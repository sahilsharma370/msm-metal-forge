import { describe, expect, it, vi } from "vitest";
import { runNotificationCronSweep, CRON_SWEEP_MAX_JOBS } from "./cron-sweep.server";
import type { NotificationLogEvent, NotificationLogger } from "./notification-logger";
import type { DispatchResult } from "./dispatch-notification.server";

function fakeLogger(): { logger: NotificationLogger; events: NotificationLogEvent[] } {
  const events: NotificationLogEvent[] = [];
  return { logger: { log: (event) => events.push(event) }, events };
}

describe("runNotificationCronSweep", () => {
  it("drains work until no_work, and reports the exact processed count", async () => {
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "d1", providerMessageId: "m1" },
      { kind: "retry_scheduled", deliveryId: "d2", nextAttemptAt: null },
      { kind: "no_work" },
    ];
    let i = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[i++]!);
    const { logger, events } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ processed: 2, stopReason: "no_work" });
    expect(events).toEqual(["cron_sweep_complete"]);
  });

  it("continues over sent, retry_scheduled, dead_lettered, and claim_lost", async () => {
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "d1", providerMessageId: "m1" },
      { kind: "retry_scheduled", deliveryId: "d2", nextAttemptAt: null },
      { kind: "dead_lettered", deliveryId: "d3", errorCode: "INVALID_RECIPIENT" },
      { kind: "claim_lost", deliveryId: "d4" },
      { kind: "no_work" },
    ];
    let i = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[i++]!);
    const { logger } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });
    expect(result).toEqual({ processed: 4, stopReason: "no_work" });
  });

  it("stops immediately on internal_error without processing further", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "internal_error" }));
    const { logger, events } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 0, stopReason: "internal_error" });
    expect(events).toEqual(["cron_sweep_internal_error"]);
  });

  it("stops safely on an unexpected thrown error", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const { logger, events } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 0, stopReason: "unexpected_error" });
    expect(events).toEqual(["cron_sweep_unexpected_error"]);
  });

  it("respects an explicit maxJobs bound rather than looping unboundedly", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "sent", deliveryId: "d1", providerMessageId: "m1" }));
    const { logger, events } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger, maxJobs: 3 });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ processed: 3, stopReason: "max_reached" });
    expect(events).toEqual(["cron_sweep_max_reached"]);
  });

  it("defaults to the CRON_SWEEP_MAX_JOBS bound (20-25 range) when maxJobs is not supplied", async () => {
    expect(CRON_SWEEP_MAX_JOBS).toBeGreaterThanOrEqual(20);
    expect(CRON_SWEEP_MAX_JOBS).toBeLessThanOrEqual(25);
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "sent", deliveryId: "d1", providerMessageId: "m1" }));
    const { logger } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(CRON_SWEEP_MAX_JOBS);
    expect(result.stopReason).toBe("max_reached");
  });

  it("an empty database (immediate no_work) is a clean no-op", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "no_work" }));
    const { logger } = fakeLogger();

    const result = await runNotificationCronSweep({ dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 0, stopReason: "no_work" });
  });

  it("never mutates anything beyond calling the injected dispatch function — no other side-effecting dependency exists", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "no_work" }));
    const { logger } = fakeLogger();
    await runNotificationCronSweep({ dispatch, logger });
    // CronSweepDeps has no lead-writing or Storage-touching capability at
    // all — see the interface definition — so there is nothing further to
    // assert to prove leads are untouched by this sweep.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
