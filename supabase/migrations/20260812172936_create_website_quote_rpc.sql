-- MSM Scrap — Quote backend CHECKPOINT B: atomic website Quote creation RPC.
--
-- Scope: exactly one function, public.create_website_quote_v1, that is the
-- single entry point the future server uses to turn one validated Quote
-- Experience submission into durable rows: one leads row, exactly one
-- lead_activities('lead_created') row, and zero to five quote_upload_slots
-- rows — all four (lead + activity + N slots) or none, atomically. Explicitly
-- NOT in scope: any HTTP/API route, any frontend change, signed upload URLs
-- or Storage object access (this function only ever writes to leads,
-- lead_activities and quote_upload_slots — never storage.objects).
--
-- Versioned as _v1 deliberately: the submission JSON shape below is a
-- contract with the future server. A breaking change to that shape gets a
-- new create_website_quote_v2 function alongside this one, never a
-- silent behavioural change to v1.
--
-- Security posture: SECURITY INVOKER, not DEFINER — this function has no
-- privileges of its own; it runs as whatever role calls it, and every
-- internal INSERT/SELECT relies entirely on that role's own table grants.
-- Only service_role holds EXECUTE, and service_role already holds exactly
-- the SELECT/INSERT(/UPDATE) grants on leads, lead_activities and
-- quote_upload_slots from the two prior migrations — so no new table GRANT
-- is needed here at all. Fixed search_path, EXECUTE revoked from public
-- (and therefore anon/authenticated) before being granted to service_role.

