-- MSM Scrap — Quote backend CHECKPOINT C2H-B1: permanent-failure and
-- operator-recovery extension for the C2H-A durable notification outbox.
--
-- Scope: one new auditability column (manual_requeue_count) plus two new
-- service_role-only RPCs — public.dead_letter_notification_delivery_v1
-- (immediate, claim-fenced permanent failure, so a genuinely unrecoverable
-- error never wastes the remaining retry budget) and
-- public.requeue_notification_delivery_v1 (the ONLY sanctioned way a
-- dead_letter row ever becomes retryable again — always a deliberate
-- operator action after fixing whatever configuration/deliverability issue
-- caused the permanent failure, never automatic).
--
-- This migration adds no table, widens no existing CHECK constraint's
-- value set, and touches no C2H-A lifecycle invariant — every guarantee
-- C2H-A already proved (only a processing row holds an active claim, sent/
-- dead_letter are terminal to every OTHER transition, next_attempt_at only
-- exists where another attempt is genuinely allowed, no raw provider text
-- ever reaches last_error_code) continues to hold. Both new RPCs are
-- additive consumers of those same constraints, not new sources of state.
--
-- Security posture matches CHECKPOINT C2H-A (and every prior migration in
-- this schema) exactly: SECURITY INVOKER, fixed search_path, EXECUTE
-- revoked from public before being granted to service_role alone. No RLS
-- change — notification_deliveries remains unreadable to anon/authenticated.

-- ---------------------------------------------------------------------------
-- A. manual_requeue_count
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries
  add column manual_requeue_count integer not null default 0
    check (manual_requeue_count >= 0);

comment on column public.notification_deliveries.manual_requeue_count is
  'How many times an operator has manually requeued this delivery via '
  'requeue_notification_delivery_v1, after CHECKPOINT C2H-A''s own five-'
  'attempt budget was exhausted (dead_letter) and whatever caused that was '
  'fixed. Distinct from attempt_count (the current bounded-retry budget, '
  'reset to 0 on every requeue) — this column is a permanent audit trail '
  'that a requeue never resets, so "this delivery needed manual '
  'intervention N times" remains visible for as long as the row exists.';

-- ---------------------------------------------------------------------------
-- B. dead_letter_notification_delivery_v1
-- ---------------------------------------------------------------------------

-- Mirrors reschedule_notification_delivery_v1's own claim-fencing and
-- error-code validation exactly (same fail-closed-on-stale/wrong-token
-- behavior, same short-machine-code-only last_error_code contract) — the
-- one behavioral difference is that this function never computes a
-- retry_wait branch at all: a permanent failure always ends here,
-- immediately, regardless of attempt_count.
create or replace function public.dead_letter_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_code text
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
  if p_error_code is null or length(p_error_code) < 1 or length(p_error_code) > 40 or p_error_code !~ '^[A-Z0-9_]+$' then
    raise exception 'dead_letter_notification_delivery_v1: error_code must be a short uppercase machine code';
  end if;

  select * into v_row
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'dead_letter_notification_delivery_v1: delivery not found';
  end if;

  if v_row.status = 'sent' then
    raise exception 'dead_letter_notification_delivery_v1: a sent delivery can never be dead-lettered';
  end if;

  -- Fails closed identically for: no claim at all (pending/retry_wait),
  -- an already-terminal dead_letter row (repeated/conflicting calls cannot
  -- mutate terminal state), and a stale/wrong token on a genuinely
  -- processing row.
  if v_row.status <> 'processing' or v_row.claim_token is distinct from p_claim_token then
    raise exception 'dead_letter_notification_delivery_v1: no matching active claim to dead-letter';
  end if;

  update public.notification_deliveries
  set status = 'dead_letter',
      next_attempt_at = null,
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
    'last_error_code', v_row.last_error_code
  );
end;
$$;

