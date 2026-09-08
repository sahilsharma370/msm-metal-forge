import { describe, expect, it, vi } from "vitest";
import {
  handleCompleteQuoteBody,
  readBoundedBody,
  BodyTooLargeError,
  type CompleteQuoteRpcClient,
} from "./complete-quote";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const IDEMPOTENCY_KEY = "d0000000-0000-0000-0000-000000000001";
const REFERENCE = "MSM-260813-ABCDEF";
const SUBMISSION_COMPLETED_AT = "2026-08-13T12:00:00+00:00";

interface RpcCallArgs {
  p_lead_id: string;
  p_idempotency_key: string;
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ leadId: LEAD_ID, idempotencyKey: IDEMPOTENCY_KEY, ...overrides });
}

const freshCompletionPayload = {
  lead_id: LEAD_ID,
  reference: REFERENCE,
  submission_completed_at: SUBMISSION_COMPLETED_AT,
  already_completed: false,
};

const alreadyCompletedPayload = {
  ...freshCompletionPayload,
  already_completed: true,
};

/** A fake RPC client — no real Supabase client, no network access, ever. */
function fakeRpc(response: {
  data: unknown;
  error: { message: string } | null;
}): CompleteQuoteRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn().mockResolvedValue(response) };
}

describe("handleCompleteQuoteBody — happy paths", () => {
  it("maps a fresh completion to a 200 with the expected shape", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      data: {
        leadId: LEAD_ID,
        reference: REFERENCE,
        submissionCompletedAt: SUBMISSION_COMPLETED_AT,
        alreadyCompleted: false,
      },
    });
  });

  it("maps an idempotent replay (already_completed=true) to a 200 as well — a safe, genuine result", async () => {
    const rpc = fakeRpc({ data: alreadyCompletedPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(200);
    if (result.body.ok) {
      expect(result.body.data.alreadyCompleted).toBe(true);
      expect(result.body.data.reference).toBe(REFERENCE);
    }
  });
});

