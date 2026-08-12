-- MSM Scrap — Quote backend CHECKPOINT C2B1: exclusive upload claim/lease
-- lifecycle for Quote files.
--
-- Scope: extends public.quote_upload_slots with an 'uploading' status plus
-- upload_attempt_id/upload_started_at lease columns, and adds three
-- functions: public.claim_quote_upload_v1 (exclusively claim or reclaim a
-- slot before proxying bytes to Storage), public.finalize_quote_upload_v2
-- (finalize, but only against a currently-held claim — supersedes v1 as
-- the only service_role-executable finalization path), and
-- public.release_quote_upload_claim_v1 (a crashed/failed upload's
-- controlled recovery path back to pending, or forward to failed/expired).
-- Explicitly NOT in scope: any HTTP route, any Storage object read/write,
-- and any TypeScript/frontend change.
--
-- Why a claim step at all: two concurrent requests must never be able to
-- proxy/finalize different bytes for the same slot, and a request that
-- crashes mid-upload must not permanently strand the slot. A lease
-- (upload_started_at + a 5-minute staleness threshold, checked in
-- claim_quote_upload_v1) gives every claim a bounded lifetime independent
-- of whether the client that took it ever comes back.
--
-- Cross-system fencing: attempt-id fencing at the database layer alone is
-- not enough. quote_upload_slots.storage_path is fixed at slot creation
-- and never changes across reclaims, so a stale attempt and the attempt
-- that reclaimed its slot would otherwise still target the exact same
-- Storage object — the database could tell the two attempts apart, but
-- Storage itself could not. upload_object_path closes this gap: every
-- fresh claim AND every reclaim mints a brand-new, attempt-scoped path
-- (embedding the new attempt id), so a stale attempt's writes physically
-- cannot land on the same object the current attempt uses, and
-- lead_files.storage_path is populated from that exact attempt-scoped
-- path — never from the original, merely-namespacing storage_path column.
--
-- Compatibility with the existing finalize_quote_upload_v1 (CHECKPOINT
-- C2A): its own pgTAP suite (20260812182525_finalize_quote_upload_rpc_test.sql)
-- calls it directly and is intentionally left unedited except for the one
-- structural privilege assertion updated alongside this migration — see
-- that file's own comment. Those direct calls keep working here because
-- they run as the function's owner (the migration-applying role), which
-- retains implicit EXECUTE on functions it owns regardless of REVOKE;
-- REVOKE only ever affects other roles. What genuinely changes is that
-- service_role (the only role application code runs as) can no longer
-- reach v1 at all — v2 is the only finalization path service_role has.
-- v1 itself is minimally updated (see below) so it keeps producing rows
-- that satisfy the new stricter lifecycle constraints — not because v1 is
-- still a supported application path, but so the existing regression
-- suite continues to exercise real, constraint-valid behavior rather than
-- silently drifting out of sync with the schema it was written against.

-- ---------------------------------------------------------------------------
-- A. Extend the quote_upload_slots lifecycle
-- ---------------------------------------------------------------------------

alter table public.quote_upload_slots
  add column upload_attempt_id uuid,
  add column upload_started_at timestamptz,
  add column upload_object_path text;

comment on column public.quote_upload_slots.upload_attempt_id is
  'Server-generated lease token for one exclusive claim on this slot, '
  'minted by claim_quote_upload_v1. Rotates on reclaim; retained (not '
  'cleared) once the slot reaches verified. Never accepted from a caller.';
comment on column public.quote_upload_slots.upload_started_at is
  'When the current (or, once verified, the winning) claim was taken. '
  'claim_quote_upload_v1 treats a claim older than 5 minutes as stale and '
  'reclaimable, independent of the slot''s own expires_at.';
comment on column public.quote_upload_slots.upload_object_path is
  'The actual Storage object path for the CURRENT (or, once verified, the '
  'winning) attempt — built only from UUID components '
  '(quote-uploads/<lead-id>/<slot-id>/<attempt-id>), never from '
  'storage_path directly and never accepted from a caller. Rotates in '
  'lockstep with upload_attempt_id on every fresh claim or reclaim, which '
  'is what makes a stale attempt''s writes land on a different object than '
  'the current attempt''s — storage_path alone could not guarantee that. '
  'This, not storage_path, is what finalize_quote_upload_v2 writes into '
  'lead_files.storage_path.';

