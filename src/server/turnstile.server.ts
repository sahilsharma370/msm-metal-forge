/**
 * CHECKPOINT C2G — server-only Cloudflare Turnstile Siteverify client.
 * `.server.ts` suffix — see env.server.ts for why that's sufficient import
 * protection on its own. TURNSTILE_SECRET_KEY is read only inside
 * getTurnstileVerifier(), never at module scope (same per-request-env
 * reasoning as env.server.ts / rate-limit.server.ts), and never appears in
 * any thrown error, log line or response body.
 */
import { z } from "zod";

/** The one action name both the browser widget (data-action) and this server check must agree on. */
export const TURNSTILE_EXPECTED_ACTION = "quote_submit";

export type TurnstileFailureReason =
  | "missing_token"
  | "invalid_or_expired_token"
  | "action_mismatch"
  | "hostname_mismatch"
  | "service_unavailable";

export type TurnstileVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TurnstileFailureReason };

export interface TurnstileVerifier {
  verify(token: string): Promise<TurnstileVerifyResult>;
}

/** Deliberately carries no detail about which variable is missing — mirrors ServerConfigurationError in env.server.ts. */
export class TurnstileConfigurationError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "TurnstileConfigurationError";
  }
}

const siteverifyResponseSchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  hostname: z.string().optional(),
  // "error-codes" and challenge_ts/cdata are intentionally not modeled —
  // this module never forwards Cloudflare's raw error codes to the
  // customer, so there is nothing to gain from parsing them strictly.
});

export interface TurnstileVerifierConfig {
  readonly secretKey: string;
  readonly expectedAction: string;
  /** Exact hostnames Turnstile is allowed to have observed the widget on — configured per environment (production domain, preview deployment pattern, "localhost" for local testing), never a wildcard. */
  readonly allowedHostnames: readonly string[];
}

/**
 * Real Siteverify-backed verifier. `fetchImpl` is injectable purely so
 * tests can exercise this function's own parsing/policy logic without a
 * real network call — production always uses the real global fetch via
 * getTurnstileVerifier() below.
 */
export function createCloudflareTurnstileVerifier(
  config: TurnstileVerifierConfig,
  fetchImpl: typeof fetch = fetch,
): TurnstileVerifier {
  return {
    async verify(token: string): Promise<TurnstileVerifyResult> {
      if (!token) return { ok: false, reason: "missing_token" };

      let response: Response;
      try {
        response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: config.secretKey, response: token }),
        });
      } catch {
        return { ok: false, reason: "service_unavailable" };
      }

      if (!response.ok) {
        return { ok: false, reason: "service_unavailable" };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { ok: false, reason: "service_unavailable" };
      }

      const parsed = siteverifyResponseSchema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, reason: "service_unavailable" };
      }

      // Single-use/expiry is Cloudflare's own guarantee, not something this
      // module tracks locally: Siteverify itself returns success:false
      // (with a timeout-or-duplicate-shaped error-code, which this module
      // deliberately does not need to distinguish further) the second time
      // the same token is submitted, or once it has expired — either way
      // this one check is sufficient and this module never needs its own
      // consumed-token cache.
      if (!parsed.data.success) {
        return { ok: false, reason: "invalid_or_expired_token" };
      }
      if (parsed.data.action !== config.expectedAction) {
        return { ok: false, reason: "action_mismatch" };
      }
      if (!parsed.data.hostname || !config.allowedHostnames.includes(parsed.data.hostname)) {
        return { ok: false, reason: "hostname_mismatch" };
      }
      return { ok: true };
    },
  };
}

/**
 * Reads TURNSTILE_SECRET_KEY and TURNSTILE_ALLOWED_HOSTNAMES from the
 * current request's environment (see rate-limit.server.ts's own doc
 * comment for exactly how process.env is populated per-request on
 * Cloudflare Workers). Fails closed (throws) if either is missing or the
 * hostname list is empty — a misconfigured deployment must never silently
 * skip verification.
 */
export function getTurnstileVerifier(): TurnstileVerifier {
  const secretKey = process.env["TURNSTILE_SECRET_KEY"];
  const allowedHostnamesRaw = process.env["TURNSTILE_ALLOWED_HOSTNAMES"];
  if (!secretKey || !allowedHostnamesRaw) {
    throw new TurnstileConfigurationError();
  }
  const allowedHostnames = allowedHostnamesRaw
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  if (allowedHostnames.length === 0) {
    throw new TurnstileConfigurationError();
  }
  return createCloudflareTurnstileVerifier({
    secretKey,
    expectedAction: TURNSTILE_EXPECTED_ACTION,
    allowedHostnames,
  });
}
