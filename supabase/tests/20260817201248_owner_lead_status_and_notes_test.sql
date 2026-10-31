-- Permanent pgTAP regression suite for
-- supabase/migrations/20260817201248_owner_lead_status_and_notes.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file never leaves persistent data behind. Synthetic
-- auth.users rows only (see 20260817120000_owner_authorization_foundation_test.sql's
-- own established pattern for this), never a real/demo email.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(65);

-- ---------------------------------------------------------------------------
-- A. Structural existence, security, and privileges
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'change_lead_status_v1', array['uuid', 'uuid', 'text', 'text', 'text'],
  'function public.change_lead_status_v1(uuid, uuid, text, text, text) exists'
);
select has_function(
  'public', 'add_lead_note_v1', array['uuid', 'uuid', 'text', 'uuid'],
  'function public.add_lead_note_v1(uuid, uuid, text, uuid) exists'
);
select ok(
  not has_function_privilege('public', 'public.change_lead_status_v1(uuid, uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.change_lead_status_v1(uuid, uuid, text, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.change_lead_status_v1(uuid, uuid, text, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.change_lead_status_v1(uuid, uuid, text, text, text)', 'EXECUTE'),
  'change_lead_status_v1 is execute-only for service_role'
);
select ok(
  not has_function_privilege('public', 'public.add_lead_note_v1(uuid, uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_lead_note_v1(uuid, uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.add_lead_note_v1(uuid, uuid, text, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.add_lead_note_v1(uuid, uuid, text, uuid)', 'EXECUTE'),
  'add_lead_note_v1 is execute-only for service_role'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.change_lead_status_v1(uuid, uuid, text, text, text)'::regprocedure) = false
  and (select prosecdef from pg_proc where oid = 'public.add_lead_note_v1(uuid, uuid, text, uuid)'::regprocedure) = false,
  'both new functions are SECURITY INVOKER, not SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- B. Fixtures — synthetic auth.users + owner_accounts + completed/incomplete leads
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo-owner-c2je@example.test'),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-owner-account-c2je@example.test'),
  ('e1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inactive-owner-c2je@example.test');

-- e1000000-...0001 gets an active owner_accounts row (the real caller
-- identity every existing test below already assumed). e1000000-...0002
-- deliberately gets NO owner_accounts row at all. e1000000-...0003 gets one
-- that is explicitly inactive. Both are exercised in section K below.
insert into public.owner_accounts (user_id, is_active)
values
  ('e1000000-0000-0000-0000-000000000001', true),
  ('e1000000-0000-0000-0000-000000000003', false);

