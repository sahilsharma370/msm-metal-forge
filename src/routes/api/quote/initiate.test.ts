import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => ({ rpc: rpcMock }));

// No real Supabase client is ever constructed in this file — createSupabaseAdminClient
// itself is mocked, so there is no possibility of a network call to a real project.
vi.mock("@/server/supabase-admin.server", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Succeeds by default so every existing test in this file reaches the RPC
// exactly as before CHECKPOINT C2G — no real network call to Cloudflare
// Siteverify is ever made from this file.
const turnstileVerifyMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/server/turnstile.server", () => ({
  getTurnstileVerifier: () => ({ verify: turnstileVerifyMock }),
}));

// Allows by default so every existing test in this file reaches the RPC
// exactly as before CHECKPOINT C2G. checkRateLimit/getCloudflareClientIp/
// RATE_LIMIT_RETRY_AFTER_SECONDS are the REAL implementations (spread from
// importOriginal) — only the live Cloudflare binding itself (which cannot
// exist in a Node test process) is faked, exactly like the Supabase client.
// getRateLimiterBindingMock is its own vi.fn() (not a plain closure) so one
// test can override it with mockImplementationOnce to simulate a missing
// binding, without needing vi.spyOn/restoreAllMocks — which would also
// strip the other module-scope mocks' own base implementations.
const rateLimiterLimitMock = vi.fn().mockResolvedValue({ success: true });
const getRateLimiterBindingMock = vi.fn(() => ({ limit: rateLimiterLimitMock }));
vi.mock("@/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => getRateLimiterBindingMock(),
  };
});

const { handleQuoteInitiateRequest } = await import("./initiate");

const CF_CONNECTING_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

const validSeller = {
  intent: "sell",
  source: "hero",
  material: "copper",
  sellerCondition: "clean_separated",
  sellerQuantityValue: "100",
  sellerQuantityUnit: "kg",
  sellerQuantityUnsure: false,
  sellerEmirate: "dubai",
  sellerArea: "Al Quoz Industrial 3",
  sellerPickupRequired: "no",
  sellerName: "Ahmed Seller",
  sellerPhone: "+971501234567",
  sellerPreferredContact: "whatsapp",
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/quote/initiate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADERS, ...headers },
  });
}

afterEach(() => {
  rpcMock.mockReset();
  createSupabaseAdminClientMock.mockClear();
  turnstileVerifyMock.mockReset().mockResolvedValue({ ok: true });
  rateLimiterLimitMock.mockReset().mockResolvedValue({ success: true });
  getRateLimiterBindingMock.mockReset().mockImplementation(() => ({ limit: rateLimiterLimitMock }));
});

describe("handleQuoteInitiateRequest — content type", () => {
  it("rejects a request without a JSON content type", async () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "d0000000-0000-0000-0000-000000000001",
        submission: validSeller,
        files: [],
      }),
      headers: { "content-type": "text/plain" },
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no content-type header at all", async () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: "{}",
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(400);
  });
});

