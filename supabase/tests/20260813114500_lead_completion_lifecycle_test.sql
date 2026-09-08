-- Permanent pgTAP regression suite for
-- supabase/migrations/20260813114500_lead_completion_lifecycle.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like the five suites it extends) never leaves
-- persistent data behind.
--
-- Concurrency note: two genuinely simultaneous finalize_quote_upload_v2
-- calls for two different "last" slots of the same lead cannot be exercised
-- from this single-connection pgTAP harness — that requires a separate,
-- real two-session test (see this checkpoint's own report). Every test
-- below proves single-threaded correctness of the aggregate/completion
-- logic; none of them are a substitute for that concurrency proof.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(78);

-- ---------------------------------------------------------------------------
-- A. Structural existence, security, and privileges
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'compute_lead_file_upload_status', array['uuid'],
  'function public.compute_lead_file_upload_status(uuid) exists'
);
select has_function(
  'public', 'complete_lead_if_ready', array['uuid'],
  'function public.complete_lead_if_ready(uuid) exists'
);
select has_function(
  'public', 'quote_upload_slots_sync_lead_status', array[]::text[],
  'function public.quote_upload_slots_sync_lead_status() exists'
);
select has_function(
  'public', 'complete_website_quote_v1', array['uuid', 'uuid'],
  'function public.complete_website_quote_v1(uuid, uuid) exists'
);
select has_trigger(
  'public', 'quote_upload_slots', 'quote_upload_slots_sync_lead_status',
  'trigger quote_upload_slots_sync_lead_status exists on quote_upload_slots'
);

select ok(
  not has_function_privilege('public', 'public.compute_lead_file_upload_status(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.compute_lead_file_upload_status(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.compute_lead_file_upload_status(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.compute_lead_file_upload_status(uuid)', 'EXECUTE'),
  'compute_lead_file_upload_status is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_lead_if_ready(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_lead_if_ready(uuid)', 'EXECUTE'),
  'complete_lead_if_ready is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.quote_upload_slots_sync_lead_status()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.quote_upload_slots_sync_lead_status()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.quote_upload_slots_sync_lead_status()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.quote_upload_slots_sync_lead_status()', 'EXECUTE'),
  'quote_upload_slots_sync_lead_status is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.complete_website_quote_v1(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_website_quote_v1(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_website_quote_v1(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_website_quote_v1(uuid, uuid)', 'EXECUTE'),
  'complete_website_quote_v1 is execute-only for service_role'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.compute_lead_file_upload_status(uuid)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.complete_lead_if_ready(uuid)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.complete_website_quote_v1(uuid, uuid)'::regprocedure) = false,
  'all three new callable functions are SECURITY INVOKER, not SECURITY DEFINER'
);
select ok(
  not has_function_privilege('public', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE'),
  'create_website_quote_v1 retains its exact prior privileges after CREATE OR REPLACE'
);

-- leads.submission_completed_at: nullable, and the one-way constraint
-- correctly rejects a resolved-completion-with-unresolved-status row while
-- accepting an unresolved lead sitting at file_upload_status='none'.
select throws_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot, file_upload_status, submission_completed_at)
     values ('a1000000-0000-0000-0000-000000000001', encode(digest('c2d-a-bad-completion', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, 'pending', now()) $$,
  '23514',
  NULL,
  'submission_completed_at cannot be set while file_upload_status is unresolved (pending)'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot, file_upload_status, submission_completed_at)
     values ('a1000000-0000-0000-0000-000000000002', encode(digest('c2d-a-null-completion-none-status', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, 'none', null) $$,
  'a lead may sit at file_upload_status=''none'' with submission_completed_at still null (the constraint is one-way only)'
);

-- ---------------------------------------------------------------------------
-- B. notification_deliveries.event_type identity and uniqueness
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000003', encode(digest('c2d-a-notification-lead', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base lead for the notification identity tests inserts successfully'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, channel)
     select id, 'email' from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003' $$,
  '23502',
  NULL,
  'inserting a notification_deliveries row without an explicit event_type fails (no DEFAULT survives this migration)'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'quotation_sent', 'email' from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003' $$,
  '23514',
  NULL,
  'an event_type outside the current allowed list is rejected'
);
select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'email', 'pending' from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003' $$,
  'the currently-allowed event_type (submission_completed) inserts successfully'
);
select throws_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'email', 'pending' from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003' $$,
  '23505',
  NULL,
  'a second (lead_id, event_type, channel) triple identical to an existing row is rejected'
);
select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel, status)
     select id, 'submission_completed', 'whatsapp', 'pending' from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000003' $$,
  'the same lead and event_type on a DIFFERENT channel is not blocked — the key is not overly broad'
);