insert into public.leads (id, idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot, submission_completed_at)
values
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', encode(digest('c2je-lead-a', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, now()),
  ('b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', encode(digest('c2je-lead-b', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, now()),
  ('b0000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000003', encode(digest('c2je-lead-c', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, now()),
  ('b0000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000004', encode(digest('c2je-lead-notes', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, now()),
  ('b0000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', encode(digest('c2je-lead-incomplete', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, null);

update public.leads set status = 'contacted' where id = 'b0000000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------------------------
-- C. change_lead_status_v1 — real transition + exactly one activity row
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'new', 'contacted') $$,
  'a real transition (new -> contacted) with a matching expected_status succeeds'
);
select is(
  (select status from public.leads where id = 'b0000000-0000-0000-0000-000000000001'), 'contacted',
  'leads.status was actually persisted as contacted'
);
select is(
  (select count(*)::int from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  1,
  'exactly one status_changed activity row was created for the real transition'
);
select is(
  (select actor_type from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  'owner',
  'the status_changed activity is attributed to actor_type=owner'
);
select is(
  (select actor_owner_id from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  'e1000000-0000-0000-0000-000000000001',
  'the status_changed activity is attributed to the calling owner'
);
select is(
  (select metadata ->> 'from_status' from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  'new',
  'the activity metadata records the correct previous status'
);
select is(
  (select metadata ->> 'to_status' from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  'contacted',
  'the activity metadata records the correct new status'
);
select ok(
  exists(select 1 from public.owner_profiles where id = 'e1000000-0000-0000-0000-000000000001'),
  'a matching owner_profiles row was lazily upserted for attribution'
);

-- ---------------------------------------------------------------------------
-- D. Same-status request is a deterministic no-op (no duplicate activity)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'contacted', 'contacted') $$,
  'resubmitting the same status (matching expected/new/current) succeeds as a no-op'
);
select is(
  ((select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'contacted', 'contacted')) ->> 'changed')::boolean,
  false,
  'the no-op call reports changed=false'
);
select is(
  (select count(*)::int from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000001' and event_type = 'status_changed'),
  1,
  'no duplicate activity row was created by the repeated same-status calls'
);

-- ---------------------------------------------------------------------------
-- E. Stale expected_status is a conflict, never silently applied
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'contacted', 'quote_sent') $$,
  'P0001', 'change_lead_status_v1: stale status',
  'a mismatched expected_status (client had a stale read) is rejected as a conflict'
);
select is(
  (select status from public.leads where id = 'b0000000-0000-0000-0000-000000000002'), 'new',
  'the lead status was not changed by the rejected stale-conflict call'
);
select is(
  (select count(*)::int from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000002'),
  0,
  'no activity row was created by the rejected stale-conflict call'
);

-- ---------------------------------------------------------------------------
-- F. Invalid status value rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'new', 'bogus_status') $$,
  'P0001', 'change_lead_status_v1: invalid status',
  'a status value outside the canonical vocabulary is rejected'
);

-- ---------------------------------------------------------------------------
-- G. 'lost' requires a non-blank, bounded reason; sets/clears closed_at
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'new', 'lost') $$,
  'P0001', 'change_lead_status_v1: lost reason required',
  'transitioning to lost without any reason is rejected'
);
select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'new', 'lost', '   ') $$,
  'P0001', 'change_lead_status_v1: lost reason required',
  'transitioning to lost with a whitespace-only reason is rejected'
);
select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'new', 'lost', repeat('x', 301)) $$,
  'P0001', 'change_lead_status_v1: lost reason too long',
  'a lost reason over 300 characters is rejected'
);
select lives_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'new', 'lost', 'Price too low for the customer') $$,
  'transitioning to lost with a valid reason succeeds'
);
select is(
  (select lost_reason from public.leads where id = 'b0000000-0000-0000-0000-000000000002'),
  'Price too low for the customer',
  'lost_reason was persisted exactly as trimmed'
);
select ok(
  (select closed_at from public.leads where id = 'b0000000-0000-0000-0000-000000000002') is not null,
  'closed_at was set when transitioning to lost'
);

select lives_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'lost', 'new') $$,
  'reopening a lost lead back to new succeeds'
);
select ok(
  (select lost_reason from public.leads where id = 'b0000000-0000-0000-0000-000000000002') is null
  and (select closed_at from public.leads where id = 'b0000000-0000-0000-0000-000000000002') is null,
  'reopening clears both lost_reason and closed_at'
);

-- ---------------------------------------------------------------------------
-- H. Missing / incomplete lead is rejected, never distinguishable from a
--    plain not-found by the caller-visible message
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.change_lead_status_v1('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e1000000-0000-0000-0000-000000000001', 'new', 'contacted') $$,
  'P0001', 'change_lead_status_v1: lead not found',
  'a nonexistent lead id is rejected'
);
select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'new', 'contacted') $$,
  'P0001', 'change_lead_status_v1: lead not found',
  'an incomplete (submission not completed) lead is rejected identically to not-found'
);

