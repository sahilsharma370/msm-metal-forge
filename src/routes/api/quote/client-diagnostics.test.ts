import { afterEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => ({ rpc: rpcMock }));

// No real Supabase client is ever constructed in this file — same pattern
// as complete.test.ts: createSupabaseAdminClient itself is mocked, so
// there is no possibility of a network call to a real project.
vi.mock("@/server/supabase-admin.server", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Allows by default so every test reaches the RPC exactly as written —
// same pattern as complete.test.ts. getCloudflareClientIp/
// RATE_LIMIT_RETRY_AFTER_SECONDS are the REAL implementations (spread from
// importOriginal); only the live Cloudflare binding itself is faked.
const rateLimiterLimitMock = vi.fn().mockResolvedValue({ success: true });
const getRateLimiterBindingMock = vi.fn(() => ({ limit: rateLimiterLimitMock }));
vi.mock("@/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => getRateLimiterBindingMock(),
  };
});

const { handleQuoteClientDiagnosticsRequest } = await import("./client-diagnostics");

const CF_CONNECTING_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

const VALID_BODY = {
  stage: "uploading",
  initiateInvoked: true,
  initiateSettled: true,
  subtleAvailable: true,
  getRandomValuesAvailable: true,
  randomUUIDAvailable: false,
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/quote/client-diagnostics", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADERS, ...headers },
  });
}

afterEach(() => {
  rpcMock.mockReset();
  createSupabaseAdminClientMock.mockClear();
  rateLimiterLimitMock.mockReset().mockResolvedValue({ success: true });
  getRateLimiterBindingMock.mockReset().mockImplementation(() => ({ limit: rateLimiterLimitMock }));
});

describe("handleQuoteClientDiagnosticsRequest — method/content-type", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/quote/client-diagnostics", { method: "GET" });
    const response = await handleQuoteClientDiagnosticsRequest(request);
    expect(response.status).toBe(405);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type", async () => {
    const request = new Request("https://example.test/api/quote/client-diagnostics", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: { "content-type": "text/plain" },
    });
    const response = await handleQuoteClientDiagnosticsRequest(request);
    expect(response.status).toBe(400);
  });
});

describe("handleQuoteClientDiagnosticsRequest — rate limiting", () => {
  it("returns 429 with Retry-After when the limiter rejects", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteClientDiagnosticsRequest(jsonRequest(VALID_BODY));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("fails closed (500) when there is no Cloudflare-verified client IP at all", async () => {
    const request = new Request("https://example.test/api/quote/client-diagnostics", {
      method: "POST",
      body: JSON.stringify(VALID_BODY),
      headers: { "content-type": "application/json" },
    });
    const response = await handleQuoteClientDiagnosticsRequest(request);
    expect(response.status).toBe(500);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteClientDiagnosticsRequest — body validation", () => {
  it("rejects malformed JSON", async () => {
    const request = new Request("https://example.test/api/quote/client-diagnostics", {
      method: "POST",
      body: "{not valid json",
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADERS },
    });
    const response = await handleQuoteClientDiagnosticsRequest(request);
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized stage value — the enum is closed, not freeform", async () => {
    const response = await handleQuoteClientDiagnosticsRequest(
      jsonRequest({ ...VALID_BODY, stage: "not_a_real_stage" }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects ANY extra field — a name, phone, token, URL, or payload hash would all be rejected the same way, never silently accepted", async () => {
    const response = await handleQuoteClientDiagnosticsRequest(
      jsonRequest({ ...VALID_BODY, sellerName: "Ahmed Seller", payloadHash: "a".repeat(64) }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean value for a boolean field", async () => {
    const response = await handleQuoteClientDiagnosticsRequest(
      jsonRequest({ ...VALID_BODY, initiateInvoked: "yes" }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before ever reaching Supabase", async () => {
    const request = new Request("https://example.test/api/quote/client-diagnostics", {
      method: "POST",
      body: "x".repeat(2000),
      headers: {
        "content-type": "application/json",
        "content-length": "2000",
        ...CF_CONNECTING_IP_HEADERS,
      },
    });
    const response = await handleQuoteClientDiagnosticsRequest(request);
    expect(response.status).toBe(413);
    // Supabase client construction happens before body reading (same
    // ordering as complete.ts/complete.test.ts) — the RPC itself is what
    // must never be reached, which is what this actually asserts.
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteClientDiagnosticsRequest — success/RPC error mapping", () => {
  it("calls log_quote_client_diagnostic_v1 with the exact six fields, nothing else, and returns ok:true", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const response = await handleQuoteClientDiagnosticsRequest(jsonRequest(VALID_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("log_quote_client_diagnostic_v1", {
      p_stage: "uploading",
      p_initiate_invoked: true,
      p_initiate_settled: true,
      p_subtle_available: true,
      p_get_random_values_available: true,
      p_random_uuid_available: false,
    });
  });

  it("maps an RPC error to a generic 500 — never the raw Postgres error text", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation does not exist: some internal detail" } });
    const response = await handleQuoteClientDiagnosticsRequest(jsonRequest(VALID_BODY));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("relation does not exist");
  });

  it("maps a rejected RPC call (network failure) to the same generic 500", async () => {
    rpcMock.mockRejectedValue(new Error("connection reset"));
    const response = await handleQuoteClientDiagnosticsRequest(jsonRequest(VALID_BODY));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});
