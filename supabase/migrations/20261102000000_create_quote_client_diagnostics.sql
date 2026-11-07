-- ---------------------------------------------------------------------------
-- QT-CLI audit — server-visible client diagnostics.
--
-- Motivation: the existing client-side quote_submit_client_exception
-- logging (src/lib/error-capture.ts) only ever reaches console.error, which
-- is a LIVE DevTools-session-only signal — invisible in Google's in-app
-- browser, where there is no DevTools to connect, and ALSO invisible on the
-- deployed Worker even if it were server-side, since Cloudflare Workers
-- Observability/Logs is NOT enabled on msm-metal-forge (confirmed via the
-- real account's Worker settings — "observability": null — not assumed).
-- This table is the durable, queryable destination that closes that gap.
--
-- Scope, deliberately narrow: ONE best-effort, fire-and-forget diagnostic
-- snapshot per client_exception, closed booleans/enums only. Never contact
-- data, form values, files, a Turnstile token, a raw exception
-- message/stack, a URL (query string or otherwise), or a payload hash —
-- none of those have a column here, so none of them CAN be stored even if
-- a future caller tried to pass one; log_quote_client_diagnostic_v1 below
-- only accepts the six scalar parameters this migration defines.
--
-- Retention: prune_quote_client_diagnostics_v1 below (wired to the
-- EXISTING Cloudflare Worker scheduled trigger in cloudflare-hooks.server.ts
-- — no new cron trigger, no new Postgres extension) deletes rows older
-- than a given age, once per day. This is a real, testable, invokable
-- mechanism, not a merely-documented manual query — but it is still NOT a
-- guarantee. CORRECTED: Cloudflare Cron Triggers fire a Worker's
-- scheduled() handler from Cloudflare's own edge infrastructure on the
-- configured schedule, independent of HTTP traffic — an idle/zero-traffic
-- Worker is NOT delayed by this (an earlier draft of this comment wrongly
-- claimed otherwise). The real caveats are narrower: the trigger must be
-- deployed/configured (verified locally, see the retention module's own
-- test coverage) and a transient RPC failure just waits for tomorrow's
-- window. See src/server/quote/quote-client-diagnostics-retention.server.ts
-- for the scheduling decision and its own tests.
--
-- Security posture matches every other table/function in this schema for
-- the TABLE and log_quote_client_diagnostic_v1 (its one application write
-- path): RLS enabled AND forced with zero policies (default-deny for anon/
-- authenticated), explicit minimal grants to service_role only, append-only
-- (select, insert — no update, no delete, no truncate), SECURITY INVOKER.
-- prune_quote_client_diagnostics_v1 is the ONE deliberate exception — see
-- its own doc comment immediately before it for why.
-- ---------------------------------------------------------------------------

create table public.quote_client_diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Mirrors QuoteClientExceptionStage exactly (quote-submission-engine.ts)
  -- — the last progress phase reached before the throw, never anything
  -- derived from the error itself.
  stage text not null check (stage in (
    'before_computing_identity',
    'computing_identity',
    'initiating',
    'resolving_slots',
    'uploading',
    'completing',
    'unknown'
  )),

  -- Whether the engine's own call into the transport abstraction for
  -- initiate() was reached at all, and whether that call returned/resolved
  -- without throwing. Deliberately NOT named/claimed as "request sent" or
  -- "HTTP response received" — the measurement point is the engine's call
  -- into quote-submission-transport.ts, not the raw fetch() boundary
  -- inside it (see quote-submission-engine.ts's own SubmitInternalDiagnostics
  -- doc comment for the full reasoning on why that distinction matters and
  -- why instrumenting the raw network boundary was considered and not done
  -- here).
  initiate_invoked boolean not null,
  initiate_settled boolean not null,

  -- Web Crypto API presence only — never a value drawn from calling any of
  -- these, just whether each one exists in this browser right now.
  subtle_available boolean not null,
  get_random_values_available boolean not null,
  random_uuid_available boolean not null
);

alter table public.quote_client_diagnostics enable row level security;
alter table public.quote_client_diagnostics force row level security;

comment on table public.quote_client_diagnostics is
  'Privacy-safe, best-effort QT-CLI diagnostic snapshots reported by the '
  'browser client. Every column is a closed boolean or CHECK-constrained '
  'enum -- never contact data, form values, files, a token, a raw error, '
  'a URL, or a payload hash; there is no column that could hold any of '
  'those. Append-only: service_role holds exactly SELECT and INSERT -- no '
  'UPDATE, no DELETE, and TRUNCATE is explicitly revoked too (see this '
  'table''s own grant statements immediately below for why TRUNCATE needed '
  'a separate, explicit revoke). Retention is handled by the one '
  'SECURITY DEFINER exception in this file, prune_quote_client_diagnostics_v1 '
  '(added further below), invoked from the existing Cloudflare Worker '
  'scheduled trigger -- not a pg_cron job, no new Postgres extension. See '
  'that function''s own doc comment, and this '
  'migration file''s own header comment for why it is still not an '
  'unconditional guarantee.';

