-- MSM Scrap — Quote backend CHECKPOINT C2D-A: database-side lead completion
-- lifecycle and notification identity.
--
-- Scope: one new nullable leads.submission_completed_at column and its
-- one-way integrity constraint; one new notification_deliveries.event_type
-- column, its CHECK and its (lead_id, event_type, channel) UNIQUE
-- constraint; two small internal helper functions
-- (compute_lead_file_upload_status, complete_lead_if_ready); one AFTER
-- trigger on quote_upload_slots that keeps leads.file_upload_status
-- synchronized with actual slot state and atomically completes a website
-- lead the moment its last declared slot verifies; a minimal, additive
-- CREATE OR REPLACE of create_website_quote_v1 (one added line, for the
-- zero-file case — every other line is byte-for-byte unchanged from its
-- CHECKPOINT B definition); one new reconciliation RPC,
-- complete_website_quote_v1; and two dashboard-supporting index changes.
--
-- Explicitly NOT in scope: any change to finalize_quote_upload_v2,
-- claim_quote_upload_v1 or release_quote_upload_claim_v1 (none is required —
-- see the trigger's own comment for the proof); any reset/revival path for a
-- failed or expired quote_upload_slots row (reset_quote_upload_slot_v1 is
-- deliberately NOT created here — an hourly-or-slower cleanup worker would
-- almost always run after a slot's own expires_at, which is immutable and
-- capped at created_at + 30 minutes, making such a "reset" reject nearly
-- every real invocation; the honest, truthful customer instruction for a
-- failed/expired slot at launch is "this upload could not be completed,
-- please restart the enquiry" — no silent revival, ever); any Storage
-- cleanup worker; any HTTP route or frontend change; any owner Quick
-- Add/manual-lead creation RPC (a future one sets submission_completed_at
-- itself, directly and synchronously, and never goes through
-- complete_lead_if_ready — see that function's own capture_channel guard).
--
-- Security posture matches every prior migration in this schema exactly:
-- SECURITY INVOKER throughout (no function here has privileges of its own —
-- each relies entirely on service_role's own existing table grants; no new
-- table GRANT is needed anywhere in this migration), fixed search_path on
-- every function, EXECUTE revoked from public before being granted to
-- service_role alone.

-- ---------------------------------------------------------------------------
-- A. leads.submission_completed_at
-- ---------------------------------------------------------------------------

alter table public.leads add column submission_completed_at timestamptz;

comment on column public.leads.submission_completed_at is
  'The atomic point at which intake became complete and owner-workflow '
  'eligible. Set exactly once, by complete_lead_if_ready (via the '
  'quote_upload_slots_sync_lead_status trigger, create_website_quote_v1''s '
  'zero-file path, or the complete_website_quote_v1 reconciliation RPC) — '
  'never by a browser/server value, never directly by an UPDATE from '
  'application code. NULL means intake is still in progress, technically '
  'failed, or (for a non-website lead) governed by a future channel-specific '
  'path instead of this one.';

-- One-way only, deliberately: a resolved file_upload_status does NOT imply
-- completion (a brand-new website lead starts at file_upload_status='none'
-- for the brief window before its slots are inserted, and a lead that later
-- reaches 'partial'/'failed' also has a resolved-but-not-'none'/'complete'
-- status that must never satisfy this side). Only the reverse direction is
-- enforced: once submission_completed_at is set, file_upload_status must be
-- exactly the one of the two values that legitimately caused it.
alter table public.leads add constraint leads_submission_completed_requires_resolved_upload_status check (
  submission_completed_at is null
  or file_upload_status in ('none', 'complete')
);

-- ---------------------------------------------------------------------------
-- B. notification_deliveries.event_type
-- ---------------------------------------------------------------------------

-- Production currently has zero rows in this table, but this ALTER stays
-- robust for a non-empty table regardless: add nullable-with-a-temporary-
-- default (so no pre-existing row can violate NOT NULL even before the
-- explicit backfill below runs), backfill explicitly, force NOT NULL, then
-- drop the default entirely — every future INSERT must name an explicit
-- event_type; none can silently inherit one.
alter table public.notification_deliveries add column event_type text default 'submission_completed';

update public.notification_deliveries
  set event_type = 'submission_completed'
  where event_type is null;

alter table public.notification_deliveries alter column event_type set not null;
alter table public.notification_deliveries alter column event_type drop default;

-- Evolvable text+check, matching leads.status/quote_upload_slots.status's own
-- established rationale in this schema: a Postgres enum's ALTER TYPE
-- awkwardness is not worth it for a value set expected to grow (quotation
-- delivery, follow-up, etc.). Only 'submission_completed' exists today —
-- widening this list is a later, explicit, additive migration, exactly like
-- every other status-list change in this schema, never a silent acceptance.
alter table public.notification_deliveries add constraint notification_deliveries_event_type_check
  check (event_type in ('submission_completed'));

comment on column public.notification_deliveries.event_type is
  'Which lifecycle event this delivery attempt is for. Currently only '
  '''submission_completed'' (the owner new-enquiry-ready notification) is '
  'allowed — a future event type (e.g. a quotation-delivery or follow-up '
  'email) requires an explicit constraint-widening migration. Deliberately '
  'a distinct identity column, not overloaded onto recipient_hint or '
  'provider_message_id, both of which remain purely about delivery '
  'mechanics, not event identity.';

-- The uniqueness key a plain UNIQUE(lead_id, channel) could not safely be:
-- that shape would permanently block ANY second email to the owner about a
-- lead, including a future, entirely different quotation/follow-up message.
-- (lead_id, event_type, channel) guarantees at most one delivery row per
-- distinct (lead, event, channel) triple — today, at most one
-- submission_completed email per lead, ever — while structurally allowing a
-- later different event_type (or a different channel of the same event) to
-- coexist as its own, independently-deduplicated row.
alter table public.notification_deliveries
  add constraint notification_deliveries_lead_event_channel_key
  unique (lead_id, event_type, channel);

-- ---------------------------------------------------------------------------
-- C. compute_lead_file_upload_status — pure aggregate derivation
-- ---------------------------------------------------------------------------

-- STABLE (not IMMUTABLE — it reads a real table whose contents change
-- between calls; not VOLATILE — it has no side effects and returns a
-- consistent result for a fixed set of underlying rows within one
-- statement). Reads quote_upload_slots ONLY — never trusts, and has no
-- parameter for, a caller-supplied file_upload_status. Unresolved
-- (pending/uploading) always outranks verified/terminal: an upload phase
-- that hasn't finished is never reported as done, partially or otherwise,
-- regardless of how many slots already succeeded or failed.
create or replace function public.compute_lead_file_upload_status(p_lead_id uuid)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when count(*) = 0 then 'none'
    when count(*) filter (where status in ('pending', 'uploading')) > 0 then 'pending'
    when count(*) filter (where status = 'verified') = count(*) then 'complete'
    when count(*) filter (where status = 'verified') = 0 then 'failed'
    else 'partial'
  end
  from public.quote_upload_slots
  where lead_id = p_lead_id;
$$;

revoke execute on function public.compute_lead_file_upload_status(uuid) from public;
grant execute on function public.compute_lead_file_upload_status(uuid) to service_role;

comment on function public.compute_lead_file_upload_status(uuid) is
  'Pure, STABLE derivation of one lead''s aggregate file_upload_status from '
  'its actual quote_upload_slots rows only. total=0 -> none; any '
  'pending/uploading slot -> pending (unresolved always wins over any '
  'verified/terminal mixture); all verified -> complete; zero verified with '
  'the rest terminal (failed or expired) -> failed; some verified with the '
  'rest terminal -> partial. Never reads or writes leads.file_upload_status '
  'itself — complete_lead_if_ready is what persists this value.';

-- ---------------------------------------------------------------------------
-- D. complete_lead_if_ready — the one place completion side effects happen
-- ---------------------------------------------------------------------------

-- Called from exactly three places (the trigger below, create_website_quote_v1's
-- zero-file path, and complete_website_quote_v1's reconciliation path) so
-- the completion rule exists in exactly one place, never duplicated.
--
-- Lock order: this function always locks ONLY the leads row (`for update`)
-- — it never locks a quote_upload_slots row itself. Every caller that DOES
-- hold a slot lock (claim_quote_upload_v1, finalize_quote_upload_v2,
-- release_quote_upload_claim_v1, via the AFTER trigger below) always
-- acquires it BEFORE this function ever runs, and this function's own lead
-- lock is the only lock it ever requests — so the total lock order across
-- every code path in this schema is "a slot row, if any, before the lead
-- row, never the reverse". A cycle requires two edges in opposite
-- directions; with a single, universally-respected order, none can exist —
-- concurrent completions serialize on the lead row without risk of
-- deadlock (see the migration's own test file and the report accompanying
-- this checkpoint for the full trace).
create or replace function public.complete_lead_if_ready(p_lead_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_status text;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    return false;
  end if;
  if v_lead.submission_completed_at is not null then
    -- Already completed — idempotent no-op. Nothing above this lead's own
    -- resolved slots can ever change again (a verified slot can never be
    -- released/downgraded), so there is nothing left to recompute either.
    return false;
  end if;
  if v_lead.capture_channel <> 'website' then
    -- A future owner Quick Add lead sets submission_completed_at itself,
    -- directly and synchronously, at creation — never through this
    -- website-intake-specific completion path. quote_upload_slots.kind's
    -- own CHECK ('seller_photo'/'buyer_document' only, no 'owner_attachment')
    -- means no current code path can even create a slot for a non-website
    -- lead, but this guard makes that exclusion structural, not incidental.
    return false;
  end if;

  v_status := public.compute_lead_file_upload_status(p_lead_id);

  -- Persisted unconditionally (once the guards above are passed) — this is
  -- what keeps leads.file_upload_status authoritative for EVERY relevant
  -- slot-state transition, not only the ones that happen to reach
  -- completion. The `is distinct from` guard keeps a reconciliation call
  -- that finds nothing new completely side-effect-free (no updated_at bump,
  -- no row version) rather than merely idempotent.
  update public.leads
  set file_upload_status = v_status
  where id = p_lead_id and file_upload_status is distinct from v_status;

  if v_status not in ('none', 'complete') then
    return false;
  end if;

  update public.leads
  set submission_completed_at = now()
  where id = p_lead_id;

  insert into public.lead_activities (lead_id, actor_type, event_type)
  values (p_lead_id, 'system', 'submission_completed');

  -- ON CONFLICT is a backstop, not the primary control — the
  -- submission_completed_at IS NULL guard above, evaluated under this same
  -- row's FOR UPDATE lock, is what actually makes this branch reachable at
  -- most once per lead. See notification_deliveries_lead_event_channel_key.
  insert into public.notification_deliveries (lead_id, event_type, channel, status)
  values (p_lead_id, 'submission_completed', 'email', 'queued')
  on conflict (lead_id, event_type, channel) do nothing;

  return true;
end;
$$;

revoke execute on function public.complete_lead_if_ready(uuid) from public;
grant execute on function public.complete_lead_if_ready(uuid) to service_role;

comment on function public.complete_lead_if_ready(uuid) is
  'Idempotent: locks the lead, no-ops for a missing/already-completed/'
  'non-website lead, otherwise recomputes and persists '
  'leads.file_upload_status unconditionally and additionally completes '
  '(submission_completed_at + one lead_activities(''submission_completed'') '
  'row + one queued notification_deliveries row, all in this same '
  'transaction) only when the recomputed status is ''none'' or ''complete''. '
  'Never sets or reads leads.status — the owner workflow column is '
  'untouched by this function. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- E. Slot-state synchronization trigger
-- ---------------------------------------------------------------------------

-- AFTER (not BEFORE): this trigger's whole purpose is propagating a
-- just-committed-within-this-transaction slot change to a DIFFERENT table
-- (leads) — an AFTER trigger is the correct shape for cross-table
-- side-effect propagation, as opposed to a BEFORE trigger's row-mutation
-- role (already used elsewhere on this same table for exactly that: storage
-- path assignment, immutability enforcement, ownership-match checks).
--
-- Fires on INSERT (a fresh slot changes the lead's total/unresolved count)
-- and on UPDATE OF status specifically (every lifecycle transition this
-- schema has — pending->uploading, uploading->verified,
-- uploading->pending/failed/expired — changes `status`; no other column
-- change needs to re-trigger this).
--
-- Cannot recurse: complete_lead_if_ready only ever writes to
-- public.leads, public.lead_activities and public.notification_deliveries —
-- never back to public.quote_upload_slots, the table this trigger is on.
-- There is therefore no code path by which this trigger's own side effects
-- could cause itself to fire again, with or without an explicit guard.
create or replace function public.quote_upload_slots_sync_lead_status()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  perform public.complete_lead_if_ready(new.lead_id);
  return new;
end;
$$;

revoke execute on function public.quote_upload_slots_sync_lead_status() from public;
grant execute on function public.quote_upload_slots_sync_lead_status() to service_role;

create trigger quote_upload_slots_sync_lead_status
  after insert or update of status on public.quote_upload_slots
  for each row
  execute function public.quote_upload_slots_sync_lead_status();

comment on function public.quote_upload_slots_sync_lead_status() is
  'Keeps leads.file_upload_status synchronized with actual quote_upload_slots '
  'state on every insert/status transition, and is what makes the LAST '
  'finalize_quote_upload_v2 call for a lead atomically complete it — in the '
  'very same transaction finalize_quote_upload_v2''s own UPDATE commits, '
  'with no dependency on a browser making any further request. '
  'finalize_quote_upload_v2 itself is unmodified: it has no knowledge that '
  'completion exists.';

-- ---------------------------------------------------------------------------
-- F. create_website_quote_v1 — additive: zero-file completion
-- ---------------------------------------------------------------------------

-- Every line below is byte-for-byte identical to the CHECKPOINT B
-- definition except the single `perform public.complete_lead_if_ready(...)`
-- call added at the end of the non-replay block. Validation, result shape,
-- idempotency, grants (CREATE OR REPLACE does not reset a function's
-- existing GRANTs — service_role's EXECUTE from CHECKPOINT B is untouched
-- and is not re-granted here), search_path and security are unchanged.
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

    -- CHECKPOINT C2D-A: the one added line. A zero-file website enquiry has
    -- nothing left to upload, so it is immediately eligible for completion —
    -- no slot INSERT (and therefore no quote_upload_slots_sync_lead_status
    -- trigger fire) ever happens for it otherwise. For a nonzero-file lead
    -- this is a safe, idempotent no-op: the trigger already fired once per
    -- slot insert above, file_upload_status is already 'pending', and
    -- complete_lead_if_ready's own readiness gate simply declines again —
    -- it does not duplicate or race with what the trigger already did.
    perform public.complete_lead_if_ready(v_lead_id);
  end if;

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

-- No revoke/grant here: CREATE OR REPLACE preserves a function's existing
-- privileges — service_role's EXECUTE from CHECKPOINT B is unaffected, and
-- re-stating it would be redundant, exactly like C2B1's own CREATE OR
-- REPLACE of finalize_quote_upload_v1 (which also cited nothing further to
-- grant).

comment on function public.create_website_quote_v1(uuid, text, jsonb, jsonb) is
  'Atomic entry point for one website Quote Experience submission: creates '
  'exactly one leads row (capture_channel forced to ''website''), one '
  'lead_activities(''lead_created'') row and zero-to-five quote_upload_slots '
  'rows, or none of them. As of CHECKPOINT C2D-A, a zero-file submission is '
  'also atomically completed in this same call via complete_lead_if_ready — '
  'a nonzero-file submission completes later, automatically, the moment its '
  'last slot verifies (see quote_upload_slots_sync_lead_status). SECURITY '
  'INVOKER — relies entirely on the caller''s (service_role''s) own table '
  'grants, never elevates. Idempotent on (idempotency_key, payload_hash): a '
  'replay with the same pair returns the original result and creates '
  'nothing new — including no second activity or notification row.';

-- ---------------------------------------------------------------------------
-- G. complete_website_quote_v1 — reconciliation only
-- ---------------------------------------------------------------------------

-- Not the mechanism completion depends on (see part E's trigger) — purely a
-- safe, idempotent "ask/confirm the truth" endpoint for a browser that
-- missed its own last upload response. It can only ever confirm or perform
-- a transition complete_lead_if_ready itself already deems ready; it has no
-- code path that bypasses that shared readiness rule.
create or replace function public.complete_website_quote_v1(
  p_lead_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
begin
  -- Same "possession proof via join, identical not-found outcome either
  -- way" pattern as every other RPC in this schema — a lead that exists
  -- under a different idempotency key produces the exact same exception as
  -- a lead_id that does not exist at all.
  select * into v_lead
  from public.leads
  where id = p_lead_id and idempotency_key = p_idempotency_key
  for update;

  if not found then
    raise exception 'complete_website_quote_v1: lead not found for the supplied idempotency key';
  end if;

  if v_lead.submission_completed_at is not null then
    return jsonb_build_object(
      'lead_id', v_lead.id,
      'reference', v_lead.reference,
      'submission_completed_at', v_lead.submission_completed_at,
      'already_completed', true
    );
  end if;

  if not public.complete_lead_if_ready(p_lead_id) then
    raise exception 'complete_website_quote_v1: lead % is not yet ready to complete (NOT_READY)', p_lead_id;
  end if;

  select * into v_lead from public.leads where id = p_lead_id;

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'reference', v_lead.reference,
    'submission_completed_at', v_lead.submission_completed_at,
    'already_completed', false
  );
end;
$$;

revoke execute on function public.complete_website_quote_v1(uuid, uuid) from public;
grant execute on function public.complete_website_quote_v1(uuid, uuid) to service_role;

comment on function public.complete_website_quote_v1(uuid, uuid) is
  'Idempotent reconciliation only — normal completion never depends on this '
  'being called (see quote_upload_slots_sync_lead_status). Already-complete '
  'replay returns already_completed=true with no new side effects; an '
  'incomplete lead raises a NOT_READY exception with no side effects at '
  'all (complete_lead_if_ready''s own file_upload_status persist is '
  'itself side-effect-free when nothing has changed, via its `is distinct '
  'from` guard). Cannot force-complete an incomplete lead — it has no logic '
  'of its own for deciding readiness, only complete_lead_if_ready does. '
  'SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- H. Dashboard indexes
-- ---------------------------------------------------------------------------

-- Redefined (drop + recreate, same pattern already used for every
-- constraint revision in this schema — plain indexes have no ALTER-in-place
-- equivalent either): normal inbox eligibility now requires genuine intake
-- completion, not just an open business status. Channel-agnostic by
-- construction — a future owner/manual lead sets submission_completed_at
-- itself, directly, at creation, so it becomes dashboard-visible through
-- this exact same predicate without this index (or this migration) needing
-- any channel-specific branch.
drop index public.leads_open_dashboard_idx;
create index leads_open_dashboard_idx on public.leads (status, created_at)
  where status not in ('completed', 'lost', 'archived') and submission_completed_at is not null;

-- Minimal partial index for the "stuck/incomplete website submissions" view
-- an owner dashboard will eventually need — scoped to capture_channel =
-- 'website' specifically, since that is the only channel this checkpoint's
-- asynchronous, slot-driven completion can ever leave incomplete for any
-- length of time (a manual lead completes synchronously at creation and
-- would never appear here). No cleanup job reads this index yet — it only
-- exists so a future one, and a future owner-facing view, has the query
-- shape it needs without a sequential scan.
create index leads_submission_incomplete_idx on public.leads (created_at)
  where submission_completed_at is null and capture_channel = 'website';
