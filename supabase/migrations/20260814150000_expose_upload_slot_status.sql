-- MSM Scrap — Quote backend CHECKPOINT C2F-C1: expose authoritative
-- per-slot upload status from create_website_quote_v1.
--
-- Scope: a single, minimal, additive CREATE OR REPLACE of
-- create_website_quote_v1 (its CHECKPOINT C2D-A definition in
-- 20260813114500_lead_completion_lifecycle.sql) that adds exactly one key,
-- 'status', to each element of the upload_slots array in its return value.
-- Every other line — validation, idempotent-replay handling, the zero-file
-- complete_lead_if_ready call, atomicity, grants — is byte-for-byte
-- unchanged from that definition.
--
-- Why: CHECKPOINT C2F-C's browser-safe draft-recovery foundation found that
-- an initiate replay could not tell a resumed draft which of its declared
-- upload slots had already been verified before a reload, because
-- quote_upload_slots.status exists at the DB layer but was never surfaced
-- through this RPC. Without it, a safe file-recovery UI has no authoritative
-- signal to skip re-prompting for an already-uploaded file, and the
-- CHECKPOINT C2F-C code deliberately refused to guess (see
-- isSlotKnownVerified's prior always-false implementation and its own
-- comment). This migration closes that gap at its source: the one function
-- that already reads every slot's live row back from the database, fresh or
-- on replay.
--
-- status is taken directly from quote_upload_slots.status — never inferred,
-- computed or defaulted here. Its five values (pending, uploading, verified,
-- failed, expired) are exactly the column's own CHECK constraint from
-- 20260812170045_quote_upload_slots_and_storage.sql and
-- 20260812191235_quote_upload_claim_lifecycle.sql; this migration does not
-- add, remove or reinterpret any of them.
--
-- Explicitly NOT in scope: removing storage_path from the same response (a
-- separate CHECKPOINT C2F-C1 finding — the browser upload flow
-- (processQuoteUpload in src/server/quote/upload-quote.ts) already
-- addresses every Storage object exclusively by slotId + idempotencyKey via
-- claim_quote_upload_v1's own upload_object_path, never by this response's
-- storage_path, so nothing browser-side genuinely needs it — but several
-- existing tests and the current response contract still assert its
-- presence, and removing it is not required to close the status gap this
-- migration exists for); any change to claim_quote_upload_v1,
-- finalize_quote_upload_v2, release_quote_upload_claim_v1 or
-- complete_website_quote_v1 (none needs one); any HTTP route or frontend
-- change (that is CHECKPOINT C2F-C1's own separate TypeScript/browser
-- follow-up, not this migration).
--
-- Security posture unchanged: SECURITY INVOKER, fixed search_path, no new
-- privilege. CREATE OR REPLACE preserves the function's existing grants —
-- service_role's EXECUTE from CHECKPOINT B is untouched and is not
-- re-granted here, exactly like every prior CREATE OR REPLACE of this same
-- function.

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
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'create_website_quote_v1: payload_hash must be a 64-character lowercase hex SHA-256 digest';
  end if;

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
  v_kind := case v_intent when 'sell' then 'seller_photo' when 'buy' then 'buyer_document' else null end;

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

    perform public.complete_lead_if_ready(v_lead_id);
  end if;

  -- ---------------------------------------------------------------------
  -- CHECKPOINT C2F-C1: the one added key. status comes directly from this
  -- same freshly-read qus row — never a caller-supplied or otherwise
  -- derived value — so a fresh slot reads 'pending' (its column DEFAULT)
  -- and a replay after any lifecycle transition (claim/finalize/release)
  -- reads whatever that transition actually left behind, including
  -- 'uploading', 'verified', 'failed' or 'expired'.
  -- ---------------------------------------------------------------------
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot_id', qus.id,
        'slot_index', qus.slot_index,
        'kind', qus.kind,
        'status', qus.status,
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

-- No revoke/grant here: CREATE OR REPLACE preserves a function's existing
-- privileges — service_role's EXECUTE from CHECKPOINT B is unaffected.

comment on function public.create_website_quote_v1(uuid, text, jsonb, jsonb) is
  'Atomic entry point for one website Quote Experience submission: creates '
  'exactly one leads row (capture_channel forced to ''website''), one '
  'lead_activities(''lead_created'') row and zero-to-five quote_upload_slots '
  'rows, or none of them. A zero-file submission is also atomically '
  'completed in this same call via complete_lead_if_ready (CHECKPOINT '
  'C2D-A) — a nonzero-file submission completes later, automatically, the '
  'moment its last slot verifies. As of CHECKPOINT C2F-C1, each returned '
  'upload_slots element also includes its authoritative current status '
  '(pending/uploading/verified/failed/expired), read directly from '
  'quote_upload_slots.status on both first success and idempotent replay — '
  'never inferred. SECURITY INVOKER — relies entirely on the caller''s '
  '(service_role''s) own table grants, never elevates. Idempotent on '
  '(idempotency_key, payload_hash): a replay with the same pair returns the '
  'current state of the original lead and creates nothing new.';
