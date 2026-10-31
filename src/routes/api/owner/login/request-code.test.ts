import { afterEach, describe, expect, it, vi } from "vitest";

const signInWithOtpMock = vi.fn().mockResolvedValue({ error: null });
const getOwnerLoginAuthClientMock = vi.fn(() => ({ signInWithOtp: signInWithOtpMock, verifyOtp: vi.fn() }));

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
    getRateLimiterBinding: (_request: Request, routeClass: string) => {
      getRateLimiterBindingMock(routeClass);
      return { limit: rateLimiterLimitMock };
    },
  };
});

const { handleOwnerLoginRequestCodeRequest } = await import("./request-code");

const CF_IP_HEADERS = { "cf-connecting-ip": "203.0.113.7" };

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/owner/login/request-code", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...CF_IP_HEADERS, ...headers },
  });
}

afterEach(() => {
  signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
  getOwnerLoginAuthClientMock.mockClear();
  rateLimiterLimitMock.mockReset().mockResolvedValue({ success: true });
  getRateLimiterBindingMock.mockReset();
});

describe("handleOwnerLoginRequestCodeRequest — method/content-type", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/owner/login/request-code", { method: "GET" });
    const response = await handleOwnerLoginRequestCodeRequest(request);
    expect(response.status).toBe(405);
  });

  it("rejects a non-JSON content type", async () => {
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.test" }),
      headers: { "content-type": "text/plain", ...CF_IP_HEADERS },
    });
    const response = await handleOwnerLoginRequestCodeRequest(request);
    expect(response.status).toBe(400);
    expect(getOwnerLoginAuthClientMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLoginRequestCodeRequest — rate limiting", () => {
  it("uses the ownerLoginRequestCode binding", async () => {
    await handleOwnerLoginRequestCodeRequest(jsonRequest({ email: "owner@example.test" }));
    expect(getRateLimiterBindingMock).toHaveBeenCalledWith("ownerLoginRequestCode");
  });

  it("returns 429 with a Retry-After header when the limiter rejects", async () => {
    rateLimiterLimitMock.mockResolvedValue({ success: false });
    const response = await handleOwnerLoginRequestCodeRequest(jsonRequest({ email: "owner@example.test" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("returns 500 when there is no Cloudflare-verified client IP", async () => {
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.test" }),
      headers: { "content-type": "application/json" },
    });
    const response = await handleOwnerLoginRequestCodeRequest(request);
    expect(response.status).toBe(500);
  });
});

describe("handleOwnerLoginRequestCodeRequest — happy path and body limits", () => {
  it("returns the generic success body for a valid email", async () => {
    const response = await handleOwnerLoginRequestCodeRequest(jsonRequest({ email: "owner@example.test" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, message: expect.any(String) });
    expect(signInWithOtpMock).toHaveBeenCalledWith({ email: "owner@example.test", options: { shouldCreateUser: false } });
  });

  it("rejects an oversized body with 413", async () => {
    const hugeEmail = `${"a".repeat(6000)}@example.test`;
    const response = await handleOwnerLoginRequestCodeRequest(
      jsonRequest({ email: hugeEmail }, { "content-length": String(6100) }),
    );
    expect(response.status).toBe(413);
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });
});
