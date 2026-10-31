import { describe, expect, it, vi } from "vitest";
import { createResendEmailProvider } from "./resend-email-provider.server";
import type { EmailSendInput } from "./notification-email-types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function baseInput(overrides: Partial<EmailSendInput> = {}): EmailSendInput {
  return {
    from: "MSM Scrap <enquiries@msmscrap.example>",
    to: "owner@msmscrap.example",
    subject: "New seller enquiry — MSM-260817-ABCDEF",
    text: "plain text body",
    html: "<p>html body</p>",
    idempotencyKey: "submission_completed/11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

describe("createResendEmailProvider — request shape", () => {
  it("POSTs to the exact official endpoint with the exact method/headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg-1" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    await provider.send(baseInput());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["idempotency-key"]).toBe("submission_completed/11111111-1111-1111-1111-111111111111");
  });

  it("sends from/to/subject/text/html in the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg-1" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    await provider.send(baseInput({ replyTo: "reply@msmscrap.example" }));

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      from: "MSM Scrap <enquiries@msmscrap.example>",
      to: ["owner@msmscrap.example"],
      reply_to: ["reply@msmscrap.example"],
      subject: "New seller enquiry — MSM-260817-ABCDEF",
      text: "plain text body",
      html: "<p>html body</p>",
    });
  });

  it("passes an AbortSignal for the request timeout", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg-1" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    await provider.send(baseInput());

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("createResendEmailProvider — success", () => {
  it("returns ok:true with the provider id and validated provider message id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "re_abc123" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: true, provider: "resend", providerMessageId: "re_abc123" });
  });

  it("accepts a 201 status as success too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { id: "re_abc123" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result.ok).toBe(true);
  });

  it("returns MALFORMED_RESPONSE, not success, when the 200 body doesn't match the expected shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "MALFORMED_RESPONSE", retryable: false });
  });

  it("returns MALFORMED_RESPONSE when the 200 body is not valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "MALFORMED_RESPONSE", retryable: false });
  });
});

describe("createResendEmailProvider — configuration/validation failures", () => {
  it("returns CONFIGURATION_ERROR (never calls fetch) when the API key is empty", async () => {
    const fetchImpl = vi.fn();
    const provider = createResendEmailProvider({ apiKey: "" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "CONFIGURATION_ERROR", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["from", "to", "subject", "replyTo"] as const)(
    "returns INVALID_REQUEST (never calls fetch) when %s contains a newline (header injection guard)",
    async (field) => {
      const fetchImpl = vi.fn();
      const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

      const result = await provider.send(baseInput({ [field]: "value\r\nBcc: attacker@example.com" }));
      expect(result).toEqual({ ok: false, code: "INVALID_REQUEST", retryable: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("createResendEmailProvider — network/timeout classification", () => {
  it("classifies a network failure as NETWORK_ERROR, retryable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "NETWORK_ERROR", retryable: true });
  });

  it("classifies an aborted (timeout) request as TIMEOUT, retryable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "TIMEOUT", retryable: true });
  });
});

describe("createResendEmailProvider — retryable HTTP status classification", () => {
  it.each([
    [408, "TIMEOUT"],
    [425, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"],
    [502, "SERVER_ERROR"],
    [503, "SERVER_ERROR"],
  ] as const)("classifies HTTP %s as %s, retryable:true", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { message: "irrelevant" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code, retryable: true });
  });
});

describe("createResendEmailProvider — permanent HTTP status classification", () => {
  it.each([
    [400, "INVALID_REQUEST"],
    [401, "AUTH_ERROR"],
    [403, "AUTH_ERROR"],
    [404, "ENDPOINT_ERROR"],
    [405, "ENDPOINT_ERROR"],
    [422, "INVALID_RECIPIENT"],
  ] as const)("classifies HTTP %s as %s, retryable:false", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { message: "irrelevant" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code, retryable: false });
  });

  it("classifies an unrecognized status as UNKNOWN_ERROR, retryable:false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(418, { message: "teapot" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "UNKNOWN_ERROR", retryable: false });
  });
});

describe("createResendEmailProvider — 409 idempotency classification", () => {
  it("classifies a concurrent-in-flight 409 as IDEMPOTENCY_CONFLICT_RETRY, retryable:true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { name: "concurrent_idempotent_requests", message: "irrelevant" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT_RETRY", retryable: true });
  });

  it("classifies a conflicting-payload 409 as IDEMPOTENCY_CONFLICT_PERMANENT, retryable:false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { name: "invalid_idempotent_request", message: "irrelevant" }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT_PERMANENT", retryable: false });
  });

  it("defaults an unparseable 409 body to permanent — the safer direction than retrying forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 409 }));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    expect(result).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT_PERMANENT", retryable: false });
  });
});

describe("createResendEmailProvider — no raw response/secret leakage", () => {
  it("never includes the Authorization header value or raw response body in a failure result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        message: "Invalid `to` field: owner@msmscrap.example is not a valid address, key=sk_live_SECRET123",
      }),
    );
    const provider = createResendEmailProvider({ apiKey: "sk_live_SECRET123" }, fetchImpl);

    const result = await provider.send(baseInput());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk_live_SECRET123");
    expect(serialized).not.toContain("Invalid `to` field");
    expect(serialized).not.toContain("owner@msmscrap.example");
    expect(result).toEqual({ ok: false, code: "INVALID_RECIPIENT", retryable: false });
  });

  it("every failure code is a short uppercase machine code (compatible with the database last_error_code constraint)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    const provider = createResendEmailProvider({ apiKey: "test-key" }, fetchImpl);

    const result = await provider.send(baseInput());
    if (!result.ok) {
      expect(result.code).toMatch(/^[A-Z0-9_]{1,40}$/);
    }
  });
});
