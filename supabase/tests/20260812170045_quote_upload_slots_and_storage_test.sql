-- Permanent pgTAP regression suite for
-- supabase/migrations/20260812170045_quote_upload_slots_and_storage.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like the foundation suite it extends) never leaves
-- persistent data behind — including the storage.buckets row it inspects
-- but never mutates.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(71);

-- ---------------------------------------------------------------------------
-- A. Structural existence
-- ---------------------------------------------------------------------------

select has_table('public', 'quote_upload_slots', 'table public.quote_upload_slots exists');
select has_function(
  'public', 'quote_upload_slots_kind_matches_lead_intent',
  'function public.quote_upload_slots_kind_matches_lead_intent exists'
);
select has_function(
  'public', 'quote_upload_slots_assign_storage_path',
  'function public.quote_upload_slots_assign_storage_path exists'
);
select has_function(
  'public', 'quote_upload_slots_prevent_immutable_field_changes',
  'function public.quote_upload_slots_prevent_immutable_field_changes exists'
);
select has_function(
  'public', 'quote_upload_slots_verified_file_matches_slot',
  'function public.quote_upload_slots_verified_file_matches_slot exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_kind_matches_lead_intent',
  'trigger quote_upload_slots_kind_matches_lead_intent exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_assign_storage_path',
  'trigger quote_upload_slots_assign_storage_path exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_immutable_core',
  'trigger quote_upload_slots_immutable_core exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_verified_file_matches_slot',
  'trigger quote_upload_slots_verified_file_matches_slot exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_set_updated_at',
  'trigger quote_upload_slots_set_updated_at exists'
);

-- ---------------------------------------------------------------------------
-- B. Bucket is private with exact size/MIME restrictions
-- ---------------------------------------------------------------------------

select ok(
  exists(select 1 from storage.buckets where id = 'lead-files'),
  'storage bucket lead-files exists'
);
select ok(
  (select public from storage.buckets where id = 'lead-files') = false,
  'storage bucket lead-files is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'lead-files'),
  8388608::bigint,
  'storage bucket lead-files file_size_limit is exactly 8 MiB'
);
select ok(
  (select allowed_mime_types from storage.buckets where id = 'lead-files')
    = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[],
  'storage bucket lead-files allowed_mime_types matches exactly'
);

-- ---------------------------------------------------------------------------
-- C. No anon/authenticated storage.objects policy was created
-- ---------------------------------------------------------------------------

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  ),
  'no policy of any kind exists on storage.objects — uploads go through service-role-minted signed URLs only'
);

-- ---------------------------------------------------------------------------
-- D. RLS/grants: default-deny for public/anon/authenticated, service_role minimal
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.quote_upload_slots'::regclass),
  'RLS is enabled and forced on public.quote_upload_slots'
);
select ok(
  not has_table_privilege('anon', 'public.quote_upload_slots', 'SELECT')
  and not has_table_privilege('anon', 'public.quote_upload_slots', 'INSERT')
  and not has_table_privilege('anon', 'public.quote_upload_slots', 'UPDATE')
  and not has_table_privilege('anon', 'public.quote_upload_slots', 'DELETE'),
  'anon has no privileges on public.quote_upload_slots'
);
select ok(
  not has_table_privilege('authenticated', 'public.quote_upload_slots', 'SELECT')
  and not has_table_privilege('authenticated', 'public.quote_upload_slots', 'INSERT')
  and not has_table_privilege('authenticated', 'public.quote_upload_slots', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.quote_upload_slots', 'DELETE'),
  'authenticated has no privileges on public.quote_upload_slots'
);
select ok(
  has_table_privilege('service_role', 'public.quote_upload_slots', 'SELECT')
  and has_table_privilege('service_role', 'public.quote_upload_slots', 'INSERT')
  and has_table_privilege('service_role', 'public.quote_upload_slots', 'UPDATE')
  and not has_table_privilege('service_role', 'public.quote_upload_slots', 'DELETE'),
  'service_role has exactly select/insert/update on public.quote_upload_slots (no delete)'
);
select ok(
  not has_function_privilege('anon', 'public.quote_upload_slots_kind_matches_lead_intent()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quote_upload_slots_kind_matches_lead_intent()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.quote_upload_slots_kind_matches_lead_intent()', 'EXECUTE'),
  'quote_upload_slots_kind_matches_lead_intent is execute-only for service_role'
);
select ok(
  not has_function_privilege('anon', 'public.quote_upload_slots_prevent_immutable_field_changes()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quote_upload_slots_prevent_immutable_field_changes()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.quote_upload_slots_prevent_immutable_field_changes()', 'EXECUTE'),
  'quote_upload_slots_prevent_immutable_field_changes is execute-only for service_role'
);
select ok(
  not has_function_privilege('anon', 'public.quote_upload_slots_verified_file_matches_slot()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quote_upload_slots_verified_file_matches_slot()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.quote_upload_slots_verified_file_matches_slot()', 'EXECUTE'),
  'quote_upload_slots_verified_file_matches_slot is execute-only for service_role'
);

-- ---------------------------------------------------------------------------
-- E. Valid seller and buyer slots succeed
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c0000000-0000-0000-0000-000000000001', encode(digest('slot-seller-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base sell-intent lead for slot tests inserts successfully'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c0000000-0000-0000-0000-000000000002', encode(digest('slot-buyer-lead', 'sha256'), 'hex'), 'buy', 'phone', 'aluminium', '{}'::jsonb) $$,
  'base buy-intent lead for slot tests inserts successfully'
);

