-- Permanent pgTAP regression suite for
-- supabase/migrations/20260814150000_expose_upload_slot_status.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like every suite it extends) never leaves persistent
-- data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(27);

-- ---------------------------------------------------------------------------
-- A. No privilege/security/search_path regression from this CREATE OR
--    REPLACE — the exact same checks the CHECKPOINT B suite runs.
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'create_website_quote_v1', array['uuid', 'text', 'jsonb', 'jsonb'],
  'function public.create_website_quote_v1(uuid, text, jsonb, jsonb) still exists after CHECKPOINT C2F-C1'
);
select ok(
  not has_function_privilege('anon', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE'),
  'anon/authenticated still cannot execute, service_role still can — CREATE OR REPLACE did not change grants'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)'::regprocedure) = false,
  'create_website_quote_v1 is still SECURITY INVOKER, not SECURITY DEFINER'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)'::regprocedure)
    @> array['search_path=pg_catalog, public'],
  'create_website_quote_v1 still pins search_path to pg_catalog, public'
);

-- ---------------------------------------------------------------------------
-- B. Fresh initiation: every slot returns status = pending
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('c2fc1-fresh-pending', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Fresh Pending", "sellerPhone": "+971501234001", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[
         {"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024},
         {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 2048}
       ]'::jsonb
     ) $$,
  'a fresh two-file submission succeeds'
);
select ok(
  (select bool_and((slot ->> 'status') = 'pending')
   from jsonb_array_elements(
     public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('c2fc1-fresh-pending', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb
     ) -> 'upload_slots'
   ) as slot),
  'every slot in a fresh (replayed, no new files) response reports status=pending'
);
select ok(
  (select bool_and(qus.status = 'pending')
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'a1000000-0000-0000-0000-000000000001'),
  'the underlying rows are genuinely pending — the RPC response matches real DB state, not a hardcoded value'
);

-- ---------------------------------------------------------------------------
-- C. uploading is distinguishable: a claimed-but-unfinished slot reports
--    status = uploading on replay, not pending and not verified
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000002'::uuid,
       encode(digest('c2fc1-uploading', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Uploading Test", "sellerPhone": "+971501234002", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the uploading-status test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000002'::uuid
     ) $$,
  'claiming the slot (but never finalizing it) succeeds'
);
select is(
  (select (jsonb_array_elements(public.create_website_quote_v1(
     'a1000000-0000-0000-0000-000000000002'::uuid,
     encode(digest('c2fc1-uploading', 'sha256'), 'hex'),
     '{"intent": "sell"}'::jsonb
   ) -> 'upload_slots') ->> 'status')),
  'uploading',
  'a replay after claim-without-finalize reports status=uploading, not pending or verified'
);

-- ---------------------------------------------------------------------------
-- D. A verified slot is returned as verified on replay
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000002'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('c2fc1-verified-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the claimed slot succeeds'
);
select is(
  (select (jsonb_array_elements(public.create_website_quote_v1(
     'a1000000-0000-0000-0000-000000000002'::uuid,
     encode(digest('c2fc1-uploading', 'sha256'), 'hex'),
     '{"intent": "sell"}'::jsonb
   ) -> 'upload_slots') ->> 'status')),
  'verified',
  'a replay after a genuine finalize reports status=verified'
);

-- ---------------------------------------------------------------------------
-- E. Mixed verified/pending statuses are preserved exactly, per slot,
--    keyed by slot_index — never conflated or reordered
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2fc1-mixed', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Mixed Status", "sellerPhone": "+971501234003", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[
         {"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024},
         {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 2048},
         {"original_filename": "c.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 4096}
       ]'::jsonb
     ) $$,
  'a fresh three-file submission for the mixed-status test succeeds'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000003' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000003'::uuid
     ) $$,
  'claiming slot 0 succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000003' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000003'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000003' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('c2fc1-mixed-slot0', 'sha256'), 'hex')
     ) $$,
  'finalizing (verifying) slot 0 succeeds — slots 1 and 2 are left untouched (still pending)'
);
select is(
  (select jsonb_agg(slot -> 'status' order by (slot ->> 'slot_index')::int)
   from jsonb_array_elements(
     public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2fc1-mixed', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb
     ) -> 'upload_slots'
   ) as slot),
  '["verified", "pending", "pending"]'::jsonb,
  'the replay reports exactly one verified and two pending statuses, in slot_index order — not conflated across slots'
);

-- ---------------------------------------------------------------------------
-- F. failed is distinguishable (release_quote_upload_claim_v1 with
--    outcome=cleanup_required)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000004'::uuid,
       encode(digest('c2fc1-failed', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Failed Test", "sellerPhone": "+971501234004", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the failed-status test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000004' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000004'::uuid
     ) $$,
  'claiming the failed-status test slot succeeds'
);
select lives_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000004' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000004'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000004' and qus.slot_index = 0),
       'cleanup_required'
     ) $$,
  'releasing with outcome=cleanup_required succeeds'
);
select is(
  (select (jsonb_array_elements(public.create_website_quote_v1(
     'a1000000-0000-0000-0000-000000000004'::uuid,
     encode(digest('c2fc1-failed', 'sha256'), 'hex'),
     '{"intent": "sell"}'::jsonb
   ) -> 'upload_slots') ->> 'status')),
  'failed',
  'a replay after cleanup_required reports status=failed'
);

-- ---------------------------------------------------------------------------
-- G. expired is distinguishable (a slot whose window elapsed while
--    uploading, released via outcome=retry — release_quote_upload_claim_v1
--    itself transitions this to expired, exactly like the CHECKPOINT C2B1
--    suite's own equivalent test)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000005', encode(digest('c2fc1-expired', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the expired-status test inserts successfully (test setup, as function owner)'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, status, created_at, expires_at, upload_attempt_id, upload_started_at, upload_object_path)
     select id, 0, 'seller_photo', 'old.jpg', 'image/jpeg', 1024, 'uploading', now() - interval '20 minutes', now() - interval '5 minutes', gen_random_uuid(), now() - interval '19 minutes',
       'quote-uploads/test-setup/' || id::text || '/c2fc1-expired'
     from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000005' $$,
  'an already-elapsed uploading slot (test setup) inserts successfully'
);
select lives_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000005' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000005'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000005' and qus.slot_index = 0),
       'retry'
     ) $$,
  'releasing with outcome=retry on an elapsed slot succeeds (transitions to expired, not pending)'
);
select is(
  (select (jsonb_array_elements(public.create_website_quote_v1(
     'a1000000-0000-0000-0000-000000000005'::uuid,
     encode(digest('c2fc1-expired', 'sha256'), 'hex'),
     '{"intent": "sell"}'::jsonb
   ) -> 'upload_slots') ->> 'status')),
  'expired',
  'a replay for an elapsed/released slot reports status=expired, distinct from failed/pending/verified/uploading'
);

-- ---------------------------------------------------------------------------
-- H. Idempotency/atomicity from the CHECKPOINT B suite still hold: a
--    replay with the same key/hash still creates no duplicate rows, and a
--    different hash under the same key is still rejected — this migration
--    changed only what one field reports, not any of that behavior.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003'),
  1,
  'the several replays exercised above still created no duplicate lead for that key'
);
select is(
  (select count(*)::int from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000003'),
  3,
  'the several replays exercised above still created no duplicate or additional slots'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('a-completely-different-payload', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'reusing an idempotency_key with a different payload_hash is still rejected after this migration'
);

select * from finish();

rollback;
