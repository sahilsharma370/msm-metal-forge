-- Permanent pgTAP regression suite for
-- supabase/migrations/20260812191235_quote_upload_claim_lifecycle.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like the four suites it extends) never leaves
-- persistent data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- A. Structural existence, security, and the v1 -> v2 permission cutover
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'claim_quote_upload_v1', array['uuid', 'uuid'],
  'function public.claim_quote_upload_v1(uuid, uuid) exists'
);
select has_function(
  'public', 'finalize_quote_upload_v2', array['uuid', 'uuid', 'uuid', 'text', 'bigint', 'text'],
  'function public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text) exists'
);
select has_function(
  'public', 'release_quote_upload_claim_v1', array['uuid', 'uuid', 'uuid', 'text'],
  'function public.release_quote_upload_claim_v1(uuid, uuid, uuid, text) exists'
);

select ok(
  not has_function_privilege('anon', 'public.claim_quote_upload_v1(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_quote_upload_v1(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_quote_upload_v1(uuid, uuid)', 'EXECUTE'),
  'claim_quote_upload_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text)', 'EXECUTE'),
  'finalize_quote_upload_v2 is execute-only for service_role'
);
select ok(
  not has_function_privilege('anon', 'public.release_quote_upload_claim_v1(uuid, uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_quote_upload_claim_v1(uuid, uuid, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.release_quote_upload_claim_v1(uuid, uuid, uuid, text)', 'EXECUTE'),
  'release_quote_upload_claim_v1 is execute-only for service_role'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.claim_quote_upload_v1(uuid, uuid)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.release_quote_upload_claim_v1(uuid, uuid, uuid, text)'::regprocedure) = false,
  'all three new functions are SECURITY INVOKER, not SECURITY DEFINER'
);

-- v1 -> v2 cutover: v1 is now inaccessible to service_role, and v2 is the
-- only finalization RPC service_role may execute.
select ok(
  not has_function_privilege('service_role', 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)', 'EXECUTE'),
  'finalize_quote_upload_v1 EXECUTE is revoked from service_role after C2B1'
);
select ok(
  not has_function_privilege('service_role', 'public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text)', 'EXECUTE'),
  'finalize_quote_upload_v2 is the only finalization RPC service_role may execute'
);

-- Proves the distinction the migration's own comment documents: v1's
-- existing regression suite keeps passing not because service_role can
-- still reach it, but because pgTAP itself runs as the function's OWNER
-- (whichever role applies migrations), and PostgreSQL object ownership
-- always implies EXECUTE independent of any REVOKE. This block
-- demonstrates both halves side by side, in this suite too.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000e'::uuid,
       encode(digest('c2b1-v1-owner-proof-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Owner Proof", "sellerPhone": "+971501111111", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the v1-owner-proof test creates successfully'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000e' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000e'::uuid,
       'image/jpeg', 1024, encode(digest('v1-owner-proof-bytes', 'sha256'), 'hex')
     ) $$,
  'a direct v1 call still succeeds when run as the function owner (this test), even though service_role cannot execute it at all'
);

