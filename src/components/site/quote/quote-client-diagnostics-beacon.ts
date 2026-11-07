/**
 * QT-CLI audit — the client half of the server-visible diagnostic path
 * (see src/server/quote/quote-client-diagnostics.ts and
 * supabase/migrations/20261102000000_create_quote_client_diagnostics.sql).
 * Deliberately NOT part of QuoteTransport (quote-submission-transport.ts):
 * this is an out-of-band, best-effort side channel, never one of the
 * initiate/upload/complete operations that interface represents, and
 * keeping it separate means every existing QuoteTransport test fake in
 * this codebase needed zero changes for this feature.
 *
 * "Best-effort, never blocks submission" is enforced structurally, not by
 * caller discipline alone: this function's own returned promise always
 * resolves (never rejects) and its own internal timeout caps how long it
 * can possibly take, so even a caller that mistakenly awaited it could
 * only ever be delayed by a few seconds at worst, never hung indefinitely
 * — but the intended, and only actually used, calling pattern is firing
 * this WITHOUT awaiting it at all (see quote-submission-engine.ts's and
 * QuoteExperience.tsx's own call sites), after the real client_exception
 * outcome has already been decided and is about to be returned.
 */

export interface QuoteClientDiagnosticsSnapshot {
  readonly stage: string;
  readonly initiateInvoked: boolean;
  readonly initiateSettled: boolean;
  readonly subtleAvailable: boolean;
  readonly getRandomValuesAvailable: boolean;
  readonly randomUUIDAvailable: boolean;
}

/** Bounded so a hung network layer can never turn "best-effort" into "indefinitely pending" — short, since nothing waits on this succeeding. */
const BEACON_TIMEOUT_MS = 3000;

/**
 * Sends one diagnostic beacon. Always resolves, never throws/rejects —
 * every failure mode (network error, timeout, non-2xx, a thrown
 * AbortController/fetch anomaly) is swallowed identically, since no
 * caller ever inspects the result or retries. Never includes anything
 * beyond the six fields on QuoteClientDiagnosticsSnapshot — there is no
 * parameter here through which a name, phone, form value, file, token,
 * URL, or payload hash could even be passed.
 */
export async function sendQuoteClientDiagnosticsBeacon(
  snapshot: QuoteClientDiagnosticsSnapshot,
  options: { readonly fetchImpl?: typeof fetch; readonly baseUrl?: string } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BEACON_TIMEOUT_MS);
  try {
    await fetchImpl(`${baseUrl}/api/quote/client-diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
      // MEASURED GAP, mitigated — without this, a customer who closes the
      // tab or navigates away right after seeing the error (a plausible
      // reaction) can have this request cancelled by the browser before
      // it reaches the server, silently losing the diagnostic. `keepalive`
      // is the standard fetch() flag precisely for "let this one small
      // request outlive the page that started it" — it is NOT a
      // guaranteed-delivery mechanism: it carries a combined ~64 KB cap
      // across all in-flight keepalive requests (irrelevant here — this
      // body is a few hundred bytes) and has had real, historically
      // inconsistent support across browser engines for the
      // keepalive+AbortSignal combination used here. This measurably
      // improves the odds the beacon survives a near-immediate page
      // close; it does not make that outcome certain.
      keepalive: true,
    });
  } catch {
    // Ignore — see module/function doc comments. Nothing ever depends on
    // this beacon actually landing.
  } finally {
    clearTimeout(timeoutId);
  }
}