-- ---------------------------------------------------------------------------
-- I. add_lead_note_v1 — success + exactly one activity row
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '  Customer wants pickup on Friday, called twice.  ', 'f1000000-0000-0000-0000-000000000001') $$,
  'adding a private note succeeds'
);
select is(
  (select count(*)::int from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000004' and event_type = 'note_added'),
  1,
  'exactly one note_added activity row was created'
);
select is(
  (select metadata ->> 'note' from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000004' and event_type = 'note_added'),
  'Customer wants pickup on Friday, called twice.',
  'the note body was trimmed and persisted exactly'
);
select is(
  (select actor_type from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000004' and event_type = 'note_added'),
  'owner',
  'the note activity is attributed to actor_type=owner'
);

-- Unicode/punctuation is preserved verbatim. Asserted directly on the RPC's
-- own return value (not a re-query ordered by created_at) because both
-- notes are inserted within this same frozen-now() test transaction, so
-- created_at cannot be relied on to distinguish insertion order.
select is(
  (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'Client café — "urgent", 50% off? مرحبا', 'f1000000-0000-0000-0000-000000000002') ->> 'note'),
  'Client café — "urgent", 50% off? مرحبا',
  'a note containing unicode and punctuation is accepted and round-trips exactly'
);

-- Two textually-identical notes under two DIFFERENT request ids are both
-- legitimate and both preserved (content-based de-dup was never the goal).
select is(
  (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'Same text, deliberately.', 'f1000000-0000-0000-0000-0000000000a1') ->> 'note'),
  'Same text, deliberately.',
  'a fresh request_id with identical text to a prior note is a legitimate new note'
);
select is(
  (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'Same text, deliberately.', 'f1000000-0000-0000-0000-0000000000a2') ->> 'note'),
  'Same text, deliberately.',
  'a second, different fresh request_id with the same identical text is also accepted'
);
select is(
  (select count(*)::int from public.lead_activities where lead_id = 'b0000000-0000-0000-0000-000000000004' and event_type = 'note_added'),
  4,
  'four distinct note submissions (four distinct request ids) created four separate activity rows'
);

select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '', 'f1000000-0000-0000-0000-000000000003') $$,
  'P0001', 'add_lead_note_v1: note body required',
  'an empty note body is rejected'
);
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '    ', 'f1000000-0000-0000-0000-000000000004') $$,
  'P0001', 'add_lead_note_v1: note body required',
  'a whitespace-only note body is rejected'
);
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', repeat('n', 2001), 'f1000000-0000-0000-0000-000000000005') $$,
  'P0001', 'add_lead_note_v1: note body too long',
  'a note body over 2000 characters is rejected'
);
select throws_ok(
  $$ select public.add_lead_note_v1('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e1000000-0000-0000-0000-000000000001', 'hello', 'f1000000-0000-0000-0000-000000000006') $$,
  'P0001', 'add_lead_note_v1: lead not found',
  'a nonexistent lead id is rejected for note creation'
);
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'hello', 'f1000000-0000-0000-0000-000000000007') $$,
  'P0001', 'add_lead_note_v1: lead not found',
  'an incomplete lead is rejected identically to not-found for note creation'
);
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'hello', null) $$,
  'P0001', 'add_lead_note_v1: request_id is required',
  'a null request_id is rejected'
);

