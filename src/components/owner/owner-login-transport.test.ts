import { describe, expect, it, vi } from "vitest";
import { createOwnerLoginTransport } from "./owner-login-transport";

function fakeFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({}),
    ...response,
  }) as unknown as typeof fetch;
}

describe("createOwnerLoginTransport — requestCode", () => {
  it("returns kind:'sent' on a generic 200 success", async () => {
    const fetchImpl = fakeFetch({ status: 200, json: async () => ({ ok: true, message: "generic message" }) });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.requestCode("owner@example.test");
    expect(result).toEqual({ kind: "sent", message: "generic message" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/owner/login/request-code",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "owner@example.test" }) }),
    );
  });

  it("returns kind:'rate_limited' on HTTP 429", async () => {
    const fetchImpl = fakeFetch({ status: 429 });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.requestCode("owner@example.test");
    expect(result).toEqual({ kind: "rate_limited" });
  });

  it("returns kind:'error' when the fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.requestCode("owner@example.test");
    expect(result.kind).toBe("error");
  });

  it("returns kind:'error' when the response body doesn't match the expected schema", async () => {
    const fetchImpl = fakeFetch({ status: 200, json: async () => ({ unexpected: "shape" }) });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.requestCode("owner@example.test");
    expect(result.kind).toBe("error");
  });

  it("returns kind:'error' with the server's message on a validation error", async () => {
    const fetchImpl = fakeFetch({
      status: 400,
      json: async () => ({ ok: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } }),
    });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.requestCode("bad");
    expect(result).toEqual({ kind: "error", message: "Enter a valid email address." });
  });
});

describe("createOwnerLoginTransport — verifyCode", () => {
  it("returns kind:'verified' with session tokens on success", async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      json: async () => ({ ok: true, session: { accessToken: "at", refreshToken: "rt", expiresAt: 123 } }),
    });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.verifyCode("owner@example.test", "123456");
    expect(result).toEqual({ kind: "verified", session: { accessToken: "at", refreshToken: "rt", expiresAt: 123 } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/owner/login/verify-code",
      expect.objectContaining({ body: JSON.stringify({ email: "owner@example.test", code: "123456" }) }),
    );
  });

  it("returns kind:'invalid_or_expired' when the server reports that code", async () => {
    const fetchImpl = fakeFetch({
      status: 401,
      json: async () => ({ ok: false, error: { code: "INVALID_OR_EXPIRED_CODE", message: "That code is invalid or has expired." } }),
    });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.verifyCode("owner@example.test", "000000");
    expect(result).toEqual({ kind: "invalid_or_expired", message: "That code is invalid or has expired." });
  });

  it("returns kind:'rate_limited' on HTTP 429", async () => {
    const fetchImpl = fakeFetch({ status: 429 });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.verifyCode("owner@example.test", "000000");
    expect(result).toEqual({ kind: "rate_limited" });
  });

  it("returns kind:'error' for any other error code", async () => {
    const fetchImpl = fakeFetch({
      status: 500,
      json: async () => ({ ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }),
    });
    const transport = createOwnerLoginTransport(fetchImpl);
    const result = await transport.verifyCode("owner@example.test", "000000");
    expect(result).toEqual({ kind: "error", message: "Something went wrong. Please try again." });
  });
});
