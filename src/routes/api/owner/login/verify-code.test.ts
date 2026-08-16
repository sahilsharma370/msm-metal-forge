import { afterEach, describe, expect, it, vi } from "vitest";

const verifyOtpMock = vi.fn().mockResolvedValue({
  data: { session: { access_token: "at-1", refresh_token: "rt-1", expires_at: 1_700_000_000 } },
  error: null,
});
const getOwnerLoginAuthClientMock = vi.fn(() => ({ signInWithOtp: vi.fn(), verifyOtp: verifyOtpMock }));

vi.mock("@/server/owner-auth/owner-login.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-auth/owner-login.server")>();
  return {
    ...actual,
    getOwnerLoginAuthClient: () => getOwnerLoginAuthClientMock(),
  };
});

const rateLimiterLimitMock = vi.fn().mockResolvedValue({ success: true });
const getRateLimiterBindingMock = vi.fn((_routeClass: string) => ({ limit: rateLimiterLimitMock }));
vi.mock("@/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: (routeClass: string) => {
      getRateLimiterBindingMock(routeClass);
      return { limit: rateLimiterLimitMock };
    },
  };
});

const { handleOwnerLoginVerifyCodeRequest } = await import("./verify-code");

const CF_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/owner/login/verify-code", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...CF_IP_HEADERS, ...headers },
  });
}

afterEach(() => {
  verifyOtpMock.mockReset().mockResolvedValue({
    data: { session: { access_token: "at-1", refresh_token: "rt-1", expires_at: 1_700_000_000 } },
    error: null,
  });
  getOwnerLoginAuthClientMock.mockClear();
  rateLimiterLimitMock.mockReset().mockResolvedValue({ success: true });
  getRateLimiterBindingMock.mockReset();
});

describe("handleOwnerLoginVerifyCodeRequest — method/content-type", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/owner/login/verify-code", { method: "GET" });
    const response = await handleOwnerLoginVerifyCodeRequest(request);
    expect(response.status).toBe(405);
  });

  it("rejects a non-JSON content type", async () => {
    const request = new Request("https://example.test/api/owner/login/verify-code", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.test", code: "123456" }),
      headers: { "content-type": "text/plain", ...CF_IP_HEADERS },
    });
    const response = await handleOwnerLoginVerifyCodeRequest(request);
    expect(response.status).toBe(400);
  });
});

describe("handleOwnerLoginVerifyCodeRequest — rate limiting", () => {
  it("uses the ownerLoginVerifyCode binding (distinct from ownerLoginRequestCode)", async () => {
    await handleOwnerLoginVerifyCodeRequest(jsonRequest({ email: "owner@example.test", code: "123456" }));
    expect(getRateLimiterBindingMock).toHaveBeenCalledWith("ownerLoginVerifyCode");
  });

  it("returns 429 with a Retry-After header when the limiter rejects", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleOwnerLoginVerifyCodeRequest(jsonRequest({ email: "owner@example.test", code: "123456" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLoginVerifyCodeRequest — happy and failure paths", () => {
  it("returns session tokens on a valid code", async () => {
    const response = await handleOwnerLoginVerifyCodeRequest(jsonRequest({ email: "owner@example.test", code: "123456" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, session: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: 1_700_000_000 } });
  });

  it("returns 401 INVALID_OR_EXPIRED_CODE on a bad code", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: null }, error: { message: "Token has expired or is invalid" } });
    const response = await handleOwnerLoginVerifyCodeRequest(jsonRequest({ email: "owner@example.test", code: "000000" }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_OR_EXPIRED_CODE");
  });

  it("rejects a malformed code before calling verifyOtp", async () => {
    const response = await handleOwnerLoginVerifyCodeRequest(jsonRequest({ email: "owner@example.test", code: "abc" }));
    expect(response.status).toBe(400);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});