create or replace function public.create_website_quote_v1(
  p_idempotency_key uuid,
  p_payload_hash text,
  p_submission jsonb,
  p_files jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  -- A caller-omitted p_files is treated identically to an explicit '[]' —
  -- "no files selected" is a normal, common case, not a malformed one.
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  v_file_count int;
  v_file jsonb;
  v_lead_id uuid;
  v_reference text;
  v_existing_hash text;
  v_intent text;
  v_kind text;
  v_idempotent_replay boolean := false;
  v_slots jsonb;
  v_constraint_name text;
begin
  -- ---------------------------------------------------------------------
  -- 1. payload_hash shape. Checked here explicitly (not left solely to the
  --    leads table's own CHECK) because the idempotent-replay path below
  --    never reaches that INSERT, and a malformed hash must still be
  --    rejected on every path, including replay.
  -- ---------------------------------------------------------------------
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'create_website_quote_v1: payload_hash must be a 64-character lowercase hex SHA-256 digest';
  end if;

  -- ---------------------------------------------------------------------
  -- 2. Submission shape: must be a JSON object containing only known keys.
  --    Every key here is explicitly extracted by name below — nothing is
  --    ever looped over or passed through dynamically — so an unexpected
  --    key is rejected outright rather than silently ignored or stored.
  --    This is the exact current frontend QuoteFormValues field set (minus
  --    sellerPhotos/buyerDocuments, which arrive separately as p_files)
  --    plus `source`, the one website-lead field QuoteFormValues itself
  --    does not carry (it lives on QuoteInitialContext instead).
  -- ---------------------------------------------------------------------
  if jsonb_typeof(p_submission) is distinct from 'object' then
    raise exception 'create_website_quote_v1: submission must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_submission) k
    where k not in (
      'intent', 'material', 'subtype', 'subtypeOtherText', 'otherMaterialText', 'materialSpec',
      'sellerQuantityValue', 'sellerQuantityUnit', 'sellerQuantityUnitOther', 'sellerQuantityUnsure',
      'sellerCondition', 'sellerDescription',
      'buyerQuantityValue', 'buyerQuantityUnit', 'buyerQuantityUnitOther',
      'buyerTradeRequirement', 'buyerRequiredByDate', 'buyerAdditionalSpec',
      'sellerEmirate', 'sellerArea', 'sellerMapLink', 'sellerPickupRequired', 'sellerPickupDate', 'sellerAccessNote',
      'buyerDestinationEmirate', 'buyerDestinationArea', 'buyerDestinationMapLink', 'buyerFulfilment',
      'buyerDestinationCountry', 'buyerDestinationCityPort',
      'buyerPreferredPort', 'buyerPreferredPortOther', 'buyerOriginCountryPreference',
      'buyerLogisticsRequirement', 'buyerLogisticsNote',
      'sellerName', 'sellerPhone', 'sellerCompany', 'sellerEmail', 'sellerPreferredContact', 'sellerNotes',
      'buyerCompany', 'buyerContactPerson', 'buyerPhone', 'buyerEmail', 'buyerPreferredContact', 'buyerNotes',
      'source'
    )
  ) then
    raise exception 'create_website_quote_v1: submission contains an unexpected key';
  end if;

  -- ---------------------------------------------------------------------
  -- 3. File declarations: bounded JSON array, each element containing only
  --    the three declared-metadata keys. storage_path, slot_index and kind
  --    are NEVER accepted here at any layer — they are computed below
  --    (slot_index/kind) or generated by the existing
  --    quote_upload_slots_assign_storage_path trigger (storage_path).
  -- ---------------------------------------------------------------------
  if jsonb_typeof(v_files) is distinct from 'array' then
    raise exception 'create_website_quote_v1: files must be a JSON array';
  end if;
  v_file_count := jsonb_array_length(v_files);
  if v_file_count > 5 then
    raise exception 'create_website_quote_v1: at most 5 file declarations are allowed (got %)', v_file_count;
  end if;
  for i in 0 .. v_file_count - 1 loop
    v_file := v_files -> i;
    if jsonb_typeof(v_file) is distinct from 'object' then
      raise exception 'create_website_quote_v1: file declaration at index % is not an object', i;
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_file) k
      where k not in ('original_filename', 'declared_mime_type', 'declared_byte_size')
    ) then
      raise exception 'create_website_quote_v1: file declaration at index % contains an unexpected key', i;
    end if;
  end loop;

  v_intent := p_submission ->> 'intent';
  -- Guaranteed 'seller_photo' or 'buyer_document' by the time this is used
  -- below: if v_intent is neither 'sell' nor 'buy', the leads insert fails
  -- its own intent CHECK before the file loop that uses v_kind ever runs.
  v_kind := case v_intent when 'sell' then 'seller_photo' when 'buy' then 'buyer_document' else null end;

  -- ---------------------------------------------------------------------
  -- 4. Idempotent create-or-replay.
  --
  --    A fast-path SELECT runs first purely as an optimization — so a
  --    genuine retry never has to re-run the full column mapping/CHECK
  --    gauntlet just to be told "you already did this" — but it is NOT
  --    the correctness mechanism and never the sole guard against a
  --    duplicate: the INSERT below still always runs whenever this SELECT
  --    finds nothing, and public.leads.idempotency_key's own UNIQUE
  --    constraint (leads_idempotency_key_key) is what actually decides
  --    the race for two concurrent calls with the same key that both pass
  --    this fast-path SELECT before either has committed. Exactly one
  --    INSERT wins regardless of timing; the loser is caught below by the
  --    unique_violation handler and folded into a replay too. There is no
  --    window in which a check-then-insert race could let both succeed.
  --
  --    Every server/owner-managed leads column (reference, sequence_number,
  --    status, lost_reason, closed_at, created_at, updated_at,
  --    submission_schema_version) is deliberately absent from the INSERT's
  --    column list below, so the caller has no way to set any of them —
  --    they take their own column DEFAULT or trigger-assigned value.
  -- ---------------------------------------------------------------------
  select id, reference, payload_hash into v_lead_id, v_reference, v_existing_hash
  from public.leads
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing_hash is distinct from p_payload_hash then
      raise exception 'create_website_quote_v1: idempotency_key % was already used with a different payload_hash', p_idempotency_key;
    end if;
    v_idempotent_replay := true;
  else
  begin
    insert into public.leads (
      idempotency_key, payload_hash, intent, capture_channel, source,
      material, material_subtype, material_subtype_other_text, material_other_text, material_spec,
      seller_quantity_value, seller_quantity_unit, seller_quantity_unit_other, seller_quantity_unsure,
      seller_condition, seller_description,
      seller_emirate, seller_area, seller_map_link, seller_pickup_required, seller_pickup_date, seller_access_note,
      seller_name, seller_phone, seller_company, seller_email, seller_preferred_contact, seller_notes,
      buyer_quantity_value, buyer_quantity_unit, buyer_quantity_unit_other,
      buyer_trade_requirement, buyer_required_by_date, buyer_additional_spec,
      buyer_destination_emirate, buyer_destination_area, buyer_destination_map_link, buyer_fulfilment,
      buyer_destination_country, buyer_destination_city_port,
      buyer_preferred_port, buyer_preferred_port_other, buyer_origin_country_preference,
      buyer_logistics_requirement, buyer_logistics_note,
      buyer_company, buyer_contact_person, buyer_phone, buyer_email, buyer_preferred_contact, buyer_notes,
      submission_snapshot
    )
    values (
      p_idempotency_key, p_payload_hash, v_intent, 'website', p_submission ->> 'source',
      p_submission ->> 'material', p_submission ->> 'subtype', p_submission ->> 'subtypeOtherText',
      p_submission ->> 'otherMaterialText', p_submission ->> 'materialSpec',
      nullif(p_submission ->> 'sellerQuantityValue', '')::numeric(12, 3),
      p_submission ->> 'sellerQuantityUnit', p_submission ->> 'sellerQuantityUnitOther',
      coalesce((p_submission ->> 'sellerQuantityUnsure')::boolean, false),
      p_submission ->> 'sellerCondition', p_submission ->> 'sellerDescription',
      p_submission ->> 'sellerEmirate', p_submission ->> 'sellerArea', p_submission ->> 'sellerMapLink',
      p_submission ->> 'sellerPickupRequired', nullif(p_submission ->> 'sellerPickupDate', '')::date,
      p_submission ->> 'sellerAccessNote',
      p_submission ->> 'sellerName', p_submission ->> 'sellerPhone', p_submission ->> 'sellerCompany',
      p_submission ->> 'sellerEmail', p_submission ->> 'sellerPreferredContact', p_submission ->> 'sellerNotes',
      nullif(p_submission ->> 'buyerQuantityValue', '')::numeric(12, 3),
      p_submission ->> 'buyerQuantityUnit', p_submission ->> 'buyerQuantityUnitOther',
      p_submission ->> 'buyerTradeRequirement', nullif(p_submission ->> 'buyerRequiredByDate', '')::date,
      p_submission ->> 'buyerAdditionalSpec',
      p_submission ->> 'buyerDestinationEmirate', p_submission ->> 'buyerDestinationArea',
      p_submission ->> 'buyerDestinationMapLink', p_submission ->> 'buyerFulfilment',
      p_submission ->> 'buyerDestinationCountry', p_submission ->> 'buyerDestinationCityPort',
      p_submission ->> 'buyerPreferredPort', p_submission ->> 'buyerPreferredPortOther',
      p_submission ->> 'buyerOriginCountryPreference',
      p_submission ->> 'buyerLogisticsRequirement', p_submission ->> 'buyerLogisticsNote',
      p_submission ->> 'buyerCompany', p_submission ->> 'buyerContactPerson', p_submission ->> 'buyerPhone',
      p_submission ->> 'buyerEmail', p_submission ->> 'buyerPreferredContact', p_submission ->> 'buyerNotes',
      -- Built field-by-field from the same explicitly-extracted values
      -- above (never a passthrough of p_submission itself), matching the
      -- "server constructs the JSON field-by-field from validated input"
      -- contract is_safe_json_object documents. No `files`/`sellerPhotos`/
      -- `buyerDocuments` key is included — is_safe_json_object rejects
      -- those key names at any depth by design, and file metadata already
      -- has its own durable home in quote_upload_slots.
      jsonb_build_object(
        'intent', v_intent, 'source', p_submission ->> 'source',
        'material', p_submission ->> 'material', 'subtype', p_submission ->> 'subtype',
        'subtypeOtherText', p_submission ->> 'subtypeOtherText',
        'otherMaterialText', p_submission ->> 'otherMaterialText',
        'materialSpec', p_submission ->> 'materialSpec',
        'sellerQuantityValue', p_submission ->> 'sellerQuantityValue',
        'sellerQuantityUnit', p_submission ->> 'sellerQuantityUnit',
        'sellerQuantityUnitOther', p_submission ->> 'sellerQuantityUnitOther',
        'sellerQuantityUnsure', coalesce((p_submission ->> 'sellerQuantityUnsure')::boolean, false),
        'sellerCondition', p_submission ->> 'sellerCondition',
        'sellerDescription', p_submission ->> 'sellerDescription',
        'sellerEmirate', p_submission ->> 'sellerEmirate', 'sellerArea', p_submission ->> 'sellerArea',
        'sellerMapLink', p_submission ->> 'sellerMapLink',
        'sellerPickupRequired', p_submission ->> 'sellerPickupRequired',
        'sellerPickupDate', p_submission ->> 'sellerPickupDate',
        'sellerAccessNote', p_submission ->> 'sellerAccessNote',
        'sellerName', p_submission ->> 'sellerName', 'sellerPhone', p_submission ->> 'sellerPhone',
        'sellerCompany', p_submission ->> 'sellerCompany', 'sellerEmail', p_submission ->> 'sellerEmail',
        'sellerPreferredContact', p_submission ->> 'sellerPreferredContact',
        'sellerNotes', p_submission ->> 'sellerNotes',
        'buyerQuantityValue', p_submission ->> 'buyerQuantityValue',
        'buyerQuantityUnit', p_submission ->> 'buyerQuantityUnit',
        'buyerQuantityUnitOther', p_submission ->> 'buyerQuantityUnitOther',
        'buyerTradeRequirement', p_submission ->> 'buyerTradeRequirement',
        'buyerRequiredByDate', p_submission ->> 'buyerRequiredByDate',
        'buyerAdditionalSpec', p_submission ->> 'buyerAdditionalSpec',
        'buyerDestinationEmirate', p_submission ->> 'buyerDestinationEmirate',
        'buyerDestinationArea', p_submission ->> 'buyerDestinationArea',
        'buyerDestinationMapLink', p_submission ->> 'buyerDestinationMapLink',
        'buyerFulfilment', p_submission ->> 'buyerFulfilment',
        'buyerDestinationCountry', p_submission ->> 'buyerDestinationCountry',
        'buyerDestinationCityPort', p_submission ->> 'buyerDestinationCityPort',
        'buyerPreferredPort', p_submission ->> 'buyerPreferredPort',
        'buyerPreferredPortOther', p_submission ->> 'buyerPreferredPortOther',
        'buyerOriginCountryPreference', p_submission ->> 'buyerOriginCountryPreference',
        'buyerLogisticsRequirement', p_submission ->> 'buyerLogisticsRequirement',
        'buyerLogisticsNote', p_submission ->> 'buyerLogisticsNote',
        'buyerCompany', p_submission ->> 'buyerCompany',
        'buyerContactPerson', p_submission ->> 'buyerContactPerson',
        'buyerPhone', p_submission ->> 'buyerPhone', 'buyerEmail', p_submission ->> 'buyerEmail',
        'buyerPreferredContact', p_submission ->> 'buyerPreferredContact',
        'buyerNotes', p_submission ->> 'buyerNotes'
      )
    )
    returning id, reference into v_lead_id, v_reference;
  exception
    when unique_violation then
      -- Only leads_idempotency_key_key means "a concurrent call won the
      -- race between our fast-path SELECT above and this INSERT" — any
      -- other unique_violation (there is no realistic other source given
      -- this INSERT's shape, but this stays precise rather than assuming)
      -- is a genuine failure and must propagate.
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name is distinct from 'leads_idempotency_key_key' then
        raise;
      end if;

      select id, reference, payload_hash into v_lead_id, v_reference, v_existing_hash
      from public.leads
      where idempotency_key = p_idempotency_key;

      if v_existing_hash is distinct from p_payload_hash then
        raise exception 'create_website_quote_v1: idempotency_key % was already used with a different payload_hash', p_idempotency_key;
      end if;

      v_idempotent_replay := true;
  end;
  end if;

  -- ---------------------------------------------------------------------
  -- 5. First-time success only. Skipped entirely on replay, so a retry
  --    never creates a second activity row or a second set of slots —
  --    "first successful call creates one lead" extends to its activity
  --    and slots too. Any failure here (an invalid file declaration,
  --    say) propagates uncaught: because it was never wrapped in its own
  --    BEGIN/EXCEPTION block, Postgres unwinds the WHOLE function
  --    invocation, including the leads insert above — there is no
  --    partial state to clean up, by ordinary transaction semantics
  --    rather than any extra rollback logic here.
  -- ---------------------------------------------------------------------
  if not v_idempotent_replay then
    insert into public.lead_activities (lead_id, actor_type, event_type)
    values (v_lead_id, 'system', 'lead_created');

    for i in 0 .. v_file_count - 1 loop
      v_file := v_files -> i;
      insert into public.quote_upload_slots (
        lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size
      )
      values (
        v_lead_id, i, v_kind,
        v_file ->> 'original_filename', v_file ->> 'declared_mime_type',
        nullif(v_file ->> 'declared_byte_size', '')::bigint
      );
    end loop;
  end if;

  -- ---------------------------------------------------------------------
  -- 6. Deterministic return payload, read back fresh from the durable
  --    rows (never echoed from caller input) — identical shape whether
  --    this call just created everything or is replaying one that already
  --    succeeded. storage_path/expires_at here are exactly what the
  --    existing quote_upload_slots_assign_storage_path trigger and the
  --    table's own expires_at DEFAULT produced — this function never sets
  --    either directly.
  -- ---------------------------------------------------------------------
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot_id', qus.id,
        'slot_index', qus.slot_index,
        'kind', qus.kind,
        'storage_path', qus.storage_path,
        'expires_at', qus.expires_at,
        'original_filename', qus.original_filename,
        'declared_mime_type', qus.declared_mime_type,
        'declared_byte_size', qus.declared_byte_size
      )
      order by qus.slot_index
    ),
    '[]'::jsonb
  )
  into v_slots
  from public.quote_upload_slots qus
  where qus.lead_id = v_lead_id;

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'reference', v_reference,
    'idempotent_replay', v_idempotent_replay,
    'upload_slots', v_slots
  );
end;
$$;

revoke execute on function public.create_website_quote_v1(uuid, text, jsonb, jsonb) from public;
grant execute on function public.create_website_quote_v1(uuid, text, jsonb, jsonb) to service_role;

comment on function public.create_website_quote_v1(uuid, text, jsonb, jsonb) is
  'Atomic entry point for one website Quote Experience submission: creates '
  'exactly one leads row (capture_channel forced to ''website''), one '
  'lead_activities(''lead_created'') row and zero-to-five quote_upload_slots '
  'rows, or none of them. SECURITY INVOKER — relies entirely on the '
  'caller''s (service_role''s) own table grants, never elevates. Idempotent '
  'on (idempotency_key, payload_hash): a replay with the same pair returns '
  'the original result and creates nothing new; the same key with a '
  'different hash is rejected.';
