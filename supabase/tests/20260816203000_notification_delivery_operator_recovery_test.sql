-- Permanent pgTAP regression suite for
-- supabase/migrations/20260816203000_notification_delivery_operator_recovery.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end (like every other suite in this schema — this file never leaves
-- persistent data behind). Same now()-is-frozen-per-transaction caveat as
-- 20260816170000_notification_delivery_outbox_lifecycle_test.sql applies
-- here too, but this file never relies on created_at ordering, so it does
-- not matter.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(39);

-- ---------------------------------------------------------------------------
-- A. manual_requeue_count — structure
-- ---------------------------------------------------------------------------

select has_column('public', 'notification_deliveries', 'manual_requeue_count', 'column manual_requeue_count exists');
select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'manual_requeue_count'),
  'integer', 'manual_requeue_count is integer'
);
select is(
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'manual_requeue_count'),
  'NO', 'manual_requeue_count is NOT NULL'
);
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'notification_deliveries' and column_name = 'manual_requeue_count'),
  '0', 'manual_requeue_count defaults to 0'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c2000b10-0000-0000-0000-000000000001', encode(digest('c2h-b1-checks-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a plain lead for direct constraint tests inserts successfully'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, manual_requeue_count)
     select id, 'submission_completed', 'whatsapp', -1
     from public.leads where idempotency_key = 'c2000b10-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a negative manual_requeue_count is rejected'
);

-- ---------------------------------------------------------------------------
-- B. Function existence, signatures, SECURITY INVOKER, fixed search_path
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'dead_letter_notification_delivery_v1', array['uuid', 'uuid', 'text'],
  'function public.dead_letter_notification_delivery_v1(uuid, uuid, text) exists'
);
select has_function(
  'public', 'requeue_notification_delivery_v1', array['uuid'],
  'function public.requeue_notification_delivery_v1(uuid) exists'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.requeue_notification_delivery_v1(uuid)'::regprocedure) = false,
  'both new functions are SECURITY INVOKER, never SECURITY DEFINER'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'dead_letter_notification_delivery_v1 pins search_path to pg_catalog, public'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.requeue_notification_delivery_v1(uuid)'::regprocedure) @> array['search_path=pg_catalog, public'],
  'requeue_notification_delivery_v1 pins search_path to pg_catalog, public'
);

-- ---------------------------------------------------------------------------
-- C. Exact role privileges
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('public', 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.dead_letter_notification_delivery_v1(uuid, uuid, text)', 'EXECUTE'),
  'dead_letter_notification_delivery_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.requeue_notification_delivery_v1(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.requeue_notification_delivery_v1(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.requeue_notification_delivery_v1(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.requeue_notification_delivery_v1(uuid)', 'EXECUTE'),
  'requeue_notification_delivery_v1 is execute-only for service_role'
);

-- ---------------------------------------------------------------------------
-- D. dead_letter_notification_delivery_v1 — behavior
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(gen_random_uuid(), gen_random_uuid(), 'lowercase_bad') $$,
  'P0001', NULL,
  'a lowercase error_code is rejected'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(gen_random_uuid(), gen_random_uuid(), repeat('A', 41)) $$,
  'P0001', NULL,
  'an oversized (41-char) error_code is rejected'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1('00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(), 'ANY_CODE') $$,
  'P0001', 'dead_letter_notification_delivery_v1: delivery not found',
  'a nonexistent delivery ID is rejected'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c2000b10-0000-0000-0000-000000000002'::uuid,
       encode(digest('c2h-b1-fixture-1', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "C2H-B1 Fixture", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file website submission succeeds (fixture for dead-letter tests)'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       gen_random_uuid(), 'WRONG_TOKEN_CODE'
     ) $$,
  'P0001', 'dead_letter_notification_delivery_v1: no matching active claim to dead-letter',
  'a pending row (never claimed) cannot be dead-lettered — no matching active claim'
);

select lives_ok(
  $$ select public.claim_notification_delivery_v1('d1000000-0000-0000-0000-000000000001'::uuid,
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       120
     ) $$,
  'claiming the fixture delivery succeeds'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       gen_random_uuid(), 'WRONG_TOKEN_CODE'
     ) $$,
  'P0001', 'dead_letter_notification_delivery_v1: no matching active claim to dead-letter',
  'a wrong/stale claim token is rejected — fails closed'
);
select is(
  (select (public.dead_letter_notification_delivery_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
     'd1000000-0000-0000-0000-000000000001'::uuid,
     'INVALID_RECIPIENT'
   ) ->> 'status')),
  'dead_letter',
  'the current valid claim can permanently dead-letter the delivery'
);
select ok(
  (select nd.status = 'dead_letter'
     and nd.next_attempt_at is null
     and nd.claim_token is null and nd.claimed_at is null and nd.lease_expires_at is null
     and nd.sent_at is null and nd.provider is null and nd.provider_message_id is null
     and nd.last_error_code = 'INVALID_RECIPIENT' and nd.last_error_at is not null
     and nd.manual_requeue_count = 0
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
  'dead-lettering clears claim/lease/next_attempt, leaves sent identity absent, and stores only the sanitized error code'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       'd1000000-0000-0000-0000-000000000001'::uuid, 'ANOTHER_CODE'
     ) $$,
  'P0001', 'dead_letter_notification_delivery_v1: no matching active claim to dead-letter',
  'a repeated call against the now-terminal dead_letter row cannot mutate it further (no active claim remains to match)'
);

