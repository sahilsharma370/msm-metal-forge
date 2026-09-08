-- MSM Scrap — CHECKPOINT C2I-A: secure owner authentication foundation.
--
-- Scope: one new table, public.owner_accounts — the durable AUTHORIZATION
-- gate for the future owner dashboard. Deliberately separate from the
-- existing public.owner_profiles (added in
-- 20260811165757_create_quote_backend_foundation.sql): owner_profiles is an
-- identity/attribution table already wired to lead_activities.actor_owner_id
-- with a broader role vocabulary ('owner', 'staff') for that future
-- feature; owner_accounts is a narrowly-scoped, security-critical yes/no
-- gate — "is this exact auth.users.id currently allowed to reach the owner
-- dashboard at all" — with an intentionally narrower initial role
-- vocabulary ('owner' only). Keeping the two concerns in separate tables
-- means broadening owner_profiles' role set later (e.g. adding 'staff'
-- attribution) can never accidentally loosen who is authorized to sign in,
-- and this migration touches neither owner_profiles' rows nor its
-- constraints.
--
-- A valid Supabase Auth session is NOT sufficient authorization on its own
-- — the application's server-side verifier (see
-- src/server/owner-auth/owner-session.server.ts) must additionally find an
-- ACTIVE row here for the verified auth.users.id. No password, OTP, access
-- token or refresh token is ever stored in this table — Supabase Auth (the
-- auth.* schema) is the sole owner of all of that; this table only ever
-- records an authorization DECISION (active/inactive + role), never
-- credential material.
--
-- Security posture matches every prior migration in this schema exactly:
-- RLS enabled AND forced with ZERO client-facing policies (default-deny —
-- see owner_profiles' own precedent), SECURITY INVOKER would apply to any
-- helper function this migration might add (it adds none: the one lookup
-- the server needs is a plain point SELECT via the service-role admin
-- client, matching the already-established
-- dispatch-notification.server.ts loadLead()/leads pattern — no RPC
-- function is needed or added here). Only service_role receives explicit,
-- minimal GRANTs; anon and authenticated get nothing. No DELETE grant —
-- deactivate via is_active = false, never hard-delete, matching
-- owner_profiles' own established convention.
--
-- Provisioning the real/demo owner's row is a deliberate, controlled
-- operator step performed OUTSIDE this migration and outside application
-- code (never a seed file, never a hardcoded email) — see
-- docs/owner-auth-setup.md.
--
-- This migration adds no table, function or RPC that touches leads,
-- lead_files, lead_activities, notification_deliveries, quote_upload_slots
-- or any Storage object/policy — every existing Quote/Storage/notification
-- security guarantee is untouched.

create table public.owner_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Intentionally narrow: only 'owner' is valid today. A future role (e.g.
  -- 'staff') is a deliberate, reviewed schema change, not something that
  -- can silently widen by inserting an unexpected value.
  role text not null default 'owner' check (role in ('owner')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_accounts enable row level security;
alter table public.owner_accounts force row level security;

comment on table public.owner_accounts is
  'CHECKPOINT C2I-A — durable owner-dashboard AUTHORIZATION gate, keyed '
  'directly on auth.users.id. Distinct from public.owner_profiles (identity/'
  'attribution for lead_activities, broader role vocabulary). A valid '
  'Supabase Auth session alone is never sufficient: the server-side '
  'verifier requires an ACTIVE row here too. Never stores a password, OTP, '
  'access token or refresh token — Supabase Auth owns all of that. '
  'Provisioning a real row is a deliberate, controlled operator step, '
  'never application code or a seed file. Deactivate via is_active = '
  'false; never hard-delete.';
comment on column public.owner_accounts.role is
  'Intentionally narrow initial vocabulary — only ''owner'' is valid today.';
comment on column public.owner_accounts.is_active is
  'The single kill-switch for this account''s dashboard access. The demo '
  'owner can be disabled, and the real owner added later, purely by '
  'row-level data changes here — never an application code change.';

create trigger owner_accounts_set_updated_at
  before update on public.owner_accounts
  for each row
  execute function public.set_updated_at();

revoke all on public.owner_accounts from public, anon, authenticated;
grant select, insert, update on public.owner_accounts to service_role;
-- No delete grant — see table comment: deactivate via is_active, never
-- hard-delete. Matches owner_profiles' own established grant shape exactly.
