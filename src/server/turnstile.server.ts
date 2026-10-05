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
  // "error-codes" is read ONLY to compute the fixed diagnostic label below
  // (mapSiteverifyErrorCodes) — the raw array itself is never logged,
  // returned to the customer, or forwarded anywhere. challenge_ts/cdata
  // are still intentionally not modeled; there is nothing to gain from
  // parsing them.
  "error-codes": z.array(z.string()).optional(),
});

/** The one place Cloudflare's raw Siteverify error-codes get collapsed into — never logged or returned raw, only this fixed label is. */
export type SiteverifyFailureLabel =
  | "invalid_secret"
  | "invalid_response"
  | "timeout_or_duplicate"
  | "other_siteverify_failure";

const INVALID_SECRET_ERROR_CODES = new Set(["missing-input-secret", "invalid-input-secret", "invalid-parsed-secret"]);
const INVALID_RESPONSE_ERROR_CODES = new Set(["missing-input-response", "invalid-input-response"]);

/**
 * Maps Cloudflare's documented Siteverify `error-codes` values
 * (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
 * to one fixed, privacy-safe diagnostic label. Never returns or logs the
 * raw codes themselves — only this closed four-value label, so a caller
 * that only ever logs the return value can never leak anything else.
 */
export function mapSiteverifyErrorCodes(errorCodes: readonly string[] | undefined): SiteverifyFailureLabel {
  if (!errorCodes || errorCodes.length === 0) return "other_siteverify_failure";
  if (errorCodes.some((code) => INVALID_SECRET_ERROR_CODES.has(code))) return "invalid_secret";
  if (errorCodes.some((code) => INVALID_RESPONSE_ERROR_CODES.has(code))) return "invalid_response";
  if (errorCodes.includes("timeout-or-duplicate")) return "timeout_or_duplicate";
  return "other_siteverify_failure";
}

export interface TurnstileVerifierConfig {
  readonly secretKey: string;
  readonly expectedAction: string;
  /** Exact hostnames Turnstile is allowed to have observed the widget on — configured per environment (production domain, preview deployment pattern, "localhost" for local testing), never a wildcard. */
  readonly allowedHostnames: readonly string[];
  /**
   * CHECKPOINT C2G-LT — when true, `verify()` additionally accepts the one
   * fixed synthetic response shape Cloudflare's official always-pass TEST
   * secret key produces (`hostname:"example.com"`, no `action` field at
   * all — see CLOUDFLARE_TEST_KEY_SYNTHETIC_HOSTNAME below). Every other
   * check (token presence, Siteverify call, `success:true`, and the
   * configured action/hostname for any response that is NOT that exact
   * synthetic shape) is unchanged. `getTurnstileVerifier()` is the only
   * place this is computed, and only turns it on when three independent
   * conditions all hold — see its own doc comment.
   */
  readonly localTestMode?: boolean;
}

/**
 * Cloudflare's own documented synthetic hostname for the official TEST
 * secret keys (always-pass/always-block/always-error) — see
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/.
 * Siteverify hardcodes this for every response to a test-key request; a
 * real widget on a real site never reports it.
 */
