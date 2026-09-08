-- Permanent pgTAP regression suite for
-- supabase/migrations/20260816170000_notification_delivery_outbox_lifecycle.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end (like every other suite in this schema — this file never leaves
-- persistent data behind), so all fixtures below are created and consumed
-- entirely within this one transaction.
--
-- now() is frozen for the lifetime of a single Postgres transaction (it
-- returns the transaction's start time, not the wall clock) — every row
-- inserted via a bare `created_at default now()` in this file therefore
-- shares the exact same created_at. Fixtures are deliberately ordered and
-- cleaned up (never left behind mid-file in a 'pending'/'retry_wait' state
-- that would compete with a later fallback-scan assertion) so that every
-- "oldest eligible due delivery" claim in this suite has exactly one
-- possible candidate at the moment it runs — never a same-timestamp tie
-- whose winner would be arbitrary.
--
-- Concurrency-testing limitation (see the migration's own header comment
-- for the full reasoning): this project's pgTAP harness is a single
-- Postgres session inside one uncommitted transaction — a genuinely
-- concurrent, two-session proof of row-level lock contention on
-- notification_deliveries is not safely reachable from within it without
-- either committing test data or using a second connection that could
-- never see this file's own uncommitted fixtures. Every "cannot be stolen"/
-- "claimed independently" test below is a deterministic, single-session
-- proof of the exact eligibility predicate and FOR UPDATE SKIP LOCKED
-- clause claim_notification_delivery_v1's SQL relies on (an unexpired
-- active claim is never returned as eligible by that predicate; an
-- expired one is; two distinct eligible rows are each independently
-- selectable) — this is the same bar the existing
-- 20260813114500_lead_completion_lifecycle_test.sql suite already set for
-- itself, not a genuine multi-connection lock-contention test, which
-- remains an explicitly reported limitation of this checkpoint.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(103);

-- ---------------------------------------------------------------------------
-- A. Column structure: new/renamed columns exist with correct type,
--    nullability and (for status) default
-- ---------------------------------------------------------------------------

select has_column('public', 'notification_deliveries', 'claim_token', 'column claim_token exists');
select has_column('public', 'notification_deliveries', 'claimed_at', 'column claimed_at exists (renamed from last_attempted_at)');
select has_column('public', 'notification_deliveries', 'lease_expires_at', 'column lease_expires_at exists');
select has_column('public', 'notification_deliveries', 'sent_at', 'column sent_at exists');
select has_column('public', 'notification_deliveries', 'provider', 'column provider exists');
select has_column('public', 'notification_deliveries', 'last_error_code', 'column last_error_code exists (renamed from last_error)');
select has_column('public', 'notification_deliveries', 'last_error_at', 'column last_error_at exists');
select hasnt_column('public', 'notification_deliveries', 'last_attempted_at', 'the old last_attempted_at column no longer exists (renamed, not duplicated)');
select hasnt_column('public', 'notification_deliveries', 'last_error', 'the old last_error column no longer exists (renamed, not duplicated)');

