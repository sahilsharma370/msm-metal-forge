import { describe, expect, it, vi } from "vitest";
import {
  handleOwnerLoginRequestCodeBody,
  handleOwnerLoginVerifyCodeBody,
  type HandleOwnerLoginDeps,
  type OwnerLoginAuthClient,
} from "./owner-login.server";

function deps(overrides: Partial<OwnerLoginAuthClient> = {}): HandleOwnerLoginDeps {
  const auth: OwnerLoginAuthClient = {
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({
      data: { session: { access_token: "at-1", refresh_token: "rt-1", expires_at: 1_700_000_000 } },
      error: null,
    }),
    ...overrides,
  };
  return { auth };
}

describe("handleOwnerLoginRequestCodeBody — malformed input", () => {
  it("rejects invalid JSON", async () => {
    const d = deps();
    const result = await handleOwnerLoginRequestCodeBody("not json", d);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, error: { code: "VALIDATION_ERROR", message: expect.any(String) } });
    expect(d.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects a body missing email", async () => {
    const d = deps();
    const result = await handleOwnerLoginRequestCodeBody("{}", d);
    expect(result.status).toBe(400);
    expect(d.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const d = deps();
    const result = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "not-an-email" }), d);
    expect(result.status).toBe(400);
    expect(d.auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLoginRequestCodeBody — shouldCreateUser:false, always generic", () => {
  it("calls signInWithOtp with shouldCreateUser:false for a valid email", async () => {
    const d = deps();
    await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "owner@example.test" }), d);
    expect(d.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("lowercases the email before calling Supabase", async () => {
    const d = deps();
    await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "Owner@Example.Test" }), d);
    expect(d.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("returns the exact same generic 200 response when signInWithOtp succeeds", async () => {
    const d = deps({ signInWithOtp: vi.fn().mockResolvedValue({ error: null }) });
    const result = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "registered@example.test" }), d);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, message: expect.any(String) });
  });

  it("returns the exact same generic 200 response when signInWithOtp errors (e.g. unknown/unauthorized email) — no enumeration", async () => {
    const d = deps({ signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "Signups not allowed for otp" } }) });
    const result = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "unknown@example.test" }), d);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, message: expect.any(String) });
  });

  it("returns the exact same generic 200 response even when signInWithOtp throws", async () => {
    const d = deps({ signInWithOtp: vi.fn().mockRejectedValue(new Error("network down")) });
    const result = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "owner@example.test" }), d);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, message: expect.any(String) });
  });

  it("the generic message is byte-for-byte identical across a registered and an unregistered email", async () => {
    const registeredDeps = deps({ signInWithOtp: vi.fn().mockResolvedValue({ error: null }) });
    const unknownDeps = deps({ signInWithOtp: vi.fn().mockResolvedValue({ error: { message: "user not found" } }) });
    const registeredResult = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "registered@example.test" }), registeredDeps);
    const unknownResult = await handleOwnerLoginRequestCodeBody(JSON.stringify({ email: "unknown@example.test" }), unknownDeps);
    expect(registeredResult.body).toEqual(unknownResult.body);
    expect(registeredResult.status).toBe(unknownResult.status);
  });
});

describe("handleOwnerLoginVerifyCodeBody — malformed input", () => {
  it("rejects invalid JSON", async () => {
    const d = deps();
    const result = await handleOwnerLoginVerifyCodeBody("not json", d);
    expect(result.status).toBe(400);
    expect(d.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a code that isn't exactly 6 digits", async () => {
    const d = deps();
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "12345" }), d);
    expect(result.status).toBe(400);
    expect(d.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a code containing non-digit characters", async () => {
    const d = deps();
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "12a456" }), d);
    expect(result.status).toBe(400);
  });

  it("rejects a missing email", async () => {
    const d = deps();
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ code: "123456" }), d);
    expect(result.status).toBe(400);
  });
});

describe("handleOwnerLoginVerifyCodeBody — valid code path", () => {
  it("returns the session tokens on success", async () => {
    const d = deps();
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "123456" }), d);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      session: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: 1_700_000_000 },
    });
  });

  it("defaults expiresAt when Supabase omits expires_at", async () => {
    const d = deps({
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: "at-1", refresh_token: "rt-1" } }, error: null }),
    });
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "123456" }), d);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    if (result.body.ok) {
      expect(result.body.session.expiresAt).toBeGreaterThan(0);
    }
  });
});

describe("handleOwnerLoginVerifyCodeBody — invalid/expired code (single generic outcome)", () => {
  it("returns 401 INVALID_OR_EXPIRED_CODE when verifyOtp errors", async () => {
    const d = deps({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { message: "Token has expired or is invalid" } }) });
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "000000" }), d);
    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "INVALID_OR_EXPIRED_CODE", message: expect.any(String) },
    });
  });

  it("returns 401 INVALID_OR_EXPIRED_CODE when verifyOtp returns no session and no error (defensive)", async () => {
    const d = deps({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) });
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "000000" }), d);
    expect(result.status).toBe(401);
  });

  it("returns 500 INTERNAL_ERROR when verifyOtp throws, and the thrown error is never included in the response", async () => {
    const d = deps({ verifyOtp: vi.fn().mockRejectedValue(new Error("db credential leaked-secret-value")) });
    const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "000000" }), d);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toMatch(/leaked-secret-value/);
  });

  it("never distinguishes an invalid code from an expired code in the response body", async () => {
    const invalidDeps = deps({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { message: "Invalid token" } }) });
    const expiredDeps = deps({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: { message: "Token expired" } }) });
    const invalidResult = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "111111" }), invalidDeps);
    const expiredResult = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email: "owner@example.test", code: "222222" }), expiredDeps);
    expect(invalidResult.body).toEqual(expiredResult.body);
    expect(invalidResult.status).toBe(expiredResult.status);
  });
});
