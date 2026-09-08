-- MSM Scrap — CHECKPOINT C2M-A: reversible Trash lifecycle for owner leads.
--
-- Scope: two new nullable columns on public.leads (deleted_at, deleted_by),
-- one redefined + one new partial index supporting "not trashed" (the
-- default owner view) and "trashed" (the Trash view) queries respectively,
-- and two new SECURITY INVOKER RPCs — trash_lead_v1 / restore_lead_v1 —
-- following change_lead_status_v1's own established shape exactly (row
-- lock, RAISE EXCEPTION 'function_name: reason', jsonb_build_object return,
-- revoke from public / grant to service_role only, first-statement
-- owner_accounts recheck regardless of the caller's own verification).
--
-- This is explicitly NOT permanent deletion: no DELETE grant is added
-- anywhere in this migration, matching every other table in this schema's
-- "no hard-delete workflow" posture. Trash is reversible by construction —
-- deleted_at is just another nullable timestamp on the existing row,
-- undone by clearing it. The row itself, its lead_files, its
-- lead_activities history, its notification_deliveries rows and its
-- submission_snapshot are all completely untouched by either RPC — neither
-- function issues a DELETE statement of any kind, against any table.
--
-- deleted_by references public.owner_profiles(id) — the same
-- identity/attribution table lead_activities.actor_owner_id already uses —
-- never public.owner_accounts (the separate authorization gate). Both new
-- RPCs lazily upsert owner_profiles(id) before writing it, matching
-- change_lead_status_v1/add_lead_note_v1's own established precedent
-- exactly.
--
-- lead_activities.event_type has no fixed enum — it is a regex-checked
-- ('^[a-z0-9_]+$', <=60 chars) free-vocabulary column (see
-- create_quote_backend_foundation.sql's own table definition) — so
-- 'lead_trashed'/'lead_restored' require no CHECK-widening migration of
-- their own; they already satisfy the existing constraint exactly like
-- 'status_changed'/'note_added' did when those were introduced.
--
-- Explicitly NOT in scope: any change to RLS (still enabled+FORCEd with
-- zero client-facing policies on every table in this schema — unaffected),
-- any widening of an existing table GRANT (service_role's select/insert/
-- update on public.leads is untouched; still no delete), permanent
-- deletion of any kind, Storage object deletion, CSV export (a separate,
-- read-only server module needs no migration).

-- ---------------------------------------------------------------------------
-- A. leads.deleted_at / leads.deleted_by
-- ---------------------------------------------------------------------------

alter table public.leads add column deleted_at timestamptz;
alter table public.leads add column deleted_by uuid references public.owner_profiles (id);

comment on column public.leads.deleted_at is
  'Reversible Trash marker — set only by trash_lead_v1, cleared only by '
  'restore_lead_v1. NULL means the lead is in its normal Inbox/Archived '
  'position. Never a hard delete: the row, its lead_files, its '
  'lead_activities history and its notification_deliveries rows are all '
  'untouched by either RPC. Every normal owner list/detail/overview query '
  'must filter deleted_at IS NULL; a dedicated Trash view queries '
  'deleted_at IS NOT NULL instead.';
comment on column public.leads.deleted_by is
  'The owner_profiles(id) who most recently trashed this lead. Cleared '
  'back to NULL by restore_lead_v1 alongside deleted_at (the durable '
  '"who/when" record of a trash action lives in lead_activities''s own '
  '''lead_trashed'' row via actor_owner_id/created_at, not here) — this '
  'column is only ever meaningful while deleted_at is also set, see '
  'leads_deleted_by_matches_deleted_at below.';

-- Two-way, matching leads_lost_reason_matches_status /
-- leads_closed_at_matches_status's own established shape exactly:
-- deleted_by is set if and only if deleted_at is set.
alter table public.leads add constraint leads_deleted_by_matches_deleted_at check (
  (deleted_at is null and deleted_by is null)
  or (deleted_at is not null and deleted_by is not null)
);

-- Redefined (drop + recreate — plain indexes have no ALTER-in-place
-- equivalent, same pattern already used by CHECKPOINT C2D-A's own
-- redefinition of leads_open_dashboard_idx): the inbox's default-order
-- index now also excludes trashed rows, so the common "not trashed" query
-- shape stays a single ordered index scan instead of an index scan plus a
-- separate filter step.
drop index public.leads_owner_inbox_completed_order_idx;
create index leads_owner_inbox_completed_order_idx
  on public.leads (submission_completed_at desc, created_at desc, id desc)
  where submission_completed_at is not null and deleted_at is null;

-- New, additive: the Trash view's own query shape (trashed leads, most
-- recently trashed first) — deliberately a separate index rather than
-- trying to serve both shapes from one, matching this schema's own
-- established preference (see leads_owner_inbox_completed_order_idx vs
-- leads_open_dashboard_idx, added as two separate indexes for two separate
-- query shapes in the same migration).
create index leads_owner_trash_order_idx
  on public.leads (deleted_at desc, id desc)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- B. trash_lead_v1
-- ---------------------------------------------------------------------------
--
-- Idempotent: a retried/duplicate trash request against an already-trashed
-- lead is a safe no-op (current state returned, no second activity row),
-- matching requeue_notification_delivery_v1's own already-pending no-op
-- precedent. Operates only on an owner-visible (submission_completed_at is
-- not null) lead — an incomplete submission was never owner-visible to
-- begin with, so it is treated identically to a missing lead, matching
-- change_lead_status_v1/add_lead_note_v1's own established guard.
create or replace function public.trash_lead_v1(
  p_lead_id uuid,
  p_owner_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_activity_id uuid;
begin
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'trash_lead_v1: owner not authorized';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'trash_lead_v1: lead not found';
  end if;
  if v_lead.submission_completed_at is null then
    raise exception 'trash_lead_v1: lead not found';
  end if;

  if v_lead.deleted_at is not null then
    return jsonb_build_object('trashed', false, 'deletedAt', v_lead.deleted_at, 'status', v_lead.status);
  end if;

  update public.leads
  set deleted_at = now(), deleted_by = p_owner_user_id
  where id = p_lead_id;

  insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

  insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type)
  values (p_lead_id, 'owner', p_owner_user_id, 'lead_trashed')
  returning id into v_activity_id;

  select * into v_lead from public.leads where id = p_lead_id;

  return jsonb_build_object('trashed', true, 'deletedAt', v_lead.deleted_at, 'status', v_lead.status, 'activityId', v_activity_id);
end;
$$;

revoke execute on function public.trash_lead_v1(uuid, uuid) from public;
grant execute on function public.trash_lead_v1(uuid, uuid) to service_role;

comment on function public.trash_lead_v1(uuid, uuid) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Locks the lead, treats a missing/incomplete lead '
  'as not found, no-ops idempotently when already trashed (no second '
  'activity row), otherwise sets deleted_at/deleted_by and inserts exactly '
  'one owner-attributed lead_activities(''lead_trashed'') row. Never '
  'issues a DELETE against any table. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------------
-- C. restore_lead_v1
-- ---------------------------------------------------------------------------
--
-- The exact inverse of trash_lead_v1, same idempotency/authorization/
-- not-found posture. Restoring never touches leads.status — a lead returns
-- to whatever status it held at trash time (status is never modified by
-- either RPC), so "restore" and "the workflow status it was left at" are
-- fully independent, matching this batch's own requirement that restoring
-- returns a lead to its previous status unchanged.
create or replace function public.restore_lead_v1(
  p_lead_id uuid,
  p_owner_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_activity_id uuid;
begin
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'restore_lead_v1: owner not authorized';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'restore_lead_v1: lead not found';
  end if;
  if v_lead.submission_completed_at is null then
    raise exception 'restore_lead_v1: lead not found';
  end if;

  if v_lead.deleted_at is null then
    return jsonb_build_object('restored', false, 'status', v_lead.status);
  end if;

  update public.leads
  set deleted_at = null, deleted_by = null
  where id = p_lead_id;

  insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

  insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type)
  values (p_lead_id, 'owner', p_owner_user_id, 'lead_restored')
  returning id into v_activity_id;

  select * into v_lead from public.leads where id = p_lead_id;

  return jsonb_build_object('restored', true, 'status', v_lead.status, 'activityId', v_activity_id);
end;
$$;

revoke execute on function public.restore_lead_v1(uuid, uuid) from public;
grant execute on function public.restore_lead_v1(uuid, uuid) to service_role;

comment on function public.restore_lead_v1(uuid, uuid) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Locks the lead, treats a missing/incomplete lead '
  'as not found, no-ops idempotently when not currently trashed (no '
  'second activity row), otherwise clears deleted_at/deleted_by and '
  'inserts exactly one owner-attributed lead_activities(''lead_restored'') '
  'row. Never modifies leads.status — a restored lead keeps whatever '
  'status it held at trash time. SECURITY INVOKER, service_role only.';
