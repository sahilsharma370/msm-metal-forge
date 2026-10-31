/**
 * CHECKPOINT C2I-B — the one server-only boundary for reading Cloudflare's
 * real per-request runtime env (live bindings: Rate Limiting, Queues, KV,
 * R2, Durable Objects, service bindings, etc.) from a Request. `.server.ts`
 * suffix — see env.server.ts for why that's sufficient import protection on
 * its own.
 *
 * Why this exists (see rate-limit.server.ts's own doc comment for the full
 * empirical story): Cloudflare Workers' `process.env` — even with the
 * `nodejs_compat_populate_process_env` compatibility flag enabled — only
 * ever carries plain-string vars/secrets. A live binding object (something
 * with a `.limit()`/`.send()`/etc. method, not a string) is never exposed
 * through `process.env`, confirmed empirically with an isolated Worker with
 * no Nitro/unenv involved at all. Nitro's cloudflare-module preset
 * (`_module-handler.mjs`, `augmentReq`) instead attaches Cloudflare's real
 * per-request bindings object directly onto the Request itself, as
 * `request.runtime.cloudflare.env` — this module is the ONE place that
 * reaches into that structural shape. Every other server module that needs
 * a live binding (rate-limit.server.ts, queue-producer.server.ts, and any
 * future one) reads it through this helper, never its own inline cast —
 * one boundary, one set of tests, no duplicated unsafe casts.
 *
 * Plain-string secrets (SUPABASE_URL, SUPABASE_SECRET_KEY,
 * TURNSTILE_SECRET_KEY, etc.) are NOT read through this module — those
 * keep using `process.env` directly in env.server.ts/turnstile.server.ts,
 * which is the correct, working mechanism for strings specifically.
 */

/** The shape Nitro's cloudflare-module preset actually attaches to the Request. Structural only, so a fake Request in tests needs nothing beyond this. */
export interface CloudflareRuntimeRequest {
  readonly runtime?: { readonly cloudflare?: { readonly env?: Readonly<Record<string, unknown>> } };
}

/**
 * Returns the live Cloudflare env object attached to this request, or
 * undefined if there is none — e.g. plain `vite dev`/vitest, where there is
 * no Cloudflare Workers runtime at all. Never throws.
 */
export function getCloudflareRuntimeEnv(request: Request): Readonly<Record<string, unknown>> | undefined {
  return (request as unknown as CloudflareRuntimeRequest).runtime?.cloudflare?.env;
}

/**
 * Reads one named value from the request's Cloudflare env and validates it
 * with the caller-supplied type guard. Returns undefined (never throws) if
 * the env is missing entirely, the named value is absent, or the value
 * fails the guard — deliberately leaves the fail-open-vs-fail-closed
 * decision to each caller (Rate Limiting must fail closed; a Queue
 * wake-up publish must fail soft), rather than baking one policy in here.
 * Never includes the binding name or the malformed value in any thrown
 * error, because this function never throws at all.
 */
export function getCloudflareBinding<T>(
  request: Request,
  bindingName: string,
  isBinding: (value: unknown) => value is T,
): T | undefined {
  const env = getCloudflareRuntimeEnv(request);
  const value = env?.[bindingName];
  return value !== undefined && isBinding(value) ? value : undefined;
}