-- ---------------------------------------------------------------------------
-- C. compute_lead_file_upload_status — the full aggregate truth table
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000010', encode(digest('c2d-a-truth-zero', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'truth-table lead (zero slots) inserts successfully'
);
select is(
  (select public.compute_lead_file_upload_status(id) from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000010'),
  'none',
  'zero declared slots -> none'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000011', encode(digest('c2d-a-truth-allpending', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'truth-table lead (all pending) inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size)
     select id, 0, 'seller_photo', 'a.jpg', 'image/jpeg', 1024 from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000011'
     union all
     select id, 1, 'seller_photo', 'b.jpg', 'image/jpeg', 1024 from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000011' $$,
  'two pending slots insert successfully'
);
select is(
  (select public.compute_lead_file_upload_status(id) from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000011'),
  'pending',
  'all slots pending -> pending'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000012', encode(digest('c2d-a-truth-uploading', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'truth-table lead (uploading) inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, status, upload_attempt_id, upload_started_at, upload_object_path)
     select id, 0, 'seller_photo', 'a.jpg', 'image/jpeg', 1024, 'uploading', gen_random_uuid(), now(), 'quote-uploads/test/' || id::text || '/uploading'
     from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000012' $$,
  'one uploading slot inserts successfully'
);
select is(
  (select public.compute_lead_file_upload_status(id) from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000012'),
  'pending',
  'an uploading (unresolved) slot -> pending, same aggregate bucket as pending'
);

-- verified + unresolved -> pending (unresolved wins), constructed directly
-- via the real claim/finalize RPCs for the verified half.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000013'::uuid,
       encode(digest('c2d-a-truth-verified-unresolved', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Truth Table", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}, {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'two-file lead for the verified+unresolved truth-table case creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000013'::uuid
     ) $$,
  'claiming slot 0 succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000013'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('truth-table-verified-unresolved', 'sha256'), 'hex')
     ) $$,
  'finalizing slot 0 succeeds, leaving slot 1 pending'
);
select is(
  (select public.compute_lead_file_upload_status(l.id) from public.leads l where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013'),
  'pending',
  'one verified, one still pending -> pending (unresolved wins over the verified slot)'
);

-- all verified -> complete: finalize the remaining slot too.
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 1),
       'a1000000-0000-0000-0000-000000000013'::uuid
     ) $$,
  'claiming slot 1 succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 1),
       'a1000000-0000-0000-0000-000000000013'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013' and qus.slot_index = 1),
       'image/jpeg', 1024, encode(digest('truth-table-all-verified', 'sha256'), 'hex')
     ) $$,
  'finalizing slot 1 succeeds — both slots now verified'
);
select is(
  (select public.compute_lead_file_upload_status(l.id) from public.leads l where l.idempotency_key = 'a1000000-0000-0000-0000-000000000013'),
  'complete',
  'all slots verified -> complete'
);

