-- ---------------------------------------------------------------------------
-- CHECKPOINT C2J-E — owner lead status changes + private notes, both fully
-- audited. Two new SECURITY INVOKER RPCs, following complete_lead_if_ready
-- and mark_notification_delivery_sent_v1's own established shape (row
-- lock, RAISE EXCEPTION 'function_name: reason' for distinguishable
-- failures, jsonb_build_object for structured returns, revoke from
-- public / grant to service_role only).
--
-- Neither function adds a new table. lead_activities.metadata already
-- exists, is bounded/shape-checked by is_safe_json_object, and was never
-- populated by any feature until now — it is the smallest correct place to
-- record a status transition's before/after values or a note's body text,
-- rather than introducing a dedicated lead_notes table.
--
-- Both functions upsert public.owner_profiles(id) for the calling owner
-- before inserting an owner-attributed activity row. owner_profiles is the
-- table lead_activities.actor_owner_id actually references (not
-- owner_accounts, the separate authorization gate) — see
-- 20260817120000_owner_authorization_foundation.sql's own header comment,
-- which describes owner_profiles as "identity/attribution ... for
-- lead_activities" but never populates it. This checkpoint is the first
-- feature that produces an owner-attributed activity row, so the lazy
-- upsert (never a schema change) is what actually wires that intent up.
-- The upserted id is always p_owner_user_id, which every caller sources
-- exclusively from the server-verified session (see the two new API
-- routes) — never from browser input.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Correction pass (same uncommitted migration — never applied outside this
-- local checkpoint, so extended in place rather than via a second file):
--
-- 1. lead_activities.request_id — the smallest durable anchor for
--    server-side idempotent replay of add_lead_note_v1 (see section B).
--    Nullable (system/status-change activities never set it), globally
--    unique when present. A client generates one crypto.randomUUID() per
--    logical note-composition attempt and resends the SAME value on retry
--    (see owner-leads-transport.ts / use-owner-lead-mutations.ts) — this
--    mirrors leads.idempotency_key's own client-generated-token pattern,
--    just scoped to one activity row instead of one lead.
-- 2. Both RPCs now independently verify p_owner_user_id against an active
--    public.owner_accounts row as their very first statement, before any
--    owner_profiles upsert or lead mutation. The route layer
--    (verifyOwnerSession) already enforces this before ever calling the
--    RPC, but a SECURITY INVOKER function granted to service_role must not
--    rely solely on its caller having checked — a direct RPC call with an
--    arbitrary p_owner_user_id must fail closed here too.
-- ---------------------------------------------------------------------------

alter table public.lead_activities add column if not exists request_id uuid;

create unique index if not exists lead_activities_request_id_key
  on public.lead_activities (request_id)
  where request_id is not null;

