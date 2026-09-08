-- Permanent pgTAP regression suite for
-- supabase/migrations/20260817213951_owner_quick_add_lead.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file never leaves persistent data behind. Synthetic
-- auth.users rows only, matching every prior owner-RPC test file's own
-- established pattern (e.g. 20260817201248_owner_lead_status_and_notes_test.sql).

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- A. Structural existence, security, and privileges
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'create_owner_quick_add_lead_v1', array['uuid', 'uuid', 'text', 'jsonb'],
  'function public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb) exists'
);
select ok(
  not has_function_privilege('public', 'public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb)', 'EXECUTE'),
  'create_owner_quick_add_lead_v1 is execute-only for service_role'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_owner_quick_add_lead_v1(uuid, uuid, text, jsonb)'::regprocedure) = false,
  'create_owner_quick_add_lead_v1 is SECURITY INVOKER, not SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-owner-c2jf@example.test'),
  ('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-owner-account-c2jf@example.test'),
  ('e2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inactive-owner-c2jf@example.test');

insert into public.owner_accounts (user_id, is_active)
values
  ('e2000000-0000-0000-0000-000000000001', true),
  ('e2000000-0000-0000-0000-000000000003', false);

-- ---------------------------------------------------------------------------
-- C. Seller Quick Add — real transition, correct columns, activity, inbox eligibility
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('c2jf-seller-a', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"copper","contactName":"Ahmed","contactPhone":"+971501234567","notes":"Called about scrap copper","quantityValue":500,"quantityUnit":"kg","sellerEmirate":"dubai","sellerArea":"Al Quoz"}'::jsonb
     ) $$,
  'a seller Quick Add with valid fields succeeds'
);
select is(
  (select intent from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), 'sell',
  'the seller lead was stored with intent=sell'
);
select is(
  (select capture_channel from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), 'phone',
  'the seller lead was stored with the exact requested manual channel (phone)'
);
select is(
  (select source from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), null,
  'source stays null for a non-website lead (leads_source_matches_channel)'
);
select is(
  (select seller_name from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), 'Ahmed',
  'contactName was mapped onto seller_name for a sell-intent lead'
);
select is(
  (select seller_phone from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), '+971501234567',
  'contactPhone was mapped onto seller_phone'
);
select is(
  (select buyer_contact_person from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), null,
  'no buyer_* column was populated for a sell-intent lead (branch isolation)'
);
select ok(
  (select reference from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001') ~ '^MSM-[0-9]{6}-[0-9A-F]{6}$',
  'a genuine, correctly formatted server-generated reference was assigned'
);
select ok(
  (select submission_completed_at from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001') is not null,
  'submission_completed_at was set directly at creation (immediate owner-inbox eligibility)'
);
select is(
  (select status from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), 'new',
  'the lead starts at the canonical new-lead status'
);
select is(
  (select file_upload_status from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000001'), 'none',
  'file_upload_status stays at its default (satisfies leads_file_upload_status_matches_completion)'
);
select ok(
  exists(
    select 1 from public.leads
    where idempotency_key = 'c1000000-0000-0000-0000-000000000001'
      and submission_completed_at is not null
  ),
  'the new lead is visible under leads_owner_inbox_completed_order_idx''s own predicate (submission_completed_at is not null)'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000001'),
  1,
  'exactly one activity row was created atomically with the lead'
);
select is(
  (select event_type from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000001'),
  'lead_created',
  'the activity event_type is lead_created'
);
select is(
  (select actor_type from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000001'),
  'owner',
  'the activity is attributed to actor_type=owner, not system'
);
select is(
  (select actor_owner_id from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000001'),
  'e2000000-0000-0000-0000-000000000001',
  'the activity is attributed to the calling owner'
);
select ok(
  exists(select 1 from public.owner_profiles where id = 'e2000000-0000-0000-0000-000000000001'),
  'a matching owner_profiles row was lazily upserted for attribution'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000001'),
  0,
  'no notification_deliveries row was queued for a Quick Add lead (no redundant owner notification)'
);

-- ---------------------------------------------------------------------------
-- D. Buyer Quick Add
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000002'::uuid,
       encode(digest('c2jf-buyer-a', 'sha256'), 'hex'),
       '{"intent":"buy","captureChannel":"whatsapp","material":"aluminium","contactName":"Fatima Traders","contactPhone":"+971521112222","quantityValue":2,"quantityUnit":"tonnes"}'::jsonb
     ) $$,
  'a buyer Quick Add with valid fields succeeds'
);
select is(
  (select intent from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000002'), 'buy',
  'the buyer lead was stored with intent=buy'
);
select is(
  (select buyer_contact_person from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000002'), 'Fatima Traders',
  'contactName was mapped onto buyer_contact_person for a buy-intent lead'
);
select is(
  (select seller_name from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000002'), null,
  'no seller_* column was populated for a buy-intent lead (branch isolation)'
);
select is(
  (select capture_channel from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000002'), 'whatsapp',
  'the buyer lead was stored with the exact requested manual channel (whatsapp)'
);

-- ---------------------------------------------------------------------------
-- E. Invalid intent / capture channel are rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2jf-invalid-intent', 'sha256'), 'hex'),
       '{"intent":"maybe","captureChannel":"phone","material":"copper","contactName":"X","contactPhone":"+971501234567"}'::jsonb
     ) $$,
  'P0001', 'create_owner_quick_add_lead_v1: invalid intent',
  'an invalid intent value is rejected'
);
select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000004'::uuid,
       encode(digest('c2jf-website-channel', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"website","material":"copper","contactName":"X","contactPhone":"+971501234567"}'::jsonb
     ) $$,
  'P0001', 'create_owner_quick_add_lead_v1: invalid capture channel',
  '''website'' is rejected — that channel belongs to create_website_quote_v1 alone'
);
select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000005'::uuid,
       encode(digest('c2jf-owner-manual-channel', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"owner_manual","material":"copper","contactName":"X","contactPhone":"+971501234567"}'::jsonb
     ) $$,
  'P0001', 'create_owner_quick_add_lead_v1: invalid capture channel',
  '''owner_manual'' is rejected here — reserved for a distinct future backfill feature, not live Quick Add capture'
);

-- ---------------------------------------------------------------------------
-- F. Missing / inactive owner rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000002'::uuid,
       'c1000000-0000-0000-0000-000000000006'::uuid,
       encode(digest('c2jf-missing-owner', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"copper","contactName":"X","contactPhone":"+971501234567"}'::jsonb
     ) $$,
  'P0001', 'create_owner_quick_add_lead_v1: owner not authorized',
  'a user with no owner_accounts row at all is rejected'
);
select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000003'::uuid,
       'c1000000-0000-0000-0000-000000000007'::uuid,
       encode(digest('c2jf-inactive-owner', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"copper","contactName":"X","contactPhone":"+971501234567"}'::jsonb
     ) $$,
  'P0001', 'create_owner_quick_add_lead_v1: owner not authorized',
  'an explicitly inactive owner is rejected'
);
select is(
  (select count(*)::int from public.leads where idempotency_key in (
    'c1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000007'
  )),
  0,
  'no lead row was created by either rejected unauthorized attempt'
);

-- ---------------------------------------------------------------------------
-- G. Atomic rollback — a CHECK-constraint failure mid-INSERT leaves no
--    partial lead/activity/owner_profiles row behind
-- ---------------------------------------------------------------------------

create temp table g_counts_before as
  select
    (select count(*) from public.leads) as leads_n,
    (select count(*) from public.lead_activities) as activities_n;

select throws_ok(
  -- A phone that fails leads.seller_phone's own E.164-style CHECK.
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000008'::uuid,
       encode(digest('c2jf-rollback', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"copper","contactName":"X","contactPhone":"0501234567"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'a malformed contact phone fails the leads table''s own CHECK constraint'
);
select is(
  (select count(*) from public.leads), (select leads_n from g_counts_before),
  'no lead row survives the failed insert — the whole call rolled back'
);
select is(
  (select count(*) from public.lead_activities), (select activities_n from g_counts_before),
  'no activity row survives the failed insert either'
);

-- ---------------------------------------------------------------------------
-- H. Idempotent replay: same key + same hash returns the same result and
--    creates no duplicates
-- ---------------------------------------------------------------------------

-- First call actually creates the lead (idempotent_replay = false) — kept
-- separate from the equality check below, which compares two SUBSEQUENT
-- replay calls to each other rather than to this first, non-replay call
-- (those two differ only in their own idempotent_replay flag, by design).
select lives_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000009'::uuid,
       encode(digest('c2jf-replay', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"walk_in","material":"steel_iron","contactName":"Repeat Co","contactPhone":"+971509998888"}'::jsonb
     ) $$,
  'the first Quick Add submission with this idempotency_key succeeds'
);
select ok(
  (select public.create_owner_quick_add_lead_v1(
     'e2000000-0000-0000-0000-000000000001'::uuid,
     'c1000000-0000-0000-0000-000000000009'::uuid,
     encode(digest('c2jf-replay', 'sha256'), 'hex'),
     '{"intent":"sell","captureChannel":"walk_in","material":"steel_iron","contactName":"Repeat Co","contactPhone":"+971509998888"}'::jsonb
   ))
  = (select public.create_owner_quick_add_lead_v1(
     'e2000000-0000-0000-0000-000000000001'::uuid,
     'c1000000-0000-0000-0000-000000000009'::uuid,
     encode(digest('c2jf-replay', 'sha256'), 'hex'),
     '{"intent":"sell","captureChannel":"walk_in","material":"steel_iron","contactName":"Repeat Co","contactPhone":"+971509998888"}'::jsonb
   )),
  'two replays of an already-created idempotency_key return the exact same lead_id/reference/idempotent_replay'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000009'), 1,
  'the replayed call created no duplicate lead'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'c1000000-0000-0000-0000-000000000009'),
  1,
  'the replayed call created no duplicate activity'
);
select is(
  (select (public.create_owner_quick_add_lead_v1(
     'e2000000-0000-0000-0000-000000000001'::uuid,
     'c1000000-0000-0000-0000-000000000009'::uuid,
     encode(digest('c2jf-replay', 'sha256'), 'hex'),
     '{"intent":"sell","captureChannel":"walk_in","material":"steel_iron","contactName":"Repeat Co","contactPhone":"+971509998888"}'::jsonb
   )) ->> 'idempotent_replay')::boolean,
  true,
  'the replay response explicitly reports idempotent_replay = true'
);

-- ---------------------------------------------------------------------------
-- I. Same idempotency_key + different payload_hash is rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-000000000009'::uuid,
       encode(digest('c2jf-a-completely-different-payload', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"walk_in","material":"steel_iron","contactName":"Repeat Co","contactPhone":"+971509998888"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'reusing an idempotency_key with a different payload_hash is rejected'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'c1000000-0000-0000-0000-000000000009'), 1,
  'the rejected conflicting replay created no additional lead'
);

-- ---------------------------------------------------------------------------
-- J. Two genuinely new request ids with identical business data create two
--    separate, legitimate leads
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-00000000000a'::uuid,
       encode(digest('c2jf-identical-a', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"lead","contactName":"Same Name","contactPhone":"+971507770001"}'::jsonb
     ) $$,
  'the first of two identical-content, distinctly-keyed submissions succeeds'
);
select lives_ok(
  $$ select public.create_owner_quick_add_lead_v1(
       'e2000000-0000-0000-0000-000000000001'::uuid,
       'c1000000-0000-0000-0000-00000000000b'::uuid,
       encode(digest('c2jf-identical-a', 'sha256'), 'hex'),
       '{"intent":"sell","captureChannel":"phone","material":"lead","contactName":"Same Name","contactPhone":"+971507770001"}'::jsonb
     ) $$,
  'the second, independently-keyed submission with identical business data also succeeds as its own legitimate lead'
);
select isnt(
  (select id from public.leads where idempotency_key = 'c1000000-0000-0000-0000-00000000000a'),
  (select id from public.leads where idempotency_key = 'c1000000-0000-0000-0000-00000000000b'),
  'the two independently-keyed submissions produced two distinct lead rows'
);
select isnt(
  (select reference from public.leads where idempotency_key = 'c1000000-0000-0000-0000-00000000000a'),
  (select reference from public.leads where idempotency_key = 'c1000000-0000-0000-0000-00000000000b'),
  'the two leads received two distinct genuine references'
);

select * from finish();
rollback;
