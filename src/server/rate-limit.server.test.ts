import { describe, expect, it, vi } from "vitest";
import {
  RATE_LIMITER_BINDING_NAMES,
  RateLimiterConfigurationError,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "./rate-limit.server";

/** Matches exactly what Nitro's cloudflare-module preset attaches to a real Request (see this module's own doc comment) — nothing more is needed to fake it. */
function fakeCloudflareRequest(env: Record<string, unknown> = {}): Request {
  const request = new Request("https://example.test/");
  Object.assign(request, { runtime: { cloudflare: { env } } });
  return request;
}

describe("getRateLimiterBinding — fails closed when missing/misshapen", () => {
  it("throws RateLimiterConfigurationError when the request has no attached Cloudflare env at all (e.g. plain vite dev, no Workers runtime)", () => {
    const request = new Request("https://example.test/");
    expect(() => getRateLimiterBinding(request, "initiate")).toThrow(RateLimiterConfigurationError);
  });

  it("throws RateLimiterConfigurationError when the binding is entirely absent from the attached env", () => {
    const request = fakeCloudflareRequest({});
    expect(() => getRateLimiterBinding(request, "initiate")).toThrow(RateLimiterConfigurationError);
  });

  it("throws when the env value exists but has no limit() method (e.g. a plain string, matching an accidental misconfiguration)", () => {
    const request = fakeCloudflareRequest({ [RATE_LIMITER_BINDING_NAMES.initiate]: "not-a-binding" });
    expect(() => getRateLimiterBinding(request, "initiate")).toThrow(RateLimiterConfigurationError);
  });

  it("the thrown error message never reveals which binding was missing", () => {
    const request = fakeCloudflareRequest({});
    try {
      getRateLimiterBinding(request, "upload");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/RATE_LIMITER|upload/i);
    }
  });

  it("returns the live binding object when present and correctly shaped, for every route class including the owner-login ones", () => {
    for (const routeClass of Object.keys(RATE_LIMITER_BINDING_NAMES) as (keyof typeof RATE_LIMITER_BINDING_NAMES)[]) {
      const fakeBinding = { limit: vi.fn() };
      const request = fakeCloudflareRequest({ [RATE_LIMITER_BINDING_NAMES[routeClass]]: fakeBinding });
      expect(getRateLimiterBinding(request, routeClass)).toBe(fakeBinding);
    }
  });

  it("reads the binding from the exact Request instance passed in, never a different/global source", () => {
    const boundBinding = { limit: vi.fn() };
    const boundRequest = fakeCloudflareRequest({ [RATE_LIMITER_BINDING_NAMES.complete]: boundBinding });
    const unboundRequest = fakeCloudflareRequest({});
    expect(getRateLimiterBinding(boundRequest, "complete")).toBe(boundBinding);
    expect(() => getRateLimiterBinding(unboundRequest, "complete")).toThrow(RateLimiterConfigurationError);
  });
});

describe("checkRateLimit", () => {
  it("returns allowed:true when the binding reports success:true", async () => {
    const binding = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const result = await checkRateLimit(binding, "1.2.3.4");
    expect(result.allowed).toBe(true);
    expect(binding.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
  });

  it("returns allowed:false when the binding reports success:false", async () => {
    const binding = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const result = await checkRateLimit(binding, "1.2.3.4");
    expect(result.allowed).toBe(false);
  });

  it("fails closed (allowed:false) when the binding call itself throws", async () => {
    const binding = { limit: vi.fn().mockRejectedValue(new Error("binding unavailable")) };
    const result = await checkRateLimit(binding, "1.2.3.4");
    expect(result.allowed).toBe(false);
  });
});

describe("getCloudflareClientIp", () => {
  it("reads cf-connecting-ip", () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(getCloudflareClientIp(request)).toBe("203.0.113.7");
  });

  it("never falls back to X-Forwarded-For — a spoofed XFF alone yields null, not the attacker-supplied value", () => {
    const request = new Request("https://example.test/api/quote/initiate", {
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    expect(getCloudflareClientIp(request)).toBeNull();
  });
});
