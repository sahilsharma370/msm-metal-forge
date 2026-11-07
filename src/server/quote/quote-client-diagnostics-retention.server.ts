/**
 * QT-CLI audit — retention for quote_client_diagnostics. `.server.ts`
 * suffix — see env.server.ts for why that's sufficient import protection
 * on its own.
 *
 * Calls prune_quote_client_diagnostics_v1 (see its own doc comment in
 * supabase/migrations/20261102000000_create_quote_client_diagnostics.sql
 * for why that one function is SECURITY DEFINER, the sole exception to
 * this schema's SECURITY INVOKER convention) once per UTC day, from the
 * EXISTING Cloudflare Worker scheduled trigger (cloudflare-hooks.server.ts)
 * — no new cron trigger, no new Postgres extension (no pg_cron). This is
 * a real, testable, invokable mechanism, not merely a documented manual
 * query — but it is still not a delivery/retention GUARANTEE.
 *
 * CORRECTION to an earlier draft of this comment: Cloudflare Cron
 * Triggers invoke a Worker's scheduled() handler directly from
 * Cloudflare's own edge infrastructure, on the configured schedule,
 * independent of HTTP traffic — that is the entire point of Cron
 * Triggers (letting a Worker do periodic work with no request to wake it
 * up). It is NOT "traffic-dependent", and an idle/zero-traffic Worker
 * does not delay this. The real, narrower caveats are: (1) the Worker
 * must actually be deployed with this trigger configured (verified in
 * wrangler.jsonc's own `triggers.crons`, confirmed locally — see this
 * module's own test file and the local-scheduled-handler check recorded
 * alongside it), and (2) a transient failure inside THIS function itself
 * (the RPC call failing) simply waits for tomorrow's 03:00 UTC tick,
 * same as any other best-effort job.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase-admin.server";

export const DEFAULT_RETENTION_MAX_AGE_DAYS = 30;

/**
 * Pure, injectable-time decision — true exactly once per UTC calendar
 * day, at a fixed hour/minute chosen to fall out of the EXISTING
 * "* * * * *" (every-minute) trigger naturally, rather than adding a
 * second cron schedule. 03:00 UTC specifically: low-traffic window for
 * this UAE-focused site (Asia/Dubai is UTC+4, so this is ~07:00 local),
 * same reasoning the notification sweep's own timestamps already favor
 * off-peak processing. Deliberately exact-minute, not "at least once a
 * day" via a wider window: a wider window would mean this could fire
 * more than once if the Worker happens to be invoked several times
 * within it, which is harmless here (prune is naturally idempotent —
 * re-running it just finds fewer or no rows to delete) but exact-once is
 * simpler to reason about and test.
 */
export function shouldRunRetentionSweepNow(now: Date): boolean {
  return now.getUTCHours() === 3 && now.getUTCMinutes() === 0;
}

export interface RetentionRpcClient {
  rpc(
    fn: "prune_quote_client_diagnostics_v1",
    args: { p_max_age_days: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toRetentionRpcClient(client: SupabaseClient): RetentionRpcClient {
  return client as unknown as RetentionRpcClient;
}

export type RetentionSweepOutcome =
  | { readonly kind: "pruned"; readonly deletedCount: number }
  | { readonly kind: "internal_error" }
  | { readonly kind: "skipped" };

export interface RunRetentionSweepDeps {
  readonly rpc: RetentionRpcClient;
  /** Defaults to DEFAULT_RETENTION_MAX_AGE_DAYS; injectable so a test can prove the exact value passed to the RPC without relying on the default staying in sync. */
  readonly maxAgeDays?: number;
  /**
   * Never includes a raw RPC error message or any row content — only this
   * fixed outcome classification and (when pruned) a bare count, matching
   * every other logOutcome-style helper in this codebase (see
   * complete-quote.ts's own logOutcome for the identical pattern).
   */
  readonly log: (outcome: RetentionSweepOutcome) => void;
}

/**
 * Best-effort by construction: every failure mode (a thrown/rejected RPC
 * call, an RPC-level error) resolves to {kind:"internal_error"} rather
 * than throwing — this function's own caller (cloudflare-hooks.server.ts)
 * never needs its own try/catch around this call, though it still has one
 * as defense-in-depth against a future change to that contract (same
 * reasoning as every other "best-effort, never breaks the real flow"
 * guard elsewhere in this audit).
 */
export async function runQuoteClientDiagnosticsRetentionSweep(
  now: Date,
  deps: RunRetentionSweepDeps,
): Promise<RetentionSweepOutcome> {
  if (!shouldRunRetentionSweepNow(now)) {
    const outcome: RetentionSweepOutcome = { kind: "skipped" };
    return outcome;
  }

  const maxAgeDays = deps.maxAgeDays ?? DEFAULT_RETENTION_MAX_AGE_DAYS;
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("prune_quote_client_diagnostics_v1", { p_max_age_days: maxAgeDays });
  } catch {
    const outcome: RetentionSweepOutcome = { kind: "internal_error" };
    deps.log(outcome);
    return outcome;
  }

  if (response.error) {
    const outcome: RetentionSweepOutcome = { kind: "internal_error" };
    deps.log(outcome);
    return outcome;
  }

  const deletedCount = typeof response.data === "number" ? response.data : 0;
  const outcome: RetentionSweepOutcome = { kind: "pruned", deletedCount };
  deps.log(outcome);
  return outcome;
}

/** Production wiring — never called from a unit test, which always injects its own fake rpc/log. */
export function createProductionRetentionSweepDeps(): RunRetentionSweepDeps {
  return {
    rpc: toRetentionRpcClient(createSupabaseAdminClient()),
    log: (outcome) => {
      console.log(JSON.stringify({ event: "quote.client_diagnostics_retention", ...outcome }));
    },
  };
}