-- RECONCILED — "append-only" is only true for every destructive operation
-- if TRUNCATE is revoked too, not just UPDATE/DELETE: TRUNCATE is a
-- SEPARATE table-level privilege from DELETE in Postgres, and `revoke all
-- ... from public, anon, authenticated` below (matching every other
-- table's own grant block in this schema) never touched service_role at
-- all. A fresh table created in this schema was independently CONFIRMED
-- (via a local, disposable Supabase smoke test — never production) to
-- already carry TRUNCATE/REFERENCES/TRIGGER on service_role from some
-- platform-level baseline neither this migration nor any other one here
-- explicitly grants. REFERENCES/TRIGGER create constraints/fire triggers,
-- not a data-integrity threat to "append-only" on their own, so they are
-- left as the same harmless inherited baseline every other table in this
-- schema already has — but TRUNCATE instantly empties the whole table,
-- which directly contradicts "append-only" if left in place. Revoking it
-- here, explicitly, for this table only (not attempting to "fix" every
-- other pre-existing table's identical inherited grant, which is a
-- separate, broader, unrequested change) is what makes the comment above
-- literally true rather than merely a stated intention.
revoke all on public.quote_client_diagnostics from public, anon, authenticated;
revoke truncate on public.quote_client_diagnostics from service_role;
grant select, insert on public.quote_client_diagnostics to service_role;
-- Deliberately no update/delete grant, and TRUNCATE explicitly revoked
-- above — see table comment.

create index quote_client_diagnostics_created_at_idx
  on public.quote_client_diagnostics (created_at);

-- ---------------------------------------------------------------------------
-- log_quote_client_diagnostic_v1 — the one, narrow write path. Six scalar
-- parameters, nothing else: a caller cannot pass through any field this
-- table doesn't have a column for, by construction (there is no jsonb
-- catch-all parameter here on purpose).
-- ---------------------------------------------------------------------------

create or replace function public.log_quote_client_diagnostic_v1(
  p_stage text,
  p_initiate_invoked boolean,
  p_initiate_settled boolean,
  p_subtle_available boolean,
  p_get_random_values_available boolean,
  p_random_uuid_available boolean
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  insert into public.quote_client_diagnostics (
    stage,
    initiate_invoked,
    initiate_settled,
    subtle_available,
    get_random_values_available,
    random_uuid_available
  ) values (
    p_stage,
    p_initiate_invoked,
    p_initiate_settled,
    p_subtle_available,
    p_get_random_values_available,
    p_random_uuid_available
  );
end;
$$;

comment on function public.log_quote_client_diagnostic_v1 is
  'The one write path for quote_client_diagnostics. Six scalar parameters '
  'only -- the table''s own CHECK constraint on stage still applies, so an '
  'out-of-enum value raises rather than silently inserting.';

revoke execute on function public.log_quote_client_diagnostic_v1(
  text, boolean, boolean, boolean, boolean, boolean
) from public;
grant execute on function public.log_quote_client_diagnostic_v1(
  text, boolean, boolean, boolean, boolean, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- prune_quote_client_diagnostics_v1 — retention, and the ONE deliberate
-- SECURITY DEFINER exception in this schema (every other function here,
-- across every migration, is SECURITY INVOKER).
--
-- WHY this one function breaks that convention, explicitly: service_role's
-- own grant on this table is SELECT + INSERT only (see above) — on
-- purpose, so the application's normal Supabase admin client can never
-- directly run an arbitrary DELETE/TRUNCATE against this table, only ever
-- insert through the one narrow, fixed RPC above. A SECURITY INVOKER prune
-- function would therefore fail (permission denied) when called as
-- service_role, since DELETE was deliberately never granted to it. The
-- alternative — granting DELETE to service_role directly — would restore
-- the exact risk the append-only design exists to prevent (any code path
-- using the admin client could then delete arbitrary rows, not just this
-- one bounded, age-based prune). SECURITY DEFINER here means this ONE
-- function runs with the privileges of whichever role DEFINED it (the
-- migration-applying role, which already has full table owner rights) —
-- service_role can call it, but can still never do anything to this table
-- OTHER than what this function's own fixed body does.
--
-- Kept safe the standard way a SECURITY DEFINER function must be: `set
-- search_path` is fixed (never resolves an identifier against a
-- caller-controlled schema), the body contains no dynamic SQL of any kind
-- (a literal, parameterized DELETE only), and the one parameter
-- (p_max_age_days) is validated before use rather than trusted outright —
-- a careless or malicious 0/negative value could otherwise delete
-- everything immediately instead of only old rows.
--
-- Returns the number of rows actually deleted — used by this function's
-- own caller (quote-client-diagnostics-retention.server.ts) only for a
-- coarse count in its own non-PII log line, never logged or returned
-- anywhere a customer could see it.
-- ---------------------------------------------------------------------------

create or replace function public.prune_quote_client_diagnostics_v1(
  p_max_age_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted_count integer;
begin
  if p_max_age_days is null or p_max_age_days < 1 then
    raise exception 'p_max_age_days must be a positive integer';
  end if;

  delete from public.quote_client_diagnostics
  where created_at < now() - (p_max_age_days || ' days')::interval;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

comment on function public.prune_quote_client_diagnostics_v1 is
  'SECURITY DEFINER exception (see its own header comment above) — the '
  'only way quote_client_diagnostics rows are ever removed. Deletes rows '
  'older than p_max_age_days (default 30), returns the count deleted. '
  'Fixed search_path, no dynamic SQL, validates its one parameter before '
  'use.';

revoke execute on function public.prune_quote_client_diagnostics_v1(integer) from public;
grant execute on function public.prune_quote_client_diagnostics_v1(integer) to service_role;
