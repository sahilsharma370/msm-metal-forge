/**
 * CHECKPOINT C2B2 — server-only orchestration for the single-file Quote
 * upload endpoint. Deliberately independent of the Fetch API Request/
 * Response types (see readBoundedBytes for the one exception, which mirrors
 * initiate-quote.ts's readBoundedBody) so the core flow can be unit tested
 * against raw bytes and fake RPC/Storage clients — no real HTTP server or
 * Supabase project involved.
 *
 * Orchestrates, in order: pre-claim structural byte checks, claim_quote_upload_v1
 * (minimizing lease duration by only claiming after those checks), byte
 * inspection via inspectUpload, comparison against the slot's own declared
 * metadata, a Storage upload using ONLY the RPC-returned upload_object_path,
 * and finalize_quote_upload_v2. Every recovery path (validation failure
 * before/after claim, Storage failure, finalize failure) is handled here —
 * see the individual functions below for the exact rules each follows.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectUpload, UploadInspectionError, MAX_BYTES } from "./inspect-upload";

/** The one private bucket created in CHECKPOINT A (20260812170045_quote_upload_slots_and_storage.sql). */
const LEAD_FILES_BUCKET = "lead-files";

// ---------------------------------------------------------------------------
// Request-size ceilings
// ---------------------------------------------------------------------------

/**
 * The exact file-byte ceiling inspectUpload itself enforces from actual
 * bytes — re-exported here so callers (the route adapter, tests) have one
 * name for "the real limit" without reaching into inspect-upload.ts
 * directly for it.
 */
export const MAX_UPLOAD_FILE_BYTES = MAX_BYTES;

/**
 * The early, cheap ceiling applied to the whole multipart request body,
 * before any parsing happens. Generous slack above the real 8 MiB file
 * limit (64 KiB — the same figure initiate-quote.ts uses for its own body
 * cap) absorbs multipart boundary/header framing and the two small text
 * fields, so a legitimate exactly-8-MiB file is never rejected here. This
 * is a fast-fail net, not the authoritative limit — inspectUpload's
 * TOO_LARGE check against actual decoded file bytes is that.
 */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_FILE_BYTES + 64 * 1024;

export class RequestTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestTooLargeError";
  }
}

/**
 * Reads a Request body up to maxBytes as raw bytes (not text — this route
 * carries binary file content), rejecting anything larger via both a
 * Content-Length fast path and actual bytes read, exactly mirroring
 * initiate-quote.ts's readBoundedBody rationale for why both checks exist.
 */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new RequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

// ---------------------------------------------------------------------------
// Multipart parsing and field validation
// ---------------------------------------------------------------------------

export type MultipartValidationErrorCode =
  | "MALFORMED_MULTIPART"
  | "MISSING_FIELD"
  | "DUPLICATE_FIELD"
  | "UNEXPECTED_FIELD"
  | "INVALID_UUID"
  | "MISSING_FILE";

export class MultipartValidationError extends Error {
  readonly code: MultipartValidationErrorCode;
  constructor(code: MultipartValidationErrorCode, message: string) {
    super(message);
    this.name = "MultipartValidationError";
    this.code = code;
  }
}

const EXPECTED_FIELDS = ["slotId", "idempotencyKey", "file"] as const;
const EXPECTED_FIELD_SET = new Set<string>(EXPECTED_FIELDS);

export interface ParsedQuoteUpload {
  slotId: string;
  idempotencyKey: string;
  fileBytes: Uint8Array;
}

/**
 * Parses and structurally validates exactly one multipart/form-data upload.
 * Takes raw bytes + the original Content-Type header (not a Request) so it
 * can be unit tested directly. Uses the Fetch API's own multipart parser
 * (via Response.formData()) rather than a hand-rolled one — this project
 * has no multipart-parsing dependency and the platform parser is exercised
 * daily by every browser/runtime already.
 *
 * Never trusts the file part's own filename or declared Content-Type —
 * neither is read here at all; only its bytes are extracted. slotId/
 * idempotencyKey/attempt/path are never accepted from any other field:
 * exactly three fields are permitted, no more, no fewer, no duplicates.
 */