-- ---------------------------------------------------------------------------
-- J. add_lead_note_v1 — request_id idempotency (correction pass)
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1'),
  0,
  'sanity: the replay request_id used below does not exist yet'
);
select is(
  (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'Please call back tomorrow.', 'f1000000-0000-0000-0000-0000000000b1') ->> 'note'),
  'Please call back tomorrow.',
  'the first call with a fresh request_id succeeds'
);
select is(
  (select count(*)::int from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1'),
  1,
  'exactly one activity row exists for that request_id after the first call'
);

-- A byte-identical replay (same lead, same owner, same normalized note,
-- same request_id) returns the ORIGINAL row's id, and creates no new row.
select is(
  (
    (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'Please call back tomorrow.', 'f1000000-0000-0000-0000-0000000000b1') ->> 'activityId')
    =
    (select id::text from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1')
  ),
  true,
  'a replay with identical input returns the same activityId as the original'
);
select is(
  (select count(*)::int from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1'),
  1,
  'the identical-input replay did not create a second activity row'
);

-- The un-trimmed variant of the same text is still the same NORMALIZED
-- operation (trim happens before the identity comparison) — also a replay.
select is(
  (select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', '  Please call back tomorrow.  ', 'f1000000-0000-0000-0000-0000000000b1') ->> 'note'),
  'Please call back tomorrow.',
  'a replay whose only difference is surrounding whitespace is still recognized as the same normalized operation'
);
select is(
  (select count(*)::int from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1'),
  1,
  'still exactly one activity row after the whitespace-only-variant replay'
);

-- Reusing the same request_id with a DIFFERENT note body is rejected, not
-- silently treated as a replay and not silently applied as a new note.
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'A completely different note.', 'f1000000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'add_lead_note_v1: request_id reused with different input',
  'reusing a request_id with a different note body is rejected'
);
select is(
  (select count(*)::int from public.lead_activities where request_id = 'f1000000-0000-0000-0000-0000000000b1'),
  1,
  'the rejected different-body replay created no additional row'
);

-- Reusing the same request_id against a DIFFERENT lead is also rejected.
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Please call back tomorrow.', 'f1000000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'add_lead_note_v1: request_id reused with different input',
  'reusing a request_id against a different lead is rejected'
);

-- ---------------------------------------------------------------------------
-- K. Both RPCs independently reject a missing/inactive owner_accounts
--    identity, before touching owner_profiles or any lead data
--    (correction pass)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'new', 'contacted') $$,
  'P0001', 'change_lead_status_v1: owner not authorized',
  'change_lead_status_v1 rejects a user with no owner_accounts row at all'
);
select throws_ok(
  $$ select public.change_lead_status_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000003', 'new', 'contacted') $$,
  'P0001', 'change_lead_status_v1: owner not authorized',
  'change_lead_status_v1 rejects a user with an explicitly inactive owner_accounts row'
);
select is(
  (select status from public.leads where id = 'b0000000-0000-0000-0000-000000000004'), 'new',
  'the unauthorized change_lead_status_v1 calls above mutated nothing'
);
select ok(
  not exists(select 1 from public.owner_profiles where id in ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003')),
  'neither unauthorized identity got an owner_profiles row upserted (the auth check runs before the upsert)'
);

select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'hello', 'f1000000-0000-0000-0000-0000000000c1') $$,
  'P0001', 'add_lead_note_v1: owner not authorized',
  'add_lead_note_v1 rejects a user with no owner_accounts row at all'
);
select throws_ok(
  $$ select public.add_lead_note_v1('b0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000003', 'hello', 'f1000000-0000-0000-0000-0000000000c2') $$,
  'P0001', 'add_lead_note_v1: owner not authorized',
  'add_lead_note_v1 rejects a user with an explicitly inactive owner_accounts row'
);
select is(
  (select count(*)::int from public.lead_activities where request_id in ('f1000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-0000000000c2')),
  0,
  'neither unauthorized add_lead_note_v1 call created an activity row'
);

-- ---------------------------------------------------------------------------
-- L. No regression to existing structures/security
-- ---------------------------------------------------------------------------

select has_table('public', 'leads', 'no regression: public.leads still exists');
select has_table('public', 'lead_activities', 'no regression: public.lead_activities still exists');
select has_function('public', 'complete_lead_if_ready', array['uuid'], 'no regression: complete_lead_if_ready still exists');
select ok(
  not has_table_privilege('authenticated', 'public.lead_activities', 'INSERT')
  and not has_table_privilege('anon', 'public.lead_activities', 'INSERT'),
  'no regression: lead_activities is still not directly insertable by authenticated/anon'
);

select * from finish();

rollback;