-- Sent is terminal to dead-lettering too.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'c2000b10-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2h-b1-fixture-sent', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "C2H-B1 Sent Fixture", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a second zero-file website submission succeeds (fixture for the sent-is-terminal test)'
);
select lives_ok(
  $$ select public.claim_notification_delivery_v1('d1000000-0000-0000-0000-000000000002'::uuid,
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000003'),
       120
     ) $$,
  'claiming the sent-fixture delivery succeeds'
);
select lives_ok(
  $$ select public.mark_notification_delivery_sent_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000003'),
       'd1000000-0000-0000-0000-000000000002'::uuid, 'resend', 'msg-real-1'
     ) $$,
  'marking the sent-fixture delivery as sent succeeds'
);
select throws_ok(
  $$ select public.dead_letter_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000003'),
       gen_random_uuid(), 'ANY_CODE'
     ) $$,
  'P0001', 'dead_letter_notification_delivery_v1: a sent delivery can never be dead-lettered',
  'a sent delivery can never be dead-lettered'
);

-- ---------------------------------------------------------------------------
-- E. requeue_notification_delivery_v1 — behavior
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.requeue_notification_delivery_v1('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0001', 'requeue_notification_delivery_v1: delivery not found',
  'a nonexistent delivery ID is rejected'
);
select throws_ok(
  $$ select public.requeue_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000003')
     ) $$,
  'P0001', NULL,
  'a sent delivery can never be requeued'
);

-- Use the already-dead_letter fixture (idempotency_key ...0002) from
-- section D for the valid-requeue tests.
select is(
  (select (public.requeue_notification_delivery_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002')
   ) ->> 'status')),
  'pending',
  'a valid manual requeue against a dead_letter row resets it to pending'
);
select ok(
  (select nd.status = 'pending'
     and nd.attempt_count = 0
     and nd.next_attempt_at is null
     and nd.claim_token is null and nd.claimed_at is null and nd.lease_expires_at is null
     and nd.manual_requeue_count = 1
    from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
  'requeue resets attempt_count to 0, leaves next_attempt_at null (the C2H-A pending invariant — immediately due), clears any claim, and increments manual_requeue_count exactly once'
);
select is(
  (select (public.requeue_notification_delivery_v1(
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002')
   ) ->> 'manual_requeue_count')::int),
  1,
  'a repeated requeue against an already-pending row is a safe idempotent no-op — manual_requeue_count does not increment again'
);
select is(
  (select manual_requeue_count from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
  1,
  'manual_requeue_count is confirmed unchanged in the actual row after the idempotent replay'
);
select is(
  (select (public.claim_notification_delivery_v1(gen_random_uuid(),
     (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002')
   ) ->> 'attempt_count')::int),
  1,
  'the requeued (now-pending) delivery is claimable again and starts a fresh five-attempt budget (attempt_count 1, not 6)'
);

-- processing/retry_wait/sent cannot use manual requeue.
select throws_ok(
  $$ select public.requeue_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002')
     ) $$,
  'P0001', NULL,
  'a processing row cannot be manually requeued'
);
select lives_ok(
  $$ select public.reschedule_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       (select nd.claim_token from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002'),
       'TRANSIENT', 300
     ) $$,
  'rescheduling the delivery to retry_wait succeeds (fixture for the next test)'
);
select throws_ok(
  $$ select public.requeue_notification_delivery_v1(
       (select nd.id from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000002')
     ) $$,
  'P0001', NULL,
  'a retry_wait row cannot be manually requeued'
);

-- ---------------------------------------------------------------------------
-- F. Full existing suite still passes (spot-check a few C2H-A behaviors
--    remain intact after this additive migration — the complete 539-test
--    regression proof is the full `npx supabase test db --local` run,
--    which includes every historical suite unmodified by this checkpoint)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c2000b10-0000-0000-0000-000000000004'::uuid,
       encode(digest('c2h-b1-regression-check', 'sha256'), 'hex'),
       '{"intent": "buy", "source": "hero", "material": "aluminium", "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local", "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay", "buyerFulfilment": "delivery", "buyerContactPerson": "Regression Buyer", "buyerPhone": "+971502345678", "buyerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file buyer website submission still succeeds after this migration (C2H-A regression check)'
);
select is(
  (select nd.status from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id where l.idempotency_key = 'c2000b10-0000-0000-0000-000000000004'),
  'pending',
  'its notification row still defaults to pending under the unmodified C2H-A lifecycle'
);

select * from finish();
