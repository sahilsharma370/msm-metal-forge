import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => ({ rpc: rpcMock }));

// No real Supabase client is ever constructed in this file — createSupabaseAdminClient
// itself is mocked, so there is no possibility of a network call to a real project.
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

// CHECKPOINT C2H-B2 — isolated vi.fn()s (not vi.spyOn + restoreAllMocks),
// matching this file's own established pattern for getRateLimiterBindingMock
// above: avoids any risk of one mock's teardown clobbering another's base
// implementation. Defaults to a present binding + successful publish so
// every pre-existing test in this file is unaffected unless it explicitly
// overrides one of these.
const getOwnerNotificationQueueBindingMock = vi.fn((_request: Request) => ({ send: vi.fn().mockResolvedValue(undefined) }));
const publishOwnerNotificationWakeupMock = vi.fn().mockResolvedValue({ published: true });
vi.mock("@/server/notifications/queue-producer.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/notifications/queue-producer.server")>();
  return {
    ...actual,
    getOwnerNotificationQueueBinding: (request: Request) => getOwnerNotificationQueueBindingMock(request),
    publishOwnerNotificationWakeup: (binding: unknown) => publishOwnerNotificationWakeupMock(binding),
  };
});

const { handleQuoteCompleteRequest } = await import("./complete");

const CF_CONNECTING_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "d0000000-0000-0000-0000-000000000001";
const REFERENCE = "MSM-260813-ABCDEF";

const rpcSuccessPayload = {
  lead_id: LEAD_ID,
  reference: REFERENCE,
  submission_completed_at: "2026-08-13T12:00:00+00:00",
  already_completed: false,
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/quote/complete", {
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
  getOwnerNotificationQueueBindingMock.mockReset().mockImplementation(() => ({ send: vi.fn().mockResolvedValue(undefined) }));
  publishOwnerNotificationWakeupMock.mockReset().mockResolvedValue({ published: true });
});

describe("handleQuoteCompleteRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/quote/complete", { method: "GET" });
    const response = await handleQuoteCompleteRequest(request);
    expect(response.status).toBe(405);
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteCompleteRequest — content type", () => {
  it("rejects a request without a JSON content type", async () => {
    const request = new Request("https://example.test/api/quote/complete", {
      method: "POST",
      body: JSON.stringify({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
      headers: { "content-type": "text/plain" },
    });
    const response = await handleQuoteCompleteRequest(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createSupabaseAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Content-Type header at all", async () => {
    const request = new Request("https://example.test/api/quote/complete", {
      method: "POST",
      body: "{}",
    });
    const response = await handleQuoteCompleteRequest(request);
    expect(response.status).toBe(400);
  });

  it("accepts application/json; charset=utf-8", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    const response = await handleQuoteCompleteRequest(
      jsonRequest(
        { leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY },
        { "content-type": "application/json; charset=utf-8" },
      ),
    );
    expect(response.status).toBe(200);
  });
});