-- ---------------------------------------------------------------------------
-- B. The schema itself, not application discipline, forbids uploading/
--    verified status without upload_attempt_id/upload_started_at/
--    upload_object_path
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000b'::uuid,
       encode(digest('c2b1-constraint-proof-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Constraint Proof", "sellerPhone": "+971502222222", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the direct constraint-proof test creates successfully'
);
-- Proves quote_upload_slots_attempt_matches_status directly: this UPDATE
-- never touches verified_file_id, so quote_upload_slots_verified_file_matches_slot
-- (which would otherwise fire first and mask which constraint actually
-- rejects the row) never runs — the CHECK constraint is the sole and
-- unambiguous cause of the failure below.
select throws_ok(
  $$ update public.quote_upload_slots set status = 'uploading'
     where lead_id = (select id from public.leads where idempotency_key = 'f0000000-0000-0000-0000-00000000000b')
       and slot_index = 0 $$,
  '23514',
  NULL,
  'directly setting status=uploading without upload_attempt_id/upload_started_at/upload_object_path fails quote_upload_slots_attempt_matches_status — the constraint enforces this, not application code'
);

-- Separately proves verified specifically cannot be reached without a
-- correct upload_object_path — attempted via a real (claimed) slot and a
-- genuinely matching lead_files row, but with upload_object_path itself
-- left null in the UPDATE. quote_upload_slots_verified_file_matches_slot
-- (an even earlier guard than the CHECK constraint once verified_file_id
-- is involved) catches this first, which is a strictly stronger
-- guarantee, not a weaker one: verified-without-a-correct-object-path is
-- unreachable either way.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000f'::uuid,
       encode(digest('c2b1-verified-object-path-proof-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Verified Path Proof", "sellerPhone": "+971502222299", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the verified-without-object-path test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000f' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000f'::uuid
     ) $$,
  'claiming the verified-without-object-path test slot succeeds'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size, checksum_sha256, upload_status, uploaded_at)
     select qus.lead_id, qus.kind, qus.upload_object_path, qus.original_filename, qus.declared_mime_type, qus.declared_byte_size, encode(digest('verified-object-path-proof', 'sha256'), 'hex'), 'complete', now()
     from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
     where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000f' and qus.slot_index = 0 $$,
  'a genuinely matching lead_files row (at the claim''s own upload_object_path) inserts successfully'
);
select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(), upload_object_path = null,
       verified_file_id = (select id from public.lead_files where checksum_sha256 = encode(digest('verified-object-path-proof', 'sha256'), 'hex'))
     where lead_id = (select id from public.leads where idempotency_key = 'f0000000-0000-0000-0000-00000000000f')
       and slot_index = 0 $$,
  'P0001',
  NULL,
  'directly setting status=verified while nulling upload_object_path fails — quote_upload_slots_verified_file_matches_slot rejects the now-mismatched reference before quote_upload_slots_attempt_matches_status is even reached, so verified without upload_object_path is unreachable either way'
);