-- verified + terminal failure -> partial; all terminal failures -> failed;
-- constructed with a fresh two-file lead where slot 0 is driven to verified
-- and slot 1 is force-failed directly (mirroring the existing suite's own
-- direct-construction technique for terminal states).
select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000014'::uuid,
       encode(digest('c2d-a-truth-partial', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Truth Table", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}, {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'two-file lead for the partial/failed truth-table cases creates successfully'
);
select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000014' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000014'::uuid
     ) $$,
  'claiming slot 0 succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000014' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000014'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000014' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('truth-table-partial-verified', 'sha256'), 'hex')
     ) $$,
  'finalizing slot 0 succeeds'
);
select lives_ok(
  $$ update public.quote_upload_slots set status = 'failed', completed_at = now()
     where lead_id = (select id from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000014')
       and slot_index = 1 $$,
  'forcing slot 1 directly to failed (test setup) succeeds'
);
select is(
  (select public.compute_lead_file_upload_status(l.id) from public.leads l where l.idempotency_key = 'a1000000-0000-0000-0000-000000000014'),
  'partial',
  'one verified, one terminal-failed -> partial'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000015', encode(digest('c2d-a-truth-allfailed', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'truth-table lead (all terminal failures) inserts successfully'
);
select lives_ok(
  $$ insert into public.quote_upload_slots (lead_id, slot_index, kind, original_filename, declared_mime_type, declared_byte_size, status, completed_at)
     select id, 0, 'seller_photo', 'a.jpg', 'image/jpeg', 1024, 'failed', now() from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000015'
     union all
     select id, 1, 'seller_photo', 'b.jpg', 'image/jpeg', 1024, 'expired', now() from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000015' $$,
  'one failed and one expired slot (both terminal, zero verified) insert successfully'
);
select is(
  (select public.compute_lead_file_upload_status(id) from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000015'),
  'failed',
  'zero verified, all terminal (mixing failed and expired) -> failed'
);

-- ---------------------------------------------------------------------------
-- D. Atomic completion via the slot-state trigger — the real, un-mocked path
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000020'::uuid,
       encode(digest('c2d-a-last-slot-completes', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Last Slot", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}, {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'two-file lead for the atomic last-slot completion test creates successfully'
);
select is(
  (select submission_completed_at from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000020'),
  null,
  'a fresh two-file lead is not yet completed'
);

select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000020'::uuid
     ) $$,
  'claiming the first slot succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 0),
       'a1000000-0000-0000-0000-000000000020'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 0),
       'image/jpeg', 1024, encode(digest('last-slot-first-file', 'sha256'), 'hex')
     ) $$,
  'finalizing the first (non-last) slot succeeds'
);
select is(
  (select submission_completed_at from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000020'),
  null,
  'after verifying only the first of two slots, the lead is still not completed'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and la.event_type = 'submission_completed'),
  0,
  'no submission_completed activity exists yet'
);

select lives_ok(
  $$ select public.claim_quote_upload_v1(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 1),
       'a1000000-0000-0000-0000-000000000020'::uuid
     ) $$,
  'claiming the second (last) slot succeeds'
);
select lives_ok(
  $$ select public.finalize_quote_upload_v2(
       (select qus.id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 1),
       'a1000000-0000-0000-0000-000000000020'::uuid,
       (select qus.upload_attempt_id from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
         where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020' and qus.slot_index = 1),
       'image/jpeg', 1024, encode(digest('last-slot-second-file', 'sha256'), 'hex')
     ) $$,
  'finalizing the LAST slot succeeds — this single call, with no other request, must complete the lead'
);
select ok(
  (select submission_completed_at is not null from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000020'),
  'submission_completed_at is set the instant the last slot verifies, without any call to complete_website_quote_v1'
);
select is(
  (select file_upload_status from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000020'),
  'complete',
  'file_upload_status is persisted as complete'
);
select is(
  (select status from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000020'),
  'new',
  'leads.status (the owner business workflow column) is untouched — still new'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020'
      and la.event_type = 'submission_completed' and la.actor_type = 'system'),
  1,
  'exactly one submission_completed/system activity row exists'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000020'
      and nd.event_type = 'submission_completed' and nd.channel = 'email' and nd.status = 'pending'),
  1,
  'exactly one pending submission_completed/email notification row exists'
);

-- ---------------------------------------------------------------------------
-- E. Zero-file website enquiries complete during initiation
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000030'::uuid,
       encode(digest('c2d-a-zero-file', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Zero File", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'a zero-file seller submission creates successfully'
);
select ok(
  (select submission_completed_at is not null and file_upload_status = 'none'
   from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000030'),
  'a zero-file website lead is atomically completed within the same create_website_quote_v1 call'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and la.event_type = 'submission_completed'),
  1,
  'exactly one submission_completed activity exists for the zero-file lead'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and nd.event_type = 'submission_completed'),
  1,
  'exactly one submission_completed notification exists for the zero-file lead'
);

-- Exact replay of the same zero-file submission must not create a second
-- activity or notification row.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000030'::uuid,
       encode(digest('c2d-a-zero-file', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Zero File", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb
     ) $$,
  'an exact replay (same idempotency_key + payload_hash) of the zero-file submission succeeds'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and la.event_type = 'submission_completed'),
  1,
  'still exactly one submission_completed activity after the exact replay — no duplicate'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and nd.event_type = 'submission_completed'),
  1,
  'still exactly one submission_completed notification after the exact replay — no duplicate'
);