const CLOUDFLARE_TEST_KEY_SYNTHETIC_HOSTNAME = "example.com";

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
  // Diagnostic logging only — logs exactly the fixed failure-category enum
  // and nothing else: never the raw Siteverify response, the token, the
  // request body, an email/IP, or any secret value. No success log (a
  // passing verification is not logged at all). Every `ok: false` return
  // below funnels through this one helper so the shape is guaranteed
  // identical regardless of which check rejected the token.
  function reject(reason: TurnstileFailureReason): TurnstileVerifyResult {
    console.log(JSON.stringify({ event: "quote.turnstile_rejected", reason }));
    return { ok: false, reason };
  }

  return {
    async verify(token: string): Promise<TurnstileVerifyResult> {
      if (!token) return reject("missing_token");

      let response: Response;
      try {
        response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: config.secretKey, response: token }),
        });
      } catch {
        return reject("service_unavailable");
      }

      if (!response.ok) {
        return reject("service_unavailable");
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return reject("service_unavailable");
      }

      const parsed = siteverifyResponseSchema.safeParse(json);
      if (!parsed.success) {
        return reject("service_unavailable");
      }

      // Single-use/expiry is Cloudflare's own guarantee, not something this
      // module tracks locally: Siteverify itself returns success:false
      // (with a timeout-or-duplicate-shaped error-code, which this module
      // deliberately does not need to distinguish further) the second time
      // the same token is submitted, or once it has expired — either way
      // this one check is sufficient and this module never needs its own
      // consumed-token cache.
      if (!parsed.data.success) {
        // Diagnostic refinement only — the public reason stays the fixed
        // "invalid_or_expired_token" below (fail closed, generic to the
        // caller). This extra log line carries only the mapped label, never
        // the raw error-codes array, response, token, keys, IP, or form data.
        const failureLabel = mapSiteverifyErrorCodes(parsed.data["error-codes"]);
        console.log(JSON.stringify({ event: "quote.turnstile_siteverify_failure", label: failureLabel }));
        return reject("invalid_or_expired_token");
      }

      // CHECKPOINT C2G-LT — the ONE narrow carve-out: only when
      // localTestMode is active AND the response is exactly Cloudflare's
      // fixed test-key shape (both conditions together, not either alone)
      // do the action/hostname checks below get skipped. Anything else —
      // a real mismatched action, a real unrecognized hostname, or this
      // exact shape when localTestMode is off — still falls through to
      // the same strict checks as before.
      const isSyntheticTestKeyResponse =
        config.localTestMode === true &&
        parsed.data.action === undefined &&
        parsed.data.hostname === CLOUDFLARE_TEST_KEY_SYNTHETIC_HOSTNAME;

      if (!isSyntheticTestKeyResponse) {
        if (parsed.data.action !== config.expectedAction) {
          return reject("action_mismatch");
        }
        if (!parsed.data.hostname || !config.allowedHostnames.includes(parsed.data.hostname)) {
          return reject("hostname_mismatch");
        }
      }
      return { ok: true };
    },
  };
}

/** Loopback hostnames a genuine production/staging deployment never serves real traffic on. */
const LOCAL_TEST_REQUEST_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/**
 * Reads TURNSTILE_SECRET_KEY and TURNSTILE_ALLOWED_HOSTNAMES from the
 * current request's environment (see rate-limit.server.ts's own doc
 * comment for exactly how process.env is populated per-request on
 * Cloudflare Workers). Fails closed (throws) if either is missing or the
 * hostname list is empty — a misconfigured deployment must never silently
 * skip verification.
 *
 * `request` is taken for exactly one purpose: deciding whether
 * CHECKPOINT C2G-LT's local-test carve-out (see TurnstileVerifierConfig's
 * own doc comment) may activate for THIS call. It activates only when all
 * three hold:
 *   1. `TURNSTILE_LOCAL_TEST_MODE` is explicitly set to "true".
 *   2. This request's own hostname (from `request.url`, the same value
 *      Cloudflare's edge routed the request to) is a loopback address.
 *   3. This deployment's configured TURNSTILE_ALLOWED_HOSTNAMES is
 *      loopback-only — never true for a real production/staging
 *      deployment, since Turnstile could not pass any real traffic if it
 *      were.
 * A production Worker accidentally left with TURNSTILE_LOCAL_TEST_MODE set
 * still fails closed exactly as before: condition 2 and/or 3 will not
 * hold for real traffic on a real domain, so nothing is relaxed.
 */
export function getTurnstileVerifier(request: Request): TurnstileVerifier {
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

  const requestHostname = new URL(request.url).hostname;
  const localTestMode =
    process.env["TURNSTILE_LOCAL_TEST_MODE"] === "true" &&
    LOCAL_TEST_REQUEST_HOSTNAMES.has(requestHostname) &&
    allowedHostnames.every((hostname) => LOCAL_TEST_REQUEST_HOSTNAMES.has(hostname));

  return createCloudflareTurnstileVerifier({
    secretKey,
    expectedAction: TURNSTILE_EXPECTED_ACTION,
    allowedHostnames,
    localTestMode,
  });
}