-- status: add 'uploading' between pending and verified. The
-- migration-authoring role owns this constraint just like every other
-- object here, so a plain DROP + re-ADD (not ALTER ... VALIDATE tricks) is
-- the same pattern already used throughout this schema.
alter table public.quote_upload_slots drop constraint quote_upload_slots_status_check;
alter table public.quote_upload_slots add constraint quote_upload_slots_status_check
  check (status in ('pending', 'uploading', 'verified', 'failed', 'expired'));

-- completed_at: 'uploading' joins 'pending' on the "must be null" side —
-- an in-progress upload has not completed by definition, whether it's a
-- fresh claim or a reclaimed one.
alter table public.quote_upload_slots drop constraint quote_upload_slots_completed_at_matches_status;
alter table public.quote_upload_slots add constraint quote_upload_slots_completed_at_matches_status check (
  (status in ('pending', 'uploading') and completed_at is null)
  or (status in ('verified', 'failed', 'expired') and completed_at is not null)
);

-- upload_attempt_id / upload_started_at / upload_object_path, exactly per
-- status:
--   pending             -> all three null (no claim has ever been taken)
--   uploading, verified -> all three required (a claim was taken and, for
--                          verified, is retained as the record of who won)
--   failed, expired     -> unconstrained either way: a slot can fail/expire
--                          having been claimed at least once (the normal
--                          case — retains the attempt that led to failure/
--                          expiry) or, in principle, never claimed at all.
-- This is the constraint that makes "verified status without attempt
-- metadata (including upload_object_path)" structurally impossible — not
-- application discipline.
alter table public.quote_upload_slots add constraint quote_upload_slots_attempt_matches_status check (
  (status = 'pending' and upload_attempt_id is null and upload_started_at is null and upload_object_path is null)
  or (
    status in ('uploading', 'verified')
    and upload_attempt_id is not null and upload_started_at is not null and upload_object_path is not null
  )
  or (status in ('failed', 'expired'))
);

-- upload_object_path is the real Storage object identity for the current
-- attempt — it must be as globally unique as storage_path itself (NULLs
-- are unrestricted by a UNIQUE index, so pending/failed/expired rows with
-- a null or merely-retained value never conflict).
alter table public.quote_upload_slots add constraint quote_upload_slots_upload_object_path_key unique (upload_object_path);

-- quote_upload_slots_verified_file_requires_verified (status='verified' <=>
-- verified_file_id not null) already covers 'uploading' correctly via its
-- own "status <> 'verified'" branch — no change needed.
--
-- quote_upload_slots_prevent_immutable_field_changes already only guards
-- id/lead_id/slot_index/kind/original_filename/declared_mime_type/
-- declared_byte_size/storage_path/created_at/expires_at — the three new
-- columns are lifecycle fields (like status/completed_at/verified_file_id)
-- and are correctly left mutable by that trigger without any change to it.

create index quote_upload_slots_uploading_lease_idx on public.quote_upload_slots (upload_started_at)
  where status = 'uploading';

-- quote_upload_slots_verified_file_matches_slot (from CHECKPOINT A/B) must
-- be updated here: lead_files.storage_path is now populated from the
-- slot's upload_object_path (see finalize_quote_upload_v2 below), not its
-- storage_path, so the ownership-match check has to compare against the
-- same column finalize_quote_upload_v2 actually writes from. This is a
-- CREATE OR REPLACE within THIS migration, exactly like
-- finalize_quote_upload_v1 below — the function's original definition
-- (CHECKPOINT A) is unmodified; this is a normal, later, additive
-- redefinition of it.
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
    or file_row.storage_path is distinct from new.upload_object_path
  then
    raise exception
      'quote_upload_slots: verified_file_id % (lead_id=%, kind=%, storage_path=%) '
      'does not match this slot (lead_id=%, kind=%, upload_object_path=%)',
      new.verified_file_id, file_row.lead_id, file_row.kind, file_row.storage_path,
      new.lead_id, new.kind, new.upload_object_path;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. finalize_quote_upload_v1 — minimal compatibility update, not a