-- ---------------------------------------------------------------------------
-- C. Valid claim: pending -> uploading, with a server-generated attempt id
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('c2b1-claim-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Claim Test", "sellerPhone": "+971503333333", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the valid-claim test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  'claiming a pending slot succeeds'
);
-- claim_quote_upload_v1's own signature (p_slot_id, p_idempotency_key) has
-- no parameter through which a caller could supply an attempt id or an
-- object path — the persisted, non-null, correctly-typed values checked
-- here are necessarily server-generated by construction, not merely by
-- convention. This also directly proves "caller cannot choose/override
-- the path": there is no path input to override with.
select ok(
  (select qus.status = 'uploading' and qus.upload_attempt_id is not null and qus.upload_started_at is not null
     and qus.upload_object_path is not null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'the slot transitioned to uploading with a server-generated attempt id, start time and object path'
);
select ok(
  (select qus.upload_object_path = 'quote-uploads/' || qus.lead_id::text || '/' || qus.id::text || '/' || qus.upload_attempt_id::text
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'the persisted upload_object_path is derived exactly from lead id, slot id and attempt id — the fresh claim returns (and stores) this unique object path'
);
select ok(
  (select qus.upload_object_path <> qus.storage_path
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'upload_object_path is a distinct, attempt-scoped path — never equal to the stable base-namespace storage_path'
);

-- ---------------------------------------------------------------------------
-- D. Active claim rejects a second claimant
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000001'::uuid
     ) $$,
  'P0001',
  NULL,
  'claiming an already-uploading slot with a fresh (< 5 minute) lease fails UPLOAD_IN_PROGRESS'
);

-- ---------------------------------------------------------------------------
-- E. A stale (>= 5 minute) claim can be reclaimed; the superseded attempt
--    can no longer finalize or release
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000002'::uuid,
       encode(digest('c2b1-reclaim-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Reclaim Test", "sellerPhone": "+971504444444", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the reclaim test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000002'::uuid
     ) $$,
  'the first claim on the reclaim-test slot succeeds'
);

create temp table reclaim_old_attempt as
  select qus.upload_attempt_id as attempt_id, qus.upload_object_path as object_path
  from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
  where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0;

-- Simulates a lease going stale (a crashed/abandoned request) — this
-- backdating is test setup only, performed as the function owner; no
-- application code has any path that ever moves upload_started_at
-- backwards.
select lives_ok(
  $$ update public.quote_upload_slots set upload_started_at = now() - interval '6 minutes'
     where lead_id = (select id from public.leads where idempotency_key = 'f0000000-0000-0000-0000-000000000002')
       and slot_index = 0 $$,
  'backdating the lease past 5 minutes (test setup) succeeds'
);

create temp table reclaim_result as
  select public.claim_quote_upload_v1(
    (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
      where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
    'f0000000-0000-0000-0000-000000000002'::uuid
  ) as result;

select ok(
  (select result ->> 'reclaimed' from reclaim_result) = 'true',
  'reclaiming a stale-leased slot succeeds and reports reclaimed=true'
);
select is(
  (select result ->> 'stale_object_path' from reclaim_result),
  (select object_path from reclaim_old_attempt),
  'the reclaim response reports the superseded attempt''s own object path as stale_object_path, for a later cleanup job'
);
select isnt(
  (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
  (select attempt_id from reclaim_old_attempt),
  'reclaiming rotates the slot to a brand-new attempt id, different from the superseded one'
);
select isnt(
  (select qus.upload_object_path from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
  (select object_path from reclaim_old_attempt),
  'reclaiming rotates the slot to a brand-new object path — the stale and current attempts never target the same Storage object'
);

select throws_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000002'::uuid,
       (select attempt_id from reclaim_old_attempt),
       'image/jpeg', 1024, encode(digest('old-attempt-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'the superseded (pre-reclaim) attempt id can no longer finalize this slot'
);
select throws_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000002' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000002'::uuid,
       (select attempt_id from reclaim_old_attempt),
       'retry'
     ) $$,
  'P0001',
  NULL,
  'the superseded (pre-reclaim) attempt id can no longer release this slot'
);

-- ---------------------------------------------------------------------------
-- F. Wrong idempotency key is indistinguishable from a missing slot
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('c2b1-wrong-key-target-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Target", "sellerPhone": "+971505555555", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'the target lead for the wrong-idempotency-key test creates successfully'
);
select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000004'::uuid,
       encode(digest('c2b1-wrong-key-attacker-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Attacker", "sellerPhone": "+971506666666", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'a second, unrelated lead (the wrong idempotency key''s real owner) creates successfully'
);
select throws_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000003' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000004'::uuid
     ) $$,
  'P0001',
  NULL,
  'claiming a real slot with a different (valid, existing) lead''s idempotency key fails'
);
select throws_ok(
  $$ select public.claim_quote_upload_v1(
       '00000000-0000-0000-0000-000000000000'::uuid,
       'f0000000-0000-0000-0000-000000000004'::uuid
     ) $$,
  'P0001',
  NULL,
  'claiming a genuinely nonexistent slot id fails identically (both are indistinguishable "not found")'
);

-- ---------------------------------------------------------------------------
-- G. An expired slot cannot be claimed
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('f0000000-0000-0000-0000-000000000005', encode(digest('c2b1-expired-claim-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the expired-slot claim test inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, created_at, expires_at)
     select id, 0, 'seller_photo', 'old.jpg', 'image/jpeg', 1024, now() - interval '1 hour', now() - interval '45 minutes'
     from public.leads where idempotency_key = 'f0000000-0000-0000-0000-000000000005' $$,
  'a slot created already past its expiry window inserts successfully'
);
select throws_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000005' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000005'::uuid
     ) $$,
  'P0001',
  NULL,
  'claiming an already-expired pending slot fails'
);

-- ---------------------------------------------------------------------------
-- H/I. V2 valid seller photo and buyer document finalization
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000006'::uuid,
       encode(digest('c2b1-v2-seller-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "V2 Seller", "sellerPhone": "+971507777777", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the V2 valid seller photo test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000006'::uuid
     ) $$,
  'claiming the V2 seller photo slot succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000006'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('v2-seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the claimed V2 seller photo slot with the correct attempt id succeeds'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000007'::uuid,
       encode(digest('c2b1-v2-buyer-lead', 'sha256'), 'hex'),
       '{"intent": "buy", "source": "materials", "material": "aluminium", "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local", "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay area", "buyerFulfilment": "delivery", "buyerContactPerson": "V2 Buyer", "buyerPhone": "+971508888888", "buyerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "invoice.pdf", "declared_mime_type": "application/pdf", "declared_byte_size": 4096}]'::jsonb
     ) $$,
  'lead for the V2 valid buyer document test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000007'::uuid
     ) $$,
  'claiming the V2 buyer document slot succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000007'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
       'application/pdf', 4096, encode(digest('v2-buyer-pdf-bytes', 'sha256'), 'hex')
     ) $$,
  'finalizing the claimed V2 buyer document slot with the correct attempt id succeeds'
);