describe("handleCompleteQuoteBody — RPC call contract", () => {
  it("calls complete_website_quote_v1 exactly once with the exact validated arguments", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(rpc.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.rpc.mock.calls[0] as [string, RpcCallArgs];
    expect(fn).toBe("complete_website_quote_v1");
    expect(args).toEqual({ p_lead_id: LEAD_ID, p_idempotency_key: IDEMPOTENCY_KEY });
  });

  it("never passes through a client-supplied reference/status/success field — the RPC call args have no such keys", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    await handleCompleteQuoteBody(
      JSON.stringify({
        leadId: LEAD_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        reference: "MSM-FORGED-000000",
        alreadyCompleted: true,
        status: "complete",
      }),
      { rpc },
    );
    // The forged extra keys make this an unknown-key request — rejected
    // before the RPC is ever called, not silently stripped and forwarded.
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("the RPC is invoked no more than once per request, even on failure paths", async () => {
    const rpc = fakeRpc({ data: null, error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" } });
    await handleCompleteQuoteBody(requestBody(), { rpc });
    expect(rpc.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("handleCompleteQuoteBody — malformed request rejections", () => {
  it("rejects an empty body as malformed JSON", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody("", { rpc });
    expect(result.status).toBe(400);
    if (!result.body.ok) expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody("{not valid json", { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a JSON array instead of an object", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(JSON.stringify([LEAD_ID, IDEMPOTENCY_KEY]), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a JSON primitive instead of an object", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(JSON.stringify("just-a-string"), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a request with an unknown key", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody({ extra: "field" }), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a request missing leadId", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(JSON.stringify({ idempotencyKey: IDEMPOTENCY_KEY }), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a request missing idempotencyKey", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(JSON.stringify({ leadId: LEAD_ID }), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed leadId (not a UUID)", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody({ leadId: "not-a-uuid" }), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed idempotencyKey (not a UUID)", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody({ idempotencyKey: "not-a-uuid" }), { rpc });
    expect(result.status).toBe(400);
    expect(rpc.rpc).not.toHaveBeenCalled();
  });

  it("returns fieldErrors for a validation failure", async () => {
    const rpc = fakeRpc({ data: freshCompletionPayload, error: null });
    const result = await handleCompleteQuoteBody(requestBody({ leadId: "not-a-uuid" }), { rpc });
    if (!result.body.ok) {
      expect(result.body.error.fieldErrors?.length).toBeGreaterThan(0);
    }
  });
});

describe("handleCompleteQuoteBody — RPC failure mapping", () => {
  it("maps the not-found RPC error to a safe 404 with no internals leaked", async () => {
    const rpc = fakeRpc({
      data: null,
      error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" },
    });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(404);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("NOT_FOUND");
      expect(result.body.error.retryable).toBe(false);
    }
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(LEAD_ID);
    expect(serialized).not.toContain(IDEMPOTENCY_KEY);
  });

  it("produces an identical not-found response for a wrong idempotency key and for a nonexistent lead — no enumeration leak", async () => {
    const rpcWrongKey = fakeRpc({
      data: null,
      error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" },
    });
    const rpcMissingLead = fakeRpc({
      data: null,
      error: { message: "complete_website_quote_v1: lead not found for the supplied idempotency key" },
    });

    const resultWrongKey = await handleCompleteQuoteBody(requestBody(), { rpc: rpcWrongKey });
    const resultMissingLead = await handleCompleteQuoteBody(
      requestBody({ leadId: "22222222-2222-2222-2222-222222222222" }),
      { rpc: rpcMissingLead },
    );

    expect(resultWrongKey.status).toBe(resultMissingLead.status);
    expect(resultWrongKey.body).toEqual(resultMissingLead.body);
  });

  it("maps the NOT_READY RPC error to a retryable 409", async () => {
    const rpc = fakeRpc({
      data: null,
      error: { message: "complete_website_quote_v1: lead 11111111-1111-1111-1111-111111111111 is not yet ready to complete (NOT_READY)" },
    });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("NOT_READY");
      expect(result.body.error.retryable).toBe(true);
    }
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(LEAD_ID);
  });

  it("maps an unrelated Supabase/Postgres error to a generic 500 with no SQL/internals leaked", async () => {
    const rpc = fakeRpc({
      data: null,
      error: { message: 'new row for relation "leads" violates check constraint "leads_website_requiredness"' },
    });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain("leads_website_requiredness");
      expect(serialized).not.toContain("relation");
    }
  });

  it("maps a malformed/unexpected RPC success payload to a generic 500", async () => {
    const rpc = fakeRpc({ data: { unexpected: "shape" }, error: null });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });
    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("maps a rejected RPC call (network failure/timeout) to a generic, sanitized 500", async () => {
    const rpc: CompleteQuoteRpcClient & { rpc: ReturnType<typeof vi.fn> } = {
      rpc: vi.fn().mockRejectedValue(new Error("ETIMEDOUT: connection to database timed out at 10.0.0.5:5432")),
    };
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });

    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
    }
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("ETIMEDOUT");
    expect(serialized).not.toContain("10.0.0.5");
    expect(serialized).not.toMatch(/postgres|supabase/i);
  });

  it("never includes the idempotency key, lead id, or raw payload anywhere in an error response", async () => {
    const rpc = fakeRpc({ data: null, error: { message: "some db failure" } });
    const result = await handleCompleteQuoteBody(requestBody(), { rpc });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain(LEAD_ID);
    expect(serialized).not.toContain(IDEMPOTENCY_KEY);
  });
});

describe("readBoundedBody", () => {
  function requestWithBody(body: string, contentLength?: number): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (contentLength !== undefined) headers.set("content-length", String(contentLength));
    return new Request("https://example.test/api/quote/complete", {
      method: "POST",
      body,
      headers,
    });
  }

  it("reads a body under the limit", async () => {
    const body = JSON.stringify({ ok: true });
    const text = await readBoundedBody(requestWithBody(body), 1024);
    expect(text).toBe(body);
  });

  it("rejects via Content-Length fast path when it exceeds the limit", async () => {
    const body = "x".repeat(100);
    await expect(readBoundedBody(requestWithBody(body, 10_000), 50)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("rejects based on actual bytes read when Content-Length is absent or wrong", async () => {
    const oversized = "x".repeat(200);
    const request = new Request("https://example.test/api/quote/complete", {
      method: "POST",
      body: oversized,
      headers: { "content-type": "application/json" },
    });
    request.headers.delete("content-length");
    await expect(readBoundedBody(request, 50)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
