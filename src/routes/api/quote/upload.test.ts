import { afterEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const storageFromMock = vi.fn(() => ({ upload: uploadMock, remove: removeMock }));
const createSupabaseAdminClientMock = vi.fn(() => ({
  rpc: rpcMock,
  storage: { from: storageFromMock },
}));

// No real Supabase client is ever constructed in this file — createSupabaseAdminClient
// itself is mocked, so there is no possibility of a network call to a real project
// or a real Storage bucket.
vi.mock("@/server/supabase-admin.server", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Allows by default so every existing test in this file reaches the RPC
// exactly as before CHECKPOINT C2G. checkRateLimit/getCloudflareClientIp/
// RATE_LIMIT_RETRY_AFTER_SECONDS are the REAL implementations (spread from
// importOriginal) — only the live Cloudflare binding itself (which cannot
// exist in a Node test process) is faked, exactly like the Supabase client.
// getRateLimiterBindingMock is its own vi.fn() so one test can override it
// with mockImplementationOnce to simulate a missing binding.
const rateLimiterLimitMock = vi.fn().mockResolvedValue({ success: true });
const getRateLimiterBindingMock = vi.fn(() => ({ limit: rateLimiterLimitMock }));
vi.mock("@/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => getRateLimiterBindingMock(),
  };
});

const { handleQuoteUploadRequest } = await import("./upload");

const CF_CONNECTING_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

const SLOT_ID = "22222222-2222-2222-2222-222222222222";
const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "d0000000-0000-0000-0000-000000000001";
const ATTEMPT_ID = "33333333-3333-3333-3333-333333333333";
const OBJECT_PATH = `quote-uploads/${LEAD_ID}/${SLOT_ID}/${ATTEMPT_ID}`;

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function jpegFile(size = 20, name = "photo.jpg"): File {
  const buffer = new Uint8Array(size);
  buffer.set(JPEG_SIGNATURE, 0);
  return new File([buffer], name, { type: "image/jpeg" });
}

function multipartRequest(fields: Record<string, string | File> | null, headers: Record<string, string> = {}): Request {
  if (fields === null) {
    return new Request("https://example.test/api/quote/upload", {
      method: "POST",
      body: "garbage, not multipart at all",
      headers: {
        "content-type": "multipart/form-data; boundary=doesnotmatch",
        ...CF_CONNECTING_IP_HEADERS,
        ...headers,
      },
    });
  }
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request("https://example.test/api/quote/upload", {
    method: "POST",
    body: formData,
    headers: { ...CF_CONNECTING_IP_HEADERS, ...headers },
  });
}

function validFields(): Record<string, string | File> {
  return { slotId: SLOT_ID, idempotencyKey: IDEMPOTENCY_KEY, file: jpegFile() };
}

afterEach(() => {
  rpcMock.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
  storageFromMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
  rateLimiterLimitMock.mockReset().mockResolvedValue({ success: true });
  getRateLimiterBindingMock.mockReset().mockImplementation(() => ({ limit: rateLimiterLimitMock }));
});

