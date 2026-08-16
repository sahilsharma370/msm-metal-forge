-- MSM Scrap — Quote backend CHECKPOINT C2H-A: durable, concurrency-safe,
-- retryable owner-notification outbox lifecycle.
--
-- Scope: extends public.notification_deliveries (created in
-- 20260811165757_create_quote_backend_foundation.sql, given its
-- event_type/uniqueness identity in 20260813114500_lead_completion_lifecycle.sql)
-- with a durable delivery lifecycle (pending/processing/retry_wait/sent/
-- dead_letter), a claim/lease/fencing mechanism mirroring this schema's own
-- established claim_quote_upload_v1/finalize_quote_upload_v2/
-- release_quote_upload_claim_v1 pattern, and three new service_role-only
-- RPCs: claim_notification_delivery_v1, mark_notification_delivery_sent_v1,
-- reschedule_notification_delivery_v1. One small, additive
-- CREATE OR REPLACE of complete_lead_if_ready (unchanged signature, return
-- type, security mode, fixed search_path and privileges — only its
-- notification_deliveries INSERT's status literal changes from the now-
-- retired 'queued' to 'pending', matching this migration's new vocabulary).
--
-- This checkpoint is DATABASE LIFECYCLE ONLY. No email is sent. No Resend
-- integration. No Cloudflare Queue/Cron code. No frontend change. The
-- database row is, and remains, the single durable source of truth: a
-- Cloudflare Queue (added in CHECKPOINT C2H-B) is only ever a wake-up/
-- transport accelerator layered on top of this table — if a Queue message
-- is lost, delayed, or delivered twice, the row underneath is either still
-- 'pending'/'retry_wait' (nothing was lost — a later scheduled fallback
-- claim picks it up) or already 'sent' (a duplicate message finds nothing
-- eligible to claim and safely no-ops). Nothing in this migration or its
-- RPCs stores a complete email payload — only lifecycle/identity metadata.
--
-- Explicitly NOT in scope: any actual send attempt; any HTTP route,
-- Cloudflare Worker, Queue consumer or Cron trigger; any frontend change;
-- widening notification_deliveries.event_type or .channel (both remain
-- exactly 'submission_completed' and 'email' respectively — this
-- checkpoint's outbox lifecycle is channel/event-agnostic by construction
-- and will apply unchanged to a future event_type/channel without needing
-- another migration to the lifecycle columns themselves); a read/list
-- helper RPC (deliberately not added — the claim RPC's own null return
-- when nothing is eligible is sufficient signal for a Queue/Cron worker
-- loop; adding a separate read path here would be a redundant RPC with no
-- concrete C2H-B consumer yet).
--
-- Security posture matches every prior migration in this schema exactly:
-- SECURITY INVOKER throughout (every function relies entirely on
-- service_role's own existing table grants — no SECURITY DEFINER anywhere),
-- fixed search_path on every function, EXECUTE revoked from public before
-- being granted to service_role alone. RLS remains enabled and FORCEd on
-- notification_deliveries with zero anon/authenticated policies (unchanged
-- from CHECKPOINT foundation) — service_role's BYPASSRLS (platform-granted)
-- plus its explicit table GRANTs (unchanged: select/insert/update, no
-- delete) are what every RPC below actually relies on, exactly like every
-- other function in this schema.
--
-- Historical-compatibility note: production has zero rows in this table as
-- of this migration (confirmed locally and unchanged since CHECKPOINT
-- C2D-A's own note to the same effect), and complete_lead_if_ready has been
-- the ONLY writer of notification_deliveries rows in this schema's entire
-- history, always inserting status='queued' unconditionally — no code path
-- anywhere in this schema has ever transitioned a row to 'sent'/'delivered'/
-- 'failed'/'bounced'. The backfill mapping in part B below is nonetheless
-- written to be correct and total for any pre-existing value in the old
-- vocabulary (never assuming what happens to be true today will always be
-- true), but its 'sent'/'delivered'/'failed'/'bounced' branches are purely
-- defensive and are not expected to actually fire against real data.
--
-- Concurrency-testing limitation (documented explicitly, matching this
-- schema's own established precedent in 20260813114500's test suite): this
-- project's pgTAP harness runs each test file as a single Postgres session
-- inside one uncommitted transaction (rolled back at the end, so no
-- persistent test data is ever left behind). A genuinely concurrent,
-- two-session proof of row-level lock contention is not safely reachable
-- from within that harness without either committing test data (violating
-- the "no persistent rows" requirement every suite in this schema honors)
-- or using a second real connection (dblink) that — being a separate
-- session — could never see this file's own uncommitted fixtures in the
-- first place. The accompanying test file therefore proves the exact same
-- thing the historical suite already establishes as this codebase's bar:
-- deterministic, single-session verification of the eligibility predicate
-- and locking clause claim_notification_delivery_v1 relies on (an
-- unexpired active claim is never returned as eligible; an expired one is;
-- FOR UPDATE SKIP LOCKED is present in the function source) — not a
-- substitute for a real concurrent-session proof, which remains an
-- explicitly reported limitation of this checkpoint.

-- ---------------------------------------------------------------------------
-- A. New/renamed columns
-- ---------------------------------------------------------------------------

-- last_attempted_at (existing, previously "the last time any attempt was
-- made", set nowhere in this schema's history) is renamed, not duplicated,
-- into claimed_at — its new, more precise meaning is "when the CURRENTLY
-- (or, for a moment mid-transaction, most recently) held claim was taken",
-- cleared the instant that claim ends (see the claim-consistency constraint
-- below). This reuses the existing column exactly as CHECKPOINT C2H-A's own
-- instructions require, rather than adding a redundant new one.
alter table public.notification_deliveries rename column last_attempted_at to claimed_at;

-- last_error (existing free-text column, regex-screened but never actually
-- written by any code path in this schema) is renamed, not duplicated, into
-- last_error_code and repurposed as a short sanitized machine code only —
-- see part D below for why raw text is rejected outright rather than merely
-- discouraged. Any pre-existing free-text content is cleared in the
-- backfill below (part B) since it cannot be safely/deterministically
-- reduced to a short machine code — see that section's own comment.
alter table public.notification_deliveries rename column last_error to last_error_code;

alter table public.notification_deliveries
  add column claim_token uuid,
  add column lease_expires_at timestamptz,
  add column sent_at timestamptz,
  add column provider text,
  add column last_error_at timestamptz;

comment on column public.notification_deliveries.status is
  'pending: never yet attempted (or freshly created), immediately eligible. '
  'processing: an active claim is currently held (claim_token/claimed_at/'
  'lease_expires_at all set) — see claim_notification_delivery_v1. '
  'retry_wait: a previous attempt failed transiently; eligible again once '
  'next_attempt_at is reached. sent: terminal success. dead_letter: '
  'terminal failure (attempt limit reached) — see '
  'notification_delivery_max_attempts(). sent and dead_letter are the only '
  'terminal states; every other state can still transition.';
comment on column public.notification_deliveries.claim_token is
  'Caller-generated UUID fencing token for the currently held claim. Set '
  'only while status = processing; null otherwise. A caller must present '
  'the exact matching token to mark_notification_delivery_sent_v1 or '
  'reschedule_notification_delivery_v1 — a stale or wrong token is rejected '
  '(fails closed), never silently accepted.';
comment on column public.notification_deliveries.claimed_at is
  'When the currently held claim was taken. Set only while status = '
  'processing; null otherwise. Renamed from the original, broader '
  '"last_attempted_at" (see migration header) — the new, narrower meaning '
  'is intentional: sent_at and last_error_at now separately record the '
  'outcome-specific timestamps this column used to conflate.';
comment on column public.notification_deliveries.lease_expires_at is
  'Bounded lease expiry for the currently held claim (see '
  'claim_notification_delivery_v1''s p_lease_seconds, clamped to a safe '
  'range). Once passed, a processing row becomes eligible for reclaim by a '
  'new caller with a new claim_token — this is what recovers a crashed '
  'worker''s stranded delivery without any manual intervention.';
comment on column public.notification_deliveries.sent_at is
  'Set exactly once, only by a successful mark_notification_delivery_sent_v1 '
  'call. Never cleared, never backdated on replay.';
comment on column public.notification_deliveries.provider is
  'Short lowercase machine code for which provider sent this (e.g. a '
  'future ''resend'') — set together with sent_at, only on success. Not '
  'populated yet in this checkpoint (no provider integration exists until '
  'CHECKPOINT C2H-B); the column exists now so the sent-identity contract '
  'is stable ahead of that integration.';
comment on column public.notification_deliveries.provider_message_id is
  'The provider''s own message identifier — set together with sent_at/'
  'provider, only on success. Unique when present (see the partial unique '
  'index below), so the same provider message can never be recorded as the '
  'successful identity of two different delivery rows.';
comment on column public.notification_deliveries.last_error_code is
  'Short, sanitized, machine-readable failure code only (see part D) — '
  'never a raw provider exception message, HTTP response body, stack '
  'trace, email HTML, API key or recipient address. Paired with '
  'last_error_at; both null or both set, independent of the row''s current '
  'status (a since-succeeded delivery may still retain the code of an '
  'earlier transient failure as diagnostic history).';
comment on column public.notification_deliveries.last_error_at is
  'When last_error_code was most recently set. See last_error_code''s own '
  'comment for the pairing rule.';

-- ---------------------------------------------------------------------------
-- B. Backfill existing rows into the new lifecycle (safe for a non-empty
--    table; see migration header for why this is defensive-only today)
-- ---------------------------------------------------------------------------

-- This single UPDATE's SET list is evaluated entirely against each row's
-- PRE-update values (standard SQL semantics) — every reference to `status`
-- below (including inside the CASE that reassigns `status` itself) sees the
-- OLD ('queued'/'sent'/'delivered'/'failed'/'bounced') value, which is still
-- valid at this point in the migration since the CHECK constraint has not
-- been tightened yet (that happens in part C, after this backfill).
update public.notification_deliveries
set
  status = case status
    when 'queued' then 'pending'
    when 'sent' then 'sent'
    when 'delivered' then 'sent' -- 'delivered' was a strictly stronger signal than 'sent'; the new model does not distinguish the two, so it collapses into the terminal success state.
    when 'failed' then 'retry_wait' -- see comment below: deferred to the new max-attempts policy rather than guessed here.
    when 'bounced' then 'dead_letter' -- a hard bounce is unrecoverable by retrying; this is the one legacy value with an unambiguous terminal-failure mapping.
    else status
  end,
  -- A legacy 'sent'/'delivered' row must satisfy the new sent-identity
  -- constraint (part C) — sent_at/provider/provider_message_id all
  -- required together. The true historical values are unknown (this schema
  -- has never actually sent an email — see migration header), so a
  -- clearly-labelled synthetic identity is used rather than inventing a
  -- plausible-looking real one that could be mistaken for genuine provider
  -- data later.
  sent_at = case when status in ('sent', 'delivered') then coalesce(claimed_at, updated_at) else null end,
  provider = case when status in ('sent', 'delivered') then 'legacy_unknown' else null end,
  provider_message_id = case
    when status in ('sent', 'delivered') then coalesce(provider_message_id, 'legacy-' || id::text)
    else provider_message_id
  end,
  -- A legacy 'failed' row is deliberately NOT force-terminated into
  -- dead_letter here — that would be a one-time guess this migration has no
  -- good basis for. Instead it becomes immediately retry-eligible
  -- (next_attempt_at = now()), handing the actual retry-vs-give-up decision
  -- to reschedule_notification_delivery_v1's own deterministic max-attempts
  -- policy the next time it is genuinely re-attempted and re-fails — never
  -- losing the row, and never silently resurrecting it as a fresh
  -- zero-attempt delivery either (attempt_count is untouched by this
  -- backfill).
  next_attempt_at = case when status = 'failed' then now() else null end,
  claim_token = null,
  claimed_at = null,
  lease_expires_at = null,
  -- Historical free-text last_error_code (renamed from last_error) content
  -- cannot be safely or deterministically reduced to a short sanitized
  -- machine code — see part D's own comment for exactly why raw text is
  -- rejected outright by the new CHECK constraint. Clearing it here (rather
  -- than attempting a lossy best-effort parse) is the documented, honest
  -- choice: no code path in this schema has ever written a real value here
  -- anyway (see migration header), so nothing of substance is discarded.
  last_error_code = null,
  last_error_at = null
where status in ('queued', 'sent', 'delivered', 'failed', 'bounced');

-- ---------------------------------------------------------------------------
-- C. Lifecycle CHECK constraints (dropping and re-adding, matching this
--    schema's own established pattern for every prior constraint revision —
--    plain CHECK constraints have no ALTER-in-place equivalent)
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries drop constraint notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('pending', 'processing', 'retry_wait', 'sent', 'dead_letter'));

alter table public.notification_deliveries alter column status set default 'pending';

-- Only a processing row may hold an active claim; every other status must
-- have all three claim fields null. This is the single constraint that
-- makes "pending/retry_wait/sent/dead_letter must not retain an active
-- claim" and "processing requires claim_token, claimed_at and
-- lease_expires_at" structurally impossible to violate, not just an
-- application convention.
alter table public.notification_deliveries add constraint notification_deliveries_claim_matches_status check (
  (status = 'processing' and claim_token is not null and claimed_at is not null and lease_expires_at is not null)
  or (status <> 'processing' and claim_token is null and claimed_at is null and lease_expires_at is null)
);

-- A lease that expires at or before it was claimed would be meaningless
-- (already-expired the instant it's granted). Written to pass trivially
-- (NULL <op> NULL is not FALSE, so a CHECK never rejects it) whenever
-- either side is null, so this stays correct for every non-processing row
-- without needing its own status branch.
alter table public.notification_deliveries add constraint notification_deliveries_lease_after_claim check (
  lease_expires_at is null or claimed_at is null or lease_expires_at > claimed_at
);

-- next_attempt_at is meaningful only for a row that is genuinely waiting
-- out a scheduled retry; every other status (including pending, which is
-- immediately eligible with no wait) must not carry one.
alter table public.notification_deliveries add constraint notification_deliveries_next_attempt_matches_status check (
  (status = 'retry_wait' and next_attempt_at is not null)
  or (status <> 'retry_wait' and next_attempt_at is null)
);

-- The sent identity (sent_at/provider/provider_message_id) is established
-- exactly once, atomically, only by mark_notification_delivery_sent_v1, and
-- exists if and only if status = sent — never a partial identity on any
-- other status.
alter table public.notification_deliveries add constraint notification_deliveries_sent_identity_matches_status check (
  (status = 'sent' and sent_at is not null and provider is not null and provider_message_id is not null)
  or (status <> 'sent' and sent_at is null and provider is null and provider_message_id is null)
);

-- last_error_code/last_error_at are a pair, independent of the row's
-- current status — see their own column comments for why history is
-- retained even past a later success.
alter table public.notification_deliveries add constraint notification_deliveries_last_error_pair check (
  (last_error_code is null) = (last_error_at is null)
);

alter table public.notification_deliveries drop constraint notification_deliveries_provider_message_id_check;
alter table public.notification_deliveries add constraint notification_deliveries_provider_message_id_check check (
  provider_message_id is null
  or (length(provider_message_id) between 1 and 200 and provider_message_id !~ '[[:cntrl:]]')
);

alter table public.notification_deliveries add constraint notification_deliveries_provider_check check (
  provider is null or (length(provider) between 1 and 40 and provider ~ '^[a-z0-9_]+$')
);

-- ---------------------------------------------------------------------------
-- D. last_error_code — short sanitized machine code only
-- ---------------------------------------------------------------------------

-- Deliberately a strict allowlist shape (short, uppercase, machine-code-only
-- — e.g. PROVIDER_TIMEOUT, RATE_LIMITED), not merely a length cap with a
-- secret-pattern denylist regex (the OLD last_error's approach). A denylist
-- can always miss a shape it wasn't written to catch; an allowlist this
-- narrow cannot admit raw exception text, an HTTP response body, email
-- HTML, an API key or a recipient address AT ALL, regardless of what they
-- look like — the constraint rejects anything that isn't already a short,
-- pre-classified code the CALLER (never a provider's raw output) chose.
alter table public.notification_deliveries drop constraint notification_deliveries_last_error_check;
alter table public.notification_deliveries add constraint notification_deliveries_last_error_code_check check (
  last_error_code is null or (length(last_error_code) between 1 and 40 and last_error_code ~ '^[A-Z0-9_]+$')
);

-- ---------------------------------------------------------------------------
-- E. Indexes — exactly what claim_notification_delivery_v1's scan and the
--    provider-identity uniqueness requirement need, nothing else
-- ---------------------------------------------------------------------------

create index notification_deliveries_pending_due_idx on public.notification_deliveries (created_at)
  where status = 'pending';
create index notification_deliveries_retry_due_idx on public.notification_deliveries (next_attempt_at)
  where status = 'retry_wait';
-- Mirrors quote_upload_slots_uploading_lease_idx's exact shape/purpose from
-- 20260812191235_quote_upload_claim_lifecycle.sql — same "find the stale
-- active leases" query need, one table over.
create index notification_deliveries_processing_lease_idx on public.notification_deliveries (lease_expires_at)
  where status = 'processing';

create unique index notification_deliveries_provider_message_id_key on public.notification_deliveries (provider_message_id)
  where provider_message_id is not null;

-- Redefined (drop + recreate, same pattern as leads_open_dashboard_idx in
-- 20260813114500_lead_completion_lifecycle.sql): 'delivered' no longer
-- exists as a status value, and the two genuine terminal states are now
-- 'sent'/'dead_letter' — a dead_letter row has already had every attempt it
-- will ever get and needs no further "attention" from this index's own
-- query shape (an owner-facing view, if ever built, would surface it
-- separately and deliberately, not through this operational index).
drop index public.notification_deliveries_needs_attention_idx;
create index notification_deliveries_needs_attention_idx on public.notification_deliveries (status)
  where status not in ('sent', 'dead_letter');

-- ---------------------------------------------------------------------------
-- F. complete_lead_if_ready — additive: 'queued' -> 'pending'
-- ---------------------------------------------------------------------------

-- Every line below is byte-for-byte identical to the CHECKPOINT C2D-A
-- definition (20260813114500_lead_completion_lifecycle.sql) except the
-- single literal status value in the notification_deliveries INSERT.
-- Signature, return type, security mode (SECURITY INVOKER), fixed
-- search_path and grants (CREATE OR REPLACE preserves them; service_role's
-- EXECUTE from CHECKPOINT C2D-A is untouched and is not re-granted here)
-- are all unchanged — this is the same "minimal, additive CREATE OR
-- REPLACE across a later migration" pattern already used twice for
-- create_website_quote_v1.
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
    return false;
  end if;
  if v_lead.capture_channel <> 'website' then
    return false;
  end if;

  v_status := public.compute_lead_file_upload_status(p_lead_id);

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

  -- CHECKPOINT C2H-A: the one changed literal. A fresh delivery now starts
  -- its life in the new outbox lifecycle's own entry state — 'pending' is
  -- also this column's new DEFAULT (part C above), so this literal and the
  -- column default agree; it is stated explicitly here regardless, matching
  -- this function's own pre-existing style of never relying on a default
  -- for a column central to its purpose.
  insert into public.notification_deliveries (lead_id, event_type, channel, status)
  values (p_lead_id, 'submission_completed', 'email', 'pending')
  on conflict (lead_id, event_type, channel) do nothing;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. notification_delivery_max_attempts — the one deterministic policy
--    constant, owned by the database, never trusted from a caller
-- ---------------------------------------------------------------------------

-- 5 total attempts (the claim that sets attempt_count to 5 is the last one
-- allowed to still retry on failure; a 6th would-be attempt instead becomes
-- dead_letter — see reschedule_notification_delivery_v1's own comment for
-- the exact arithmetic). Chosen the same way every other bounded constant in
-- this schema was (rate limits, lease durations, expiry windows): a small,
-- human-reasoned, easily-adjusted value, not derived from anything. Kept as
-- its own IMMUTABLE function (not a literal duplicated in two RPCs) so
-- claim/reschedule and this checkpoint's own tests share exactly one source
-- of truth.
create or replace function public.notification_delivery_max_attempts()
returns integer
language sql
immutable
set search_path = pg_catalog
as $$ select 5 $$;

revoke execute on function public.notification_delivery_max_attempts() from public;
grant execute on function public.notification_delivery_max_attempts() to service_role;

comment on function public.notification_delivery_max_attempts() is
  'The single source of truth for how many total attempts (claims) a '
  'notification_deliveries row gets before reschedule_notification_delivery_v1 '
  'moves it to dead_letter instead of retry_wait. Never accepted as a '
  'caller-supplied parameter on any RPC.';

-- ---------------------------------------------------------------------------
-- H. claim_notification_delivery_v1
-- ---------------------------------------------------------------------------

-- p_claim_token is required and listed first (Postgres requires every
-- parameter after the first one with a DEFAULT to also have one, so the
-- required parameter cannot come after the optional ones).
create or replace function public.claim_notification_delivery_v1(
  p_claim_token uuid,
  p_delivery_id uuid default null,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.notification_deliveries%rowtype;
  v_now timestamptz := now();
  v_lease_expires timestamptz;
begin
  if p_claim_token is null then
    raise exception 'claim_notification_delivery_v1: claim_token is required';
  end if;
  -- Bounded lease duration: at least 30 seconds (a lease shorter than a
  -- realistic single provider round trip would reclaim its own in-flight
  -- work) and at most 15 minutes (an unbounded lease would defeat the whole
  -- point of a lease — recovering a crashed worker promptly).
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'claim_notification_delivery_v1: lease_seconds must be between 30 and 900';
  end if;

  v_lease_expires := v_now + make_interval(secs => p_lease_seconds);

  -- Eligible work, either targeted (p_delivery_id supplied — the Cloudflare
  -- Queue message path in C2H-B) or fallback (p_delivery_id null — the
  -- scheduled sweep path in C2H-B): pending (always due), retry_wait whose
  -- next_attempt_at has arrived, or processing whose lease has expired
  -- (a crashed/hung worker's stranded claim). FOR UPDATE SKIP LOCKED is
  -- what makes concurrent claimants never block on, or double-claim, the
  -- same row — the loser's SELECT simply returns zero rows for any row
  -- another concurrent claimant already has locked, whether or not that
  -- other row would otherwise have matched. NULLS/absence and an already
  -- ineligible row (wrong status, unexpired lease, not-yet-due retry) both
  -- fall through to the same "not found -> return null" outcome as a
  -- nonexistent id — deliberately indistinguishable, exactly what makes a
  -- duplicate Queue message for an already-claimed or already-sent delivery
  -- a safe no-op rather than an error.
  if p_delivery_id is not null then
    select * into v_row
    from public.notification_deliveries
    where id = p_delivery_id
      and (
        status = 'pending'
        or (status = 'retry_wait' and next_attempt_at <= v_now)
        or (status = 'processing' and lease_expires_at <= v_now)
      )
    for update skip locked;
  else
    select * into v_row
    from public.notification_deliveries
    where (
        status = 'pending'
        or (status = 'retry_wait' and next_attempt_at <= v_now)
        or (status = 'processing' and lease_expires_at <= v_now)
      )
    order by created_at asc
    for update skip locked
    limit 1;
  end if;

  if not found then
    return null;
  end if;

  -- attempt_count increments exactly once here, per successful claim (a
  -- reclaim of a stale processing row is itself a new attempt). Never
  -- incremented anywhere else.
  update public.notification_deliveries
  set status = 'processing',
      claim_token = p_claim_token,
      claimed_at = v_now,
      lease_expires_at = v_lease_expires,
      next_attempt_at = null,
      attempt_count = attempt_count + 1
  where id = v_row.id
  returning * into v_row;

  -- Minimum safe metadata only — no recipient_hint, no submission data, no
  -- Storage path, no other lead field. A Queue/Cron worker needs nothing
  -- more than this to look up what it must send and prove its claim later.
  return jsonb_build_object(
    'delivery_id', v_row.id,
    'lead_id', v_row.lead_id,
    'event_type', v_row.event_type,
    'channel', v_row.channel,
    'attempt_count', v_row.attempt_count,
    'claim_token', v_row.claim_token,
    'claimed_at', v_row.claimed_at,
    'lease_expires_at', v_row.lease_expires_at
  );
end;
$$;

revoke execute on function public.claim_notification_delivery_v1(uuid, uuid, integer) from public;
grant execute on function public.claim_notification_delivery_v1(uuid, uuid, integer) to service_role;

comment on function public.claim_notification_delivery_v1(uuid, uuid, integer) is
  'Atomically claims either one targeted delivery (p_delivery_id, for a '
  'Cloudflare Queue message) or the oldest eligible due delivery '
  '(p_delivery_id null, for a scheduled fallback sweep). Returns null when '
  'nothing is eligible — never an error — so a duplicate Queue message or '
  'an empty sweep is always a safe no-op. FOR UPDATE SKIP LOCKED guarantees '
  'at most one concurrent caller ever wins a given row. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- I. mark_notification_delivery_sent_v1
-- ---------------------------------------------------------------------------

create or replace function public.mark_notification_delivery_sent_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.notification_deliveries%rowtype;
  v_now timestamptz := now();
begin
  if p_provider is null or length(p_provider) < 1 or length(p_provider) > 40 or p_provider !~ '^[a-z0-9_]+$' then
    raise exception 'mark_notification_delivery_sent_v1: provider must be a short lowercase machine code';
  end if;
  if p_provider_message_id is null or length(p_provider_message_id) < 1 or length(p_provider_message_id) > 200
    or p_provider_message_id ~ '[[:cntrl:]]'
  then
    raise exception 'mark_notification_delivery_sent_v1: provider_message_id is missing or invalid';
  end if;

  select * into v_row
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'mark_notification_delivery_sent_v1: delivery not found';
  end if;

  -- Idempotent replay: once already sent, claim_token has already been
  -- cleared (see the UPDATE below) — checking it here would wrongly reject
  -- a legitimate retry of the caller's OWN already-successful call (e.g.
  -- after a lost response). Identity, not claim possession, is what proves
  -- a replay is genuine: the exact same (provider, provider_message_id)
  -- succeeds again as a no-op; anything else — including a genuinely
  -- different successful send being reported twice — is rejected. This is
  -- what "repeated or conflicting finalization cannot duplicate/change the
  -- sent identity" means in practice.
  if v_row.status = 'sent' then
    if v_row.provider is distinct from p_provider or v_row.provider_message_id is distinct from p_provider_message_id then
      raise exception 'mark_notification_delivery_sent_v1: delivery already finalized with a different identity';
    end if;
    return jsonb_build_object(
      'delivery_id', v_row.id, 'status', v_row.status, 'sent_at', v_row.sent_at,
      'provider', v_row.provider, 'provider_message_id', v_row.provider_message_id
    );
  end if;

  -- First-time finalization requires the exact currently-held claim — a
  -- stale token (superseded by a reclaim) or a caller with no claim at all
  -- (status not processing) fails closed here, identically either way.
  if v_row.status <> 'processing' or v_row.claim_token is distinct from p_claim_token then
    raise exception 'mark_notification_delivery_sent_v1: no matching active claim to finalize';
  end if;

  update public.notification_deliveries
  set status = 'sent',
      sent_at = v_now,
      provider = p_provider,
      provider_message_id = p_provider_message_id,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      next_attempt_at = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'delivery_id', v_row.id, 'status', v_row.status, 'sent_at', v_row.sent_at,
    'provider', v_row.provider, 'provider_message_id', v_row.provider_message_id
  );
end;
$$;

revoke execute on function public.mark_notification_delivery_sent_v1(uuid, uuid, text, text) from public;
grant execute on function public.mark_notification_delivery_sent_v1(uuid, uuid, text, text) to service_role;

comment on function public.mark_notification_delivery_sent_v1(uuid, uuid, text, text) is
  'Finalizes a delivery as sent — only against the exact currently-held '
  'claim (stale/wrong claim_token fails closed). A matching-identity replay '
  'after the row is already sent is a safe no-op; a conflicting one is '
  'rejected. Never touches public.leads — an email-provider outcome can '
  'never roll back or alter an already-completed lead. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- J. reschedule_notification_delivery_v1
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retry_after_seconds integer default 60
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.notification_deliveries%rowtype;
  v_now timestamptz := now();
  v_new_status text;
  v_next_attempt timestamptz;
begin
  if p_error_code is null or length(p_error_code) < 1 or length(p_error_code) > 40 or p_error_code !~ '^[A-Z0-9_]+$' then
    raise exception 'reschedule_notification_delivery_v1: error_code must be a short uppercase machine code';
  end if;
  -- Bounded retry delay: at least 1 second, at most 24 hours — an outbox
  -- entry must never be schedulable so far out that it effectively goes
  -- dormant.
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 86400 then
    raise exception 'reschedule_notification_delivery_v1: retry_after_seconds must be between 1 and 86400';
  end if;

  select * into v_row
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'reschedule_notification_delivery_v1: delivery not found';
  end if;

  if v_row.status = 'sent' then
    raise exception 'reschedule_notification_delivery_v1: a sent delivery can never be rescheduled';
  end if;

  if v_row.status <> 'processing' or v_row.claim_token is distinct from p_claim_token then
    raise exception 'reschedule_notification_delivery_v1: no matching active claim to reschedule';
  end if;

  -- Deterministic, database-owned policy — never a caller-supplied
  -- "give up" flag. attempt_count was already incremented once by the
  -- claim that is now failing (see claim_notification_delivery_v1), so
  -- attempt_count reaching the max here means this row has now used its
  -- final allowed attempt.
  if v_row.attempt_count >= public.notification_delivery_max_attempts() then
    v_new_status := 'dead_letter';
    v_next_attempt := null;
  else
    v_new_status := 'retry_wait';
    v_next_attempt := v_now + make_interval(secs => p_retry_after_seconds);
  end if;

  update public.notification_deliveries
  set status = v_new_status,
      next_attempt_at = v_next_attempt,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      last_error_at = v_now
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'next_attempt_at', v_row.next_attempt_at,
    'last_error_code', v_row.last_error_code
  );
end;
$$;

revoke execute on function public.reschedule_notification_delivery_v1(uuid, uuid, text, integer) from public;
grant execute on function public.reschedule_notification_delivery_v1(uuid, uuid, text, integer) to service_role;

comment on function public.reschedule_notification_delivery_v1(uuid, uuid, text, integer) is
  'Records a transient failure (only against the exact currently-held '
  'claim, same fencing as mark_notification_delivery_sent_v1) and either '
  'schedules a future retry (retry_wait) or, once '
  'notification_delivery_max_attempts() is reached, gives up permanently '
  '(dead_letter) — the decision is always derived from attempt_count, never '
  'from a caller-supplied flag. Only ever stores a short sanitized '
  'last_error_code, never raw provider text. A sent delivery can never be '
  'rescheduled. SECURITY INVOKER.';
