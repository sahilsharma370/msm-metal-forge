// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.
//
// PRODUCTION SAFETY: in production (import.meta.env.DEV === false), no
// Error's message, stack, or cause chain — and no request/customer data —
// ever reaches console output, regardless of argument shape (string,
// object, Error, or any mix). Only one of the fixed UnhandledErrorCategory
// values below does. In local development, the original full stack +
// cause-chain expansion is unchanged, for debuggability.
//
// LIMITS (confirmed, not fixed by this file — stated plainly):
//   - Only console.error is wrapped. console.warn/log/info/debug are not —
//     h3 itself calls console.warn with static, non-dynamic text in the
//     two places checked (node_modules/h3/dist/h3.mjs), but nothing in
//     this codebase enforces that every console.warn call anywhere stays
//     that way.
//   - A truly uncaught exception — one that escapes every try/catch in
//     server.ts's fetch handler entirely (e.g. a rejected ctx.waitUntil()
//     promise after the response has already returned, or a throw during
//     module evaluation itself) — is reported by the Cloudflare Workers
//     runtime's own built-in error capture, never through console.* at
//     all. This file cannot intercept that path. Not reproduced live this
//     session; stated per Cloudflare's documented Workers behavior.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Dev-only: expand Error-like args into a string that
// keeps the message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * The entire vocabulary of what can ever reach production console output
 * for an unhandled error — a fixed category, never error content. Scoped
 * to the Seller quote-initiate path this audit traced, plus the generic
 * buckets the app's other top-level safety nets also need.
 */
export type UnhandledErrorCategory =
  | "quote_initiate_unhandled"
  | "server_unhandled"
  | "quote_render_unhandled"
  | "root_render_unhandled"
  | "console_internal_unhandled"
  | "quote_submit_client_exception";

const QUOTE_INITIATE_PATH = "/api/quote/initiate";
const QUOTE_ROUTE_PATH = "/quote";

/** Classifies a REQUEST pathname — start.ts/server.ts's top-level catches. */
export function classifyRoutePath(pathname: string): "quote_initiate_unhandled" | "server_unhandled" {
  return pathname === QUOTE_INITIATE_PATH ? "quote_initiate_unhandled" : "server_unhandled";
}

/** Classifies a RENDER-time pathname — __root.tsx's error boundary. */
export function classifyRenderPath(pathname: string): "quote_render_unhandled" | "root_render_unhandled" {
  return pathname === QUOTE_ROUTE_PATH ? "quote_render_unhandled" : "root_render_unhandled";
}

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are both
// recorded for consumeLastCapturedError and, in production, never reach
// real output untouched. h3 itself calls console.error with a bare Error, a
// string + Error pair, and a string + {cause: Error} object (confirmed by
// reading node_modules/h3/dist/h3.mjs directly) — so this collapses the
// ENTIRE argument list to one fixed line in production, regardless of how
// many arguments there are or what type each one is; it does not inspect
// argument content to decide what's "safe", since that inspection is
// exactly what would be unreliable. Dev keeps every argument exactly as
// given, only expanding Error instances via describeError (unchanged from
// before this audit).
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (!import.meta.env.DEV) {
    for (const arg of args) {
      if (isErrorLike(arg)) record(arg);
    }
    const category: UnhandledErrorCategory = "console_internal_unhandled";
    originalConsoleError(JSON.stringify({ event: "app.unhandled_error", category }));
    return;
  }
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

/**
 * The only way application code should log an unhandled error. Dev:
 * preserves full stack/cause detail via describeError, unchanged from
 * before this audit. Production: emits ONLY the fixed category (plus
 * `extra`, if given) as a JSON object — never error.message, stack, cause,
 * or any request/customer data, no matter what `error` actually contains.
 *
 * `extra` exists so a caller can attach a small amount of ADDITIONAL
 * structured context beyond the category — e.g. which stage of a pipeline
 * was reached before the throw, or a handful of plain booleans like
 * "was this API available" — without reopening the "never log the error
 * itself" guarantee above. Values are deliberately restricted to `string
 * | boolean` only, never a free-form value: a boolean's only two possible
 * values are themselves a closed set, same spirit as a string drawn from
 * an enum. The caller is responsible for every value in it being from a
 * closed, pre-defined enum of ITS OWN (never a raw error message, stack,
 * user input, or anything derived from `error` itself) — this function
 * does not and cannot inspect `extra`'s values to verify that, the same
 * way it can't inspect `category`'s. Keep it small: a handful of short
 * enum-valued or boolean fields, not a general-purpose log payload.
 *
 * WHERE THIS ACTUALLY GOES: `originalConsoleError` below is plain
 * console.error.bind(console) — nothing more. Called from server.ts/
 * start.ts/initiate-quote.ts (Cloudflare Worker runtime), it reaches
 * whatever is tailing that Worker (e.g. `wrangler tail`, if someone is
 * actively watching). Called from browser code (e.g. quote-submission-
 * engine.ts), it reaches ONLY that browser's own local DevTools console —
 * there is no remote/centralized log store on the client side. Either way,
 * this is a live-observation primitive, not a retrievable history: nothing
 * here persists past the console's own buffer, and there is no way to
 * look up a past occurrence after the fact without having been watching
 * at the time.
 */
export function logUnhandledError(
  error: unknown,
  category: UnhandledErrorCategory,
  extra?: Readonly<Record<string, string | boolean>>,
): void {
  record(error);
  if (import.meta.env.DEV) {
    originalConsoleError(describeError(error));
    return;
  }
  originalConsoleError(JSON.stringify({ event: "app.unhandled_error", category, ...extra }));
}

/**
 * Best-effort Web Crypto API availability snapshot — never throws, every
 * value a plain boolean. Exists purely as closed-value diagnostic context
 * for logUnhandledError's own `extra` (see quote-submission-engine.ts and
 * QuoteExperience.tsx for its callers); checks only WHETHER each API
 * exists, never calls it, never reads or logs any value drawn from it.
 * Shared here, not duplicated at each call site, so the two call sites
 * can never silently drift on what "available" means.
 */
export function describeWebCryptoAvailability(): Readonly<Record<string, boolean>> {
  try {
    return {
      subtleAvailable: typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined",
      getRandomValuesAvailable: typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function",
      randomUUIDAvailable: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function",
    };
  } catch {
    return { subtleAvailable: false, getRandomValuesAvailable: false, randomUUIDAvailable: false };
  }
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