describe("handleQuoteUploadRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/quote/upload", { method: "GET" });
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(405);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteUploadRequest — content type", () => {
  it("rejects a request without a multipart/form-data content type", async () => {
    const request = new Request("https://example.test/api/quote/upload", {
      method: "POST",
      body: JSON.stringify({ slotId: SLOT_ID }),
      headers: { "content-type": "application/json" },
    });
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Content-Type header at all", async () => {
    const request = new Request("https://example.test/api/quote/upload", {
      method: "POST",
      body: "irrelevant",
    });
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(400);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteUploadRequest — malformed multipart", () => {
  it("rejects a body that claims multipart/form-data but is not valid multipart", async () => {
    const request = multipartRequest(null);
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("handleQuoteUploadRequest — request size ceiling", () => {
  it("rejects an oversized request via the Content-Length fast path without ever calling the RPC or Storage", async () => {
    const request = multipartRequest(validFields());
    request.headers.set("content-length", String(50 * 1024 * 1024));
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteUploadRequest — environment failure fails closed", () => {
  it("returns a generic 500 when the Supabase client cannot be constructed, leaking no detail about the cause", async () => {
    createSupabaseAdminClientMock.mockImplementationOnce(() => {
      throw new Error("Server configuration error.");
    });
    const request = multipartRequest(validFields());
    const response = await handleQuoteUploadRequest(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/SUPABASE|SECRET|env/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteUploadRequest — end to end with a mocked RPC and Storage client", () => {
  it("returns 200 for a valid fresh upload, calling claim, upload and finalize exactly once each", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          slot_id: SLOT_ID,
          lead_id: LEAD_ID,
          attempt_id: ATTEMPT_ID,
          state: "uploading",
          reclaimed: false,
          kind: "seller_photo",
          storage_path: `leads/${LEAD_ID}/slot-0-${SLOT_ID}`,
          upload_object_path: OBJECT_PATH,
          stale_object_path: null,
          original_filename: "photo.jpg",
          declared_mime_type: "image/jpeg",
          declared_byte_size: 20,
          expires_at: "2026-08-13T00:00:00+00:00",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          lead_file_id: "44444444-4444-4444-4444-444444444444",
          slot_id: SLOT_ID,
          lead_id: LEAD_ID,
          kind: "seller_photo",
          storage_path: OBJECT_PATH,
          detected_mime_type: "image/jpeg",
          byte_size: 20,
          checksum: "a".repeat(64),
          verified_at: "2026-08-13T00:00:05+00:00",
        },
        error: null,
      });
    uploadMock.mockResolvedValue({ data: { path: OBJECT_PATH }, error: null });

    const response = await handleQuoteUploadRequest(multipartRequest(validFields()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.slotId).toBe(SLOT_ID);
    expect(body.data.replayed).toBe(false);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(storageFromMock).toHaveBeenCalledWith("lead-files");
  });

  it("rejects a request with an unexpected extra field before ever calling the RPC", async () => {
    const response = await handleQuoteUploadRequest(
      multipartRequest({ ...validFields(), extra: "field" }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteUploadRequest — CHECKPOINT C2G rate limiting", () => {
  it("returns 429 with a stable code, no internals, and a Retry-After header when the limiter reports rejection — before the RPC is ever called", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteUploadRequest(multipartRequest(validFields()));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.retryable).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/203\.0\.113\.7|counter|ip address/i);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects before the multipart body is ever parsed — a rate-limited request with a genuinely malformed body still returns 429, not a body-parsing 400", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteUploadRequest(multipartRequest(null));
    expect(response.status).toBe(429);
  });

  it("rejects before the (potentially large) body is read at all — an oversized request that would otherwise 413 returns 429 instead when rate-limited", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const request = multipartRequest(validFields());
    request.headers.set("content-length", String(50 * 1024 * 1024));
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(429);
  });

  it("keys the limiter on the Cloudflare-verified client IP, never a client-supplied X-Forwarded-For", async () => {
    rpcMock
      .mockResolvedValueOnce({
        data: {
          slot_id: SLOT_ID,
          lead_id: LEAD_ID,
          attempt_id: ATTEMPT_ID,
          state: "uploading",
          reclaimed: false,
          kind: "seller_photo",
          storage_path: `leads/${LEAD_ID}/slot-0-${SLOT_ID}`,
          upload_object_path: OBJECT_PATH,
          stale_object_path: null,
          original_filename: "photo.jpg",
          declared_mime_type: "image/jpeg",
          declared_byte_size: 20,
          expires_at: "2026-08-13T00:00:00+00:00",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          lead_file_id: "44444444-4444-4444-4444-444444444444",
          slot_id: SLOT_ID,
          lead_id: LEAD_ID,
          kind: "seller_photo",
          storage_path: OBJECT_PATH,
          detected_mime_type: "image/jpeg",
          byte_size: 20,
          checksum: "a".repeat(64),
          verified_at: "2026-08-13T00:00:05+00:00",
        },
        error: null,
      });
    uploadMock.mockResolvedValue({ data: { path: OBJECT_PATH }, error: null });

    await handleQuoteUploadRequest(
      multipartRequest(validFields(), { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "203.0.113.7" }),
    );
    expect(rateLimiterLimitMock).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("fails closed with a generic 500 when the rate-limiter binding is missing — production never runs unprotected", async () => {
    const { RateLimiterConfigurationError } = await import("@/server/rate-limit.server");
    getRateLimiterBindingMock.mockImplementationOnce(() => {
      throw new RateLimiterConfigurationError();
    });

    const response = await handleQuoteUploadRequest(multipartRequest(validFields()));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 500 when the request has no Cloudflare-verified client IP at all", async () => {
    const request = multipartRequest(validFields());
    request.headers.delete("cf-connecting-ip");
    const response = await handleQuoteUploadRequest(request);
    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
