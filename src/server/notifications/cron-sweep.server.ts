/**
 * CHECKPOINT C2H-B2 — scheduled (Cron) reconciliation sweep. `.server.ts`
 * suffix — see env.server.ts for why that's sufficient import protection
 * on its own.
 *
 * Recovers everything a Queue wake-up message could ever fail to deliver:
 * a missed/discarded publish, a due retry_wait row, or a processing row
 * whose lease expired (a crashed worker) — because it repeatedly calls the
 * exact same database fallback claim (dispatchOwnerNotification with no
 * delivery ID) a Queue consumer uses, just on a fixed schedule instead of
 * an event. This is what makes the Queue purely an accelerator: even if
 * Cloudflare Queues vanished entirely, this sweep alone would still
 * eventually process every due row.
 */
import { dispatchOwnerNotification, createDispatchNotificationDeps, type DispatchNotificationDeps, type DispatchResult } from "./dispatch-notification.server";
import { createConsoleNotificationLogger, type NotificationLogger } from "./notification-logger";

/** Bounds one Cron invocation to a small, fixed amount of work — never an unbounded loop, matching the C2H-A rate/lease bounds' own "small, human-reasoned, easily-adjusted" philosophy. */
export const CRON_SWEEP_MAX_JOBS = 25;

export type CronSweepStopReason = "no_work" | "internal_error" | "unexpected_error" | "max_reached";

export interface CronSweepResult {
  readonly processed: number;
  readonly stopReason: CronSweepStopReason;
}

export interface CronSweepDeps {
  readonly dispatch: () => Promise<DispatchResult>;
  readonly logger: NotificationLogger;
  /** Defaults to CRON_SWEEP_MAX_JOBS; injectable so tests can prove the bound without looping 25 times. */
  readonly maxJobs?: number;
}

/**
 * Repeatedly claims and processes the oldest due delivery until there is
 * genuinely no more due work (no_work), a bounded amount of work has been
 * done this run (max_reached — the sweep will simply pick up again on the
 * next scheduled tick), or something goes wrong (internal_error / an
 * unexpected thrown error) — in either failure case this stops immediately
 * rather than hammering a possibly-unhealthy dependency in a tight loop.
 * Never mutates public.leads — every job goes through the exact same
 * dispatcher used by the Queue consumer, which only ever reads leads and
 * writes notification_deliveries.
 */
export async function runNotificationCronSweep(deps: CronSweepDeps): Promise<CronSweepResult> {
  const maxJobs = deps.maxJobs ?? CRON_SWEEP_MAX_JOBS;
  let processed = 0;

  for (let i = 0; i < maxJobs; i += 1) {
    let result: DispatchResult;
    try {
      result = await deps.dispatch();
    } catch {
      deps.logger.log("cron_sweep_unexpected_error");
      return { processed, stopReason: "unexpected_error" };
    }

    if (result.kind === "no_work") {
      deps.logger.log("cron_sweep_complete");
      return { processed, stopReason: "no_work" };
    }
    if (result.kind === "internal_error") {
      deps.logger.log("cron_sweep_internal_error");
      return { processed, stopReason: "internal_error" };
    }

    // sent / retry_scheduled / dead_lettered / claim_lost — a durable
    // outcome either way; continue draining the queue of due work.
    processed += 1;
  }

  deps.logger.log("cron_sweep_max_reached");
  return { processed, stopReason: "max_reached" };
}

/** Production wiring — never called from a unit test, which always injects its own fake dispatch/logger/maxJobs. */
export function createProductionCronSweepDeps(): CronSweepDeps {
  const dispatchDeps: DispatchNotificationDeps = createDispatchNotificationDeps();
  return {
    dispatch: () => dispatchOwnerNotification({}, dispatchDeps),
    logger: createConsoleNotificationLogger(),
  };
}
