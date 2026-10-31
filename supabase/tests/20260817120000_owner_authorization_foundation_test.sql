-- Permanent pgTAP regression suite for
-- supabase/migrations/20260817120000_owner_authorization_foundation.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file never leaves persistent data behind — including the
-- synthetic auth.users fixture rows it creates purely to satisfy
-- owner_accounts.user_id's foreign key (no real/demo email is ever used
-- here; every fixture uses a synthetic *.example.test address).

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- A. Table, columns, defaults, PK and FK exist as specified
-- ---------------------------------------------------------------------------

select has_table('public', 'owner_accounts', 'table public.owner_accounts exists');

select columns_are('public', 'owner_accounts', array[
  'user_id', 'role', 'is_active', 'created_at', 'updated_at'
], 'owner_accounts has exactly the specified columns, no more, no less');

select col_type_is('public', 'owner_accounts', 'user_id', 'uuid', 'user_id is uuid');
select col_type_is('public', 'owner_accounts', 'role', 'text', 'role is text');
select col_type_is('public', 'owner_accounts', 'is_active', 'boolean', 'is_active is boolean');
select col_type_is('public', 'owner_accounts', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');
select col_type_is('public', 'owner_accounts', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');

select col_is_pk('public', 'owner_accounts', 'user_id', 'user_id is the primary key');
select col_not_null('public', 'owner_accounts', 'role', 'role is not null');
select col_not_null('public', 'owner_accounts', 'is_active', 'is_active is not null');
select col_default_is('public', 'owner_accounts', 'role', 'owner', 'role defaults to ''owner''');
select col_default_is('public', 'owner_accounts', 'is_active', 'true', 'is_active defaults to true');

select fk_ok('public', 'owner_accounts', 'user_id', 'auth', 'users', 'id', 'user_id references auth.users(id)');

select has_trigger('public', 'owner_accounts', 'owner_accounts_set_updated_at', 'trigger owner_accounts_set_updated_at exists');

-- ---------------------------------------------------------------------------
-- B. RLS enabled and forced
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.owner_accounts'::regclass),
  'RLS is enabled and forced on public.owner_accounts'
);

-- ---------------------------------------------------------------------------
-- C. public / anon / authenticated cannot enumerate or mutate rows directly
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.owner_accounts', 'SELECT')
  and not has_table_privilege('anon', 'public.owner_accounts', 'INSERT')
  and not has_table_privilege('anon', 'public.owner_accounts', 'UPDATE')
  and not has_table_privilege('anon', 'public.owner_accounts', 'DELETE'),
  'anon has no privileges on public.owner_accounts'
);
select ok(
  not has_table_privilege('authenticated', 'public.owner_accounts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.owner_accounts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.owner_accounts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.owner_accounts', 'DELETE'),
  'authenticated has no privileges on public.owner_accounts'
);
select ok(
  not has_table_privilege('public', 'public.owner_accounts', 'SELECT')
  and not has_table_privilege('public', 'public.owner_accounts', 'INSERT')
  and not has_table_privilege('public', 'public.owner_accounts', 'UPDATE')
  and not has_table_privilege('public', 'public.owner_accounts', 'DELETE'),
  'the public role has no privileges on public.owner_accounts'
);

-- No permissive policy of any kind exists — zero policies is the entire
-- point of default-deny (see the migration's own comment). If a future
-- change ever adds one, this assertion starts failing loudly.
select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'owner_accounts') = 0,
  'owner_accounts has zero RLS policies — default-deny, no permissive client policy'
);

-- ---------------------------------------------------------------------------
-- D. Only trusted service/operator access — service_role gets exactly
--    select/insert/update, no delete
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('service_role', 'public.owner_accounts', 'SELECT')
  and has_table_privilege('service_role', 'public.owner_accounts', 'INSERT')
  and has_table_privilege('service_role', 'public.owner_accounts', 'UPDATE')
  and not has_table_privilege('service_role', 'public.owner_accounts', 'DELETE'),
  'service_role has exactly select/insert/update on owner_accounts (no delete)'
);

-- ---------------------------------------------------------------------------
-- E. Fixtures — synthetic auth.users rows only, never a real/demo email
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-owner@example.test'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inactive-owner@example.test'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invalid-role@example.test'),
  ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duplicate-owner@example.test');

-- ---------------------------------------------------------------------------
-- F. Valid active owner row — the authorization contract's "allow" case
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.owner_accounts (user_id) values ('c0000000-0000-0000-0000-000000000001') $$,
  'active owner row insert succeeds with only user_id supplied (role/is_active take their defaults)'
);
select is(
  (select role from public.owner_accounts where user_id = 'c0000000-0000-0000-0000-000000000001'),
  'owner',
  'role defaults to owner on insert'
);
select ok(
  (select is_active from public.owner_accounts where user_id = 'c0000000-0000-0000-0000-000000000001') = true,
  'is_active defaults to true on insert'
);
-- The exact predicate the server-side verifier relies on (see
-- src/server/owner-auth/owner-session.server.ts): an active row for this
-- role/user_id combination is found.
select ok(
  exists(
    select 1 from public.owner_accounts
    where user_id = 'c0000000-0000-0000-0000-000000000001' and role = 'owner' and is_active = true
  ),
  'active owner is found by the exact authorization-contract predicate'
);

