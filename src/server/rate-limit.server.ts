/**
 * CHECKPOINT C2G — server-only access to Cloudflare Worker Rate Limiting
 * bindings. `.server.ts` suffix — see env.server.ts for why that's
 * sufficient import protection on its own.
 *
 * Runtime mechanism (verified by reading node_modules/nitro's actual
 * cloudflare-module preset before writing this file, not assumed):
 * Nitro's `_module-handler.mjs` sets `globalThis.__env__ = env` on every
 * Worker `fetch(request, env, context)` invocation, where `env` is
 * Cloudflare's own per-request bindings object (containing live binding
 * instances — KV, Durable Objects, Rate Limiting — not just strings).
 * unenv's `process.env` polyfill (node_modules/unenv/.../internal/process/env.mjs)
 * is a Proxy whose `get` trap reads directly from `globalThis.__env__` with
 * no type coercion. This is the exact same mechanism env.server.ts already
 * relies on for SUPABASE_URL/SUPABASE_SECRET_KEY — `process.env["MY_BINDING"]`
 * genuinely yields the live Cloudflare binding object in production, not a
 * stringified value. Every read happens inside a function, never at module
 * scope, for the same per-request-injection reason as env.server.ts.
 *
 * Locally (`vite dev`, vitest) there is no Cloudflare Workers runtime and
 * therefore no real binding — getRateLimiterBinding() throws in that case,
 * exactly like createSupabaseAdminClient() does for missing Supabase env.
 * Route handlers catch this and fail closed with a generic 500 — production
 * must not silently run unprotected, so "binding missing" is never treated
 * as "skip rate limiting". Manual local testing of these three routes
 * therefore requires a Cloudflare Workers-emulating runtime (`wrangler dev`
 * against the built output, which provisions bindings from the checked-in
 * wrangler.jsonc via Miniflare) — plain `vite dev` intentionally fails
 * closed here. Automated tests inject a fake binding via `vi.mock`, exactly
 * like the existing `@/server/supabase-admin.server` mocking convention.
 */

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
 * The three route-class binding names — declared once here so the route
 * handlers, the checked-in wrangler.jsonc, and .env.example documentation
 * all reference the exact same literal strings. Each route gets its own
 * binding (not one shared binding with a route-prefixed key) because
 * Cloudflare's Rate Limiting binding fixes its limit/period at the binding
 * level, not per call — three genuinely different ceilings require three
 * genuinely different bindings.
 */
export const RATE_LIMITER_BINDING_NAMES = {
  initiate: "RATE_LIMITER_INITIATE",
  upload: "RATE_LIMITER_UPLOAD",
  complete: "RATE_LIMITER_COMPLETE",
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
 */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

function isRateLimiterBinding(value: unknown): value is RateLimiterBinding {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { limit?: unknown }).limit === "function"
  );
}

/** Reads one named binding from the current request's Cloudflare env via process.env (see module doc comment). Throws (fail closed) if missing or shaped wrong. */
export function getRateLimiterBinding(routeClass: RateLimitRouteClass): RateLimiterBinding {
  const binding = process.env[RATE_LIMITER_BINDING_NAMES[routeClass]];
  if (!isRateLimiterBinding(binding)) {
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