select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'seller_photo', 'photo1.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  'valid seller_photo slot on a sell-intent lead succeeds'
);
select is(
  (select kind from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001'),
  'seller_photo',
  'seller slot kind persisted correctly'
);

select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'buyer_document', 'invoice.pdf', 'application/pdf', 2048
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000002' $$,
  'valid buyer_document PDF slot on a buy-intent lead succeeds'
);
select is(
  (select declared_mime_type from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'c0000000-0000-0000-0000-000000000002'),
  'application/pdf',
  'buyer slot declared_mime_type persisted correctly'
);

-- ---------------------------------------------------------------------------
-- F. Wrong lead/kind combination fails
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 1, 'buyer_document', 'wrong.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  'P0001',
  NULL,
  'buyer_document slot on a sell-intent lead is rejected by quote_upload_slots_kind_matches_lead_intent'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 1, 'seller_photo', 'wrong.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000002' $$,
  'P0001',
  NULL,
  'seller_photo slot on a buy-intent lead is rejected by quote_upload_slots_kind_matches_lead_intent'
);

-- ---------------------------------------------------------------------------
-- G. PDF seller upload fails
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 2, 'seller_photo', 'scan.pdf', 'application/pdf', 2048
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a seller_photo slot declaring application/pdf violates quote_upload_slots_pdf_requires_buyer_document'
);

-- ---------------------------------------------------------------------------
-- H. Invalid MIME, zero/oversized byte count and out-of-range slot index fail
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 3, 'seller_photo', 'photo.gif', 'image/gif', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a declared_mime_type outside the bucket allowlist is rejected'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 3, 'seller_photo', 'photo.jpg', 'image/jpeg', 0
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a zero declared_byte_size is rejected'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 3, 'seller_photo', 'photo.jpg', 'image/jpeg', 8388609
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a declared_byte_size over 8 MiB is rejected'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 5, 'seller_photo', 'photo.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'slot_index 5 (a sixth slot) is rejected — only 0..4 are valid'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, -1, 'seller_photo', 'photo.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a negative slot_index is rejected'
);

-- ---------------------------------------------------------------------------
-- I. Filename traversal / control characters fail
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 3, 'seller_photo', '../../etc/passwd', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'a path-traversal-shaped original_filename (containing /) is rejected'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 3, 'seller_photo', chr(9) || 'photo.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'an original_filename containing a control character is rejected'
);

