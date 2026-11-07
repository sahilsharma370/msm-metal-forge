import { describe, expect, it, vi } from "vitest";
import { runScheduledWorkerSweeps, type ScheduledSweepDeps } from "./scheduled-sweep.server";

describe("runScheduledWorkerSweeps — notification/retention isolation", () => {
  it("retention sweep still runs, and reports its own real outcome, even when the notification sweep's own SETUP throws (not just an internal failure its own code already catches)", async () => {
    // This is the exact gap this file was extracted to fix and prove: the
    // prior wiring called createProductionCronSweepDeps() inline as an
    // argument to runNotificationCronSweep(...), both unguarded — a throw
    // from deps creation (e.g. the Supabase admin client constructor
    // failing) would have propagated past the retention call entirely,
    // since that call came AFTER in the same unguarded sequence.
    const runRetentionSweep = vi.fn(async () => ({ kind: "pruned" as const, deletedCount: 3 }));
    const onStepFailed = vi.fn();

    const result = await runScheduledWorkerSweeps({
      runNotificationSweep: () => {
        throw new Error("supabase admin client creation failed");
      },
      runRetentionSweep,
      onStepFailed,
    });

    expect(runRetentionSweep).toHaveBeenCalledTimes(1);
    expect(result.retention).toEqual({ kind: "pruned", deletedCount: 3 });
    expect(result.notification).toEqual({ kind: "setup_failed" });
    expect(onStepFailed).toHaveBeenCalledWith("notification", expect.any(Error));
  });

  it("the same isolation holds in reverse: a retention-sweep failure never affects the notification sweep's own already-decided result", async () => {
    const runNotificationSweep = vi.fn(async () => ({ processed: 5, stopReason: "no_work" as const }));

    const result = await runScheduledWorkerSweeps({
      runNotificationSweep,
      runRetentionSweep: () => {
        throw new Error("prune RPC failed");
      },
    });

    expect(result.notification).toEqual({ processed: 5, stopReason: "no_work" });
    expect(result.retention).toEqual({ kind: "setup_failed" });
  });

  it("runs retention unconditionally — never skipped merely because notification sweep failed", async () => {
    const runRetentionSweep = vi.fn(async () => ({ kind: "skipped" as const }));
    await runScheduledWorkerSweeps({
      runNotificationSweep: async () => {
        throw new Error("boom");
      },
      runRetentionSweep,
    });
    expect(runRetentionSweep).toHaveBeenCalledTimes(1);
  });

  it("the happy path: both sweeps succeed, both real outcomes are reported unchanged", async () => {
    const result = await runScheduledWorkerSweeps({
      runNotificationSweep: async () => ({ processed: 1, stopReason: "no_work" }),
      runRetentionSweep: async () => ({ kind: "pruned", deletedCount: 0 }),
    });
    expect(result).toEqual({
      notification: { processed: 1, stopReason: "no_work" },
      retention: { kind: "pruned", deletedCount: 0 },
    });
  });

  it("onStepFailed is best-effort too — a throw from the logger itself must never prevent retention from running (the same bug class, one level removed)", async () => {
    const runRetentionSweep = vi.fn(async () => ({ kind: "pruned" as const, deletedCount: 1 }));
    const deps: ScheduledSweepDeps = {
      runNotificationSweep: () => {
        throw new Error("boom");
      },
      runRetentionSweep,
      onStepFailed: () => {
        throw new Error("logging itself failed");
      },
    };

    const result = await runScheduledWorkerSweeps(deps);

    expect(runRetentionSweep).toHaveBeenCalledTimes(1);
    expect(result.retention).toEqual({ kind: "pruned", deletedCount: 1 });
    expect(result.notification).toEqual({ kind: "setup_failed" });
  });
});