--    behavioral change
-- ---------------------------------------------------------------------------

-- Only two things change from the CHECKPOINT C2A version: a synthetic
-- attempt (including upload_object_path = storage_path — v1 has no
-- separate attempt-scoped path concept, so its "object path" is simply
-- its one and only path) is generated immediately before the
-- verified-transition UPDATE (so the resulting row satisfies
-- quote_upload_slots_attempt_matches_status), and that UPDATE now sets
-- the three new columns. Every validation branch, the atomicity
-- structure, the replay behavior and the return shape are byte-for-byte
-- unchanged.
create or replace function public.finalize_quote_upload_v1(
  p_slot_id uuid,
  p_idempotency_key uuid,
  p_detected_mime_type text,
  p_byte_size bigint,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_slot public.quote_upload_slots%rowtype;
  v_existing_file public.lead_files%rowtype;
  v_new_file_id uuid;
  v_completed_at timestamptz;
  v_synthetic_attempt_id uuid;
  v_synthetic_started_at timestamptz;
begin
  if p_detected_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'finalize_quote_upload_v1: detected_mime_type is not a supported type';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 8388608 then
    raise exception 'finalize_quote_upload_v1: byte_size must be between 1 and 8388608';
  end if;
  if p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'finalize_quote_upload_v1: checksum_sha256 must be a 64-character lowercase hex SHA-256 digest';
  end if;

  select qus.* into v_slot
  from public.quote_upload_slots qus
  join public.leads l on l.id = qus.lead_id
  where qus.id = p_slot_id and l.idempotency_key = p_idempotency_key
  for update of qus;

  if not found then
    raise exception 'finalize_quote_upload_v1: upload slot not found for the supplied idempotency key';
  end if;

  if v_slot.status = 'verified' then
    select * into v_existing_file from public.lead_files where id = v_slot.verified_file_id;

    if v_existing_file.detected_mime_type is distinct from p_detected_mime_type
      or v_existing_file.byte_size is distinct from p_byte_size
      or v_existing_file.checksum_sha256 is distinct from p_checksum_sha256
    then
      raise exception 'finalize_quote_upload_v1: this slot was already finalized with different file metadata';
    end if;

    return jsonb_build_object(
      'lead_file_id', v_existing_file.id,
      'slot_id', v_slot.id,
      'lead_id', v_slot.lead_id,
      'kind', v_slot.kind,
      'storage_path', v_slot.storage_path,
      'detected_mime_type', v_existing_file.detected_mime_type,
      'byte_size', v_existing_file.byte_size,
      'checksum', v_existing_file.checksum_sha256,
      'verified_at', v_slot.completed_at
    );
  end if;

  if v_slot.status <> 'pending' then
    raise exception 'finalize_quote_upload_v1: upload slot has status % and can no longer be finalized', v_slot.status;
  end if;

  if now() >= v_slot.expires_at then
    raise exception 'finalize_quote_upload_v1: upload slot has expired';
  end if;

  if p_detected_mime_type is distinct from v_slot.declared_mime_type then
    raise exception 'finalize_quote_upload_v1: detected_mime_type does not match this slot''s declared type';
  end if;
  if p_byte_size is distinct from v_slot.declared_byte_size then
    raise exception 'finalize_quote_upload_v1: byte_size does not match this slot''s declared size';
  end if;

  insert into public.lead_files (
    lead_id, kind, storage_path, original_filename,
    detected_mime_type, byte_size, checksum_sha256,
    upload_status, uploaded_at
  )
  values (
    v_slot.lead_id, v_slot.kind, v_slot.storage_path, v_slot.original_filename,
    p_detected_mime_type, p_byte_size, p_checksum_sha256,
    'complete', now()
  )
  returning id into v_new_file_id;

  v_completed_at := now();
  -- Synthesized solely so this row satisfies
  -- quote_upload_slots_attempt_matches_status — v1 never had a real claim
  -- step, so there is no genuine attempt to preserve here, only one to
  -- manufacture so the constraint (correctly) cannot tell the difference.
  -- upload_object_path is set equal to storage_path (not a fresh
  -- quote-uploads/... path) — v1's whole point is exact backward parity
  -- with its original CHECKPOINT C2A behavior, which only ever knew about
  -- storage_path.
  v_synthetic_attempt_id := gen_random_uuid();
  v_synthetic_started_at := v_completed_at;

  update public.quote_upload_slots
  set status = 'verified', completed_at = v_completed_at, verified_file_id = v_new_file_id,
      upload_attempt_id = v_synthetic_attempt_id, upload_started_at = v_synthetic_started_at,
      upload_object_path = v_slot.storage_path
  where id = v_slot.id;

  return jsonb_build_object(
    'lead_file_id', v_new_file_id,
    'slot_id', v_slot.id,
    'lead_id', v_slot.lead_id,
    'kind', v_slot.kind,
    'storage_path', v_slot.storage_path,
    'detected_mime_type', p_detected_mime_type,
    'byte_size', p_byte_size,
    'checksum', p_checksum_sha256,
    'verified_at', v_completed_at
  );
end;
$$;

-- service_role loses EXECUTE entirely: v2 (below) is now the only
-- finalization path application code can reach. v1's EXECUTE was never
-- granted to public/anon/authenticated in the first place (C2A), so this
-- is the only grant that needs revoking. The function owner (whichever
-- role applies migrations) is unaffected by this REVOKE — ownership
-- always implies EXECUTE, independent of any GRANT/REVOKE — which is
-- exactly why the existing v1 pgTAP suite's direct calls keep working.
revoke execute on function public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text) from service_role;