-- ---------------------------------------------------------------------------
-- J. A supplied malicious storage_path cannot survive
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, storage_path)
     select id, 3, 'seller_photo', 'photo.jpg', 'image/jpeg', 1024, '../../../etc/passwd'
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  'inserting an explicit malicious storage_path still succeeds (the trigger silently overwrites it)'
);
select ok(
  (select storage_path from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001' and qus.slot_index = 3)
    <> '../../../etc/passwd',
  'the client-supplied storage_path did not survive — it was overwritten by quote_upload_slots_assign_storage_path'
);

-- ---------------------------------------------------------------------------
-- K. Generated paths are unique and tied to lead + slot
-- ---------------------------------------------------------------------------

select ok(
  (select storage_path from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001' and qus.slot_index = 0)
    = (select 'leads/' || l.id::text || '/slot-0-' || qus.id::text
       from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
       where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001' and qus.slot_index = 0),
  'generated storage_path is derived exactly from lead_id + slot_index + slot id'
);
select ok(
  (select storage_path from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001' and qus.slot_index = 0)
    <> (select storage_path from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
        where l.idempotency_key = 'c0000000-0000-0000-0000-000000000001' and qus.slot_index = 3),
  'two distinct slots on the same lead generate distinct storage_path values'
);

-- ---------------------------------------------------------------------------
-- L. Duplicate slot index fails
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'seller_photo', 'duplicate.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23505',
  NULL,
  'a second slot reusing an already-taken slot_index for the same lead fails unique_violation'
);

-- ---------------------------------------------------------------------------
-- M. Authorization/identity fields are immutable after insert
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.quote_upload_slots set lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000002')
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing lead_id after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set slot_index = 4
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing slot_index after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set kind = 'buyer_document'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing kind after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set declared_mime_type = 'image/png'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing declared_mime_type after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set declared_byte_size = 4096
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing declared_byte_size after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set original_filename = 'renamed.jpg'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing original_filename after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set expires_at = expires_at + interval '5 minutes'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing expires_at after insert is rejected by quote_upload_slots_immutable_core'
);
select throws_ok(
  $$ update public.quote_upload_slots set storage_path = 'leads/tampered/path'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001') and slot_index = 0 $$,
  'P0001',
  NULL,
  'changing storage_path after insert is rejected by quote_upload_slots_immutable_core'
);

-- ---------------------------------------------------------------------------
-- N. Expiry window enforcement
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, created_at, expires_at)
     select id, 4, 'seller_photo', 'photo.jpg', 'image/jpeg', 1024, now(), now() - interval '1 minute'
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514',
  NULL,
  'expires_at at or before created_at fails quote_upload_slots_expires_at_within_window'
);
select throws_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, created_at, expires_at)
     select id, 1, 'buyer_document', 'invoice2.pdf', 'application/pdf', 2048, now(), now() + interval '31 minutes'
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000002' $$,
  '23514',
  NULL,
  'expires_at more than 30 minutes after created_at fails quote_upload_slots_expires_at_within_window'
);

-- ---------------------------------------------------------------------------
-- O. Verified-file ownership consistency + lifecycle transitions
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c0000000-0000-0000-0000-000000000003', encode(digest('slot-verify-lead', 'sha256'), 'hex'), 'buy', 'phone', 'lead', '{}'::jsonb) $$,
  'base buy-intent lead for verification-transition tests inserts successfully'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('c0000000-0000-0000-0000-000000000004', encode(digest('slot-verify-other-lead', 'sha256'), 'hex'), 'buy', 'phone', 'lead', '{}'::jsonb) $$,
  'a second, unrelated buy-intent lead for the cross-lead verified_file test inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'buyer_document', 'doc-a.pdf', 'application/pdf', 2048
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003' $$,
  'verification-test slot A inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 1, 'buyer_document', 'doc-b.pdf', 'application/pdf', 2048
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003' $$,
  'verification-test slot B inserts successfully'
);

select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now()
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  '23514',
  NULL,
  'setting status=verified without verified_file_id fails quote_upload_slots_verified_file_requires_verified'
);
select throws_ok(
  $$ update public.quote_upload_slots set status = 'failed'
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 1 $$,
  '23514',
  NULL,
  'setting status=failed without completed_at fails quote_upload_slots_completed_at_matches_status'
);
select throws_ok(
  $$ update public.quote_upload_slots set completed_at = now()
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 1 $$,
  '23514',
  NULL,
  'setting completed_at while status stays pending fails quote_upload_slots_completed_at_matches_status'
);

