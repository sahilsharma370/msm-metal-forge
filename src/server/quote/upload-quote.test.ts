import { describe, expect, it, vi } from "vitest";
import {
  processQuoteUpload,
  parseQuoteUploadMultipart,
  readBoundedBytes,
  MultipartValidationError,
  RequestTooLargeError,
  MAX_UPLOAD_FILE_BYTES,
  type UploadQuoteRpcClient,
  type UploadQuoteStorageClient,
} from "./upload-quote";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const SLOT_ID = "22222222-2222-2222-2222-222222222222";
const IDEMPOTENCY_KEY = "d0000000-0000-0000-0000-000000000001";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_ATTEMPT_ID = "55555555-5555-5555-5555-555555555555";
const FILE_ID = "44444444-4444-4444-4444-444444444444";
const OBJECT_PATH = `quote-uploads/${LEAD_ID}/${SLOT_ID}/${ATTEMPT_ID}`;
const STORAGE_NAMESPACE_PATH = `leads/${LEAD_ID}/slot-0-${SLOT_ID}`;

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/**
 * Same ArrayBuffer-backed-vs-ArrayBufferLike generic distinction as
 * inspect-upload.ts's sha256HexOfBytes cast — every Uint8Array built in
 * this file is backed by a real ArrayBuffer, so this is safe.
 */
function asBufferSource(value: Uint8Array): BufferSource {
  return value as BufferSource;
}

function padded(signature: number[], totalLength: number): Uint8Array {
  const buffer = new Uint8Array(totalLength);
  buffer.set(signature, 0);
  return buffer;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function validJpegBytes(size = 20): Uint8Array {
  return padded(JPEG_SIGNATURE, size);
}

interface ClaimOverrides {
  state?: "uploading" | "verified";
  reclaimed?: boolean;
  declared_mime_type?: string;
  declared_byte_size?: number;
  attempt_id?: string;
  upload_object_path?: string;
  stale_object_path?: string | null;
}

function claimSuccess(overrides: ClaimOverrides = {}) {
  return {
    data: {
      slot_id: SLOT_ID,
      lead_id: LEAD_ID,
      attempt_id: ATTEMPT_ID,
      state: "uploading",
      reclaimed: false,
      kind: "seller_photo",
      storage_path: STORAGE_NAMESPACE_PATH,
      upload_object_path: OBJECT_PATH,
      stale_object_path: null,
      original_filename: "photo.jpg",
      declared_mime_type: "image/jpeg",
      declared_byte_size: 20,
      expires_at: "2026-08-13T00:00:00+00:00",
      ...overrides,
    },
    error: null as { message: string } | null,
  };
}

function claimError(message: string) {
  return { data: null, error: { message } };
}

function finalizeSuccess(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      lead_file_id: FILE_ID,
      slot_id: SLOT_ID,
      lead_id: LEAD_ID,
      kind: "seller_photo",
      storage_path: OBJECT_PATH,
      detected_mime_type: "image/jpeg",
      byte_size: 20,
      checksum: "a".repeat(64),
      verified_at: "2026-08-13T00:00:05+00:00",
      ...overrides,
    },
    error: null as { message: string } | null,
  };
}

function finalizeError(message: string) {
  return { data: null, error: { message } };
}

/** A fake RPC client — no real Supabase client, no network access, ever. */
function fakeRpc(): UploadQuoteRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn() } as unknown as UploadQuoteRpcClient & { rpc: ReturnType<typeof vi.fn> };
}

