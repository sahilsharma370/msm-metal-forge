-- Permanent pgTAP regression suite for
-- supabase/migrations/20260812182525_finalize_quote_upload_rpc.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like the three suites it extends) never leaves
-- persistent data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- A. Structural existence and permissions
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'finalize_quote_upload_v1', array['uuid', 'uuid', 'text', 'bigint', 'text'],
  'function public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text) exists'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)', 'EXECUTE'),
  'finalize_quote_upload_v1 is execute-only for service_role'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)'::regprocedure) = false,
  'finalize_quote_upload_v1 is SECURITY INVOKER, not SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- B. Valid seller photo finalization
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('finalize-seller-lead', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb,
       '[{"original_filename": "photo1.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'seller lead with one declared photo creates successfully'
);

select lives_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000001'::uuid,
       'image/jpeg', 1024, encode(digest('seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the seller photo slot with matching metadata succeeds'
);

select ok(
  (select
     lf.lead_id = qus.lead_id and lf.kind = qus.kind and lf.storage_path = qus.storage_path
     and lf.original_filename = qus.original_filename
     and lf.detected_mime_type = 'image/jpeg' and lf.byte_size = 1024
     and lf.upload_status = 'complete' and lf.uploaded_at is not null
   from public.lead_files lf
   join public.quote_upload_slots qus on qus.verified_file_id = lf.id
   join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'the inserted lead_files row uses the slot''s own lead_id/kind/storage_path/original_filename, not caller input'
);
select ok(
  (select qus.status = 'verified' and qus.completed_at is not null and qus.verified_file_id is not null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'the slot became verified with completed_at and verified_file_id set'
);

-- ---------------------------------------------------------------------------
-- C. Valid buyer image and PDF finalization
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000002'::uuid,
       encode(digest('finalize-buyer-lead', 'sha256'), 'hex'),
       '{
         "intent": "buy", "source": "materials", "material": "aluminium",
         "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local",
         "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay area", "buyerFulfilment": "delivery",
         "buyerContactPerson": "Fatima Buyer", "buyerPhone": "+971502345678", "buyerPreferredContact": "whatsapp"
       }'::jsonb,
       '[
         {"original_filename": "receipt.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 2048},
         {"original_filename": "invoice.pdf", "declared_mime_type": "application/pdf", "declared_byte_size": 4096}
       ]'::jsonb
     ) $$,
  'buyer lead with an image and a PDF declaration creates successfully'
);

