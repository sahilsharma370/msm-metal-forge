-- ---------------------------------------------------------------------------
-- CHECKPOINT C2J-F — owner Quick Add: one new SECURITY INVOKER RPC,
-- create_owner_quick_add_lead_v1, that lets an authenticated owner manually
-- record a phone/WhatsApp/walk-in enquiry into the exact same leads /
-- lead_activities model a website submission uses.
--
-- No new table and no new column. Three things already existed, built for
-- exactly this future feature, and are reused verbatim rather than
-- reinvented:
--
--   1. leads.capture_channel's own CHECK already allows 'phone', 'whatsapp'
--      and 'walk_in' (20260811165757_create_quote_backend_foundation.sql,
--      comment: "the other four support the future owner Quick Add path
--      (phone/whatsapp/walk_in captured live, or a backfilled manual
--      entry)"). This RPC accepts exactly those three — never 'website'
--      (that channel is create_website_quote_v1's alone) and never
--      'owner_manual' (that value is reserved, per the same comment, for a
--      distinct future *backfilled* entry feature, not a live Quick Add
--      capture — out of scope here).
--   2. leads.idempotency_key + leads.payload_hash already give this table
--      its own atomic create-or-replay mechanism — the identical fast-path
--      SELECT / INSERT / unique_violation-recovery shape
--      create_website_quote_v1 established
--      (20260812172936_create_website_quote_rpc.sql) is reused here
--      unchanged, rather than adding a second, parallel idempotency
--      mechanism (e.g. a new request_id column, the shape
--      20260817201248_owner_lead_status_and_notes.sql's two RPCs used
--      because lead_activities itself had no idempotency concept yet).
--   3. leads.submission_completed_at already documents this exact call
--      site: "A future owner Quick Add lead sets submission_completed_at
--      itself, directly and synchronously, at creation — never through
--      this website-intake-specific completion path"
--      (complete_lead_if_ready's own header comment,
--      20260813114500_lead_completion_lifecycle.sql). This RPC does exactly
--      that in the same INSERT — never calls complete_lead_if_ready, which
--      would no-op for a non-website capture_channel anyway.
--
-- Consequence of (3), reported rather than silently patched around: a
-- Quick Add lead's leads.file_upload_status stays at its column DEFAULT
-- ('none'), which satisfies leads_file_upload_status_matches_completion
-- (submission_completed_at set requires file_upload_status in
-- ('none','complete')) — so it becomes owner-inbox-eligible immediately,
-- matching leads_owner_inbox_completed_order_idx's own partial-index
-- predicate (20260817150000_owner_lead_inbox_read_index.sql) with no
-- further migration needed.
--
-- Notification decision (discovered, not invented): complete_lead_if_ready
-- is the ONLY code path that ever inserts a notification_deliveries row,
-- and it unconditionally returns false (no-op) for any non-website
-- capture_channel before it would reach that insert. Because this RPC never
-- calls complete_lead_if_ready, a Quick Add lead gets zero
-- notification_deliveries rows — there is no "new website enquiry" email
-- queued for an enquiry the owner just typed in themselves, which is
-- already this schema's own canonical behaviour for every non-website
-- channel, not a new carve-out added here.
--
-- Known side effect of that same fact, called out for a deliberate
-- follow-up decision rather than fixed here (fixing it would mean editing
-- notification-status derivation logic, which is explicitly out of scope
-- for this checkpoint): owner-leads.server.ts's/owner-lead-detail.server.ts's
-- shared deriveNotificationSummaryStatus() treats ANY completed lead with
-- no matching notification_deliveries row as "attention" ("a completed lead
-- with NO matching notification_deliveries row also maps to ''attention'',
-- never ''sent'' or omitted") — written before Quick Add existed, for the
-- website-only case where a missing row after completion is a genuine
-- pipeline anomaly. A Quick Add lead will therefore show an "attention"
-- notification badge in the owner inbox/detail UI even though nothing is
-- actually wrong (there was never a notification to send). This is a
-- pre-existing display-logic gap this checkpoint surfaces, not a bug this
-- checkpoint introduces or is authorized to fix (notifications
-- infrastructure is explicitly out of scope).
--
-- Field scope (per the checkpoint's "do not invent unnecessary required
-- fields" instruction): contact name + normalized phone, intent, material
-- (+ materialOtherText when material = 'other'), optional quantity
-- value/unit (+ quantityUnitOther when unit = 'other'), optional notes, and
-- — seller branch only — optional emirate/area. Buyer-branch location is
-- deliberately NOT captured here: every buyer destination field on `leads`
-- is gated behind buyer_trade_requirement via leads_buyer_route_field_isolation
-- (local/import/export each require a different, larger field subset), and
-- forcing a Quick Add caller to pick a trade route just to record a phone
-- call is exactly the kind of invented requirement this checkpoint's own
-- instructions warn against. A buyer Quick Add lead can still be enriched
-- with that detail afterward through the existing owner lead-detail
-- workflow; capturing it live is left to a future, deliberate checkpoint.
--
-- Security posture matches every prior owner RPC in this schema exactly:
-- SECURITY INVOKER (relies entirely on service_role's own existing table
-- grants — no new GRANT needed on leads/lead_activities/owner_profiles),
-- fixed search_path, EXECUTE revoked from public and granted only to
-- service_role, and an explicit, first-statement re-check of
-- p_owner_user_id against an ACTIVE public.owner_accounts row — the route
-- layer (verifyOwnerSession) already enforces this before ever calling the
-- RPC, but per change_lead_status_v1/add_lead_note_v1's own established
-- precedent, a SECURITY INVOKER function granted to service_role must not
-- rely solely on its caller having checked.
-- ---------------------------------------------------------------------------

create or replace function public.create_owner_quick_add_lead_v1(
  p_owner_user_id uuid,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_submission jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_intent text;
  v_channel text;
  v_material text;
  v_material_other_text text;
  v_contact_name text;
  v_contact_phone text;
  v_notes text;
  v_quantity_value numeric(12, 3);
  v_quantity_unit text;
  v_quantity_unit_other text;
  v_seller_emirate text;
  v_seller_area text;
  v_lead_id uuid;
  v_reference text;
  v_existing_hash text;
  v_idempotent_replay boolean := false;
  v_constraint_name text;
  v_activity_id uuid;
begin
  -- 1. Owner authorization — re-checked here regardless of the caller's own
  --    verification (see header comment).
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'create_owner_quick_add_lead_v1: owner not authorized';
  end if;

  -- 2. payload_hash shape — checked explicitly (not left solely to the
  --    leads table's own CHECK) because the idempotent-replay path below
  --    never reaches that INSERT, matching create_website_quote_v1's own
  --    reasoning exactly.
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'create_owner_quick_add_lead_v1: payload_hash must be a 64-character lowercase hex SHA-256 digest';
  end if;

  -- 3. Submission shape: a JSON object containing only known keys, every one
  --    explicitly extracted by name below — never a dynamic passthrough.
  if jsonb_typeof(p_submission) is distinct from 'object' then
    raise exception 'create_owner_quick_add_lead_v1: submission must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_submission) k
    where k not in (
      'intent', 'captureChannel', 'material', 'materialOtherText',
      'contactName', 'contactPhone', 'notes',
      'quantityValue', 'quantityUnit', 'quantityUnitOther',
      'sellerEmirate', 'sellerArea'
    )
  ) then
    raise exception 'create_owner_quick_add_lead_v1: submission contains an unexpected key';
  end if;

  v_intent := p_submission ->> 'intent';
  if v_intent not in ('sell', 'buy') then
    raise exception 'create_owner_quick_add_lead_v1: invalid intent';
  end if;

  -- Deliberately narrower than leads.capture_channel's own CHECK (which
  -- also allows 'website' and 'owner_manual') — see header comment.
  v_channel := p_submission ->> 'captureChannel';
  if v_channel not in ('phone', 'whatsapp', 'walk_in') then
    raise exception 'create_owner_quick_add_lead_v1: invalid capture channel';
  end if;

  v_material := p_submission ->> 'material';
  v_material_other_text := p_submission ->> 'materialOtherText';
  v_contact_name := p_submission ->> 'contactName';
  v_contact_phone := p_submission ->> 'contactPhone';
  v_notes := p_submission ->> 'notes';
  v_quantity_value := nullif(p_submission ->> 'quantityValue', '')::numeric(12, 3);
  v_quantity_unit := p_submission ->> 'quantityUnit';
  v_quantity_unit_other := p_submission ->> 'quantityUnitOther';
  v_seller_emirate := p_submission ->> 'sellerEmirate';
  v_seller_area := p_submission ->> 'sellerArea';

  -- 4. Idempotent create-or-replay — identical shape to
  --    create_website_quote_v1 (see header comment): a fast-path SELECT,
  --    then an INSERT racing leads_idempotency_key_key as the real
  --    concurrency guard, with a unique_violation handler folding the loser
  --    of that race into a replay too. A reused key with a different
  --    payload_hash is rejected on both paths.
  select id, reference, payload_hash into v_lead_id, v_reference, v_existing_hash
  from public.leads
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing_hash is distinct from p_payload_hash then
      raise exception 'create_owner_quick_add_lead_v1: idempotency_key % was already used with a different payload_hash', p_idempotency_key;
    end if;
    v_idempotent_replay := true;
  else
  begin
    if v_intent = 'sell' then
      insert into public.leads (
        idempotency_key, payload_hash, intent, capture_channel, source,
        material, material_other_text,
        seller_name, seller_phone, seller_notes,
        seller_quantity_value, seller_quantity_unit, seller_quantity_unit_other,
        seller_emirate, seller_area,
        submission_snapshot, submission_completed_at
      )
      values (
        p_idempotency_key, p_payload_hash, v_intent, v_channel, null,
        v_material, v_material_other_text,
        v_contact_name, v_contact_phone, v_notes,
        v_quantity_value, v_quantity_unit, v_quantity_unit_other,
        v_seller_emirate, v_seller_area,
        jsonb_build_object(
          'intent', v_intent, 'captureChannel', v_channel,
          'material', v_material, 'materialOtherText', v_material_other_text,
          'contactName', v_contact_name, 'contactPhone', v_contact_phone, 'notes', v_notes,
          'quantityValue', p_submission ->> 'quantityValue', 'quantityUnit', v_quantity_unit,
          'quantityUnitOther', v_quantity_unit_other,
          'sellerEmirate', v_seller_emirate, 'sellerArea', v_seller_area
        ),
        now()
      )
      returning id, reference into v_lead_id, v_reference;
    else
      insert into public.leads (
        idempotency_key, payload_hash, intent, capture_channel, source,
        material, material_other_text,
        buyer_contact_person, buyer_phone, buyer_notes,
        buyer_quantity_value, buyer_quantity_unit, buyer_quantity_unit_other,
        submission_snapshot, submission_completed_at
      )
      values (
        p_idempotency_key, p_payload_hash, v_intent, v_channel, null,
        v_material, v_material_other_text,
        v_contact_name, v_contact_phone, v_notes,
        v_quantity_value, v_quantity_unit, v_quantity_unit_other,
        jsonb_build_object(
          'intent', v_intent, 'captureChannel', v_channel,
          'material', v_material, 'materialOtherText', v_material_other_text,
          'contactName', v_contact_name, 'contactPhone', v_contact_phone, 'notes', v_notes,
          'quantityValue', p_submission ->> 'quantityValue', 'quantityUnit', v_quantity_unit,
          'quantityUnitOther', v_quantity_unit_other
        ),
        now()
      )
      returning id, reference into v_lead_id, v_reference;
    end if;
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
        raise exception 'create_owner_quick_add_lead_v1: idempotency_key % was already used with a different payload_hash', p_idempotency_key;
      end if;

      v_idempotent_replay := true;
  end;
  end if;

  -- 5. First-time success only — a replay creates no second activity row.
  if not v_idempotent_replay then
    insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

    insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type, metadata)
    values (
      v_lead_id, 'owner', p_owner_user_id, 'lead_created',
      jsonb_build_object('channel', v_channel)
    )
    returning id into v_activity_id;
  end if;

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'reference', v_reference,
    'idempotent_replay', v_idempotent_replay
  );
end;
$$;

revoke execute on function public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb) from public;
grant execute on function public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb) to service_role;

comment on function public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Atomically creates one leads row (capture_channel '
  'in (''phone'',''whatsapp'',''walk_in'') only, submission_completed_at '
  'set directly at creation so it is immediately owner-inbox-eligible, '
  'status/file_upload_status left at their column defaults) and one '
  'owner-attributed lead_activities(''lead_created'') row, or neither. '
  'Idempotent on (idempotency_key, payload_hash), identical mechanism to '
  'create_website_quote_v1: a replay with the same pair returns the '
  'original result and creates nothing new; the same key with a different '
  'hash is rejected. Never calls complete_lead_if_ready and never inserts '
  'a notification_deliveries row — see this migration''s own header '
  'comment for the discovered notification/display-status consequence. '
  'SECURITY INVOKER, service_role only.';
