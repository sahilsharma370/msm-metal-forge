-- MSM Scrap — Quote backend CHECKPOINT A: private Storage + server-authorized
-- upload-slot foundation.
--
-- Scope: exactly one private Storage bucket (lead-files) and one new table,
-- public.quote_upload_slots, that lets the future server pre-authorize a
-- bounded set of client uploads (max 5 per lead, 8 MiB each, four fixed MIME
-- types) before any file bytes exist in Storage. Explicitly NOT in scope:
-- signed-upload-URL issuance itself (server code, not SQL), the eventual
-- lead_files verification write-path, storage.objects RLS policies for
-- anon/authenticated (there must be none — service_role mints signed URLs
-- out-of-band and uploads happen against those, never against a
-- client-held anon/authenticated Storage session), and the pending/expired
-- cleanup job itself (this migration only adds the indexes it will need).
--
-- Security posture matches 20260811165757_create_quote_backend_foundation.sql
-- exactly: RLS enabled and FORCEd with zero anon/authenticated policies,
-- service_role gets only the minimum explicit GRANTs it needs (no DELETE),
-- and every new function pins search_path and is EXECUTE-revoked from
-- public before being EXECUTE-granted to service_role alone.

-- ---------------------------------------------------------------------------
-- A. Private Storage bucket
-- ---------------------------------------------------------------------------

-- Deliberately not an upsert: a pre-existing "lead-files" bucket with any
-- configuration other than exactly what this migration expects is treated
-- as a conflict and fails loudly, rather than being silently overwritten
-- (which could quietly widen an already-deployed bucket's MIME allowlist or
-- size limit). A bucket that already matches exactly is left untouched —
-- this makes the migration safe to re-run, without ever being a place that
-- redefines an existing bucket's security-relevant config.
do $$
declare
  existing storage.buckets%rowtype;
  expected_mime_types text[] := array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  expected_size_limit bigint := 8388608; -- 8 MiB, matches lead_files.byte_size's own cap
begin
  select * into existing from storage.buckets where id = 'lead-files';

  if not found then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('lead-files', 'lead-files', false, expected_size_limit, expected_mime_types);
  elsif existing.public is distinct from false
     or existing.file_size_limit is distinct from expected_size_limit
     or existing.allowed_mime_types is distinct from expected_mime_types
  then
    raise exception
      'storage bucket "lead-files" already exists with conflicting configuration '
      '(public=%, file_size_limit=%, allowed_mime_types=%) — refusing to silently overwrite it',
      existing.public, existing.file_size_limit, existing.allowed_mime_types;
  end if;
end;
$$;

-- No storage.objects policies are created here for anon/authenticated —
-- intentionally. Uploads happen exclusively via service_role-minted signed
-- upload URLs (createSignedUploadUrl, issued by the future server, never by
-- this migration), so the bucket needs no client-facing RLS policy at all;
-- adding one would be the wrong shape for this flow, not merely unnecessary.

-- ---------------------------------------------------------------------------
-- public.quote_upload_slots
-- ---------------------------------------------------------------------------

