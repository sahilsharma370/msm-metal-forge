-- BATCH 3B — Freeze trashed enquiries: change_lead_status_v1 and
-- add_lead_note_v1 must reject a trashed lead (deleted_at is not null)
-- exactly like update_lead_details_v1 already does, using the identical
-- '<fn>: lead not editable' RAISE convention so the existing server-side
-- NOT_EDITABLE mapping pattern (see owner-lead-edit.server.ts) can be
-- reused unchanged in shape for these two RPCs.
--
-- Scope, precisely: ONLY deleted_at is checked. status = 'archived' is
-- deliberately NOT checked here — archived-lead status changes/notes
-- (e.g. un-archiving) must keep working exactly as before. This is a new
-- forward migration; 20260817201248_owner_lead_status_and_notes.sql (the
-- migration that originally defined both functions) is never edited.
--
-- The new check sits immediately after each function's existing
-- lead-not-found/incomplete-submission guard and before any other
-- validation (stale-status, no-op, lost-reason, idempotent-replay-of-a-
-- NEW-insert) — the row is already locked FOR UPDATE at that point in both
-- functions, so a rejection here means zero rows were touched: no leads
-- UPDATE, no lead_activities INSERT. A retried rejected request behaves
-- identically every time (same RAISE, same zero side effects) since
-- nothing before the new check is stateful. Every other line below is
-- copied verbatim from the original migration — nothing else changed.

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

  -- BATCH 3B — a trashed lead is read-only: status stays frozen at
  -- whatever it was the instant it was trashed, until Restore. Deliberately
  -- checked before the stale-status/no-op branches below, so a trashed
  -- lead's status can never change for ANY reason, including a same-status
  -- resubmit. status = 'archived' is intentionally NOT checked here —
  -- un-archiving (and every other archived-lead status change) is
  -- unaffected by this batch.
  if v_lead.deleted_at is not null then
    raise exception 'change_lead_status_v1: lead not editable';
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
  'before anything else. Locks the lead FOR UPDATE, rejects a trashed lead '
  '(RAISE ''lead not editable'', BATCH 3B — deleted_at only, never '
  'status = ''archived''), rejects a stale p_expected_status (RAISE '
  '''stale status''), no-ops deterministically when p_new_status already '
  'matches (no UPDATE, no activity row), otherwise validates p_new_status '
  'against the canonical vocabulary, requires+bounds p_lost_reason exactly '
  'when transitioning to ''lost'', sets/clears closed_at to satisfy '
  'leads_closed_at_matches_status, lazily upserts owner_profiles(id) for '
  'attribution, and inserts exactly one owner-attributed '
  'lead_activities(''status_changed'') row with from/to/reason metadata — '
  'all in one transaction. SECURITY INVOKER, service_role only.';

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

  -- BATCH 3B — a trashed lead is read-only: no new note may be attached
  -- until Restore. Checked after the idempotent-replay-of-an-existing-note
  -- branch above (replaying a note that was already added before the lead
  -- was trashed is a pure read of already-committed data, not a new
  -- mutation, so it stays allowed) but before the INSERT below. status =
  -- 'archived' is intentionally NOT checked here — notes on an archived
  -- lead are unaffected by this batch.
  if v_lead.deleted_at is not null then
    raise exception 'add_lead_note_v1: lead not editable';
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
  'original row idempotently even if the lead has since been trashed, a '
  'replay with different input is rejected. Otherwise validates an '
  'empty/whitespace-only/over-2000-char note body, locks the lead, rejects '
  'a trashed lead for a genuinely NEW note (RAISE ''lead not editable'', '
  'BATCH 3B — deleted_at only, never status = ''archived''), lazily '
  'upserts owner_profiles(id) for attribution, and inserts exactly one '
  'owner-attributed lead_activities(''note_added'') row — all in one '
  'transaction. SECURITY INVOKER, service_role only.';
