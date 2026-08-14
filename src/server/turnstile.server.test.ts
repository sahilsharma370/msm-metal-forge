import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_EXPECTED_ACTION,
  TurnstileConfigurationError,
  createCloudflareTurnstileVerifier,
  getTurnstileVerifier,
} from "./turnstile.server";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const config = {
  secretKey: "test-secret",
  expectedAction: TURNSTILE_EXPECTED_ACTION,
  allowedHostnames: ["quote.example.test", "localhost"],
};

describe("createCloudflareTurnstileVerifier — valid token", () => {
  it("allows a token when success/action/hostname all agree", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "quote.example.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);

    const result = await verifier.verify("a-real-token");
    expect(result.ok).toBe(true);
  });

  it("POSTs the secret and token as form-urlencoded, never as query params or JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "quote.example.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    await verifier.verify("a-real-token");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body as string);
    expect(params.get("secret")).toBe("test-secret");
    expect(params.get("response")).toBe("a-real-token");
  });
});

describe("createCloudflareTurnstileVerifier — missing/invalid/expired/duplicate token", () => {
  it("rejects an empty token before any network call", async () => {
    const fetchImpl = vi.fn();
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("");
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when Siteverify reports success:false (covers invalid, expired, and timeout-or-duplicate tokens alike)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("stale-token");
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired_token" });
  });

  it("a token already consumed once (a second verify call with the same token) is rejected the same way — no local cache pretends it was still valid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "quote.example.test" }))
      .mockResolvedValueOnce(jsonResponse(200, { success: false }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);

    const first = await verifier.verify("used-once-token");
    const second = await verifier.verify("used-once-token");

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "invalid_or_expired_token" });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // every call genuinely re-verifies with Cloudflare, never trusts a local cache
  });
});

describe("createCloudflareTurnstileVerifier — action mismatch", () => {
  it("rejects when the verified action does not match the expected action", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: "some_other_action", hostname: "quote.example.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });
});

describe("createCloudflareTurnstileVerifier — hostname mismatch", () => {
  it("rejects when the verified hostname is not in the allowed list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "evil.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "hostname_mismatch" });
  });

  it("allows a hostname explicitly configured for local testing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "localhost" }),
    );
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result.ok).toBe(true);
  });
});

describe("createCloudflareTurnstileVerifier — Siteverify unavailable fails closed", () => {
  it("a network failure is treated as service_unavailable, never as success", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "service_unavailable" });
  });

  it("a non-2xx HTTP response is treated as service_unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "service_unavailable" });
  });

  it("a malformed JSON body is treated as service_unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "service_unavailable" });
  });

  it("a response missing the required success field is treated as service_unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "service_unavailable" });
  });
});

describe("getTurnstileVerifier — fails closed when misconfigured", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    delete process.env["TURNSTILE_SECRET_KEY"];
    delete process.env["TURNSTILE_ALLOWED_HOSTNAMES"];
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) process.env[key] = value;
  });

  it("throws when TURNSTILE_SECRET_KEY is missing", () => {
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "localhost";
    expect(() => getTurnstileVerifier()).toThrow(TurnstileConfigurationError);
  });

  it("throws when TURNSTILE_ALLOWED_HOSTNAMES is missing", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    expect(() => getTurnstileVerifier()).toThrow(TurnstileConfigurationError);
  });

  it("throws when TURNSTILE_ALLOWED_HOSTNAMES resolves to an empty list", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = " , ,";
    expect(() => getTurnstileVerifier()).toThrow(TurnstileConfigurationError);
  });

  it("never reveals which variable was missing", () => {
    try {
      getTurnstileVerifier();
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/TURNSTILE|SECRET/i);
    }
  });

  it("succeeds when both are present, splitting the hostname list on commas", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "quote.example.test, localhost ,";
    expect(() => getTurnstileVerifier()).not.toThrow();
  });
});