create table public.quote_upload_slots (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,

  -- Position within this lead's file selection (max 5 files, indices 0..4).
  -- Combined with the (lead_id, slot_index) unique constraint below, this is
  -- what makes "slot 6" and "duplicate slot 2" both structurally impossible.
  slot_index smallint not null check (slot_index between 0 and 4),

  -- Cross-checked against the owning lead's intent by the
  -- quote_upload_slots_kind_matches_lead_intent trigger below — a CHECK
  -- constraint alone cannot see another table's row, so this half only
  -- constrains the value set; the sell/buy correlation is enforced there.
  kind text not null check (kind in ('seller_photo', 'buyer_document')),

  -- Display metadata only — never a path component. Same guard shape as
  -- lead_files.original_filename: bounded length, no control characters, no
  -- path separators, so this can never be (mis)used as anything other than
  -- a name shown back to an owner later.
  original_filename text not null
    check (
      length(original_filename) between 1 and 255
      and original_filename !~ '[[:cntrl:]]'
      and strpos(original_filename, '/') = 0
      and strpos(original_filename, chr(92)) = 0
    ),

  -- Client-declared, pre-upload hint only — matches the bucket's own
  -- allowed_mime_types exactly (kept in sync by hand; a CHECK constraint
  -- cannot subquery storage.buckets). This is NOT the authority on what the
  -- uploaded bytes actually are — that's lead_files.detected_mime_type,
  -- written later from a server-side magic-number sniff after upload.
  declared_mime_type text not null
    check (declared_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  -- Client-declared, pre-upload hint only, 1 byte .. 8 MiB. Real enforcement
  -- of the actual uploaded size is the bucket's file_size_limit plus the
  -- later lead_files.byte_size check at verification time.
  declared_byte_size bigint not null check (declared_byte_size between 1 and 8388608),

  -- Unconditionally generated by quote_upload_slots_assign_storage_path
  -- below (same "trigger unconditionally overwrites, never a plain
  -- DEFAULT" pattern as leads.reference) — no client-supplied value, no
  -- filename, no extension ever becomes part of this path. Embeds lead_id
  -- and slot_index so the path is legible and provably tied to this exact
  -- slot, plus this row's own id for global uniqueness.
  storage_path text not null unique,

  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  -- Short-lived by design: an authorized slot that nothing ever uploads
  -- against must not stay valid indefinitely. The cleanup job (not part of
  -- this migration) sweeps rows past this timestamp still 'pending' into
  -- 'expired' using the partial index below.
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  -- Two-way tied to status below: set exactly when a slot leaves 'pending'
  -- (verified, failed, or expired), never before.
  completed_at timestamptz,

  -- Set exactly once, exactly when status transitions to 'verified', by the
  -- (not-yet-built) verification step that inserts the matching lead_files
  -- row after independently re-checking the uploaded object. Unique so two
  -- slots can never point at the same verified file.
  verified_file_id uuid unique references public.lead_files (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint quote_upload_slots_lead_slot_unique unique (lead_id, slot_index),

  constraint quote_upload_slots_completed_at_matches_status check (
    (status = 'pending' and completed_at is null)
    or (status in ('verified', 'failed', 'expired') and completed_at is not null)
  ),
  constraint quote_upload_slots_verified_file_requires_verified check (
    (status = 'verified' and verified_file_id is not null)
    or (status <> 'verified' and verified_file_id is null)
  ),
  -- Same rule as lead_files_pdf_requires_buyer_document — enforced here too
  -- since a slot's declared_mime_type is checked well before any actual
  -- file (and therefore before any lead_files row) exists.
  constraint quote_upload_slots_pdf_requires_buyer_document check (
    declared_mime_type <> 'application/pdf' or kind = 'buyer_document'
  ),
  -- A pre-authorized upload window must be bounded on both ends: strictly
  -- after created_at (an already-expired slot is meaningless) and never
  -- more than 30 minutes out (the default is 15 minutes; this is the outer
  -- ceiling, not the normal case). expires_at itself is immutable after
  -- insert (see quote_upload_slots_immutable_core below), so this only ever
  -- needs to hold at insert time — it cannot be widened later.
  constraint quote_upload_slots_expires_at_within_window check (
    expires_at > created_at
    and expires_at <= created_at + interval '30 minutes'
  )
);

alter table public.quote_upload_slots enable row level security;
alter table public.quote_upload_slots force row level security;

comment on table public.quote_upload_slots is
  'Server-authorized record of one intended file upload, created before the '
  'file exists in Storage and before any signed upload URL is issued. '
  'Verified (or expired/failed) by the future server-side completion step; '
  'never a place client-supplied paths or filenames are trusted directly.';
comment on column public.quote_upload_slots.storage_path is
  'Generated unconditionally by quote_upload_slots_assign_storage_path — '
  'never accepted from the caller, regardless of what an INSERT supplies.';

-- Cross-table correlation a CHECK constraint cannot express: a sell-intent
-- lead may only ever authorize seller_photo slots, a buy-intent lead only
-- buyer_document slots. Runs as invoker (service_role, which already holds
-- SELECT on public.leads) — no elevated privilege needed. Silently no-ops
-- (defers to the lead_id foreign key) when lead_id doesn't resolve to an
-- existing lead, so this never produces a confusing error ahead of the
-- foreign-key violation that already covers that case.
create or replace function public.quote_upload_slots_kind_matches_lead_intent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lead_intent text;
begin
  select intent into lead_intent from public.leads where id = new.lead_id;

  if lead_intent = 'sell' and new.kind <> 'seller_photo' then
    raise exception
      'quote_upload_slots: lead % has intent=sell, which requires kind=seller_photo (got %)',
      new.lead_id, new.kind;
  elsif lead_intent = 'buy' and new.kind <> 'buyer_document' then
    raise exception
      'quote_upload_slots: lead % has intent=buy, which requires kind=buyer_document (got %)',
      new.lead_id, new.kind;
  end if;

  return new;
end;
$$;

revoke execute on function public.quote_upload_slots_kind_matches_lead_intent() from public;
grant execute on function public.quote_upload_slots_kind_matches_lead_intent() to service_role;

-- Sole writer of storage_path, INSERT only. Derives a fresh path from
-- lead_id + this row's own id (already populated from the column DEFAULT by
-- the time a BEFORE ROW trigger sees NEW) and slot_index, discarding
-- whatever the caller supplied — there is deliberately no column DEFAULT on
-- storage_path itself, so an INSERT that explicitly lists the column still
-- gets overwritten (same reasoning as leads.reference). Post-insert
-- immutability of storage_path (and every other authorization/identity
-- field) is enforced separately by quote_upload_slots_immutable_core below,
-- so this function has no UPDATE-time responsibility at all.
create or replace function public.quote_upload_slots_assign_storage_path()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.storage_path := 'leads/' || new.lead_id::text || '/slot-' || new.slot_index::text || '-' || new.id::text;
  return new;
end;
$$;

revoke execute on function public.quote_upload_slots_assign_storage_path() from public;
grant execute on function public.quote_upload_slots_assign_storage_path() to service_role;

-- Mirrors leads_prevent_immutable_field_changes: once a slot is created,
-- every field that identifies WHAT was authorized (lead, slot position,
-- kind, filename, declared MIME/size, the generated storage_path, and the
-- creation/expiry timestamps) is fixed. Only the lifecycle fields the
-- verification step actually needs to write — status, completed_at,
-- verified_file_id, updated_at — may change after insert.
create or replace function public.quote_upload_slots_prevent_immutable_field_changes()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.lead_id is distinct from old.lead_id
    or new.slot_index is distinct from old.slot_index
    or new.kind is distinct from old.kind
    or new.original_filename is distinct from old.original_filename
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.declared_byte_size is distinct from old.declared_byte_size
    or new.storage_path is distinct from old.storage_path
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception
      'quote_upload_slots: id, lead_id, slot_index, kind, original_filename, '
      'declared_mime_type, declared_byte_size, storage_path, created_at and '
      'expires_at are immutable after insert';
  end if;
  return new;
end;
$$;

revoke execute on function public.quote_upload_slots_prevent_immutable_field_changes() from public;
grant execute on function public.quote_upload_slots_prevent_immutable_field_changes() to service_role;

-- Ownership consistency for the verification hand-off: a slot may only be
-- marked verified against a lead_files row that actually belongs to it —
-- same lead, same kind, same storage_path (the file was uploaded to
-- exactly the path this slot pre-authorized). Without this, a compromised
-- or buggy server call could point one lead's slot at another lead's
-- already-uploaded file (or the right lead but the wrong kind/path) and
-- have it accepted as "verified". Runs as invoker (service_role, which
-- already holds SELECT on public.lead_files) — no elevated privilege
-- needed. A no-op whenever verified_file_id is null, so ordinary
-- pending/failed/expired transitions are unaffected.
create or replace function public.quote_upload_slots_verified_file_matches_slot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  file_row public.lead_files%rowtype;
begin
  if new.verified_file_id is null then
    return new;
  end if;

  select * into file_row from public.lead_files where id = new.verified_file_id;

  if not found then
    raise exception 'quote_upload_slots: verified_file_id % does not reference an existing lead_files row', new.verified_file_id;
  end if;

  if file_row.lead_id is distinct from new.lead_id
    or file_row.kind is distinct from new.kind
    or file_row.storage_path is distinct from new.storage_path
  then
    raise exception
      'quote_upload_slots: verified_file_id % (lead_id=%, kind=%, storage_path=%) '
      'does not match this slot (lead_id=%, kind=%, storage_path=%)',
      new.verified_file_id, file_row.lead_id, file_row.kind, file_row.storage_path,
      new.lead_id, new.kind, new.storage_path;
  end if;

  return new;
end;
$$;

revoke execute on function public.quote_upload_slots_verified_file_matches_slot() from public;
grant execute on function public.quote_upload_slots_verified_file_matches_slot() to service_role;

create trigger quote_upload_slots_kind_matches_lead_intent
  before insert or update of lead_id, kind on public.quote_upload_slots
  for each row
  execute function public.quote_upload_slots_kind_matches_lead_intent();

create trigger quote_upload_slots_assign_storage_path
  before insert on public.quote_upload_slots
  for each row
  execute function public.quote_upload_slots_assign_storage_path();

-- Runs before quote_upload_slots_kind_matches_lead_intent/
-- quote_upload_slots_verified_file_matches_slot in trigger-name order on
-- UPDATE (fires first alphabetically), so a forbidden field change is
-- rejected before any other UPDATE-time trigger does its own work —
-- immaterial to correctness (any one of them aborting the statement is
-- sufficient), just the actual firing order.
create trigger quote_upload_slots_immutable_core
  before update on public.quote_upload_slots
  for each row
  execute function public.quote_upload_slots_prevent_immutable_field_changes();

create trigger quote_upload_slots_verified_file_matches_slot
  before insert or update of verified_file_id on public.quote_upload_slots
  for each row
  execute function public.quote_upload_slots_verified_file_matches_slot();

create trigger quote_upload_slots_set_updated_at
  before update on public.quote_upload_slots
  for each row
  execute function public.set_updated_at();

revoke all on public.quote_upload_slots from public, anon, authenticated;
grant select, insert, update on public.quote_upload_slots to service_role;
-- No delete grant — an expired/failed slot is retained (status says why),
-- matching the "no hard-delete workflow" posture of every other table in
-- this schema. Cascades away automatically if the owning lead is deleted.

create index quote_upload_slots_lead_id_idx on public.quote_upload_slots (lead_id);
create index quote_upload_slots_status_idx on public.quote_upload_slots (status);
-- The cleanup job's actual query shape: "pending slots whose window has
-- passed" — a partial index keyed on exactly that predicate.
create index quote_upload_slots_pending_expiry_idx on public.quote_upload_slots (expires_at)
  where status = 'pending';