export async function parseQuoteUploadMultipart(
  rawBytes: Uint8Array,
  contentType: string,
): Promise<ParsedQuoteUpload> {
  let formData: FormData;
  try {
    // Same ArrayBuffer-backed-vs-ArrayBufferLike generic cast as
    // inspect-upload.ts's sha256HexOfBytes — this function's only callers
    // always pass a definitely-ArrayBuffer-backed Uint8Array.
    formData = await new Response(rawBytes as BufferSource, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new MultipartValidationError(
      "MALFORMED_MULTIPART",
      "The request body is not valid multipart/form-data.",
    );
  }

  const keys = Array.from(formData.keys());
  const uniqueKeys = new Set(keys);

  for (const key of uniqueKeys) {
    if (!EXPECTED_FIELD_SET.has(key)) {
      throw new MultipartValidationError("UNEXPECTED_FIELD", "The request contains an unexpected field.");
    }
  }
  if (keys.length !== uniqueKeys.size) {
    throw new MultipartValidationError("DUPLICATE_FIELD", "The request contains a duplicate field.");
  }
  for (const required of EXPECTED_FIELDS) {
    if (!uniqueKeys.has(required)) {
      throw new MultipartValidationError("MISSING_FIELD", `Missing required field: ${required}.`);
    }
  }

  const slotIdRaw = formData.get("slotId");
  const idempotencyKeyRaw = formData.get("idempotencyKey");
  const fileRaw = formData.get("file");

  if (typeof slotIdRaw !== "string" || typeof idempotencyKeyRaw !== "string") {
    throw new MultipartValidationError("MISSING_FIELD", "slotId and idempotencyKey must be text fields.");
  }
  if (!(fileRaw instanceof File)) {
    throw new MultipartValidationError("MISSING_FILE", "The file field must be a file.");
  }

  const slotIdResult = z.string().uuid().safeParse(slotIdRaw);
  const idempotencyKeyResult = z.string().uuid().safeParse(idempotencyKeyRaw);
  if (!slotIdResult.success || !idempotencyKeyResult.success) {
    throw new MultipartValidationError("INVALID_UUID", "slotId and idempotencyKey must be valid UUIDs.");
  }

  const fileBytes = new Uint8Array(await fileRaw.arrayBuffer());

  return { slotId: slotIdResult.data, idempotencyKey: idempotencyKeyResult.data, fileBytes };
}

// ---------------------------------------------------------------------------
// Dependency-injected Supabase RPC + Storage clients
// ---------------------------------------------------------------------------

/**
 * Narrow structural subsets of the real SupabaseClient / StorageFileApi —
 * small enough to fake completely in tests, exactly like initiate-quote.ts's
 * QuoteRpcClient. Only the three C2B1 claim/finalize/release RPCs are
 * exposed; finalize_quote_upload_v1 has no overload here at all, so it is
 * structurally impossible for this module to call it.
 */
export interface UploadQuoteRpcClient {
  rpc(
    fn: "claim_quote_upload_v1",
    args: { p_slot_id: string; p_idempotency_key: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "finalize_quote_upload_v2",
    args: {
      p_slot_id: string;
      p_idempotency_key: string;
      p_upload_attempt_id: string;
      p_detected_mime_type: string;
      p_byte_size: number;
      p_checksum_sha256: string;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "release_quote_upload_claim_v1",
    args: {
      p_slot_id: string;
      p_idempotency_key: string;
      p_upload_attempt_id: string;
      p_outcome: "retry" | "cleanup_required";
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toUploadQuoteRpcClient(client: SupabaseClient): UploadQuoteRpcClient {
  return client as unknown as UploadQuoteRpcClient;
}

export interface UploadQuoteStorageClient {
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): PromiseLike<{ data: { path: string } | null; error: { message: string } | null }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toUploadQuoteStorageClient(client: SupabaseClient): UploadQuoteStorageClient {
  return client.storage.from(LEAD_FILES_BUCKET) as unknown as UploadQuoteStorageClient;
}

// ---------------------------------------------------------------------------
// RPC response contracts — defensively re-validated, never trusted blindly
// ---------------------------------------------------------------------------

const claimResultSchema = z.object({
  slot_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  state: z.enum(["uploading", "verified"]),
  reclaimed: z.boolean(),
  kind: z.enum(["seller_photo", "buyer_document"]),
  storage_path: z.string(),
  upload_object_path: z.string(),
  stale_object_path: z.string().nullable(),
  original_filename: z.string(),
  declared_mime_type: z.string(),
  declared_byte_size: z.number(),
  expires_at: z.string(),
});

const finalizeResultSchema = z.object({
  lead_file_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  kind: z.enum(["seller_photo", "buyer_document"]),
  storage_path: z.string(),
  detected_mime_type: z.string(),
  byte_size: z.number(),
  checksum: z.string(),
  verified_at: z.string(),
});

// ---------------------------------------------------------------------------
// Response contract — browser-safe only. No raw SQL/Supabase/bucket/
// internal-path/stack/secret detail is ever placed in these bodies.
// ---------------------------------------------------------------------------

export type UploadErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UPLOAD_IN_PROGRESS"
  | "SLOT_UNAVAILABLE"
  | "ALREADY_VERIFIED_MISMATCH"
  | "STORAGE_ERROR"
  | "FINALIZE_FAILED"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED";

export interface UploadQuoteSuccessBody {
  ok: true;
  data: {
    success: true;
    slotId: string;
    fileId: string;
    status: "verified";
    replayed: boolean;
  };
}

export interface UploadQuoteErrorBody {
  ok: false;
  error: {
    code: UploadErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type UploadQuoteResponseBody = UploadQuoteSuccessBody | UploadQuoteErrorBody;

export interface UploadQuoteResult {
  status: number;
  body: UploadQuoteResponseBody;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

function errorResult(
  status: number,
  code: UploadErrorCode,
  message: string,
  retryable: boolean,
): UploadQuoteResult {
  return { status, body: { ok: false, error: { code, message, retryable } } };
}

function internalError(): UploadQuoteResult {
  return errorResult(500, "INTERNAL_ERROR", GENERIC_MESSAGE, false);
}

function successResult(slotId: string, fileId: string, replayed: boolean): UploadQuoteResult {
  return {
    status: 200,
    body: { ok: true, data: { success: true, slotId, fileId, status: "verified", replayed } },
  };
}

// ---------------------------------------------------------------------------
// claim_quote_upload_v1 error-message mapping — matched by fragment, not
// guessed, against that function's own exact wording (see the C2B1
// migration). Identical treatment for "wrong idempotency key" and "slot
// does not exist" (both raise the same not-found message) — never reveals
// which.
// ---------------------------------------------------------------------------

const CLAIM_NOT_FOUND_FRAGMENT = "upload slot not found for the supplied idempotency key";
const CLAIM_IN_PROGRESS_FRAGMENT = "UPLOAD_IN_PROGRESS";
const CLAIM_EXPIRED_FRAGMENT = "upload slot has expired";
const CLAIM_TERMINAL_FRAGMENT = "cannot be claimed";
const FINALIZE_REPLAY_MISMATCH_FRAGMENT = "already finalized with different metadata or attempt";

function mapClaimError(message: string): UploadQuoteResult {
  if (message.includes(CLAIM_NOT_FOUND_FRAGMENT)) {
    return errorResult(404, "NOT_FOUND", "This upload slot could not be found.", false);
  }
  if (message.includes(CLAIM_IN_PROGRESS_FRAGMENT)) {
    return errorResult(
      409,
      "UPLOAD_IN_PROGRESS",
      "An upload is already in progress for this slot. Please wait and try again.",
      true,
    );
  }
  if (message.includes(CLAIM_EXPIRED_FRAGMENT) || message.includes(CLAIM_TERMINAL_FRAGMENT)) {
    return errorResult(409, "SLOT_UNAVAILABLE", "This upload slot is no longer available.", false);
  }
  return internalError();
}

// ---------------------------------------------------------------------------
// Best-effort release / cleanup — never allowed to throw out of these
// helpers (no unhandled rejection on a cleanup failure), never logs any
// idempotency key, slot id, attempt id or path.
// ---------------------------------------------------------------------------

async function safeRelease(
  deps: HandleQuoteUploadDeps,
  slotId: string,
  idempotencyKey: string,
  attemptId: string,
  outcome: "retry" | "cleanup_required",
): Promise<void> {
  try {
    await deps.rpc.rpc("release_quote_upload_claim_v1", {
      p_slot_id: slotId,
      p_idempotency_key: idempotencyKey,
      p_upload_attempt_id: attemptId,
      p_outcome: outcome,
    });
  } catch {
    // Best-effort only. The caller's own response already reflects the
    // real outcome regardless of whether this release call itself
    // succeeds — a slot stuck without a successful release is exactly what
    // the out-of-band cleanup path (see the C2B1 migration) exists for.
  }
}

/** Attempts to delete exactly one attempt-scoped object; never any other path. Returns true only on a confirmed (no-error) removal. */
async function attemptStorageCleanup(
  deps: HandleQuoteUploadDeps,
  objectPath: string,
): Promise<boolean> {
  try {
    const { error } = await deps.storage.remove([objectPath]);
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core orchestration
// ---------------------------------------------------------------------------

export interface HandleQuoteUploadDeps {
  rpc: UploadQuoteRpcClient;
  storage: UploadQuoteStorageClient;
}

export interface QuoteUploadInput {
  slotId: string;
  idempotencyKey: string;
  fileBytes: Uint8Array;
}

/**
 * Finalizes an already-verified slot's replay: never re-uploads to
 * Storage. finalize_quote_upload_v2's own idempotent-replay branch does
 * the exact metadata/checksum comparison — this function only maps its
 * outcome, it does not duplicate that comparison.
 */
async function finalizeReplay(
  input: QuoteUploadInput,
  deps: HandleQuoteUploadDeps,
  attemptId: string,
  inspected: { detectedMimeType: string; byteSize: number; checksumSha256: string },
): Promise<UploadQuoteResult> {
  const response = await deps.rpc.rpc("finalize_quote_upload_v2", {
    p_slot_id: input.slotId,
    p_idempotency_key: input.idempotencyKey,
    p_upload_attempt_id: attemptId,
    p_detected_mime_type: inspected.detectedMimeType,
    p_byte_size: inspected.byteSize,
    p_checksum_sha256: inspected.checksumSha256,
  });

  if (response.error) {
    if (response.error.message.includes(FINALIZE_REPLAY_MISMATCH_FRAGMENT)) {
      return errorResult(
        409,
        "ALREADY_VERIFIED_MISMATCH",
        "This upload slot was already completed with different content.",
        false,
      );
    }
    return internalError();
  }

  const parsed = finalizeResultSchema.safeParse(response.data);
  if (!parsed.success) return internalError();

  return successResult(input.slotId, parsed.data.lead_file_id, true);
}

/**
 * Finalizes a freshly-uploaded (or reclaimed) attempt. Retries the
 * idempotent V2 call exactly once on failure before giving up — a second
 * call is always safe because finalize_quote_upload_v2 is atomic and
 * idempotent: it either performs the same write this attempt intended, or
 * (if the first call's write actually committed and only the response was
 * lost) transparently hits its own verified-replay branch and returns the
 * same result, which this function treats identically to a first-time
 * success. Only if BOTH attempts fail is the database outcome treated as
 * unknown — at that point the object is deliberately left in place
 * (cleanup_required, never a delete) rather than risking destruction of a
 * file that may in fact have verified successfully.
 */
async function finalizeFresh(
  input: QuoteUploadInput,
  deps: HandleQuoteUploadDeps,
  attemptId: string,
  inspected: { detectedMimeType: string; byteSize: number; checksumSha256: string },
): Promise<UploadQuoteResult> {
  const args = {
    p_slot_id: input.slotId,
    p_idempotency_key: input.idempotencyKey,
    p_upload_attempt_id: attemptId,
    p_detected_mime_type: inspected.detectedMimeType,
    p_byte_size: inspected.byteSize,
    p_checksum_sha256: inspected.checksumSha256,
  };

  let response = await deps.rpc.rpc("finalize_quote_upload_v2", args);
  if (response.error) {
    response = await deps.rpc.rpc("finalize_quote_upload_v2", args);
  }

  if (response.error) {
    await safeRelease(deps, input.slotId, input.idempotencyKey, attemptId, "cleanup_required");
    return errorResult(
      500,
      "FINALIZE_FAILED",
      "The upload could not be completed. Please contact support.",
      false,
    );
  }

  const parsed = finalizeResultSchema.safeParse(response.data);
  if (!parsed.success) return internalError();

  return successResult(input.slotId, parsed.data.lead_file_id, false);
}

/**
 * Core route logic for POST /api/quote/upload, independent of Request/
 * Response — see parseQuoteUploadMultipart and readBoundedBytes for the
 * Fetch-API-facing edges the route adapter calls before this.
 */
export async function processQuoteUpload(
  input: QuoteUploadInput,
  deps: HandleQuoteUploadDeps,
): Promise<UploadQuoteResult> {
  // Basic request/byte validation before any claim is taken, so a
  // trivially-doomed request (empty or oversized file) never holds a lease
  // at all — nothing to release.
  if (input.fileBytes.byteLength === 0) {
    return errorResult(400, "VALIDATION_ERROR", "The file is empty.", false);
  }
  if (input.fileBytes.byteLength > MAX_UPLOAD_FILE_BYTES) {
    return errorResult(413, "VALIDATION_ERROR", "The file exceeds the 8 MiB limit.", false);
  }

  const claimResponse = await deps.rpc.rpc("claim_quote_upload_v1", {
    p_slot_id: input.slotId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (claimResponse.error) {
    return mapClaimError(claimResponse.error.message);
  }
  const parsedClaim = claimResultSchema.safeParse(claimResponse.data);
  if (!parsedClaim.success) return internalError();
  const claim = parsedClaim.data;

  // Actual bytes are inspected against the slot's OWN declared mime type
  // (from the claim response, never from the browser) — this is what
  // catches MIME spoofing and unsupported/unrecognized signatures.
  let inspected: { detectedMimeType: string; byteSize: number; checksumSha256: string };
  try {
    inspected = await inspectUpload(input.fileBytes, claim.declared_mime_type);
  } catch (error) {
    if (!(error instanceof UploadInspectionError)) throw error;
    if (claim.state === "uploading") {
      await safeRelease(deps, input.slotId, input.idempotencyKey, claim.attempt_id, "retry");
    }
    return errorResult(400, "VALIDATION_ERROR", "The uploaded file could not be validated.", false);
  }

  if (inspected.byteSize !== claim.declared_byte_size) {
    if (claim.state === "uploading") {
      await safeRelease(deps, input.slotId, input.idempotencyKey, claim.attempt_id, "retry");
    }
    return errorResult(
      400,
      "VALIDATION_ERROR",
      "The uploaded file does not match this slot's declared size.",
      false,
    );
  }

  if (claim.state === "verified") {
    // Already-verified replay: never touch Storage. finalize_quote_upload_v2's
    // own idempotent branch is the sole authority on whether this replay's
    // metadata exactly matches what was already recorded.
    return finalizeReplay(input, deps, claim.attempt_id, inspected);
  }

  // Fresh or reclaimed claim held — proxy bytes to the exact,
  // RPC-returned, attempt-scoped path. Never the slot's stable
  // storage_path, never anything caller-supplied (no such parameter
  // exists on this path), and never with upsert.
  const uploadResponse = await deps.storage.upload(claim.upload_object_path, input.fileBytes, {
    contentType: inspected.detectedMimeType,
    upsert: false,
  });

  if (uploadResponse.error) {
    const cleanupConfirmed = await attemptStorageCleanup(deps, claim.upload_object_path);
    await safeRelease(
      deps,
      input.slotId,
      input.idempotencyKey,
      claim.attempt_id,
      cleanupConfirmed ? "retry" : "cleanup_required",
    );
    return errorResult(
      502,
      "STORAGE_ERROR",
      "The file could not be stored. Please try again.",
      cleanupConfirmed,
    );
  }

  return finalizeFresh(input, deps, claim.attempt_id, inspected);
}