describe("handleQuoteInitiateRequest — exact Content-Type matching", () => {
  const body = {
    idempotencyKey: "d0000000-0000-0000-0000-000000000001",
    submission: validSeller,
    files: [],
    turnstileToken: "valid-turnstile-token",
  };

  beforeEach(() => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        reference: "MSM-260812-ABCDEF",
        idempotent_replay: false,
        upload_slots: [],
      },
      error: null,
    });
  });

  it("accepts application/json", async () => {
    const response = await handleQuoteInitiateRequest(jsonRequest(body, { "content-type": "application/json" }));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("accepts application/json; charset=utf-8", async () => {
    const response = await handleQuoteInitiateRequest(
      jsonRequest(body, { "content-type": "application/json; charset=utf-8" }),
    );
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a differently-cased, whitespace-padded media type", async () => {
    const response = await handleQuoteInitiateRequest(jsonRequest(body, { "content-type": "  APPLICATION/JSON  " }));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("rejects application/jsonp (must not match as a substring of application/json)", async () => {
    const response = await handleQuoteInitiateRequest(jsonRequest(body, { "content-type": "application/jsonp" }));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects text/application/json (must not match as a substring of application/json)", async () => {
    const response = await handleQuoteInitiateRequest(
      jsonRequest(body, { "content-type": "text/application/json" }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty Content-Type header", async () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "" },
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Content-Type header at all", async () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteInitiateRequest — environment failure fails closed", () => {
  it("returns a generic 500 when the Supabase client cannot be constructed (missing env), leaking no detail about the cause", async () => {
    createSupabaseAdminClientMock.mockImplementationOnce(() => {
      throw new Error("Server configuration error.");
    });
    const request = jsonRequest({
      idempotencyKey: "d0000000-0000-0000-0000-000000000001",
      submission: validSeller,
      files: [],
      turnstileToken: "valid-turnstile-token",
    });
    const response = await handleQuoteInitiateRequest(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/SUPABASE|SECRET|env/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteInitiateRequest — end to end with a mocked RPC", () => {
  it("returns 200 for a valid request, calling the (mocked) RPC exactly once", async () => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        reference: "MSM-260812-ABCDEF",
        idempotent_replay: false,
        upload_slots: [],
      },
      error: null,
    });
    const request = jsonRequest({
      idempotencyKey: "d0000000-0000-0000-0000-000000000001",
      submission: validSeller,
      files: [],
      turnstileToken: "valid-turnstile-token",
    });
    const response = await handleQuoteInitiateRequest(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("returns 413 for an oversized body without ever calling the RPC", async () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "d0000000-0000-0000-0000-000000000001",
        submission: validSeller,
        files: [],
        turnstileToken: "valid-turnstile-token",
        padding: "x".repeat(200_000),
      }),
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADERS },
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteInitiateRequest — CHECKPOINT C2G rate limiting", () => {
  const body = {
    idempotencyKey: "d0000000-0000-0000-0000-000000000001",
    submission: validSeller,
    files: [],
    turnstileToken: "valid-turnstile-token",
  };

  it("returns 429 with a stable code, no internals, and a Retry-After header when the limiter reports rejection — before the RPC is ever called", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteInitiateRequest(jsonRequest(body));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    const responseBody = await response.json();
    expect(responseBody.ok).toBe(false);
    expect(responseBody.error.code).toBe("RATE_LIMITED");
    const serialized = JSON.stringify(responseBody);
    expect(serialized).not.toMatch(/203\.0\.113\.7|counter|ip address/i);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("keys the limiter on the Cloudflare-verified client IP, never a client-supplied X-Forwarded-For", async () => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        reference: "MSM-260812-ABCDEF",
        idempotent_replay: false,
        upload_slots: [],
      },
      error: null,
    });
    await handleQuoteInitiateRequest(
      jsonRequest(body, { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "203.0.113.7" }),
    );
    expect(rateLimiterLimitMock).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("fails closed with a generic 500 when the rate-limiter binding is missing — production never runs unprotected", async () => {
    const { RateLimiterConfigurationError } = await import("@/server/rate-limit.server");
    getRateLimiterBindingMock.mockImplementationOnce(() => {
      throw new RateLimiterConfigurationError();
    });

    const response = await handleQuoteInitiateRequest(jsonRequest(body));
    expect(response.status).toBe(500);
    const responseBody = await response.json();
    expect(responseBody.error.code).toBe("INTERNAL_ERROR");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 500 when the request has no Cloudflare-verified client IP at all", async () => {
    const request = jsonRequest(body);
    request.headers.delete("cf-connecting-ip");
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("allows the request through when the limiter reports success", async () => {
    rpcMock.mockResolvedValue({
      data: {
        lead_id: "11111111-1111-1111-1111-111111111111",
        reference: "MSM-260812-ABCDEF",
        idempotent_replay: false,
        upload_slots: [],
      },
      error: null,
    });
    const response = await handleQuoteInitiateRequest(jsonRequest(body));
    expect(response.status).toBe(200);
    expect(rateLimiterLimitMock).toHaveBeenCalledTimes(1);
  });
});