select lives_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000002'::uuid,
       'image/jpeg', 2048, encode(digest('buyer-image-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the buyer image slot with matching metadata succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000002' and qus.slot_index = 1),
       'e0000000-0000-0000-0000-000000000002'::uuid,
       'application/pdf', 4096, encode(digest('buyer-pdf-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the buyer PDF slot with matching metadata succeeds'
);
select ok(
  (select count(*) from public.lead_files lf join public.leads l on l.id = lf.lead_id
    where l.idempotency_key = 'e0000000-0000-0000-0000-000000000002') = 2,
  'both buyer files (image and PDF) were recorded as separate lead_files rows'
);

-- ---------------------------------------------------------------------------
-- D. Matching replay creates no duplicate; changed replay metadata fails
-- ---------------------------------------------------------------------------

create temp table replay_before as
  select count(*) as n from public.lead_files;

select lives_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000001'::uuid,
       'image/jpeg', 1024, encode(digest('seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'replaying the already-finalized seller slot with identical metadata succeeds (idempotent replay)'
);
select ok(
  (select count(*) from public.lead_files) = (select n from replay_before),
  'the matching replay created no duplicate lead_files row'
);
select is(
  (select public.finalize_quote_upload_v1(
     (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
       where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
     'e0000000-0000-0000-0000-000000000001'::uuid,
     'image/jpeg', 1024, encode(digest('seller-photo-bytes', 'sha256'), 'hex')
   ) ->> 'lead_file_id'),
  (select verified_file_id::text from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'the replay result references the exact same lead_file_id as the original finalization'
);

select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000001'::uuid,
       'image/jpeg', 9999, encode(digest('seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'replaying the same slot with a changed byte_size fails'
);
select ok(
  (select count(*) from public.lead_files) = (select n from replay_before),
  'the changed-metadata replay attempt still created no duplicate/extra lead_files row'
);

-- ---------------------------------------------------------------------------
-- E. Wrong idempotency key fails without revealing whether another lead exists
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('finalize-wrong-key-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234599", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 500}]'::jsonb
     ) $$,
  'a second, unrelated seller lead for the wrong-idempotency-key test creates successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000003' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000001'::uuid,
       'image/jpeg', 500, encode(digest('wrong-key-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'finalizing a real slot with a different (but valid, existing) lead''s idempotency key fails'
);

-- ---------------------------------------------------------------------------
-- F. Expired and failed slots fail safely
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('e0000000-0000-0000-0000-000000000004', encode(digest('finalize-expired-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the expired-slot test inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, created_at, expires_at)
     select id, 0, 'seller_photo', 'old.jpg', 'image/jpeg', 1024, now() - interval '1 hour', now() - interval '45 minutes'
     from public.leads where idempotency_key = 'e0000000-0000-0000-0000-000000000004' $$,
  'a slot created already past its expiry window inserts successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000004' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000004'::uuid,
       'image/jpeg', 1024, encode(digest('expired-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'finalizing an expired pending slot fails'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('e0000000-0000-0000-0000-000000000005', encode(digest('finalize-failed-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the failed-slot test inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'seller_photo', 'bad.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'e0000000-0000-0000-0000-000000000005' $$,
  'a pending slot for the failed-slot test inserts successfully'
);
select lives_ok(
  $$ update public.quote_upload_slots set status = 'failed', completed_at = now()
     where lead_id = (select id from public.leads where idempotency_key = 'e0000000-0000-0000-0000-000000000005')
       and slot_index = 0 $$,
  'marking that slot failed succeeds'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000005' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000005'::uuid,
       'image/jpeg', 1024, encode(digest('failed-slot-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'finalizing an already-failed slot fails'
);

-- ---------------------------------------------------------------------------
-- G. MIME mismatch, byte-size mismatch, malformed checksum, unsupported MIME
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000006'::uuid,
       encode(digest('finalize-mime-mismatch-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234598", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the MIME-mismatch test creates successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000006'::uuid,
       'image/png', 1024, encode(digest('mime-mismatch-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'a detected_mime_type that does not match the slot''s declared type fails'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000007'::uuid,
       encode(digest('finalize-size-mismatch-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234597", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the byte-size-mismatch test creates successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000007'::uuid,
       'image/jpeg', 2048, encode(digest('size-mismatch-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'a byte_size that does not match the slot''s declared size fails'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000008'::uuid,
       encode(digest('finalize-bad-checksum-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234596", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the malformed-checksum test creates successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000008' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000008'::uuid,
       'image/jpeg', 1024, 'not-a-valid-sha256-checksum'
     ) $$,
  'P0001',
  NULL,
  'a malformed (non-64-hex) checksum fails'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-000000000009'::uuid,
       encode(digest('finalize-unsupported-mime-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234595", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the unsupported-detected-MIME test creates successfully'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-000000000009' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-000000000009'::uuid,
       'image/gif', 1024, encode(digest('unsupported-mime-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'a detected_mime_type outside the four supported types fails'
);

-- ---------------------------------------------------------------------------
-- H. Any insert/update failure rolls the entire finalization back
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'e0000000-0000-0000-0000-00000000000a'::uuid,
       encode(digest('finalize-rollback-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Someone", "sellerPhone": "+971501234594", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the atomic-rollback test creates successfully'
);

-- Simulates an orphaned/pre-existing object at this slot's exact
-- storage_path (never produced by this function itself — it always writes
-- a fresh, never-before-used path — but proves that if the INSERT does
-- fail for any reason, including a table-level constraint this RPC's own
-- validation didn't already rule out, the whole call fails atomically and
-- the slot is left completely untouched, not partially updated.
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size, checksum_sha256, upload_status, uploaded_at)
     select qus.lead_id, qus.kind, qus.storage_path, 'colliding.jpg', 'image/jpeg', 1, encode(digest('colliding', 'sha256'), 'hex'), 'complete', now()
     from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
     where l.idempotency_key = 'e0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0 $$,
  'a pre-existing lead_files row occupying the slot''s exact storage_path inserts successfully (test setup only)'
);

create temp table rollback_before as
  select
    (select count(*) from public.lead_files) as files_n,
    (select qus.status from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
      where l.idempotency_key = 'e0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0) as slot_status;

select throws_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'e0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
       'e0000000-0000-0000-0000-00000000000a'::uuid,
       'image/jpeg', 1024, encode(digest('rollback-bytes', 'sha256'), 'hex')
     ) $$,
  '23505',
  NULL,
  'a storage_path collision at the INSERT itself (a genuine table-constraint failure) fails the whole call'
);
select ok(
  (select count(*) from public.lead_files) = (select files_n from rollback_before),
  'no additional lead_files row was left behind by the failed finalization attempt'
);
select is(
  (select qus.status from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'e0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
  (select slot_status from rollback_before),
  'the slot''s status is completely unchanged (still pending) after the failed finalization — no partial update'
);

select * from finish();

rollback;