-- ---------------------------------------------------------------------------
-- G. Inactive owner — the authorization contract's "deny" case
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.owner_accounts (user_id, is_active) values ('c0000000-0000-0000-0000-000000000002', false) $$,
  'inactive owner row is representable at insert time'
);
select ok(
  not exists(
    select 1 from public.owner_accounts
    where user_id = 'c0000000-0000-0000-0000-000000000002' and role = 'owner' and is_active = true
  ),
  'inactive owner is rejected by the exact authorization-contract predicate'
);

-- Deactivating a previously-active owner (the "demo owner disabled later"
-- scenario) is a pure UPDATE — no application code change needed.
select lives_ok(
  $$ update public.owner_accounts set is_active = false where user_id = 'c0000000-0000-0000-0000-000000000001' $$,
  'deactivating a previously-active owner via UPDATE succeeds'
);
select ok(
  not exists(
    select 1 from public.owner_accounts
    where user_id = 'c0000000-0000-0000-0000-000000000001' and role = 'owner' and is_active = true
  ),
  'a deactivated owner no longer satisfies the authorization-contract predicate'
);
-- Not asserted here: updated_at actually changing on this UPDATE. now() is
-- frozen for the lifetime of this whole transaction (see
-- 20260816170000_..._test.sql's own comment on this exact limitation), so
-- created_at and updated_at are identical regardless of whether the
-- trigger ran — has_trigger above is this suite's (and every other suite
-- in this schema's) actual proof the trigger exists and is wired up.

-- ---------------------------------------------------------------------------
-- H. Duplicate authorization rejected
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.owner_accounts (user_id) values ('c0000000-0000-0000-0000-000000000004') $$,
  'first authorization row for this user_id succeeds'
);
select throws_ok(
  $$ insert into public.owner_accounts (user_id) values ('c0000000-0000-0000-0000-000000000004') $$,
  '23505',
  NULL,
  'a second authorization row for the same user_id is rejected (primary key violation)'
);

-- ---------------------------------------------------------------------------
-- I. Invalid role rejected
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.owner_accounts (user_id, role) values ('c0000000-0000-0000-0000-000000000003', 'staff') $$,
  '23514',
  NULL,
  'a role outside the narrow (''owner''-only) vocabulary is rejected'
);
select throws_ok(
  $$ insert into public.owner_accounts (user_id, role) values ('c0000000-0000-0000-0000-000000000003', 'admin') $$,
  '23514',
  NULL,
  'an arbitrary/unexpected role value is rejected'
);

-- ---------------------------------------------------------------------------
-- J. user_id integrity — required, and must reference a real auth user
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.owner_accounts (user_id) values (null) $$,
  '23502',
  NULL,
  'a null user_id is rejected (primary key implies not null)'
);
select throws_ok(
  $$ insert into public.owner_accounts (user_id) values ('dddddddd-dddd-dddd-dddd-dddddddddddd') $$,
  '23503',
  NULL,
  'a user_id with no matching auth.users row is rejected (foreign key violation)'
);

-- ---------------------------------------------------------------------------
-- K. No regression to existing Quote / Storage / notification security
--    (structural spot-checks — the full existing suites run unmodified
--    alongside this file under `npx supabase test db --local` and are the
--    primary proof; these assertions additionally confirm this migration
--    did not touch any of them)
-- ---------------------------------------------------------------------------

select has_table('public', 'leads', 'no regression: public.leads still exists');
select has_table('public', 'owner_profiles', 'no regression: public.owner_profiles still exists, untouched');
select has_table('public', 'lead_files', 'no regression: public.lead_files still exists');
select has_table('public', 'lead_activities', 'no regression: public.lead_activities still exists');
select has_table('public', 'notification_deliveries', 'no regression: public.notification_deliveries still exists');
select has_function('public', 'create_website_quote_v1', 'no regression: create_website_quote_v1 still exists');

-- owner_profiles' own broader role vocabulary ('owner', 'staff') is
-- unchanged by this migration — proves this checkpoint's narrower
-- owner_accounts.role CHECK was added as a NEW, separate constraint, not
-- by tightening the existing owner_profiles table.
select lives_ok(
  $$ insert into public.owner_profiles (id, role) values ('c0000000-0000-0000-0000-000000000003', 'staff') $$,
  'no regression: owner_profiles still accepts role = ''staff'' (its own vocabulary is untouched)'
);

select * from finish();

rollback;