-- ---------------------------------------------------------------------------
-- A. change_lead_status_v1
-- ---------------------------------------------------------------------------
--
-- Concurrency: locks the lead row FOR UPDATE, then requires the caller's
-- p_expected_status to match the row's current status before applying
-- anything — a stale read (someone else already changed it) is rejected
-- with a distinguishable RAISE EXCEPTION, never silently overwritten. This
-- reuses the status column itself as the optimistic-concurrency token
-- (the smallest mechanism the current model supports), rather than adding
-- a new column.
--
-- Same-status request (p_new_status = the lead's current status, which by
-- construction also equals p_expected_status once the check above passes)
-- is a deterministic no-op: no UPDATE, no activity row, current state
-- returned as-is. This mirrors complete_lead_if_ready's own
-- already-done-is-a-no-op precedent and is what keeps a duplicated click
-- or retried request from ever producing a duplicate activity row.
--
-- lost_reason / closed_at: leads_lost_reason_matches_status and
-- leads_closed_at_matches_status (both defined on public.leads) require
-- these two columns to track status exactly. This function sets/clears
-- both alongside status in the same UPDATE so a real transition can never
-- violate either constraint.
create or replace function public.change_lead_status_v1(
  p_lead_id uuid,
  p_owner_user_id uuid,
  p_expected_status text,
  p_new_status text,
  p_lost_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_reason text;
  v_closed_at timestamptz;
  v_activity_id uuid;
begin
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'change_lead_status_v1: owner not authorized';
  end if;

  if p_new_status not in (
    'new', 'needs_information', 'contacted', 'inspection', 'quote_sent',
    'pickup_delivery', 'completed', 'lost', 'archived'
  ) then
    raise exception 'change_lead_status_v1: invalid status';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'change_lead_status_v1: lead not found';
  end if;
  if v_lead.submission_completed_at is null then
    -- An incomplete submission has no owner-visible workflow yet — the
    -- owner detail surface itself never reaches a mutation UI for one
    -- (owner-lead-detail.server.ts already treats it as not-found), so
    -- this is a defensive backstop, not a reachable UI path.
    raise exception 'change_lead_status_v1: lead not found';
  end if;

  if v_lead.status is distinct from p_expected_status then
    raise exception 'change_lead_status_v1: stale status';
  end if;

  if p_new_status = v_lead.status then
    -- Deterministic no-op — see header comment. Returned shape matches the
    -- real-transition branch below so callers never need to special-case it.
    return jsonb_build_object(
      'changed', false,
      'status', v_lead.status,
      'lostReason', v_lead.lost_reason,
      'closedAt', v_lead.closed_at,
      'updatedAt', v_lead.updated_at
    );
  end if;

  if p_new_status = 'lost' then
    v_reason := nullif(btrim(p_lost_reason), '');
    if v_reason is null then
      raise exception 'change_lead_status_v1: lost reason required';
    end if;
    if length(v_reason) > 300 then
      raise exception 'change_lead_status_v1: lost reason too long';
    end if;
  else
    v_reason := null;
  end if;

  if p_new_status in ('completed', 'lost', 'archived') then
    v_closed_at := now();
  else
    v_closed_at := null;
  end if;

  update public.leads
  set status = p_new_status, lost_reason = v_reason, closed_at = v_closed_at
  where id = p_lead_id;

  insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

  insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type, metadata)
  values (
    p_lead_id, 'owner', p_owner_user_id, 'status_changed',
    jsonb_build_object('from_status', v_lead.status, 'to_status', p_new_status, 'reason', v_reason)
  )
  returning id into v_activity_id;

  select * into v_lead from public.leads where id = p_lead_id;

  return jsonb_build_object(
    'changed', true,
    'status', v_lead.status,
    'lostReason', v_lead.lost_reason,
    'closedAt', v_lead.closed_at,
    'updatedAt', v_lead.updated_at,
    'activityId', v_activity_id
  );
end;
$$;

revoke execute on function public.change_lead_status_v1(uuid, uuid, text, text, text) from public;
grant execute on function public.change_lead_status_v1(uuid, uuid, text, text, text) to service_role;

comment on function public.change_lead_status_v1(uuid, uuid, text, text, text) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Locks the lead FOR UPDATE, rejects a stale '
  'p_expected_status (RAISE ''stale status''), no-ops deterministically '
  'when p_new_status already matches (no UPDATE, no activity row), '
  'otherwise validates p_new_status against the canonical vocabulary, '
  'requires+bounds p_lost_reason exactly when transitioning to ''lost'', '
  'sets/clears closed_at to satisfy leads_closed_at_matches_status, lazily '
  'upserts owner_profiles(id) for attribution, and inserts exactly one '
  'owner-attributed lead_activities(''status_changed'') row with '
  'from/to/reason metadata — all in one transaction. SECURITY INVOKER, '
  'service_role only.';

