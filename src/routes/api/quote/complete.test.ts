import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => ({ rpc: rpcMock }));

// No real Supabase client is ever constructed in this file — createSupabaseAdminClient
// itself is mocked, so there is no possibility of a network call to a real project.
vi.mock("@/server/supabase-admin.server", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

const { handleQuoteCompleteRequest } = await import("./complete");

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
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  rpcMock.mockReset();
  createSupabaseAdminClientMock.mockClear();
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
      headers: { "content-type": "application/json" },
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
