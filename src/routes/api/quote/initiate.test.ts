import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createSupabaseAdminClientMock = vi.fn(() => ({ rpc: rpcMock }));

// No real Supabase client is ever constructed in this file — createSupabaseAdminClient
// itself is mocked, so there is no possibility of a network call to a real project.
vi.mock("@/server/supabase-admin.server", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

const { handleQuoteInitiateRequest } = await import("./initiate");

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
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  rpcMock.mockReset();
  createSupabaseAdminClientMock.mockClear();
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
        padding: "x".repeat(200_000),
      }),
      headers: { "content-type": "application/json" },
    });
    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
