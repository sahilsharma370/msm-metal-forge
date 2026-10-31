-- Permanent pgTAP regression suite for
-- supabase/migrations/20260817150000_owner_lead_inbox_read_index.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file never leaves persistent data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(9);

-- ---------------------------------------------------------------------------
-- A. Index exists on the expected table
-- ---------------------------------------------------------------------------

select has_index('public', 'leads', 'leads_owner_inbox_completed_order_idx',
  'index leads_owner_inbox_completed_order_idx exists on public.leads');

-- ---------------------------------------------------------------------------
-- B. Exact ordered columns and directions — submission_completed_at DESC,
--    created_at DESC, id DESC (matches the inbox's required default sort)
-- ---------------------------------------------------------------------------

select ok(
  (
    select indexdef ~ 'USING btree \(submission_completed_at DESC, created_at DESC, id DESC\)'
    from pg_indexes
    where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_owner_inbox_completed_order_idx'
  ),
  'index orders exactly (submission_completed_at DESC, created_at DESC, id DESC)'
);

-- ---------------------------------------------------------------------------
-- C. Partial predicate — only rows where submission_completed_at is not null
-- ---------------------------------------------------------------------------

select ok(
  (
    select indexdef ~ 'WHERE \(submission_completed_at IS NOT NULL\)'
    from pg_indexes
    where schemaname = 'public' and tablename = 'leads' and indexname = 'leads_owner_inbox_completed_order_idx'
  ),
  'index is partial: WHERE submission_completed_at IS NOT NULL'
);

select is(
  (select indisunique from pg_index where indexrelid = 'public.leads_owner_inbox_completed_order_idx'::regclass),
  false,
  'index is a plain (non-unique) read index, not a constraint'
);

-- ---------------------------------------------------------------------------
-- D. No redundant index — exactly one index with this exact column list
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'leads'
      and indexdef ~ 'submission_completed_at DESC, created_at DESC, id DESC'
  ),
  1,
  'exactly one index provides this column order — no redundant duplicate'
);

-- ---------------------------------------------------------------------------
-- E. No regression — public.leads' existing RLS/zero-policy/grant posture
--    is completely unaffected by this migration
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.leads'::regclass),
  'no regression: RLS remains enabled and forced on public.leads'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'leads') = 0,
  'no regression: public.leads still has zero client-facing RLS policies'
);

select ok(
  not has_table_privilege('anon', 'public.leads', 'SELECT')
  and not has_table_privilege('authenticated', 'public.leads', 'SELECT'),
  'no regression: anon/authenticated still have no SELECT on public.leads'
);

select ok(
  has_table_privilege('service_role', 'public.leads', 'SELECT')
  and has_table_privilege('service_role', 'public.leads', 'INSERT')
  and has_table_privilege('service_role', 'public.leads', 'UPDATE')
  and not has_table_privilege('service_role', 'public.leads', 'DELETE'),
  'no regression: service_role still has exactly select/insert/update on public.leads (no delete)'
);

select * from finish();

rollback;
