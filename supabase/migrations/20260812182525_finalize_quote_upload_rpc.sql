-- MSM Scrap — Quote backend CHECKPOINT C2A: atomic upload finalization RPC.
--
-- Scope: exactly one function, public.finalize_quote_upload_v1, that turns
-- one server-verified file (bytes already inspected off-DB — see
-- src/server/quote/inspect-upload.ts — and never touched here) into a
-- durable public.lead_files row and a 'verified' public.quote_upload_slots
-- row, atomically: both happen or neither does. Explicitly NOT in scope:
-- any HTTP route, any Storage object read/write (this function never calls
-- anything in the storage schema — the actual file bytes are proxied and
-- written to Storage entirely outside SQL, by the future C2B server route,
-- strictly before this function is ever called), and signed upload URLs
-- (the architecture decision documented in the C2B planning note is to
-- proxy bytes through the MSM server instead of createSignedUploadUrl,
-- specifically because a 2-hour signed URL would outlive this table's own
-- 15-minute quote_upload_slots.expires_at window).
--
-- Security posture matches the two prior migrations exactly: SECURITY
-- INVOKER (relies entirely on service_role's own existing grants — no new
-- table GRANT is needed, service_role already holds SELECT/INSERT on
-- lead_files and SELECT/UPDATE on quote_upload_slots), fixed search_path,
-- EXECUTE revoked from public before being granted to service_role alone.
--
-- Concurrency posture is deliberately different from create_website_quote_v1
-- (CHECKPOINT B): that function inserts a brand-new leads row and so races
-- on a UNIQUE constraint (insert-then-catch-unique_violation). This
-- function instead updates one specific, already-existing
-- quote_upload_slots row, so `select ... for update` — pessimistic row
-- locking — is the correct primitive: two concurrent finalize calls for
-- the same slot serialize on that lock, and the second one to acquire it
-- sees the first one's committed 'verified' status and is handled by the
-- same idempotent-replay branch a genuine retry uses.

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
begin
  -- ---------------------------------------------------------------------
  -- 1. Shape validation of the caller's claimed inspection result — checked
  --    explicitly here (not left solely to lead_files' own CHECK
  --    constraints) because the idempotent-replay branch below never
  --    reaches that INSERT, and malformed input must still be rejected on
  --    every path, including replay.
  -- ---------------------------------------------------------------------
  if p_detected_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'finalize_quote_upload_v1: detected_mime_type is not a supported type';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 8388608 then
    raise exception 'finalize_quote_upload_v1: byte_size must be between 1 and 8388608';
  end if;
  if p_checksum_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'finalize_quote_upload_v1: checksum_sha256 must be a 64-character lowercase hex SHA-256 digest';
  end if;

  -- ---------------------------------------------------------------------
  -- 2. Lock the slot and prove possession in one step: the row is only
  --    ever found when p_slot_id resolves to a quote_upload_slots row
  --    AND that row's lead has idempotency_key = p_idempotency_key. A
  --    slot that exists but belongs to a different lead produces the
  --    exact same "not found" outcome as a slot that doesn't exist at
  --    all — never a different error, so a caller can never learn
  --    whether some other lead's slot exists from the response shape.
  --    `for update of qus` locks only the slot row, not the joined leads
  --    row (which nothing here mutates).
  -- ---------------------------------------------------------------------
  select qus.* into v_slot
  from public.quote_upload_slots qus
  join public.leads l on l.id = qus.lead_id
  where qus.id = p_slot_id and l.idempotency_key = p_idempotency_key
  for update of qus;

  if not found then
    raise exception 'finalize_quote_upload_v1: upload slot not found for the supplied idempotency key';
  end if;

  -- ---------------------------------------------------------------------
  -- 3. Idempotent replay: a slot already finalized returns the same
  --    result again (matching metadata) or fails loudly (metadata that
  --    doesn't match what was actually recorded) — never re-verifies,
  --    never inserts a second lead_files row.
  -- ---------------------------------------------------------------------
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

  -- now() is the transaction timestamp, the same value quote_upload_slots'
  -- own expires_at DEFAULT was computed from — comparing against it here
  -- is apples to apples, not a second, independently-drifting clock read.
  if now() >= v_slot.expires_at then
    raise exception 'finalize_quote_upload_v1: upload slot has expired';
  end if;

  -- ---------------------------------------------------------------------
  -- 4. The actual verification cross-check: what the caller inspected
  --    must match what this slot pre-authorized. A mismatch here means
  --    either the wrong bytes were proxied against this slot, or the
  --    inspection step disagrees with what the client originally
  --    declared — either way, not this slot's file.
  -- ---------------------------------------------------------------------
  if p_detected_mime_type is distinct from v_slot.declared_mime_type then
    raise exception 'finalize_quote_upload_v1: detected_mime_type does not match this slot''s declared type';
  end if;
  if p_byte_size is distinct from v_slot.declared_byte_size then
    raise exception 'finalize_quote_upload_v1: byte_size does not match this slot''s declared size';
  end if;

  -- ---------------------------------------------------------------------
  -- 5. Insert + update, both unguarded (no inner BEGIN/EXCEPTION block):
  --    if the UPDATE below fails for any reason, Postgres unwinds this
  --    whole function invocation, including the INSERT that already
  --    "succeeded" a moment earlier — by ordinary transaction semantics,
  --    not extra rollback logic. lead_id/kind/storage_path/
  --    original_filename come from the LOCKED slot row, never from the
  --    caller — the caller has no field through which to influence any
  --    of them.
  -- ---------------------------------------------------------------------
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

  update public.quote_upload_slots
  set status = 'verified', completed_at = v_completed_at, verified_file_id = v_new_file_id
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

revoke execute on function public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text) from public;
grant execute on function public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text) to service_role;

comment on function public.finalize_quote_upload_v1(uuid, uuid, text, bigint, text) is
  'Atomically finalizes one already-verified file upload: inserts exactly '
  'one public.lead_files row (using the locked quote_upload_slots row''s '
  'own lead_id/kind/storage_path/original_filename — never caller-supplied) '
  'and marks that slot verified, or does neither. SECURITY INVOKER — no '
  'privileges beyond service_role''s own existing grants. Idempotent: a '
  'replay with matching metadata returns the original result and inserts '
  'nothing new; a replay with different metadata is rejected. Never touches '
  'Storage — the caller is responsible for having already written the '
  'bytes to storage_path before calling this function.';