function fakeStorage(): UploadQuoteStorageClient & {
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    upload: vi.fn().mockResolvedValue({ data: { path: OBJECT_PATH }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
}

function input(overrides: Partial<{ slotId: string; idempotencyKey: string; fileBytes: Uint8Array }> = {}) {
  return {
    slotId: SLOT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    fileBytes: validJpegBytes(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseQuoteUploadMultipart
// ---------------------------------------------------------------------------

async function buildMultipart(fields: Record<string, string | File>): Promise<{ bytes: Uint8Array; contentType: string }> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  const probe = new Response(formData);
  const rawBytes = new Uint8Array(await probe.arrayBuffer());
  const contentType = probe.headers.get("content-type")!;
  return { bytes: rawBytes, contentType };
}

function validFields(overrides: Record<string, string | File> = {}) {
  return {
    slotId: SLOT_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    file: new File([asBufferSource(validJpegBytes())], "whatever.jpg", { type: "image/jpeg" }),
    ...overrides,
  };
}

describe("parseQuoteUploadMultipart — happy path", () => {
  it("extracts slotId, idempotencyKey and file bytes", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(validFields());
    const parsed = await parseQuoteUploadMultipart(rawBytes, contentType);
    expect(parsed.slotId).toBe(SLOT_ID);
    expect(parsed.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(Array.from(parsed.fileBytes)).toEqual(Array.from(validJpegBytes()));
  });

  it("ignores the file part's own filename and declared Content-Type — only bytes are extracted", async () => {
    const file = new File([asBufferSource(validJpegBytes())], "../../etc/passwd", {
      type: "application/x-evil",
    });
    const { bytes: rawBytes, contentType } = await buildMultipart({
      slotId: SLOT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file,
    });
    const parsed = await parseQuoteUploadMultipart(rawBytes, contentType);
    expect(Array.from(parsed.fileBytes)).toEqual(Array.from(validJpegBytes()));
  });
});

describe("parseQuoteUploadMultipart — malformed multipart", () => {
  it("rejects bytes that are not valid multipart/form-data", async () => {
    const rawBytes = new TextEncoder().encode("this is not multipart data at all");
    await expect(
      parseQuoteUploadMultipart(rawBytes, "multipart/form-data; boundary=doesnotmatch"),
    ).rejects.toMatchObject({ code: "MALFORMED_MULTIPART" });
  });
});

describe("parseQuoteUploadMultipart — field validation", () => {
  it("rejects a missing slotId field", async () => {
    const formData = new FormData();
    formData.append("idempotencyKey", IDEMPOTENCY_KEY);
    formData.append("file", new File([asBufferSource(validJpegBytes())], "a.jpg"));
    const probe = new Response(formData);
    const rawBytes = new Uint8Array(await probe.arrayBuffer());
    await expect(
      parseQuoteUploadMultipart(rawBytes, probe.headers.get("content-type")!),
    ).rejects.toMatchObject({ code: "MISSING_FIELD" });
  });

  it("rejects a missing file field", async () => {
    const formData = new FormData();
    formData.append("slotId", SLOT_ID);
    formData.append("idempotencyKey", IDEMPOTENCY_KEY);
    const probe = new Response(formData);
    const rawBytes = new Uint8Array(await probe.arrayBuffer());
    await expect(
      parseQuoteUploadMultipart(rawBytes, probe.headers.get("content-type")!),
    ).rejects.toMatchObject({ code: "MISSING_FIELD" });
  });

  it("rejects a duplicate slotId field", async () => {
    const formData = new FormData();
    formData.append("slotId", SLOT_ID);
    formData.append("slotId", SLOT_ID);
    formData.append("idempotencyKey", IDEMPOTENCY_KEY);
    formData.append("file", new File([asBufferSource(validJpegBytes())], "a.jpg"));
    const probe = new Response(formData);
    const rawBytes = new Uint8Array(await probe.arrayBuffer());
    await expect(
      parseQuoteUploadMultipart(rawBytes, probe.headers.get("content-type")!),
    ).rejects.toMatchObject({ code: "DUPLICATE_FIELD" });
  });

  it("rejects an unexpected extra field", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(
      validFields({ uploadObjectPath: "quote-uploads/attacker/chosen/path" }),
    );
    await expect(parseQuoteUploadMultipart(rawBytes, contentType)).rejects.toMatchObject({
      code: "UNEXPECTED_FIELD",
    });
  });

  it("rejects an attempt-id field the browser tries to supply — structurally, no such field is ever accepted", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(
      validFields({ attemptId: ATTEMPT_ID }),
    );
    await expect(parseQuoteUploadMultipart(rawBytes, contentType)).rejects.toMatchObject({
      code: "UNEXPECTED_FIELD",
    });
  });

  it("rejects a malformed slotId (not a UUID)", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(validFields({ slotId: "not-a-uuid" }));
    await expect(parseQuoteUploadMultipart(rawBytes, contentType)).rejects.toMatchObject({
      code: "INVALID_UUID",
    });
  });

  it("rejects a malformed idempotencyKey (not a UUID)", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(
      validFields({ idempotencyKey: "not-a-uuid" }),
    );
    await expect(parseQuoteUploadMultipart(rawBytes, contentType)).rejects.toMatchObject({
      code: "INVALID_UUID",
    });
  });

  it("rejects a 'file' field that is a plain text value, not an actual file", async () => {
    const formData = new FormData();
    formData.append("slotId", SLOT_ID);
    formData.append("idempotencyKey", IDEMPOTENCY_KEY);
    formData.append("file", "not-a-file");
    const probe = new Response(formData);
    const rawBytes = new Uint8Array(await probe.arrayBuffer());
    await expect(
      parseQuoteUploadMultipart(rawBytes, probe.headers.get("content-type")!),
    ).rejects.toMatchObject({ code: "MISSING_FILE" });
  });

  it("throws MultipartValidationError instances specifically", async () => {
    const { bytes: rawBytes, contentType } = await buildMultipart(validFields({ slotId: "bad" }));
    await expect(parseQuoteUploadMultipart(rawBytes, contentType)).rejects.toBeInstanceOf(
      MultipartValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// readBoundedBytes
// ---------------------------------------------------------------------------

describe("readBoundedBytes", () => {
  function requestWithBody(body: Uint8Array, contentLength?: number): Request {
    const headers = new Headers({ "content-type": "multipart/form-data; boundary=x" });
    if (contentLength !== undefined) headers.set("content-length", String(contentLength));
    return new Request("https://example.test/api/quote/upload", {
      method: "POST",
      body: asBufferSource(body),
      headers,
    });
  }

  it("reads a body under the limit", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const result = await readBoundedBytes(requestWithBody(body), 1024);
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("rejects via Content-Length fast path when it exceeds the limit", async () => {
    const body = new Uint8Array(100);
    await expect(readBoundedBytes(requestWithBody(body, 10_000), 50)).rejects.toBeInstanceOf(
      RequestTooLargeError,
    );
  });

  it("rejects based on actual bytes read when Content-Length is absent or wrong", async () => {
    const oversized = new Uint8Array(200);
    const request = new Request("https://example.test/api/quote/upload", {
      method: "POST",
      body: asBufferSource(oversized),
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    request.headers.delete("content-length");
    await expect(readBoundedBytes(request, 50)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — pre-claim structural validation
// ---------------------------------------------------------------------------

describe("processQuoteUpload — pre-claim validation (no lease ever taken)", () => {
  it("rejects an empty file without ever calling claim", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const result = await processQuoteUpload(input({ fileBytes: bytes() }), { rpc, storage });
    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(rpc.rpc).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("accepts a file that is exactly 8 MiB (constructed in memory)", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ declared_byte_size: MAX_UPLOAD_FILE_BYTES }))
      .mockResolvedValueOnce(finalizeSuccess({ byte_size: MAX_UPLOAD_FILE_BYTES }));

    const file = padded(JPEG_SIGNATURE, MAX_UPLOAD_FILE_BYTES);
    const result = await processQuoteUpload(input({ fileBytes: file }), { rpc, storage });
    expect(result.status).toBe(200);
  });

  it("rejects a file that is 8 MiB + 1 byte without ever calling claim", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const file = padded(JPEG_SIGNATURE, MAX_UPLOAD_FILE_BYTES + 1);
    const result = await processQuoteUpload(input({ fileBytes: file }), { rpc, storage });
    expect(result.status).toBe(413);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — claim outcome mapping
// ---------------------------------------------------------------------------

describe("processQuoteUpload — claim outcome mapping", () => {
  it("maps 'not found' to a safe 404, regardless of whether the slot or the key was wrong", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(
      claimError("claim_quote_upload_v1: upload slot not found for the supplied idempotency key"),
    );
    const result = await processQuoteUpload(input(), { rpc, storage });
    expect(result.status).toBe(404);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("NOT_FOUND");
      expect(result.body.error.retryable).toBe(false);
    }
  });

  it("maps an active lease to a retryable 409 conflict, mutating nothing", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(
      claimError("claim_quote_upload_v1: upload is already in progress for this slot (UPLOAD_IN_PROGRESS)"),
    );
    const result = await processQuoteUpload(input(), { rpc, storage });
    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("UPLOAD_IN_PROGRESS");
      expect(result.body.error.retryable).toBe(true);
    }
    expect(rpc.rpc).toHaveBeenCalledTimes(1);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("maps an expired slot to a non-retryable 409", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(claimError("claim_quote_upload_v1: upload slot has expired"));
    const result = await processQuoteUpload(input(), { rpc, storage });
    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("SLOT_UNAVAILABLE");
      expect(result.body.error.retryable).toBe(false);
    }
  });

  it("maps a failed slot to a non-retryable 409", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(
      claimError("claim_quote_upload_v1: upload slot has status failed and cannot be claimed"),
    );
    const result = await processQuoteUpload(input(), { rpc, storage });
    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("SLOT_UNAVAILABLE");
      expect(result.body.error.retryable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — inspection against the slot's own declared metadata
// ---------------------------------------------------------------------------

describe("processQuoteUpload — byte inspection", () => {
  it("rejects MIME spoofing (declared jpeg, actual bytes are a PNG) and releases with retry", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ declared_mime_type: "image/jpeg", declared_byte_size: 30 }))
      .mockResolvedValueOnce({ data: {}, error: null }); // release

    const pngBytes = padded(PNG_SIGNATURE, 30);
    const result = await processQuoteUpload(input({ fileBytes: pngBytes }), { rpc, storage });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpc.rpc).toHaveBeenNthCalledWith(2, "release_quote_upload_claim_v1", {
      p_slot_id: SLOT_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_upload_attempt_id: ATTEMPT_ID,
      p_outcome: "retry",
    });
  });

  it("rejects unsupported/unrecognized magic bytes and releases with retry", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockResolvedValueOnce({ data: {}, error: null }); // release

    const notAnImage = new TextEncoder().encode("hello world, this is plain text data");
    const result = await processQuoteUpload(input({ fileBytes: notAnImage }), { rpc, storage });

    expect(result.status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpc.rpc).toHaveBeenNthCalledWith(2, "release_quote_upload_claim_v1", expect.objectContaining({
      p_outcome: "retry",
    }));
  });

  it("rejects a declared-size mismatch (valid signature, wrong size) and releases with retry, never touching Storage", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ declared_byte_size: 999 }))
      .mockResolvedValueOnce({ data: {}, error: null }); // release

    const result = await processQuoteUpload(input({ fileBytes: validJpegBytes(20) }), { rpc, storage });

    expect(result.status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpc.rpc).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — fresh upload happy path
// ---------------------------------------------------------------------------

describe("processQuoteUpload — fresh upload happy path", () => {
  it("uploads to the exact RPC-returned upload_object_path with upsert:false and the detected MIME type, then finalizes", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce(finalizeSuccess());

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      data: { success: true, slotId: SLOT_ID, fileId: FILE_ID, status: "verified", replayed: false },
    });

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [path, , options] = storage.upload.mock.calls[0] as [string, Uint8Array, { contentType: string; upsert: boolean }];
    expect(path).toBe(OBJECT_PATH);
    expect(path).not.toBe(STORAGE_NAMESPACE_PATH);
    expect(options.upsert).toBe(false);
    expect(options.contentType).toBe("image/jpeg");

    expect(rpc.rpc).toHaveBeenNthCalledWith(2, "finalize_quote_upload_v2", {
      p_slot_id: SLOT_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_upload_attempt_id: ATTEMPT_ID,
      p_detected_mime_type: "image/jpeg",
      p_byte_size: 20,
      p_checksum_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("never calls the deprecated finalize_quote_upload_v1 RPC", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce(finalizeSuccess());

    await processQuoteUpload(input(), { rpc, storage });

    for (const call of rpc.rpc.mock.calls) {
      expect(call[0]).not.toBe("finalize_quote_upload_v1");
    }
  });

  it("uses the reclaimed attempt id/object path exactly as returned by claim, regardless of any prior stale attempt", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    const reclaimedPath = `quote-uploads/${LEAD_ID}/${SLOT_ID}/${OTHER_ATTEMPT_ID}`;
    rpc.rpc
      .mockResolvedValueOnce(
        claimSuccess({
          reclaimed: true,
          attempt_id: OTHER_ATTEMPT_ID,
          upload_object_path: reclaimedPath,
          stale_object_path: OBJECT_PATH,
        }),
      )
      .mockResolvedValueOnce(finalizeSuccess({ storage_path: reclaimedPath }));

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(200);
    const [path] = storage.upload.mock.calls[0] as [string];
    expect(path).toBe(reclaimedPath);
    expect(path).not.toBe(OBJECT_PATH);
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — already-verified replay
// ---------------------------------------------------------------------------

describe("processQuoteUpload — already-verified replay", () => {
  it("accepts an exact metadata/checksum-compatible replay without touching Storage", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ state: "verified" }))
      .mockResolvedValueOnce(finalizeSuccess());

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(200);
    if (result.body.ok) {
      expect(result.body.data.replayed).toBe(true);
    }
    expect(storage.upload).not.toHaveBeenCalled();
    expect(rpc.rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects a changed replay (different content than what was verified) with a safe conflict, never touching Storage", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ state: "verified" }))
      .mockResolvedValueOnce(
        finalizeError(
          "finalize_quote_upload_v2: this slot was already finalized with different metadata or attempt",
        ),
      );

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("ALREADY_VERIFIED_MISMATCH");
      expect(result.body.error.retryable).toBe(false);
    }
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — Storage failure recovery
// ---------------------------------------------------------------------------

describe("processQuoteUpload — Storage failure recovery", () => {
  it("on a confirmed cleanup, releases with 'retry' and reports a retryable error", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    storage.remove.mockResolvedValueOnce({ data: [], error: null });
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce({ data: {}, error: null });

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(502);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("STORAGE_ERROR");
      expect(result.body.error.retryable).toBe(true);
    }
    expect(storage.remove).toHaveBeenCalledWith([OBJECT_PATH]);
    expect(rpc.rpc).toHaveBeenNthCalledWith(2, "release_quote_upload_claim_v1", {
      p_slot_id: SLOT_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_upload_attempt_id: ATTEMPT_ID,
      p_outcome: "retry",
    });
  });

  it("on a failed/ambiguous cleanup, releases with 'cleanup_required' and reports a non-retryable error", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    storage.remove.mockResolvedValueOnce({ data: null, error: { message: "not sure what happened" } });
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce({ data: {}, error: null });

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(502);
    if (!result.body.ok) {
      expect(result.body.error.retryable).toBe(false);
    }
    expect(rpc.rpc).toHaveBeenNthCalledWith(2, "release_quote_upload_claim_v1", expect.objectContaining({
      p_outcome: "cleanup_required",
    }));
  });

  it("deletes only the current attempt's exact object path, never any other path", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce({ data: {}, error: null });

    await processQuoteUpload(input(), { rpc, storage });

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([OBJECT_PATH]);
  });

  it("produces no unhandled promise rejection when both Storage cleanup and release fail", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    storage.upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    storage.remove.mockRejectedValueOnce(new Error("network error during cleanup"));
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockRejectedValueOnce(new Error("network error during release"));

    await expect(processQuoteUpload(input(), { rpc, storage })).resolves.toMatchObject({
      status: 502,
    });
  });
});

// ---------------------------------------------------------------------------
// processQuoteUpload — finalize failure recovery
// ---------------------------------------------------------------------------

describe("processQuoteUpload — finalize failure recovery", () => {
  it("retries finalize_quote_upload_v2 exactly once on a transient failure, then succeeds", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: connection reset"))
      .mockResolvedValueOnce(finalizeSuccess());

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(200);
    expect(rpc.rpc).toHaveBeenCalledTimes(3); // claim, finalize (fail), finalize (retry, succeeds)
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous outcome (retry hits the idempotent-replay branch) as success, never deleting the object", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: connection reset"))
      // The retry hits the RPC's own already-verified branch because the
      // first call's write actually committed — same success shape either way.
      .mockResolvedValueOnce(finalizeSuccess());

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(200);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("on two consecutive finalize failures, marks cleanup_required (retaining the object) instead of deleting anything", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: unexpected failure"))
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: unexpected failure"))
      .mockResolvedValueOnce({ data: {}, error: null }); // release

    const result = await processQuoteUpload(input(), { rpc, storage });

    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("FINALIZE_FAILED");
      expect(result.body.error.retryable).toBe(false);
    }
    expect(storage.remove).not.toHaveBeenCalled();
    expect(rpc.rpc).toHaveBeenNthCalledWith(4, "release_quote_upload_claim_v1", {
      p_slot_id: SLOT_ID,
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_upload_attempt_id: ATTEMPT_ID,
      p_outcome: "cleanup_required",
    });
  });

  it("a wrong/stale attempt id rejected by finalize never deletes or releases another attempt's object — only the current attempt id is ever sent", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess({ attempt_id: ATTEMPT_ID }))
      .mockResolvedValueOnce(
        finalizeError("finalize_quote_upload_v2: upload_attempt_id does not match this slot's active claim"),
      )
      .mockResolvedValueOnce(
        finalizeError("finalize_quote_upload_v2: upload_attempt_id does not match this slot's active claim"),
      )
      .mockResolvedValueOnce({ data: {}, error: null }); // release

    await processQuoteUpload(input(), { rpc, storage });

    expect(storage.remove).not.toHaveBeenCalled();
    for (const call of rpc.rpc.mock.calls) {
      if (call[0] === "finalize_quote_upload_v2" || call[0] === "release_quote_upload_claim_v1") {
        const args = call[1] as { p_upload_attempt_id: string };
        expect(args.p_upload_attempt_id).toBe(ATTEMPT_ID);
      }
    }
  });

  it("produces no unhandled promise rejection when the final cleanup_required release itself fails", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc
      .mockResolvedValueOnce(claimSuccess())
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: unexpected failure"))
      .mockResolvedValueOnce(finalizeError("finalize_quote_upload_v2: unexpected failure"))
      .mockRejectedValueOnce(new Error("network error during release"));

    await expect(processQuoteUpload(input(), { rpc, storage })).resolves.toMatchObject({
      status: 500,
    });
  });
});