select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'claim_token'),
  'uuid', 'claim_token is uuid'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'claim_token'),
  'YES', 'claim_token is nullable'
);
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'status'),
  '''pending''::text', 'status now defaults to pending'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'status'),
  'NO', 'status remains NOT NULL'
);

-- ---------------------------------------------------------------------------
-- B. Indexes and uniqueness
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'notification_deliveries' and indexname = 'notification_deliveries_pending_due_idx'),
  1, 'notification_deliveries_pending_due_idx exists'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'notification_deliveries' and indexname = 'notification_deliveries_retry_due_idx'),
  1, 'notification_deliveries_retry_due_idx exists'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'notification_deliveries' and indexname = 'notification_deliveries_processing_lease_idx'),
  1, 'notification_deliveries_processing_lease_idx exists'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'notification_deliveries' and indexname = 'notification_deliveries_provider_message_id_key'),
  1, 'notification_deliveries_provider_message_id_key exists'
);
select ok(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notification_deliveries_provider_message_id_key') ilike '%unique%',
  'notification_deliveries_provider_message_id_key is a unique index'
);

-- ---------------------------------------------------------------------------
-- C. Function existence, exact signatures, SECURITY INVOKER, fixed search_path
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'notification_delivery_max_attempts', array[]::text[],
  'function public.notification_delivery_max_attempts() exists'
);
select has_function(
  'public', 'claim_notification_delivery_v1', array['uuid', 'uuid', 'integer'],
  'function public.claim_notification_delivery_v1(uuid, uuid, integer) exists'
);
select has_function(
  'public', 'mark_notification_delivery_sent_v1', array['uuid', 'uuid', 'text', 'text'],
  'function public.mark_notification_delivery_sent_v1(uuid, uuid, text, text) exists'
);
select has_function(
  'public', 'reschedule_notification_delivery_v1', array['uuid', 'uuid', 'text', 'integer'],
  'function public.reschedule_notification_delivery_v1(uuid, uuid, text, integer) exists'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.notification_delivery_max_attempts()'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.claim_notification_delivery_v1(uuid, uuid, integer)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.complete_lead_if_ready(uuid)'::regprocedure) = false,
  'all four new functions and the redefined complete_lead_if_ready are SECURITY INVOKER, never SECURITY DEFINER'
);

select ok(
  (select proconfig from pg_proc where oid = 'public.notification_delivery_max_attempts()'::regprocedure) @> array['search_path=pg_catalog'],
  'notification_delivery_max_attempts pins search_path to pg_catalog'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.claim_notification_delivery_v1(uuid, uuid, integer)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'claim_notification_delivery_v1 pins search_path to pg_catalog, public'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'mark_notification_delivery_sent_v1 pins search_path to pg_catalog, public'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'reschedule_notification_delivery_v1 pins search_path to pg_catalog, public'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.complete_lead_if_ready(uuid)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'complete_lead_if_ready still pins search_path to pg_catalog, public after its CREATE OR REPLACE'
);

-- ---------------------------------------------------------------------------
-- D. Exact role privileges: public/anon/authenticated denied, service_role
--    (and only service_role) granted EXECUTE
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('public', 'public.notification_delivery_max_attempts()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notification_delivery_max_attempts()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notification_delivery_max_attempts()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.notification_delivery_max_attempts()', 'EXECUTE'),
  'notification_delivery_max_attempts is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.claim_notification_delivery_v1(uuid, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_notification_delivery_v1(uuid, uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_notification_delivery_v1(uuid, uuid, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_notification_delivery_v1(uuid, uuid, integer)', 'EXECUTE'),
  'claim_notification_delivery_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mark_notification_delivery_sent_v1(uuid, uuid, text, text)', 'EXECUTE'),
  'mark_notification_delivery_sent_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reschedule_notification_delivery_v1(uuid, uuid, text, integer)', 'EXECUTE'),
  'reschedule_notification_delivery_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_lead_if_ready(uuid)', 'EXECUTE'),
  'complete_lead_if_ready retains its exact prior execute-only-for-service_role privileges after CREATE OR REPLACE'
);
select ok(
  not has_table_privilege('anon', 'public.notification_deliveries', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT')
  and has_table_privilege('service_role', 'public.notification_deliveries', 'SELECT'),
  'notification_deliveries remains unreadable to anon/authenticated after this migration — service_role only'
);

-- ---------------------------------------------------------------------------
-- E. Fixture: one real website lead + notification for the behavioral tests
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c2000a00-0000-0000-0000-000000000001'::uuid,
       encode(digest('c2h-a-fixture-1', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "C2H-A Fixture", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file website submission (existing create_website_quote_v1 flow) still succeeds after this migration'
);

-- ---------------------------------------------------------------------------
-- F. Completion-created row defaults to pending; existing identity preserved
-- ---------------------------------------------------------------------------

select is(
  (select nd.status from public.notification_deliveries nd
    join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  'pending',
  'the notification row created by real completion defaults to pending under the new lifecycle'
);
select is(
  (select count(*)::int from public.notification_deliveries nd
    join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'
      and nd.event_type = 'submission_completed' and nd.channel = 'email'),
  1,
  'exactly one submission_completed/email delivery exists — existing identity (event_type/channel) preserved'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select l.id, 'submission_completed', 'email' from public.leads l
     where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001' $$,
  '23505',
  NULL,
  'the existing (lead_id, event_type, channel) UNIQUE identity still blocks a second row for the same triple'
);

-- ---------------------------------------------------------------------------
-- G. Lifecycle CHECK constraints — illegal combinations rejected
--    (a dedicated lead+channel per assertion, all wrapped in throws_ok so no
--    row from this section ever persists — no interference with the
--    fallback-claim ordering tests in sections I/J)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c2000a00-0000-0000-0000-000000000002', encode(digest('c2h-a-checks-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a plain lead for direct notification_deliveries constraint tests inserts successfully'
);

select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'whatsapp', 'processing'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'processing without claim_token/claimed_at/lease_expires_at is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, claim_token, claimed_at, lease_expires_at)
     select id, 'submission_completed', 'whatsapp', 'pending', gen_random_uuid(), now(), now() + interval '1 minute'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'pending with an active claim retained is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, claim_token, claimed_at, lease_expires_at)
     select id, 'submission_completed', 'whatsapp', 'processing', gen_random_uuid(), now(), now() - interval '1 minute'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'a lease_expires_at at or before claimed_at is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, next_attempt_at)
     select id, 'submission_completed', 'whatsapp', 'pending', now() + interval '1 minute'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'pending with a next_attempt_at set is rejected — pending is always immediately due'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'whatsapp', 'retry_wait'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'retry_wait without a next_attempt_at is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, sent_at)
     select id, 'submission_completed', 'whatsapp', 'pending', now()
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'a non-sent row with sent_at set is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, sent_at, provider, provider_message_id)
     select id, 'submission_completed', 'whatsapp', 'sent', now(), 'resend', null
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'sent without a provider_message_id is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, last_error_code)
     select id, 'submission_completed', 'whatsapp', 'SOME_CODE'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'last_error_code without last_error_at is rejected (the pairing constraint)'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'whatsapp', 'not_a_real_status'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'an unrecognized status value is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, attempt_count)
     select id, 'submission_completed', 'whatsapp', -1
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'a negative attempt_count is rejected (existing constraint, reused unchanged)'
);

-- ---------------------------------------------------------------------------
-- H. last_error_code / provider / provider_message_id — bounded, sanitized,
--    no raw text / PII storage path. The one successful insert here is
--    given status='dead_letter' explicitly (not the pending default) so it
--    can never compete with the fallback-scan "oldest eligible" tests below.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, last_error_code, last_error_at)
     select id, 'submission_completed', 'whatsapp',
       'Exception: connection to smtp.provider.com timed out after 30000ms at Client.send (client.js:42)',
       now()
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'raw free-text exception content is rejected outright by last_error_code''s allowlist shape — there is no path for it to be stored'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, last_error_code, last_error_at)
     select id, 'submission_completed', 'whatsapp', 'owner@msmscrap.com', now()
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'an email-address-shaped value is rejected as a last_error_code (lowercase/@/. all fall outside the allowed charset)'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, last_error_code, last_error_at)
     select id, 'submission_completed', 'whatsapp', repeat('A', 41), now()
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'an oversized (41-char) last_error_code is rejected'
);
select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, last_error_code, last_error_at)
     select id, 'submission_completed', 'whatsapp', 'dead_letter', 'PROVIDER_TIMEOUT', now()
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  'a short, uppercase, sanitized machine code is accepted for last_error_code (inserted as dead_letter so it is never fallback-scan-eligible)'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status, sent_at, provider, provider_message_id)
     select id, 'submission_completed', 'sms', 'sent', now(), 'not a valid provider!!', 'msg-1'
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'a provider value outside the lowercase machine-code shape is rejected'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, provider_message_id)
     select id, 'submission_completed', 'sms', repeat('x', 201)
     from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'an oversized (201-char) provider_message_id is rejected'
);

-- ---------------------------------------------------------------------------
-- I. claim_notification_delivery_v1 — input validation
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.claim_notification_delivery_v1(null, null, 120) $$,
  'P0001', 'claim_notification_delivery_v1: claim_token is required',
  'a null claim_token is rejected'
);
select throws_ok(
  $$ select public.claim_notification_delivery_v1(gen_random_uuid(), null, 10) $$,
  'P0001', NULL,
  'a lease_seconds below the bounded minimum (30) is rejected'
);
select throws_ok(
  $$ select public.claim_notification_delivery_v1(gen_random_uuid(), null, 901) $$,
  'P0001', NULL,
  'a lease_seconds above the bounded maximum (900) is rejected'
);
select is(
  (select public.claim_notification_delivery_v1(gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid, 120)),
  NULL,
  'a targeted claim against a nonexistent delivery ID returns null, not an error'
);

-- ---------------------------------------------------------------------------
-- J. claim_notification_delivery_v1 — first claim (fallback), attempt_count,
--    exclusivity
-- ---------------------------------------------------------------------------

-- At this point in the file, fixture 1's delivery (from section E) is the
-- ONLY pending-or-otherwise-eligible row in the whole table — every row
-- from sections G/H either never persisted (throws_ok) or was inserted
-- directly as dead_letter. The fallback scan below is therefore
-- unambiguous.
select is(
  (select (public.claim_notification_delivery_v1('d0000000-0000-0000-0000-000000000001'::uuid, null, 120) ->> 'attempt_count')::int),
  1,
  'the first successful fallback claim sets attempt_count to 1'
);
select is(
  (select nd.status from public.notification_deliveries nd
    join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  'processing',
  'the claimed row is now processing'
);
select ok(
  (select claim_token from public.notification_deliveries nd
    join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001') = 'd0000000-0000-0000-0000-000000000001'::uuid,
  'the claim_token stored matches exactly what the caller supplied'
);

-- Active, unexpired claim cannot be stolen by a second caller (targeted).
select is(
  (select public.claim_notification_delivery_v1(
     'd0000000-0000-0000-0000-000000000002'::uuid,
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
     120
   )),
  NULL,
  'a targeted claim against an already-processing, unexpired-lease delivery returns null — the active claim cannot be stolen'
);
-- Active, unexpired claim is also invisible to the fallback scan.
select is(
  (select public.claim_notification_delivery_v1('d0000000-0000-0000-0000-000000000099'::uuid, null, 120)),
  NULL,
  'the fallback scan also finds nothing while the only other row remains an unexpired active claim'
);
select is(
  (select count(*)::int from public.notification_deliveries nd
    join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'
      and nd.status = 'processing' and nd.claim_token = 'd0000000-0000-0000-0000-000000000001'::uuid),
  1,
  'the original claim is untouched by both failed steal attempts'
);

-- ---------------------------------------------------------------------------
-- K. Two eligible rows can be claimed independently; targeted claim by
--    exact delivery ID
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c2000a00-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2h-a-fixture-2', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "C2H-A Fixture 2", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a second independent zero-file website submission succeeds'
);
-- Fixture 1's row is still processing (claimed above); fixture 2's fresh
-- row is now the ONLY pending row, so this fallback claim is unambiguous.
select is(
  (select (public.claim_notification_delivery_v1('d0000000-0000-0000-0000-000000000003'::uuid, null, 120) ->> 'lead_id')),
  (select id::text from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'the second, independent delivery is claimed by the fallback scan while the first remains claimed under its own token'
);
select is(
  (select count(*)::int from public.notification_deliveries where status = 'processing'),
  2,
  'both deliveries are now independently processing under two different claim_tokens'
);

-- Targeted claim by exact delivery ID, using a fresh dedicated lead so it
-- cannot be confused with any fallback-scan candidate.
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c2000a00-0000-0000-0000-000000000004', encode(digest('c2h-a-targeted-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a plain lead for the targeted-claim test inserts successfully'
);
select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'submission_completed', 'sms' from public.leads where idempotency_key = 'c2000a00-0000-0000-0000-000000000004' $$,
  'a fresh pending delivery for the targeted-claim test inserts successfully'
);
select is(
  (select (public.claim_notification_delivery_v1(
     'd0000000-0000-0000-0000-000000000004'::uuid,
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000004'),
     120
   ) ->> 'delivery_id')),
  (select nd.id::text from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000004'),
  'a targeted claim by exact delivery ID claims exactly that row'
);

-- ---------------------------------------------------------------------------
-- L. Expired-lease reclaim, stale-token rejection, wrong-token rejection
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.notification_deliveries
     set claimed_at = now() - interval '10 minutes', lease_expires_at = now() - interval '5 minutes'
     where claim_token = 'd0000000-0000-0000-0000-000000000001'::uuid $$,
  'simulating a crashed worker: forcing the first claim''s lease into the past succeeds'
);
select is(
  (select (public.claim_notification_delivery_v1('e0000000-0000-0000-0000-000000000001'::uuid, null, 120) ->> 'attempt_count')::int
    from public.leads l where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  2,
  'an expired-lease processing row is reclaimed by a new caller, and attempt_count increments again on the reclaim'
);
select ok(
  (select claim_token from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001')
    = 'e0000000-0000-0000-0000-000000000001'::uuid,
  'the reclaimed row now carries the NEW claim_token, not the stale one'
);
select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
       'd0000000-0000-0000-0000-000000000001'::uuid, -- the STALE, superseded token
       'resend', 'msg-stale'
     ) $$,
  'P0001', 'mark_notification_delivery_sent_v1: no matching active claim to finalize',
  'the stale (reclaimed-away) token is rejected by mark_notification_delivery_sent_v1 — fails closed'
);
select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
       gen_random_uuid(), -- a token that was never valid at all
       'resend', 'msg-wrong'
     ) $$,
  'P0001', 'mark_notification_delivery_sent_v1: no matching active claim to finalize',
  'a wrong token that was never valid is rejected identically'
);

-- ---------------------------------------------------------------------------
-- M. mark_notification_delivery_sent_v1 — validation, success, sent
--    identity, terminal state, idempotent vs. conflicting replay
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1(gen_random_uuid(), gen_random_uuid(), 'Not-Valid', 'msg-1') $$,
  'P0001', NULL,
  'an invalid (mixed-case/hyphenated) provider is rejected before any row lookup'
);
select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1(gen_random_uuid(), gen_random_uuid(), 'resend', '') $$,
  'P0001', NULL,
  'an empty provider_message_id is rejected'
);
select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1('00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(), 'resend', 'msg-1') $$,
  'P0001', 'mark_notification_delivery_sent_v1: delivery not found',
  'a nonexistent delivery ID is rejected'
);

select is(
  (select (public.mark_notification_delivery_sent_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
     'e0000000-0000-0000-0000-000000000001'::uuid,
     'resend', 'msg-real-12345'
   ) ->> 'status')),
  'sent',
  'marking sent with the exact current claim succeeds'
);
select is(
  (select nd.status from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  'sent', 'the row is persisted as sent'
);
select ok(
  (select sent_at is not null and provider = 'resend' and provider_message_id = 'msg-real-12345'
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  'the sent identity (sent_at, provider, provider_message_id) is stored exactly as supplied'
);
select ok(
  (select claim_token is null and claimed_at is null and lease_expires_at is null
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
  'the active claim is fully cleared once sent'
);
select is(
  (select public.claim_notification_delivery_v1(gen_random_uuid(),
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001')
   )),
  NULL,
  'a sent row is terminal — a targeted claim against it returns null, never re-claimable'
);
select is(
  (select (public.mark_notification_delivery_sent_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
     '11111111-1111-1111-1111-111111111111'::uuid, -- any token — irrelevant for a matching-identity replay
     'resend', 'msg-real-12345'
   ) ->> 'status')),
  'sent',
  'a matching-identity replay after already sent is a safe idempotent no-op, regardless of claim_token'
);
select throws_ok(
  $$ select public.mark_notification_delivery_sent_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
       gen_random_uuid(), 'resend', 'msg-DIFFERENT'
     ) $$,
  'P0001', 'mark_notification_delivery_sent_v1: delivery already finalized with a different identity',
  'a conflicting replay (different provider_message_id) after already sent is rejected, never overwriting the stored identity'
);

-- ---------------------------------------------------------------------------
-- N. reschedule_notification_delivery_v1 — validation, transient retry,
--    retry-window eligibility, max attempts -> dead_letter, terminal states
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.reschedule_notification_delivery_v1(gen_random_uuid(), gen_random_uuid(), 'lowercase_bad', 60) $$,
  'P0001', NULL,
  'a lowercase error_code is rejected — must be uppercase machine-code shape'
);
select throws_ok(
  $$ select public.reschedule_notification_delivery_v1(gen_random_uuid(), gen_random_uuid(), 'OK_CODE', 0) $$,
  'P0001', NULL,
  'a retry_after_seconds of 0 is rejected (must be at least 1)'
);
select throws_ok(
  $$ select public.reschedule_notification_delivery_v1(gen_random_uuid(), gen_random_uuid(), 'OK_CODE', 86401) $$,
  'P0001', NULL,
  'a retry_after_seconds above the 24-hour bound is rejected'
);
select throws_ok(
  $$ select public.reschedule_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000001'),
       gen_random_uuid(), 'ANY_CODE', 60
     ) $$,
  'P0001', 'reschedule_notification_delivery_v1: a sent delivery can never be rescheduled',
  'a sent delivery can never be rescheduled, even with a made-up claim token'
);

-- Use the second (still-processing) delivery from fixture 2 for the
-- transient-retry / max-attempts sequence.
select is(
  (select (public.reschedule_notification_delivery_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
     'd0000000-0000-0000-0000-000000000003'::uuid,
     'PROVIDER_TIMEOUT', 300
   ) ->> 'status')),
  'retry_wait',
  'a transient failure on attempt_count=1 (< max) becomes retry_wait'
);
select ok(
  (select next_attempt_at > now() and next_attempt_at <= now() + interval '301 seconds'
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'next_attempt_at is set to a real future time matching the requested delay'
);
select ok(
  (select claim_token is null and claimed_at is null and lease_expires_at is null
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'the active claim is cleared on reschedule'
);
select ok(
  (select last_error_code = 'PROVIDER_TIMEOUT' and last_error_at is not null
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'the sanitized error code and its timestamp are recorded'
);
select is(
  (select public.claim_notification_delivery_v1(gen_random_uuid(),
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003')
   )),
  NULL,
  'a retry_wait row whose next_attempt_at has not yet arrived is not claimable (targeted claim returns null)'
);
select lives_ok(
  $$ update public.notification_deliveries set next_attempt_at = now() - interval '1 second'
     where id = (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003') $$,
  'fast-forwarding next_attempt_at into the past succeeds'
);
select is(
  (select (public.claim_notification_delivery_v1('f0000000-0000-0000-0000-000000000001'::uuid, null, 120) ->> 'attempt_count')::int
    from public.leads l where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  2,
  'once due, the retry_wait row is claimable again by the fallback scan, and attempt_count increments to 2'
);

-- Drive the same delivery through the remaining attempts to prove the
-- deterministic max-attempts -> dead_letter policy exactly.
select lives_ok(
  $$ do $do$
     declare
       v_delivery_id uuid;
       v_token uuid;
     begin
       select nd.id into v_delivery_id from public.notification_deliveries nd
         join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003';
       -- Currently at attempt_count = 2 (processing, held by f0000000-...0001).
       perform public.reschedule_notification_delivery_v1(v_delivery_id, 'f0000000-0000-0000-0000-000000000001'::uuid, 'TRANSIENT', 1);
       for i in 3..4 loop
         update public.notification_deliveries set next_attempt_at = now() - interval '1 second' where id = v_delivery_id;
         v_token := gen_random_uuid();
         perform public.claim_notification_delivery_v1(v_token, v_delivery_id, 120);
         perform public.reschedule_notification_delivery_v1(v_delivery_id, v_token, 'TRANSIENT', 1);
       end loop;
       -- attempt_count is now 4 (still < 5) — one more claim+failure must dead-letter it.
       update public.notification_deliveries set next_attempt_at = now() - interval '1 second' where id = v_delivery_id;
       v_token := gen_random_uuid();
       perform public.claim_notification_delivery_v1(v_token, v_delivery_id, 120);
       perform public.reschedule_notification_delivery_v1(v_delivery_id, v_token, 'TRANSIENT', 1);
     end
     $do$ $$,
  'driving the delivery through its remaining allowed attempts succeeds'
);
select is(
  (select nd.status from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'dead_letter',
  'reaching notification_delivery_max_attempts() (5) transitions the delivery to dead_letter'
);
select is(
  (select attempt_count from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  (select public.notification_delivery_max_attempts()),
  'attempt_count exactly equals the max-attempts constant when dead-lettered'
);
select ok(
  (select next_attempt_at is null and claim_token is null
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
  'a dead_letter row carries no next_attempt_at and no active claim'
);
select is(
  (select public.claim_notification_delivery_v1(gen_random_uuid(),
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003')
   )),
  NULL,
  'a dead_letter row is never returned by a targeted claim attempt against it — terminal'
);
select throws_ok(
  $$ select public.reschedule_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000a00-0000-0000-0000-000000000003'),
       gen_random_uuid(), 'ANOTHER_CODE', 60
     ) $$,
  'P0001', 'reschedule_notification_delivery_v1: no matching active claim to reschedule',
  'a dead_letter row cannot be rescheduled again (no active claim to match — it is terminal)'
);

select * from finish();