-- Nonzero-file, still-incomplete initiation must not complete.
select lives_ok(
  $$ select public.create_website_quote_v1(
       'a1000000-0000-0000-0000-000000000031'::uuid,
       encode(digest('c2d-a-nonzero-incomplete', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper", "sellerCondition": "clean_separated", "sellerQuantityValue": "10", "sellerQuantityUnit": "kg", "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no", "sellerName": "Incomplete", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp"}'::jsonb,
       '[{"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  'a one-file seller submission creates successfully'
);
select ok(
  (select submission_completed_at is null and file_upload_status = 'pending'
   from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000031'),
  'a nonzero-file lead with no verified slots is not completed'
);

-- ---------------------------------------------------------------------------
-- F. complete_website_quote_v1 — reconciliation only
-- ---------------------------------------------------------------------------

-- Already-completed replay: safe, no side effects, already_completed=true.
select is(
  (select public.complete_website_quote_v1(
       (select id from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000030'),
       'a1000000-0000-0000-0000-000000000030'::uuid
     ) ->> 'already_completed'),
  'true',
  'reconciling an already-completed lead reports already_completed=true'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and la.event_type = 'submission_completed'),
  1,
  'reconciling an already-completed lead created no second activity row'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000030' and nd.event_type = 'submission_completed'),
  1,
  'reconciling an already-completed lead created no second notification row'
);

-- Incomplete lead: distinguishable NOT_READY failure, no side effects.
select throws_ok(
  $$ select public.complete_website_quote_v1(
       (select id from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000031'),
       'a1000000-0000-0000-0000-000000000031'::uuid
     ) $$,
  'P0001',
  NULL,
  'reconciling a genuinely incomplete lead raises an exception rather than force-completing it'
);
select ok(
  (select submission_completed_at is null from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000031'),
  'the incomplete lead remains uncompleted after the rejected reconciliation attempt'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000031' and la.event_type = 'submission_completed'),
  0,
  'the rejected reconciliation attempt created no activity row'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000031' and nd.event_type = 'submission_completed'),
  0,
  'the rejected reconciliation attempt created no notification row'
);

-- Wrong idempotency key vs. a genuinely missing lead: indistinguishable.
select throws_ok(
  $$ select public.complete_website_quote_v1(
       (select id from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000031'),
       '00000000-0000-0000-0000-000000000000'::uuid
     ) $$,
  'P0001',
  'complete_website_quote_v1: lead not found for the supplied idempotency key',
  'a real lead_id with the wrong idempotency key produces the standard not-found exception'
);
select throws_ok(
  $$ select public.complete_website_quote_v1(
       '00000000-0000-0000-0000-000000000000'::uuid,
       '00000000-0000-0000-0000-000000000000'::uuid
     ) $$,
  'P0001',
  'complete_website_quote_v1: lead not found for the supplied idempotency key',
  'a lead_id that does not exist at all produces the exact same exception text — never distinguishable'
);

-- ---------------------------------------------------------------------------
-- G. Non-website leads are never completed by this checkpoint's machinery
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a1000000-0000-0000-0000-000000000040', encode(digest('c2d-a-non-website', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'a directly-inserted phone lead (capture_channel <> website) inserts successfully'
);
select is(
  (select public.complete_lead_if_ready(id) from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000040'),
  false,
  'complete_lead_if_ready never completes a non-website lead, even though it trivially has zero (declared) slots'
);
select ok(
  (select submission_completed_at is null from public.leads where idempotency_key = 'a1000000-0000-0000-0000-000000000040'),
  'the phone lead remains uncompleted'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000040' and la.event_type = 'submission_completed'),
  0,
  'no submission_completed activity was created for the non-website lead'
);
select is(
  (select count(*)::int from public.notification_deliveries nd join public.leads l on l.id = nd.lead_id
    where l.idempotency_key = 'a1000000-0000-0000-0000-000000000040' and nd.event_type = 'submission_completed'),
  0,
  'no submission_completed notification was created for the non-website lead'
);

select * from finish();

rollback;
