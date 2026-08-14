import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMITER_BINDING_NAMES,
  RateLimiterConfigurationError,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "./rate-limit.server";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(RATE_LIMITER_BINDING_NAMES).map((k) => RATE_LIMITER_BINDING_NAMES[k as keyof typeof RATE_LIMITER_BINDING_NAMES])) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
});

describe("getRateLimiterBinding — fails closed when missing/misshapen", () => {
  it("throws RateLimiterConfigurationError when the binding is entirely absent", () => {
    expect(() => getRateLimiterBinding("initiate")).toThrow(RateLimiterConfigurationError);
  });

  it("throws when the env value exists but has no limit() method (e.g. a plain string, matching an accidental .env entry)", () => {
    // Simulating a misconfigured plain string in env — process.env is
    // typed as string-valued, so this assignment needs no type escape.
    process.env[RATE_LIMITER_BINDING_NAMES.initiate] = "not-a-binding";
    expect(() => getRateLimiterBinding("initiate")).toThrow(RateLimiterConfigurationError);
  });

  it("the thrown error message never reveals which binding was missing", () => {
    try {
      getRateLimiterBinding("upload");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/RATE_LIMITER|upload/i);
    }
  });

  it("returns the live binding object when present and correctly shaped", () => {
    // Node's real process.env setter stringifies any assigned value (a
    // well-known Node quirk), which would silently turn a fake binding
    // object into "[object Object]" and defeat this test. The real
    // Cloudflare Workers process.env Proxy (see this module's own doc
    // comment) does no such coercion — vi.stubGlobal replaces the whole
    // `process` with a plain object whose `.env` is a plain object too,
    // which correctly preserves object identity, matching production.
    const fakeBinding = { limit: vi.fn() };
    vi.stubGlobal("process", { env: { ...process.env, [RATE_LIMITER_BINDING_NAMES.complete]: fakeBinding } });
    try {
      expect(getRateLimiterBinding("complete")).toBe(fakeBinding);
    } finally {
      vi.unstubAllGlobals();
    }
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