-- lead_files rows for the ownership-consistency tests below. The matching
-- row is deliberately built FROM slot A's own generated lead_id/kind/
-- storage_path (never hand-typed), so it is exactly what a real
-- verification write — one that re-checked the actual uploaded object at
-- that exact path — would look like.
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     select lead_id, kind, storage_path, 'doc-a.pdf', 'application/pdf', 2048
     from public.quote_upload_slots
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'the exactly-matching lead_files row for slot A inserts successfully'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     select id, 'buyer_document', 'leads/unrelated/other-lead-file.pdf', 'other-lead-file.pdf', 'application/pdf', 2048
     from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000004' $$,
  'a lead_files row belonging to a different, unrelated lead inserts successfully'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     select lead_id, 'seller_photo', 'leads/verify/wrong-kind.jpg', 'wrong-kind.jpg', 'image/jpeg', 1024
     from public.quote_upload_slots
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'a lead_files row on the same lead but with a mismatched kind inserts successfully'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     select lead_id, kind, 'leads/verify/wrong-path.pdf', 'wrong-path.pdf', 'application/pdf', 2048
     from public.quote_upload_slots
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'a lead_files row on the same lead/kind but with a mismatched storage_path inserts successfully'
);

select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(),
       verified_file_id = (
         select lf.id from public.lead_files lf
         join public.leads l on l.id = lf.lead_id
         where l.idempotency_key = 'c0000000-0000-0000-0000-000000000004'
       )
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'P0001',
  NULL,
  'a verified_file_id belonging to a different lead is rejected by quote_upload_slots_verified_file_matches_slot'
);
select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(),
       verified_file_id = (select id from public.lead_files where storage_path = 'leads/verify/wrong-kind.jpg')
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'P0001',
  NULL,
  'a verified_file_id with a mismatched kind is rejected by quote_upload_slots_verified_file_matches_slot'
);
select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(),
       verified_file_id = (select id from public.lead_files where storage_path = 'leads/verify/wrong-path.pdf')
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'P0001',
  NULL,
  'a verified_file_id with a mismatched storage_path is rejected by quote_upload_slots_verified_file_matches_slot'
);

select lives_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(),
       verified_file_id = (
         select lf.id from public.lead_files lf
         join public.quote_upload_slots qus
           on qus.lead_id = lf.lead_id and qus.kind = lf.kind and qus.storage_path = lf.storage_path
         where qus.lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
           and qus.slot_index = 0
       )
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 0 $$,
  'a fully matching verified_file_id (same lead, kind and storage_path) succeeds — the valid lifecycle transition'
);
-- Not a 23505 unique_violation in practice: since both quote_upload_slots.
-- storage_path and lead_files.storage_path are independently UNIQUE, a
-- given file's path can only ever equal one slot's path — so
-- quote_upload_slots_verified_file_matches_slot already rejects this on an
-- ownership mismatch (slot B's storage_path differs from slot A's file)
-- before the unique(verified_file_id) constraint would even be reached.
-- The constraint stays in the schema as defense-in-depth; this proves the
-- practical rejection path a second slot actually hits.
select throws_ok(
  $$ update public.quote_upload_slots set status = 'verified', completed_at = now(),
       verified_file_id = (
         select lf.id from public.lead_files lf
         join public.quote_upload_slots qus
           on qus.lead_id = lf.lead_id and qus.kind = lf.kind and qus.storage_path = lf.storage_path
         where qus.lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
           and qus.slot_index = 0
       )
     where lead_id = (select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000003')
       and slot_index = 1 $$,
  'P0001',
  NULL,
  'a second slot cannot claim slot A''s verified_file_id — its storage_path only matches slot A, so quote_upload_slots_verified_file_matches_slot rejects it'
);

-- ---------------------------------------------------------------------------
-- P. Cascade behavior is correct
-- ---------------------------------------------------------------------------

-- Captured before the delete below — once the lead is gone, its id can no
-- longer be looked up by idempotency_key, so the post-delete assertion needs
-- this stashed separately rather than re-querying public.leads.
create temp table cascade_test_lead as
  select id from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ delete from public.leads where idempotency_key = 'c0000000-0000-0000-0000-000000000001' $$,
  'deleting the sell-intent lead with quote_upload_slots rows succeeds'
);
select ok(
  not exists (
    select 1 from public.quote_upload_slots qus
    where qus.lead_id = (select id from cascade_test_lead)
  ),
  'deleting the parent lead cascades to its quote_upload_slots rows'
);

select * from finish();

rollback;