-- ---------------------------------------------------------------------------
-- C. claim_quote_upload_v1
-- ---------------------------------------------------------------------------

create or replace function public.claim_quote_upload_v1(
  p_slot_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_slot public.quote_upload_slots%rowtype;
  v_reclaimed boolean := false;
  v_new_attempt_id uuid;
  v_new_object_path text;
  v_stale_object_path text;
  v_now timestamptz := now();
begin
  -- Same "possession proof via join, identical not-found outcome either
  -- way" pattern as finalize_quote_upload_v1/v2 — see those functions'
  -- own comments for the full reasoning.
  select qus.* into v_slot
  from public.quote_upload_slots qus
  join public.leads l on l.id = qus.lead_id
  where qus.id = p_slot_id and l.idempotency_key = p_idempotency_key
  for update of qus;

  if not found then
    raise exception 'claim_quote_upload_v1: upload slot not found for the supplied idempotency key';
  end if;

  -- Already verified: report the winning claim's identity and this slot's
  -- safe metadata, but never mutate an already-completed slot.
  if v_slot.status = 'verified' then
    return jsonb_build_object(
      'slot_id', v_slot.id,
      'lead_id', v_slot.lead_id,
      'attempt_id', v_slot.upload_attempt_id,
      'state', v_slot.status,
      'reclaimed', false,
      'kind', v_slot.kind,
      'storage_path', v_slot.storage_path,
      'upload_object_path', v_slot.upload_object_path,
      'stale_object_path', null,
      'original_filename', v_slot.original_filename,
      'declared_mime_type', v_slot.declared_mime_type,
      'declared_byte_size', v_slot.declared_byte_size,
      'expires_at', v_slot.expires_at
    );
  end if;

  if v_slot.status in ('failed', 'expired') then
    raise exception 'claim_quote_upload_v1: upload slot has status % and cannot be claimed', v_slot.status;
  end if;

  -- status is now guaranteed to be 'pending' or 'uploading'. The slot's
  -- own expiry window is the outer bound for either: a pending slot past
  -- expires_at was never claimed in time, and an uploading slot past
  -- expires_at is not eligible for reclaim regardless of lease age.
  if v_now >= v_slot.expires_at then
    raise exception 'claim_quote_upload_v1: upload slot has expired';
  end if;

  v_stale_object_path := null;

  if v_slot.status = 'uploading' then
    if v_now - v_slot.upload_started_at < interval '5 minutes' then
      raise exception 'claim_quote_upload_v1: upload is already in progress for this slot (UPLOAD_IN_PROGRESS)';
    end if;
    -- Lease is stale (>= 5 minutes old) and the overall slot has not
    -- expired: the previous claimant is presumed dead (crashed request,
    -- dropped connection, abandoned tab) and this call may take over.
    -- The path it was (or wasn't) writing to is reported back as
    -- stale_object_path so a later cleanup job can check Storage for an
    -- orphaned partial object at that exact path.
    v_reclaimed := true;
    v_stale_object_path := v_slot.upload_object_path;
  end if;

  v_new_attempt_id := gen_random_uuid();
  -- Built only from UUID components (lead id, slot id, the brand-new
  -- attempt id) plus fixed literal segments — never from storage_path,
  -- slot_index, kind or anything else. Rotating this on every fresh claim
  -- AND every reclaim is what physically fences a stale attempt's writes
  -- away from the current attempt's object, independent of the database
  -- layer's own attempt-id fencing.
  v_new_object_path := 'quote-uploads/' || v_slot.lead_id::text || '/' || v_slot.id::text || '/' || v_new_attempt_id::text;

  update public.quote_upload_slots
  set status = 'uploading', upload_attempt_id = v_new_attempt_id, upload_started_at = v_now,
      upload_object_path = v_new_object_path
  where id = v_slot.id
  returning * into v_slot;

  return jsonb_build_object(
    'slot_id', v_slot.id,
    'lead_id', v_slot.lead_id,
    'attempt_id', v_slot.upload_attempt_id,
    'state', v_slot.status,
    'reclaimed', v_reclaimed,
    'kind', v_slot.kind,
    'storage_path', v_slot.storage_path,
    'upload_object_path', v_slot.upload_object_path,
    'stale_object_path', v_stale_object_path,
    'original_filename', v_slot.original_filename,
    'declared_mime_type', v_slot.declared_mime_type,
    'declared_byte_size', v_slot.declared_byte_size,
    'expires_at', v_slot.expires_at
  );
end;
$$;

revoke execute on function public.claim_quote_upload_v1(uuid, uuid) from public;
grant execute on function public.claim_quote_upload_v1(uuid, uuid) to service_role;

comment on function public.claim_quote_upload_v1(uuid, uuid) is
  'Exclusively claims (or reclaims, after a 5-minute stale lease) one '
  'quote_upload_slots row before any bytes are proxied to Storage, '
  'rotating both upload_attempt_id and upload_object_path on every fresh '
  'claim or reclaim so a stale attempt''s Storage writes can never land on '
  'the current attempt''s object. SECURITY INVOKER — no privileges beyond '
  'service_role''s own existing grants. Never touches Storage.';

-- ---------------------------------------------------------------------------
-- D. finalize_quote_upload_v2
-- ---------------------------------------------------------------------------

create or replace function public.finalize_quote_upload_v2(
  p_slot_id uuid,
  p_idempotency_key uuid,
  p_upload_attempt_id uuid,
  p_detected_mime_type text,
  p_byte_size bigint,
  p_checksum_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_slot public.quote_upload_slots%rowtype;
  v_existing_file public.lead_files%rowtype;
  v_new_file_id uuid;
  v_completed_at timestamptz;
begin
  if p_detected_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'finalize_quote_upload_v2: detected_mime_type is not a supported type';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 8388608 then
    raise exception 'finalize_quote_upload_v2: byte_size must be between 1 and 8388608';
  end if;
  if p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'finalize_quote_upload_v2: checksum_sha256 must be a 64-character lowercase hex SHA-256 digest';
  end if;

  select qus.* into v_slot
  from public.quote_upload_slots qus
  join public.leads l on l.id = qus.lead_id
  where qus.id = p_slot_id and l.idempotency_key = p_idempotency_key
  for update of qus;

  if not found then
    raise exception 'finalize_quote_upload_v2: upload slot not found for the supplied idempotency key';
  end if;

  -- Idempotent replay: also re-checks upload_attempt_id, not just file
  -- metadata — a caller quoting the wrong (e.g. superseded-by-reclaim)
  -- attempt id against an already-verified slot is treated the same as
  -- any other metadata mismatch, not silently accepted.
  if v_slot.status = 'verified' then
    select * into v_existing_file from public.lead_files where id = v_slot.verified_file_id;

    if v_slot.upload_attempt_id is distinct from p_upload_attempt_id
      or v_existing_file.detected_mime_type is distinct from p_detected_mime_type
      or v_existing_file.byte_size is distinct from p_byte_size
      or v_existing_file.checksum_sha256 is distinct from p_checksum_sha256
    then
      raise exception 'finalize_quote_upload_v2: this slot was already finalized with different metadata or attempt';
    end if;

    return jsonb_build_object(
      'lead_file_id', v_existing_file.id,
      'slot_id', v_slot.id,
      'lead_id', v_slot.lead_id,
      'kind', v_slot.kind,
      'storage_path', v_existing_file.storage_path,
      'detected_mime_type', v_existing_file.detected_mime_type,
      'byte_size', v_existing_file.byte_size,
      'checksum', v_existing_file.checksum_sha256,
      'verified_at', v_slot.completed_at
    );
  end if;

  -- First-time finalization requires an actual held claim: status must be
  -- 'uploading' (never 'pending' — that is precisely what
  -- claim_quote_upload_v1 exists to close off) and the caller's attempt id
  -- must match the slot's current one. A stale/reclaimed attempt id fails
  -- here exactly like a slot the caller never claimed at all.
  if v_slot.status <> 'uploading' then
    raise exception 'finalize_quote_upload_v2: upload slot has status % and cannot be finalized', v_slot.status;
  end if;
  if v_slot.upload_attempt_id is distinct from p_upload_attempt_id then
    raise exception 'finalize_quote_upload_v2: upload_attempt_id does not match this slot''s active claim';
  end if;

  if now() >= v_slot.expires_at then
    raise exception 'finalize_quote_upload_v2: upload slot has expired';
  end if;

  if p_detected_mime_type is distinct from v_slot.declared_mime_type then
    raise exception 'finalize_quote_upload_v2: detected_mime_type does not match this slot''s declared type';
  end if;
  if p_byte_size is distinct from v_slot.declared_byte_size then
    raise exception 'finalize_quote_upload_v2: byte_size does not match this slot''s declared size';
  end if;

  -- The one place lead_files.storage_path is decided: the LOCKED slot's
  -- own upload_object_path — the exact path this attempt's bytes were
  -- actually proxied to — never storage_path (which is now only a stable
  -- per-slot namespace, not a real object location) and never anything
  -- resembling a caller-supplied path parameter, because this function's
  -- signature has no such parameter at all.
  insert into public.lead_files (
    lead_id, kind, storage_path, original_filename,
    detected_mime_type, byte_size, checksum_sha256,
    upload_status, uploaded_at
  )
  values (
    v_slot.lead_id, v_slot.kind, v_slot.upload_object_path, v_slot.original_filename,
    p_detected_mime_type, p_byte_size, p_checksum_sha256,
    'complete', now()
  )
  returning id into v_new_file_id;

  v_completed_at := now();

  -- upload_attempt_id/upload_started_at/upload_object_path are
  -- deliberately absent from this UPDATE's SET list — they already hold
  -- the real claim's values from claim_quote_upload_v1 and are retained
  -- unchanged, which is exactly what "V2 retains attempt metadata after
  -- verification" means.
  update public.quote_upload_slots
  set status = 'verified', completed_at = v_completed_at, verified_file_id = v_new_file_id
  where id = v_slot.id;

  return jsonb_build_object(
    'lead_file_id', v_new_file_id,
    'slot_id', v_slot.id,
    'lead_id', v_slot.lead_id,
    'kind', v_slot.kind,
    'storage_path', v_slot.upload_object_path,
    'detected_mime_type', p_detected_mime_type,
    'byte_size', p_byte_size,
    'checksum', p_checksum_sha256,
    'verified_at', v_completed_at
  );
end;
$$;

revoke execute on function public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text) from public;
grant execute on function public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text) to service_role;

comment on function public.finalize_quote_upload_v2(uuid, uuid, uuid, text, bigint, text) is
  'The only finalization RPC service_role may execute after CHECKPOINT '
  'C2B1 (finalize_quote_upload_v1''s EXECUTE was revoked from service_role '
  'in this same migration). Requires a currently-held claim '
  '(status=uploading, matching upload_attempt_id from '
  'claim_quote_upload_v1) rather than v1''s bare status=pending, and takes '
  'lead_files.storage_path from the locked slot''s own upload_object_path '
  '(never from storage_path, and never from any caller-supplied path — '
  'this function has no such parameter). SECURITY INVOKER, atomic, '
  'idempotent on matching replay. Never touches Storage.';

-- ---------------------------------------------------------------------------
-- E. release_quote_upload_claim_v1
-- ---------------------------------------------------------------------------

create or replace function public.release_quote_upload_claim_v1(
  p_slot_id uuid,
  p_idempotency_key uuid,
  p_upload_attempt_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_slot public.quote_upload_slots%rowtype;
  v_new_status text;
  v_completed_at timestamptz;
begin
  if p_outcome not in ('retry', 'cleanup_required') then
    raise exception 'release_quote_upload_claim_v1: outcome must be ''retry'' or ''cleanup_required''';
  end if;

  select qus.* into v_slot
  from public.quote_upload_slots qus
  join public.leads l on l.id = qus.lead_id
  where qus.id = p_slot_id and l.idempotency_key = p_idempotency_key
  for update of qus;

  if not found then
    raise exception 'release_quote_upload_claim_v1: upload slot not found for the supplied idempotency key';
  end if;

  -- A verified slot's file already exists and is durable — this function
  -- must never be able to undo that, regardless of what the caller claims
  -- its attempt id is.
  if v_slot.status = 'verified' then
    raise exception 'release_quote_upload_claim_v1: a verified slot can never be released or downgraded';
  end if;

  -- Possession of the CURRENT active claim is required, not merely
  -- possession of the lead (already proven by the join above): a stale or
  -- otherwise-wrong attempt id — including one superseded by a reclaim —
  -- cannot release someone else's active claim, and there is nothing to
  -- release on a slot that was never claimed (still pending) or has
  -- already reached a terminal non-verified state (failed/expired).
  if v_slot.status <> 'uploading' or v_slot.upload_attempt_id is distinct from p_upload_attempt_id then
    raise exception 'release_quote_upload_claim_v1: no matching active claim to release for this slot';
  end if;

  if p_outcome = 'cleanup_required' then
    -- Attempt metadata, upload_object_path and storage_path are all left
    -- untouched (this UPDATE never lists them), so a later out-of-band
    -- cleanup job can still locate whatever partial object this attempt
    -- may have written, at the exact path it would have written to.
    v_new_status := 'failed';
    v_completed_at := now();
    update public.quote_upload_slots
    set status = v_new_status, completed_at = v_completed_at
    where id = v_slot.id;
  elsif now() >= v_slot.expires_at then
    -- Asked for a retry, but the slot's own window has already run out —
    -- there is no valid "pending" to return to. Attempt metadata and
    -- upload_object_path are retained here too, for the same cleanup
    -- reason as above.
    v_new_status := 'expired';
    v_completed_at := now();
    update public.quote_upload_slots
    set status = v_new_status, completed_at = v_completed_at
    where id = v_slot.id;
  else
    v_new_status := 'pending';
    v_completed_at := null;
    update public.quote_upload_slots
    set status = v_new_status, upload_attempt_id = null, upload_started_at = null, upload_object_path = null
    where id = v_slot.id;
  end if;

  return jsonb_build_object(
    'slot_id', v_slot.id,
    'lead_id', v_slot.lead_id,
    'status', v_new_status,
    'completed_at', v_completed_at
  );
end;
$$;

revoke execute on function public.release_quote_upload_claim_v1(uuid, uuid, uuid, text) from public;
grant execute on function public.release_quote_upload_claim_v1(uuid, uuid, uuid, text) to service_role;

comment on function public.release_quote_upload_claim_v1(uuid, uuid, uuid, text) is
  'Controlled recovery path for one held claim: ''retry'' returns the slot '
  'to pending, clearing upload_attempt_id/upload_started_at/'
  'upload_object_path (or to expired, retaining them, if its window '
  'already ran out); ''cleanup_required'' marks it failed while retaining '
  'all three for an out-of-band Storage cleanup job to locate the exact '
  'object path this attempt may have written to. Never downgrades a '
  'verified slot; a stale or wrong attempt id cannot release another '
  'request''s active claim. SECURITY INVOKER. Never touches Storage.';
