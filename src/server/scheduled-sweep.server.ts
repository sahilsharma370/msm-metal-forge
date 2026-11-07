/**
 * QT-CLI audit — the one place the notification cron sweep and the
 * quote-client-diagnostics retention sweep are actually orchestrated
 * together, extracted out of cloudflare-hooks.server.ts specifically so
 * this ordering/isolation behavior is unit-testable with fake deps,
 * matching this codebase's own established split (wiring stays thin and
 * untested; logic — including this orchestration — is fully tested).
 * `.server.ts` suffix — see env.server.ts for why that's sufficient
 * import protection on its own.
 *
 * MEASURED GAP, fixed — the prior version of this wiring called
 * createProductionCronSweepDeps() INLINE as an argument to
 * runNotificationCronSweep(...), both directly inside
 * cloudflare-hooks.server.ts's own scheduled hook, with the retention
 * sweep's own try/catch only wrapping the SECOND call. A throw from that
 * deps-creation call (e.g. the Supabase admin client constructor failing)
 * would happen before runNotificationCronSweep was ever entered — and
 * therefore before the retention sweep's own try/catch was ever reached
 * at all, since it comes after in the same unguarded sequence. Each step
 * below is now independently wrapped, so a notification-sweep SETUP
 * failure (not just a failure the sweep's own internal logic already
 * guards against) can never prevent the retention sweep from running —
 * proven by this file's own test, not merely asserted.
 */
import { runNotificationCronSweep, createProductionCronSweepDeps, type CronSweepResult } from "./notifications/cron-sweep.server";
import {
  runQuoteClientDiagnosticsRetentionSweep,
  createProductionRetentionSweepDeps,
  type RetentionSweepOutcome,
} from "./quote/quote-client-diagnostics-retention.server";

export interface ScheduledSweepDeps {
  readonly runNotificationSweep: () => Promise<CronSweepResult>;
  readonly runRetentionSweep: () => Promise<RetentionSweepOutcome>;
  /** Best-effort diagnostic only — never rethrown, never required. */
  readonly onStepFailed?: (step: "notification" | "retention", error: unknown) => void;
}

export type ScheduledSweepStepResult<T> = T | { readonly kind: "setup_failed" };

export interface ScheduledSweepResult {
  readonly notification: ScheduledSweepStepResult<CronSweepResult>;
  readonly retention: ScheduledSweepStepResult<RetentionSweepOutcome>;
}

/**
 * Runs the notification sweep, then the retention sweep, UNCONDITIONALLY
 * — the second call is never skipped because the first one failed, and
 * each one's own thrown exception (from the step itself OR from
 * constructing its deps, which is exactly the gap this fixes) is caught
 * independently, in place, rather than relying on a single try/catch
 * wrapping both calls together (which would only protect whichever call
 * came last).
 */
function reportStepFailure(deps: ScheduledSweepDeps, step: "notification" | "retention", error: unknown): void {
  // Guarded independently of the two steps below: a misbehaving
  // caller-supplied onStepFailed must never be able to reproduce the
  // exact bug this file exists to fix, just one level removed — it is
  // diagnostic-only and must never affect which steps run.
  try {
    deps.onStepFailed?.(step, error);
  } catch {
    // Ignore — see comment above.
  }
}

export async function runScheduledWorkerSweeps(deps: ScheduledSweepDeps): Promise<ScheduledSweepResult> {
  let notification: ScheduledSweepStepResult<CronSweepResult>;
  try {
    notification = await deps.runNotificationSweep();
  } catch (error) {
    reportStepFailure(deps, "notification", error);
    notification = { kind: "setup_failed" };
  }

  let retention: ScheduledSweepStepResult<RetentionSweepOutcome>;
  try {
    retention = await deps.runRetentionSweep();
  } catch (error) {
    reportStepFailure(deps, "retention", error);
    retention = { kind: "setup_failed" };
  }

  return { notification, retention };
}

/** Production wiring — never called from a unit test, which always injects its own fake sweep functions. */
export function createProductionScheduledSweepDeps(): ScheduledSweepDeps {
  return {
    runNotificationSweep: () => runNotificationCronSweep(createProductionCronSweepDeps()),
    runRetentionSweep: () => runQuoteClientDiagnosticsRetentionSweep(new Date(), createProductionRetentionSweepDeps()),
    onStepFailed: (step, error) => {
      // Never the raw error message/stack — only this fixed, closed
      // (step name) + (error-less) classification, same privacy posture
      // as every other best-effort log line in this codebase.
      console.log(JSON.stringify({ event: "scheduled_sweep_step_failed", step }));
      void error;
    },
  };
}
