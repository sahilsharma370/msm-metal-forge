/**
 * The one shared bound on how long a single step of the Owner auth-bootstrap
 * sequence (local access-token retrieval, then server-side session
 * verification) may take before it's treated as failed rather than left
 * pending indefinitely.
 *
 * Neither underlying call is itself guaranteed to resolve in bounded time:
 * - owner-auth-client.ts's getAccessToken() calls the Supabase JS SDK's own
 *   auth.getSession(), which can internally trigger a token-refresh network
 *   request (GoTrueClient#_callRefreshToken -> #_refreshAccessToken) with no
 *   AbortController/timeout of its own anywhere in the SDK — confirmed by
 *   inspecting node_modules/@supabase/auth-js/dist/main/GoTrueClient.js. A
 *   stalled connection (not a fast network error, a genuine hang) leaves
 *   that promise pending forever.
 * - owner-session-checker.ts's check() issues a plain fetch() to
 *   /api/owner/session with no `signal`, so it has the identical exposure.
 *
 * Both call sites already have an existing styled "error" state with a
 * Retry action (OwnerShell.tsx, routes/owner/login.tsx — both wrap their
 * bootstrap effect in try/catch and land any thrown exception there). This
 * module's only job is making sure a stalled step actually throws
 * OwnerAuthTimeoutError instead of hanging, so that existing handling fires.
 */

export const OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS = 10_000;

export class OwnerAuthTimeoutError extends Error {
  constructor() {
    super("Owner auth bootstrap step timed out.");
    this.name = "OwnerAuthTimeoutError";
  }
}

/**
 * Races `promise` against a timer and rejects with OwnerAuthTimeoutError if
 * the timer wins. Used only where the underlying call cannot be aborted
 * directly (the Supabase SDK's own getSession() call) — this bounds the
 * CALLER's wait, it does not cancel the original operation, which keeps
 * running in the background. Where a real abort is possible (a plain
 * fetch() this codebase owns), use AbortController directly instead — see
 * owner-session-checker.ts's own check().
 */
export function withOwnerAuthTimeout<T>(promise: Promise<T>, timeoutMs: number = OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OwnerAuthTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