// ---------------------------------------------------------------------------
// Safe error responses — no secrets, no internal paths, no raw SQL
// ---------------------------------------------------------------------------

describe("processQuoteUpload — safe error responses", () => {
  it("never leaks the internal object path, idempotency key, or raw RPC error text on a Storage failure", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    storage.upload.mockResolvedValueOnce({
      data: null,
      error: { message: "S3 bucket lead-files denied: AKIAFAKESECRET" },
    });
    rpc.rpc.mockResolvedValueOnce(claimSuccess()).mockResolvedValueOnce({ data: {}, error: null });

    const result = await processQuoteUpload(input(), { rpc, storage });
    const serialized = JSON.stringify(result.body);

    expect(serialized).not.toContain(OBJECT_PATH);
    expect(serialized).not.toContain(IDEMPOTENCY_KEY);
    expect(serialized).not.toContain("AKIAFAKESECRET");
    expect(serialized).not.toContain("lead-files");
  });

  it("never leaks a raw Postgres/RPC error message on an unmapped claim failure", async () => {
    const rpc = fakeRpc();
    const storage = fakeStorage();
    rpc.rpc.mockResolvedValueOnce(
      claimError('new row for relation "quote_upload_slots" violates check constraint "xyz"'),
    );
    const result = await processQuoteUpload(input(), { rpc, storage });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("relation");
    expect(serialized).not.toContain("quote_upload_slots");
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
    }
  });
});