-- ---------------------------------------------------------------------------
-- J. V2 retains attempt metadata after verification
-- ---------------------------------------------------------------------------

select ok(
  (select qus.upload_attempt_id is not null and qus.upload_started_at is not null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
  'the V2-verified seller slot retains its upload_attempt_id and upload_started_at'
);
select ok(
  (select qus.upload_attempt_id is not null and qus.upload_started_at is not null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
  'the V2-verified buyer slot retains its upload_attempt_id and upload_started_at'
);

select is(
  (select lf.storage_path
   from public.lead_files lf
   join public.quote_upload_slots qus on qus.verified_file_id = lf.id
   join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
  (select qus.upload_object_path
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
  'V2 wrote lead_files.storage_path equal to the seller slot''s current upload_object_path, not the stable storage_path'
);
select is(
  (select lf.storage_path
   from public.lead_files lf
   join public.quote_upload_slots qus on qus.verified_file_id = lf.id
   join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
  (select qus.upload_object_path
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000007' and qus.slot_index = 0),
  'V2 wrote lead_files.storage_path equal to the buyer slot''s current upload_object_path, not the stable storage_path'
);

-- ---------------------------------------------------------------------------
-- K/L. Exact replay is idempotent; changed replay metadata fails
-- ---------------------------------------------------------------------------

create temp table v2_replay_before as
  select count(*) as n from public.lead_files;

select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000006'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('v2-seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'replaying V2 finalization with identical metadata and attempt id succeeds'
);
select ok(
  (select count(*) from public.lead_files) = (select n from v2_replay_before),
  'the matching V2 replay created no duplicate lead_files row'
);
select throws_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000006'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'image/jpeg', 9999, encode(digest('v2-seller-photo-bytes', 'sha256'), 'hex')
     ) $$,
  'P0001',
  NULL,
  'replaying V2 finalization with changed byte_size fails'
);
select ok(
  (select count(*) from public.lead_files) = (select n from v2_replay_before),
  'the changed-metadata V2 replay attempt still created no duplicate/extra lead_files row'
);

-- ---------------------------------------------------------------------------
-- M/N. release_quote_upload_claim_v1 retry: back to pending, or to expired
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-000000000008'::uuid,
       encode(digest('c2b1-release-retry-pending-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Release Retry", "sellerPhone": "+971509999999", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the release-retry-to-pending test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000008' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000008'::uuid
     ) $$,
  'claiming the release-retry-to-pending slot succeeds'
);
select lives_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000008' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000008'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000008' and qus.slot_index = 0),
       'retry'
     ) $$,
  'releasing with outcome=retry on a still-valid slot succeeds'
);
select ok(
  (select qus.status = 'pending' and qus.upload_attempt_id is null and qus.upload_started_at is null
     and qus.upload_object_path is null and qus.completed_at is null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000008' and qus.slot_index = 0),
  'the slot returned fully to pending, with attempt id, start time and object path all cleared'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('f0000000-0000-0000-0000-000000000009', encode(digest('c2b1-release-retry-expired-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the release-retry-to-expired test inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, status, created_at, expires_at, upload_attempt_id, upload_started_at, upload_object_path)
     select id, 0, 'seller_photo', 'old.jpg', 'image/jpeg', 1024, 'uploading', now() - interval '20 minutes', now() - interval '5 minutes', gen_random_uuid(), now() - interval '19 minutes',
       'quote-uploads/test-setup/' || id::text || '/expired-retry'
     from public.leads where idempotency_key = 'f0000000-0000-0000-0000-000000000009' $$,
  'an already-elapsed uploading slot (test setup) inserts successfully'
);
select lives_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000009' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000009'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000009' and qus.slot_index = 0),
       'retry'
     ) $$,
  'releasing with outcome=retry on a slot whose window has already elapsed succeeds'
);
select ok(
  (select qus.status = 'expired' and qus.completed_at is not null
     and qus.upload_attempt_id is not null and qus.upload_object_path is not null
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-000000000009' and qus.slot_index = 0),
  'the elapsed slot transitioned to expired (not pending), retaining its attempt metadata and object path'
);

-- ---------------------------------------------------------------------------
-- O. cleanup_required records a failed state, retaining attempt metadata
--    and storage_path
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000a'::uuid,
       encode(digest('c2b1-cleanup-required-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Cleanup Required", "sellerPhone": "+971501010101", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the cleanup_required test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000a'::uuid
     ) $$,
  'claiming the cleanup_required slot succeeds'
);

create temp table cleanup_required_before as
  select qus.upload_attempt_id as attempt_id, qus.storage_path as storage_path, qus.upload_object_path as object_path
  from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
  where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0;

select lives_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000a'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
       'cleanup_required'
     ) $$,
  'releasing with outcome=cleanup_required succeeds'
);
select ok(
  (select qus.status = 'failed' and qus.completed_at is not null
     and qus.upload_attempt_id = (select attempt_id from cleanup_required_before)
     and qus.storage_path = (select storage_path from cleanup_required_before)
     and qus.upload_object_path = (select object_path from cleanup_required_before)
   from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
   where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000a' and qus.slot_index = 0),
  'the slot is marked failed, retaining its attempt id, storage_path and upload_object_path for a later cleanup job to locate'
);

-- ---------------------------------------------------------------------------
-- P/Q. A verified slot can never be released; a wrong attempt cannot release
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-000000000006'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-000000000006' and qus.slot_index = 0),
       'retry'
     ) $$,
  'P0001',
  NULL,
  'attempting to release an already-verified slot fails — verified is never downgraded'
);

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000c'::uuid,
       encode(digest('c2b1-wrong-attempt-release-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Wrong Attempt", "sellerPhone": "+971502020202", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the wrong-attempt-release test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000c' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000c'::uuid
     ) $$,
  'claiming the wrong-attempt-release slot succeeds'
);
select throws_ok(
  $$ select public.release_quote_upload_claim_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000c' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000c'::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid,
       'retry'
     ) $$,
  'P0001',
  NULL,
  'releasing with a wrong (non-matching) attempt id fails — it cannot release another attempt''s claim'
);