revoke execute on function public.dead_letter_notification_delivery_v1(uuid, uuid, text) from public;
grant execute on function public.dead_letter_notification_delivery_v1(uuid, uuid, text) to service_role;

comment on function public.dead_letter_notification_delivery_v1(uuid, uuid, text) is
  'Immediate, claim-fenced permanent failure — used for an error the '
  'dispatcher has classified as unrecoverable-by-retry (bad configuration, '
  'invalid recipient, auth failure, etc.), so it never wastes the '
  'remaining attempt budget waiting out retry_wait delays that cannot '
  'possibly help. Same fencing as reschedule_notification_delivery_v1: '
  'only the exact currently-held claim may call this; a sent delivery can '
  'never be dead-lettered. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- C. requeue_notification_delivery_v1
-- ---------------------------------------------------------------------------

-- Convention choice (documented, tested): a requeue against a row that is
-- ALREADY pending is treated as a safe, idempotent no-op — same jsonb
-- shape returned, manual_requeue_count NOT incremented again — rather than
-- raising. This mirrors this schema's own established idempotent-replay
-- convention (create_website_quote_v1, complete_website_quote_v1,
-- mark_notification_delivery_sent_v1's matching-identity replay): an
-- operator re-running the same recovery action against a delivery that
-- some other concurrent recovery attempt already requeued should never see
-- an error for something that is, from their point of view, already true.
-- A requeue against any OTHER non-dead_letter status (processing,
-- retry_wait, sent) is a genuine misuse — no ambiguity about "is this
-- already what I wanted" — and fails closed with an exception instead.
create or replace function public.requeue_notification_delivery_v1(
  p_delivery_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_row public.notification_deliveries%rowtype;
begin
  select * into v_row
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'requeue_notification_delivery_v1: delivery not found';
  end if;

  if v_row.status = 'pending' then
    -- Idempotent no-op — see the function's own header comment above for
    -- why this is a safe replay rather than an error.
    return jsonb_build_object(
      'delivery_id', v_row.id,
      'status', v_row.status,
      'attempt_count', v_row.attempt_count,
      'manual_requeue_count', v_row.manual_requeue_count
    );
  end if;

  if v_row.status <> 'dead_letter' then
    raise exception 'requeue_notification_delivery_v1: only a dead_letter delivery can be manually requeued (current status: %)', v_row.status;
  end if;

  -- attempt_count resets to 0 so the newly-fixed configuration gets the
  -- full five-attempt budget again, exactly like a brand-new delivery —
  -- never a partially-spent one. next_attempt_at is left null (not set to
  -- now()), matching the same pending invariant every fresh
  -- complete_lead_if_ready-created row already satisfies: pending is
  -- always immediately due by virtue of its status alone, never by a
  -- next_attempt_at value (see notification_deliveries_next_attempt_matches_status).
  update public.notification_deliveries
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = null,
      claim_token = null,
      claimed_at = null,
      lease_expires_at = null,
      manual_requeue_count = manual_requeue_count + 1
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'delivery_id', v_row.id,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'manual_requeue_count', v_row.manual_requeue_count
  );
end;
$$;

revoke execute on function public.requeue_notification_delivery_v1(uuid) from public;
grant execute on function public.requeue_notification_delivery_v1(uuid) to service_role;

comment on function public.requeue_notification_delivery_v1(uuid) is
  'The only sanctioned way a dead_letter delivery becomes retryable again '
  '— always a deliberate operator action, never automatic. Resets '
  'attempt_count to 0 (a fresh five-attempt budget) and clears any claim, '
  'while manual_requeue_count is a permanent, never-reset audit trail of '
  'how many times this happened. A requeue against an already-pending row '
  'is a safe idempotent no-op; against any other non-dead_letter status it '
  'fails closed. No signature parameter accepts a claim token — a '
  'dead_letter row never holds one (see notification_deliveries_claim_matches_status), '
  'so there is nothing to fence against here. SECURITY INVOKER.';
