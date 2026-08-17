/**
 * CHECKPOINT C2G — server-only access to Cloudflare Worker Rate Limiting
 * bindings. `.server.ts` suffix — see env.server.ts for why that's
 * sufficient import protection on its own.
 *
 * Runtime mechanism: reads the live binding via
 * `@/server/cloudflare-runtime.server`'s `getCloudflareBinding` — see that
 * module's own doc comment for the full empirical story of why bindings
 * must come from `request.runtime.cloudflare.env`, never `process.env`
 * (confirmed against a real `wrangler dev` run: even with
 * `nodejs_compat_populate_process_env` enabled, `process.env` only ever
 * carries plain-string vars, never a live binding object).
 *
 * Locally (`vite dev`, vitest) there is no Cloudflare Workers runtime and
 * therefore no real binding, and no `request.runtime.cloudflare.env` either
 * — getRateLimiterBinding() throws in that case, exactly like
 * createSupabaseAdminClient() does for missing Supabase env. Route handlers
 * catch this and fail closed with a generic 500 — production must not
 * silently run unprotected, so "binding missing" is never treated as "skip
 * rate limiting". Manual local testing of these five routes therefore
 * requires a Cloudflare Workers-emulating runtime (`wrangler dev` against
 * the built output, which provisions bindings from the checked-in
 * wrangler.jsonc via Miniflare) — plain `vite dev` intentionally fails
 * closed here. Automated tests inject a fake `Request` shaped with
 * `runtime.cloudflare.env`, exactly like the existing
 * `@/server/supabase-admin.server` mocking convention.
 */
import { getCloudflareBinding } from "./cloudflare-runtime.server";

/** One route class's outcome from a single rate-limit check — never exposes the underlying counter or IP. */
export interface RateLimitCheckResult {
  readonly allowed: boolean;
}

/** The exact shape of Cloudflare's Workers Rate Limiting binding: `env.MY_LIMITER.limit({ key })`. */
export interface RateLimiterBinding {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

/** Deliberately carries no detail about which binding is missing — mirrors ServerConfigurationError in env.server.ts. */
export class RateLimiterConfigurationError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "RateLimiterConfigurationError";
  }
}

/**
 * The route-class binding names — declared once here so the route
 * handlers, the checked-in wrangler.jsonc, and .env.example documentation
 * all reference the exact same literal strings. Each route gets its own
 * binding (not one shared binding with a route-prefixed key) because
 * Cloudflare's Rate Limiting binding fixes its limit/period at the binding
 * level, not per call — genuinely different ceilings require genuinely
 * different bindings.
 */
export const RATE_LIMITER_BINDING_NAMES = {
  initiate: "RATE_LIMITER_INITIATE",
  upload: "RATE_LIMITER_UPLOAD",
  complete: "RATE_LIMITER_COMPLETE",
  // CHECKPOINT C2I-A — owner passwordless login. Two distinct bindings
  // (not one shared "owner login" binding) for the same reason
  // initiate/upload/complete are separate: requesting a code and
  // submitting a code are genuinely different abuse shapes (the request
  // side bounds how many OTP emails one IP can trigger; the verify side
  // bounds how many six-digit guesses one IP can attempt against an
  // outstanding code) and Cloudflare's binding fixes its limit at the
  // binding level, not per call.
  ownerLoginRequestCode: "RATE_LIMITER_OWNER_LOGIN_REQUEST_CODE",
  ownerLoginVerifyCode: "RATE_LIMITER_OWNER_LOGIN_VERIFY_CODE",
} as const;

export type RateLimitRouteClass = keyof typeof RATE_LIMITER_BINDING_NAMES;

/**
 * Suggested starting ceilings (period is always 60s, matching the wrangler.jsonc
 * `ratelimits` bindings — kept here too so the `Retry-After` header each
 * route sends on a 429 always agrees with the binding's own actual period):
 * - initiate 5/60s: one genuine submission needs at most a handful of
 *   initiate calls (first attempt + a couple of legitimate retries after a
 *   dropped response) — 5 comfortably covers that while still bounding a
 *   scripted burst.
 * - upload 30/60s: up to 5 files per submission, each potentially retried
 *   once or twice (a stale-lease reclaim, a transient Storage error) — 30
 *   leaves generous headroom for the legitimate 5-file worst case.
 * - complete 10/60s: normally called once (often zero times at all, since
 *   the zero-file/last-slot-verifies paths complete server-side already);
 *   10 covers reconciliation retries without meaningfully constraining any
 *   real customer.
 * - ownerLoginRequestCode 5/60s: one genuine sign-in needs at most a
 *   handful of requests (first attempt + a resend or two) — 5 bounds a
 *   script from cheaply triggering unbounded OTP emails toward any address
 *   per IP per minute, matching initiate's own tightness for the same
 *   "cheap for an attacker, rare for a real user" reasoning.
 * - ownerLoginVerifyCode 8/60s: a genuine sign-in enters one code, maybe
 *   retyped once or twice on a typo — 8 covers that comfortably while
 *   keeping a six-digit-code brute force (1,000,000 possibilities)
 *   completely impractical per IP per minute, on top of Supabase Auth's
 *   own independent token_verifications limit (see supabase/config.toml)
 *   as a second, independent layer.
 */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

function isRateLimiterBinding(value: unknown): value is RateLimiterBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { limit?: unknown }).limit === "function"
  );
}

/** Reads one named binding from the current request's own attached Cloudflare env (see module doc comment — never process.env for a binding). Throws (fail closed) if missing or shaped wrong; the thrown error never names the binding. */
export function getRateLimiterBinding(request: Request, routeClass: RateLimitRouteClass): RateLimiterBinding {
  const binding = getCloudflareBinding(request, RATE_LIMITER_BINDING_NAMES[routeClass], isRateLimiterBinding);
  if (!binding) {
    throw new RateLimiterConfigurationError();
  }
  return binding;
}

/**
 * Runs one rate-limit check. A throwing/erroring binding call is treated as
 * NOT allowed (fail closed) — the limiter is abuse defense; if it cannot be
 * consulted, the safe default is to reject, not to silently let the
 * request through. `key` should already be the caller's chosen identity
 * (Cloudflare-verified client IP) — this function does no key derivation
 * of its own.
 */
export async function checkRateLimit(
  binding: RateLimiterBinding,
  key: string,
): Promise<RateLimitCheckResult> {
  try {
    const result = await binding.limit({ key });
    return { allowed: result.success === true };
  } catch {
    return { allowed: false };
  }
}

/**
 * The one Cloudflare-verified client-identity header — set authoritatively
 * by Cloudflare's edge on every request that reaches this Worker, and
 * overwritten (never passed through from the original client) if a
 * requester tries to forge it. X-Forwarded-For is deliberately never read
 * anywhere in this codebase: it is client-suppliable and trivially spoofed.
 */
export function getCloudflareClientIp(request: Request): string | null {
  return request.headers.get("cf-connecting-ip");
}