-- ---------------------------------------------------------------------------
-- R. Any insert/update failure during finalization rolls back the whole
--    call — no partial lead_files row or verified slot remains
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'f0000000-0000-0000-0000-00000000000d'::uuid,
       encode(digest('c2b1-rollback-lead', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Rollback Test", "sellerPhone": "+971503030303", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'lead for the V2 atomic-rollback test creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000d'::uuid
     ) $$,
  'claiming the V2 atomic-rollback slot succeeds'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size, checksum_sha256, upload_status, uploaded_at)
     select qus.lead_id, qus.kind, qus.upload_object_path, 'colliding.jpg', 'image/jpeg', 1, encode(digest('colliding', 'sha256'), 'hex'), 'complete', now()
     from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
     where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0 $$,
  'a pre-existing lead_files row occupying the claimed slot''s exact upload_object_path inserts successfully (test setup only) — this is what V2 will actually try to insert at'
);

create temp table v2_rollback_before as
  select
    (select count(*) from public.lead_files) as files_n,
    (select qus.status from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
      where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0) as slot_status;

select throws_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0),
       'f0000000-0000-0000-0000-00000000000d'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('rollback-bytes', 'sha256'), 'hex')
     ) $$,
  '23505',
  NULL,
  'a storage_path collision at the INSERT itself fails the whole V2 finalization call'
);
select ok(
  (select count(*) from public.lead_files) = (select files_n from v2_rollback_before),
  'no additional lead_files row was left behind by the failed V2 finalization attempt'
);
select is(
  (select qus.status from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'f0000000-0000-0000-0000-00000000000d' and qus.slot_index = 0),
  (select slot_status from v2_rollback_before),
  'the slot''s status is unchanged (still uploading) after the failed V2 finalization — no partial update'
);

select * from finish();

rollback;