describe("handleQuoteCompleteRequest — environment failure fails closed", () => {
  it("returns a generic 500 when the Supabase client cannot be constructed, leaking no detail about the cause", async () => {
    createSupabaseAdminClientMock.mockImplementationOnce(() => {
      throw new Error("Server configuration error.");
    });
    const request = jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY });
    const response = await handleQuoteCompleteRequest(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/SUPABASE|SECRET|env/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteCompleteRequest — end to end with a mocked RPC", () => {
  it("returns 200 for a fresh completion, calling the (mocked) RPC exactly once", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    const request = jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY });
    const response = await handleQuoteCompleteRequest(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toBe(REFERENCE);
    expect(body.data.alreadyCompleted).toBe(false);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with alreadyCompleted=true for an idempotent replay", async () => {
    rpcMock.mockResolvedValue({ data: { ...rpcSuccessPayload, already_completed: true }, error: null });
    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.alreadyCompleted).toBe(true);
  });

  it("returns 409 NOT_READY when the RPC reports the submission is not ready", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "complete_website_quote_v1: lead 11111111-1111-1111-1111-111111111111 is not yet ready to complete (NOT_READY)" },
    });
    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_READY");
    expect(body.error.retryable).toBe(true);
  });

  it("returns 404 NOT_FOUND for a wrong idempotency key or missing lead, with no internals leaked", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" },
    });
    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(LEAD_ID);
  });

  it("returns 413 for an oversized body without ever calling the RPC", async () => {
    const request = new Request("https://example.test/api/quote/complete", {
      method: "POST",
      body: JSON.stringify({
        leadId: LEAD_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        padding: "x".repeat(10_000),
      }),
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADERS },
    });
    const response = await handleQuoteCompleteRequest(request);
    expect(response.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an unexpected extra field before ever calling the RPC", async () => {
    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY, reference: "MSM-FORGED-000000" }),
    );
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("handleQuoteCompleteRequest — CHECKPOINT C2G rate limiting", () => {
  it("returns 429 with a stable code, no internals, and a Retry-After header when the limiter reports rejection — before the RPC is ever called", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    );

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

  it("keys the limiter on the Cloudflare-verified client IP, never a client-supplied X-Forwarded-For", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    await handleQuoteCompleteRequest(
      jsonRequest(
        { leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY },
        { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "203.0.113.7" },
      ),
    );
    expect(rateLimiterLimitMock).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("fails closed with a generic 500 when the rate-limiter binding is missing — production never runs unprotected", async () => {
    const { RateLimiterConfigurationError } = await import("@/server/rate-limit.server");
    getRateLimiterBindingMock.mockImplementationOnce(() => {
      throw new RateLimiterConfigurationError();
    });

    const response = await handleQuoteCompleteRequest(
      jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 500 when the request has no Cloudflare-verified client IP at all", async () => {
    const request = jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY });
    request.headers.delete("cf-connecting-ip");
    const response = await handleQuoteCompleteRequest(request);
    expect(response.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("separate route counters: this route's limiter is distinct from initiate's/upload's own bindings", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    const { RATE_LIMITER_BINDING_NAMES } = await import("@/server/rate-limit.server");
    // This file's own mock only ever stands in for RATE_LIMITER_COMPLETE —
    // proving the route asks for exactly that binding name (not initiate's
    // or upload's) is what "separate route-aware limits" means structurally.
    expect(RATE_LIMITER_BINDING_NAMES.complete).toBe("RATE_LIMITER_COMPLETE");
    expect(RATE_LIMITER_BINDING_NAMES.complete).not.toBe(RATE_LIMITER_BINDING_NAMES.initiate);
    expect(RATE_LIMITER_BINDING_NAMES.complete).not.toBe(RATE_LIMITER_BINDING_NAMES.upload);
  });
});

describe("handleQuoteCompleteRequest — CHECKPOINT C2H-B2 Queue wake-up", () => {
  it("attempts a Queue wake-up publish after a successful fresh completion", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(200);
    expect(publishOwnerNotificationWakeupMock).toHaveBeenCalledTimes(1);
  });

  it("attempts a Queue wake-up publish after a successful idempotent replay (already_completed:true) too — a duplicate wake-up is harmless", async () => {
    rpcMock.mockResolvedValue({ data: { ...rpcSuccessPayload, already_completed: true }, error: null });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(200);
    expect(publishOwnerNotificationWakeupMock).toHaveBeenCalledTimes(1);
  });

  it("Queue publish failure cannot change the successful HTTP response", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    publishOwnerNotificationWakeupMock.mockResolvedValue({ published: false });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toBe(REFERENCE);
  });

  it("does not publish a wake-up for a NOT_READY (unsuccessful) completion attempt", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "complete_website_quote_v1: lead 11111111-1111-1111-1111-111111111111 is not yet ready to complete (NOT_READY)" },
    });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(409);
    expect(publishOwnerNotificationWakeupMock).not.toHaveBeenCalled();
  });

  it("does not publish a wake-up for a NOT_FOUND completion attempt", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" },
    });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(404);
    expect(publishOwnerNotificationWakeupMock).not.toHaveBeenCalled();
  });

  it("does not publish a wake-up when validation/rate-limiting rejects the request before the RPC is ever called", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    expect(response.status).toBe(429);
    expect(publishOwnerNotificationWakeupMock).not.toHaveBeenCalled();
  });

  it("the browser response body never contains Queue/provider internals, even when the publish is attempted", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    const response = await handleQuoteCompleteRequest(jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY }));
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/queue|published|binding|wakeup/i);
    expect(Object.keys(body)).toEqual(["ok", "data"]);
  });

  it("CHECKPOINT C2I-B: resolves the Queue binding from the request's own Cloudflare runtime env, never process.env", async () => {
    rpcMock.mockResolvedValue({ data: rpcSuccessPayload, error: null });
    const request = jsonRequest({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY });
    await handleQuoteCompleteRequest(request);
    expect(getOwnerNotificationQueueBindingMock).toHaveBeenCalledTimes(1);
    expect(getOwnerNotificationQueueBindingMock).toHaveBeenCalledWith(request);
  });
});
