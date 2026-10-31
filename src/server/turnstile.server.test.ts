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

describe("createCloudflareTurnstileVerifier — local test mode (CHECKPOINT C2G-LT)", () => {
  const localTestConfig = { ...config, localTestMode: true };

  it("accepts Cloudflare's exact synthetic test-key shape (no action, hostname:example.com) when localTestMode is on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, hostname: "example.com" }));
    const verifier = createCloudflareTurnstileVerifier(localTestConfig, fetchImpl);
    const result = await verifier.verify("token");
    expect(result.ok).toBe(true);
  });

  it("rejects that same synthetic shape when localTestMode is off", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, hostname: "example.com" }));
    const verifier = createCloudflareTurnstileVerifier(config, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("still rejects success:false even with localTestMode on — the carve-out never touches the success check", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }));
    const verifier = createCloudflareTurnstileVerifier(localTestConfig, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired_token" });
  });

  it("still rejects a real mismatched action even with localTestMode on — only the exact synthetic shape is carved out", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: "some_other_action", hostname: "quote.example.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(localTestConfig, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("still rejects a real unrecognized hostname even with localTestMode on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: TURNSTILE_EXPECTED_ACTION, hostname: "evil.test" }),
    );
    const verifier = createCloudflareTurnstileVerifier(localTestConfig, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "hostname_mismatch" });
  });

  it("rejects hostname:example.com paired with a present (mismatched) action — only the combined missing-action+example.com shape is carved out", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { success: true, action: "some_other_action", hostname: "example.com" }),
    );
    const verifier = createCloudflareTurnstileVerifier(localTestConfig, fetchImpl);
    const result = await verifier.verify("token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
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

function requestTo(hostname: string): Request {
  return new Request(`https://${hostname}/api/quote/initiate`, { method: "POST" });
}

const LOCALHOST_REQUEST = requestTo("localhost");

describe("getTurnstileVerifier — fails closed when misconfigured", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    delete process.env["TURNSTILE_SECRET_KEY"];
    delete process.env["TURNSTILE_ALLOWED_HOSTNAMES"];
    delete process.env["TURNSTILE_LOCAL_TEST_MODE"];
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) process.env[key] = value;
  });

  it("throws when TURNSTILE_SECRET_KEY is missing", () => {
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "localhost";
    expect(() => getTurnstileVerifier(LOCALHOST_REQUEST)).toThrow(TurnstileConfigurationError);
  });

  it("throws when TURNSTILE_ALLOWED_HOSTNAMES is missing", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    expect(() => getTurnstileVerifier(LOCALHOST_REQUEST)).toThrow(TurnstileConfigurationError);
  });

  it("throws when TURNSTILE_ALLOWED_HOSTNAMES resolves to an empty list", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = " , ,";
    expect(() => getTurnstileVerifier(LOCALHOST_REQUEST)).toThrow(TurnstileConfigurationError);
  });

  it("never reveals which variable was missing", () => {
    try {
      getTurnstileVerifier(LOCALHOST_REQUEST);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/TURNSTILE|SECRET/i);
    }
  });

  it("succeeds when both are present, splitting the hostname list on commas", () => {
    process.env["TURNSTILE_SECRET_KEY"] = "a-secret";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "quote.example.test, localhost ,";
    expect(() => getTurnstileVerifier(LOCALHOST_REQUEST)).not.toThrow();
  });
});

describe("getTurnstileVerifier — local-test-mode gate (CHECKPOINT C2G-LT)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    delete process.env["TURNSTILE_SECRET_KEY"];
    delete process.env["TURNSTILE_ALLOWED_HOSTNAMES"];
    delete process.env["TURNSTILE_LOCAL_TEST_MODE"];
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) process.env[key] = value;
    global.fetch = ORIGINAL_FETCH;
  });

  /** Stubs the real global fetch (never a real network call) to return Cloudflare's exact synthetic test-key shape. */
  function stubSyntheticTestKeyFetch(): void {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, hostname: "example.com" })) as unknown as typeof fetch;
  }

  it("accepts the synthetic test-key response only when the flag is set, the request hostname is local, AND the configured allowed hostnames are local-only", async () => {
    stubSyntheticTestKeyFetch();
    process.env["TURNSTILE_SECRET_KEY"] = "1x0000000000000000000000000000000AA";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "localhost";
    process.env["TURNSTILE_LOCAL_TEST_MODE"] = "true";

    const result = await getTurnstileVerifier(LOCALHOST_REQUEST).verify("test-token");
    expect(result.ok).toBe(true);
  });

  it("rejects the same synthetic response when TURNSTILE_LOCAL_TEST_MODE is not set", async () => {
    stubSyntheticTestKeyFetch();
    process.env["TURNSTILE_SECRET_KEY"] = "1x0000000000000000000000000000000AA";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "localhost";
    // TURNSTILE_LOCAL_TEST_MODE deliberately left unset.

    const result = await getTurnstileVerifier(LOCALHOST_REQUEST).verify("test-token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("cannot relax verification when this deployment's configured allowed hostnames is a real domain, even with the flag set and a local request hostname", async () => {
    stubSyntheticTestKeyFetch();
    process.env["TURNSTILE_SECRET_KEY"] = "1x0000000000000000000000000000000AA";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "www.example.com";
    process.env["TURNSTILE_LOCAL_TEST_MODE"] = "true";

    const result = await getTurnstileVerifier(LOCALHOST_REQUEST).verify("test-token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("cannot relax verification for a non-local request hostname, even with the flag set and locally-scoped allowed hostnames", async () => {
    stubSyntheticTestKeyFetch();
    process.env["TURNSTILE_SECRET_KEY"] = "1x0000000000000000000000000000000AA";
    process.env["TURNSTILE_ALLOWED_HOSTNAMES"] = "localhost";
    process.env["TURNSTILE_LOCAL_TEST_MODE"] = "true";

    const result = await getTurnstileVerifier(requestTo("www.example.com")).verify("test-token");
    expect(result).toEqual({ ok: false, reason: "action_mismatch" });
  });
});
