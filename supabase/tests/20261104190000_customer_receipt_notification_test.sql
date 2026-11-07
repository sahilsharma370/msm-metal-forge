-- Permanent pgTAP regression suite for
-- supabase/migrations/20261104190000_customer_receipt_notification.sql
--
-- Run with: npx supabase test db --local
--
-- Same single-transaction-rolled-back convention as every other suite in
-- this schema (see 20260816170000_notification_delivery_outbox_lifecycle_test.sql's
-- own header comment for the full reasoning) — nothing here persists.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- A. event_type CHECK constraint widened, not loosened
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c4000000-0000-0000-0000-000000000001', encode(digest('cr-direct-insert-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a plain lead for direct notification_deliveries constraint tests inserts successfully'
);

select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'customer_receipt', 'email' from public.leads
     where idempotency_key = 'c4000000-0000-0000-0000-000000000001' $$,
  'customer_receipt is now an accepted event_type value'
);

select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'some_other_event', 'email' from public.leads
     where idempotency_key = 'c4000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'an unrecognized event_type is still rejected — the widening is additive, not a wildcard'
);

select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'customer_receipt', 'email' from public.leads
     where idempotency_key = 'c4000000-0000-0000-0000-000000000001' $$,
  '23505',
  NULL,
  'the (lead_id, event_type, channel) UNIQUE identity blocks a second customer_receipt row for the same lead'
);

-- ---------------------------------------------------------------------------
-- B. complete_lead_if_ready — zero-file website seller submission queues
--    BOTH submission_completed and customer_receipt, exactly once each
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c4000000-0000-0000-0000-000000000010'::uuid,
       encode(digest('cr-zero-file-seller', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Zero File Seller", "sellerPhone": "+971501234567", "sellerEmail": "zerofile.seller@example.com", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file seller submission (with email) creates and completes successfully'
);
select ok(
  (select submission_completed_at is not null from public.leads
    where idempotency_key = 'c4000000-0000-0000-0000-000000000010'),
  'the zero-file seller lead is completed'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'submission_completed' and nd.channel = 'email'),
  1,
  'exactly one submission_completed/email delivery exists — unchanged from before this migration'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'customer_receipt' and nd.channel = 'email'),
  1,
  'exactly one customer_receipt/email delivery exists — the new row this migration adds'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010'),
  2,
  'exactly two delivery rows total for this lead — the two event_types coexist independently, never merged into one'
);
select is(
  (select nd.status from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'customer_receipt'),
  'pending',
  'the new customer_receipt row starts pending, same as submission_completed'
);

-- Exact replay must not create a second row of either kind.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'c4000000-0000-0000-0000-000000000010'::uuid,
       encode(digest('cr-zero-file-seller', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Zero File Seller", "sellerPhone": "+971501234567", "sellerEmail": "zerofile.seller@example.com", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'an exact replay (same idempotency_key + payload_hash) succeeds'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'submission_completed'),
  1,
  'still exactly one submission_completed row after the exact replay — no duplicate'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'customer_receipt'),
  1,
  'still exactly one customer_receipt row after the exact replay — no duplicate'
);

-- Calling complete_lead_if_ready a second time directly (simulating a
-- reconciliation/trigger race on an already-completed lead) must also be a
-- safe no-op for both rows.
select is(
  (select public.complete_lead_if_ready(id) from public.leads
    where idempotency_key = 'c4000000-0000-0000-0000-000000000010'),
  false,
  'a second direct call to complete_lead_if_ready on an already-completed lead returns false'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010'),
  2,
  'still exactly two delivery rows total after the direct reconciliation call — no duplicate of either kind'
);

-- ---------------------------------------------------------------------------
-- C. Buyer-branch website submission also gets both rows
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'c4000000-0000-0000-0000-000000000020'::uuid,
       encode(digest('cr-zero-file-buyer', 'sha256'), 'hex'),
       '{"intent": "buy", "source": "materials", "material": "aluminium", "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local", "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay area", "buyerFulfilment": "delivery", "buyerContactPerson": "Fatima Buyer", "buyerPhone": "+971502345678", "buyerEmail": "fatima.buyer@example.com", "buyerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file buyer submission (with email) creates and completes successfully'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000020' and nd.event_type = 'customer_receipt'),
  1,
  'exactly one customer_receipt row exists for the buyer lead too'
);

-- ---------------------------------------------------------------------------
-- D. A non-website (owner-created/phone) lead never gets either row —
--    unaffected by this migration, exactly as before it
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c4000000-0000-0000-0000-000000000030', encode(digest('cr-non-website-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a non-website lead inserts successfully'
);
select is(
  (select public.complete_lead_if_ready(id) from public.leads
    where idempotency_key = 'c4000000-0000-0000-0000-000000000030'),
  false,
  'complete_lead_if_ready never completes a non-website lead'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000030'),
  0,
  'no notification_deliveries row of any event_type was created for the non-website lead'
);

-- ---------------------------------------------------------------------------
-- E. Historical-nullable-email leads are structurally unaffected — this
--    migration adds no CHECK on leads.seller_email/buyer_email at all, and
--    a null email never prevents the row from being queued (only the
--    dispatcher, not this migration, has an opinion about a null recipient)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.leads set seller_email = null
     where idempotency_key = 'c4000000-0000-0000-0000-000000000010' $$,
  'a completed lead''s seller_email can still be nulled out directly — no new CHECK constraint on leads itself'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c4000000-0000-0000-0000-000000000010' and nd.event_type = 'customer_receipt'),
  1,
  'the already-queued customer_receipt row for that lead is untouched by nulling its email afterward'
);

select * from finish();

rollback;