-- ---------------------------------------------------------------------------
-- B. add_lead_note_v1
-- ---------------------------------------------------------------------------
--
-- A private note is stored as its own lead_activities row
-- (event_type = 'note_added', metadata = {"note": "<body>"}) rather than a
-- new table — see this migration's header comment. Every note is a
-- distinct, durable, append-only row (lead_activities has no update/delete
-- grant to any role), so two textually-identical notes submitted under two
-- DIFFERENT request ids are both legitimate and both preserved.
--
-- Idempotency: p_request_id is a client-generated token, resent unchanged
-- across a retry of the exact same submission attempt (see
-- lead_activities_request_id_key above). A replay with the SAME
-- request_id and the SAME (lead, owner, normalized note body) returns the
-- original row's data without inserting a second one. A replay with the
-- SAME request_id but any DIFFERENT input is rejected — a reused token is
-- either a bug or an attempt to relabel a different mutation as a retry,
-- neither of which should silently succeed. The insert's own unique index
-- is the actual concurrency guard (two truly simultaneous calls with the
-- same request_id race the index, not this function's own SELECT check);
-- the unique_violation handler below re-resolves that race the same way a
-- sequential replay would.
create or replace function public.add_lead_note_v1(
  p_lead_id uuid,
  p_owner_user_id uuid,
  p_note_body text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_body text;
  v_lead public.leads%rowtype;
  v_existing public.lead_activities%rowtype;
  v_activity_id uuid;
  v_created_at timestamptz;
begin
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'add_lead_note_v1: owner not authorized';
  end if;

  if p_request_id is null then
    raise exception 'add_lead_note_v1: request_id is required';
  end if;

  v_body := nullif(btrim(p_note_body), '');
  if v_body is null then
    raise exception 'add_lead_note_v1: note body required';
  end if;
  if length(v_body) > 2000 then
    raise exception 'add_lead_note_v1: note body too long';
  end if;

  select * into v_existing from public.lead_activities where request_id = p_request_id;
  if found then
    if v_existing.lead_id = p_lead_id
       and v_existing.actor_owner_id = p_owner_user_id
       and v_existing.event_type = 'note_added'
       and (v_existing.metadata ->> 'note') = v_body
    then
      return jsonb_build_object('activityId', v_existing.id, 'note', v_existing.metadata ->> 'note', 'createdAt', v_existing.created_at);
    end if;
    raise exception 'add_lead_note_v1: request_id reused with different input';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'add_lead_note_v1: lead not found';
  end if;
  if v_lead.submission_completed_at is null then
    raise exception 'add_lead_note_v1: lead not found';
  end if;

  insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

  begin
    insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type, metadata, request_id)
    values (p_lead_id, 'owner', p_owner_user_id, 'note_added', jsonb_build_object('note', v_body), p_request_id)
    returning id, created_at into v_activity_id, v_created_at;
  exception when unique_violation then
    -- Lost the race to a genuinely concurrent identical retry — resolve it
    -- exactly like a sequential replay would, never as an internal error.
    select * into v_existing from public.lead_activities where request_id = p_request_id;
    if v_existing.lead_id = p_lead_id
       and v_existing.actor_owner_id = p_owner_user_id
       and v_existing.event_type = 'note_added'
       and (v_existing.metadata ->> 'note') = v_body
    then
      return jsonb_build_object('activityId', v_existing.id, 'note', v_existing.metadata ->> 'note', 'createdAt', v_existing.created_at);
    end if;
    raise exception 'add_lead_note_v1: request_id reused with different input';
  end;

  return jsonb_build_object('activityId', v_activity_id, 'note', v_body, 'createdAt', v_created_at);
end;
$$;

revoke execute on function public.add_lead_note_v1(uuid, uuid, text, uuid) from public;
grant execute on function public.add_lead_note_v1(uuid, uuid, text, uuid) to service_role;

comment on function public.add_lead_note_v1(uuid, uuid, text, uuid) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Requires p_request_id; a replay of the same '
  'request_id with identical (lead, owner, normalized note) returns the '
  'original row idempotently, a replay with different input is rejected. '
  'Otherwise validates an empty/whitespace-only/over-2000-char note body, '
  'locks/validates the lead, lazily upserts owner_profiles(id) for '
  'attribution, and inserts exactly one owner-attributed '
  'lead_activities(''note_added'') row — all in one transaction. '
  'SECURITY INVOKER, service_role only.';
