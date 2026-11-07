import { describe, expect, it, vi } from "vitest";
import {
  shouldRunRetentionSweepNow,
  runQuoteClientDiagnosticsRetentionSweep,
  DEFAULT_RETENTION_MAX_AGE_DAYS,
  type RetentionRpcClient,
  type RetentionSweepOutcome,
} from "./quote-client-diagnostics-retention.server";

describe("shouldRunRetentionSweepNow", () => {
  it("is true only at exactly 03:00 UTC", () => {
    expect(shouldRunRetentionSweepNow(new Date("2026-11-02T03:00:00.000Z"))).toBe(true);
  });

  it.each([
    "2026-11-02T02:59:00.000Z",
    "2026-11-02T03:01:00.000Z",
    "2026-11-02T00:00:00.000Z",
    "2026-11-02T12:00:00.000Z",
    "2026-11-02T03:00:59.000Z", // same minute, different second — UTCMinutes() is still 0, so this one IS true
  ])("evaluates %s per its own exact-minute rule", (iso) => {
    const now = new Date(iso);
    const expected = now.getUTCHours() === 3 && now.getUTCMinutes() === 0;
    expect(shouldRunRetentionSweepNow(now)).toBe(expected);
  });

  it("is true every day at the same wall-clock moment — not a one-time check", () => {
    expect(shouldRunRetentionSweepNow(new Date("2026-11-02T03:00:00.000Z"))).toBe(true);
    expect(shouldRunRetentionSweepNow(new Date("2026-12-25T03:00:00.000Z"))).toBe(true);
  });
});

function fakeRpc(impl: RetentionRpcClient["rpc"]): RetentionRpcClient {
  return { rpc: impl };
}

describe("runQuoteClientDiagnosticsRetentionSweep", () => {
  it("skips entirely outside the daily window — the RPC is never called", async () => {
    const rpc = vi.fn();
    const log = vi.fn();

    const outcome = await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T12:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      log,
    });

    expect(outcome).toEqual({ kind: "skipped" });
    expect(rpc).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("calls the RPC with DEFAULT_RETENTION_MAX_AGE_DAYS when not overridden, and reports the exact deleted count", async () => {
    const rpc = vi.fn(async () => ({ data: 7, error: null }));
    const log = vi.fn();

    const outcome = await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T03:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      log,
    });

    expect(rpc).toHaveBeenCalledWith("prune_quote_client_diagnostics_v1", {
      p_max_age_days: DEFAULT_RETENTION_MAX_AGE_DAYS,
    });
    expect(outcome).toEqual({ kind: "pruned", deletedCount: 7 });
    expect(log).toHaveBeenCalledWith({ kind: "pruned", deletedCount: 7 });
  });

  it("honors an injected maxAgeDays override", async () => {
    const rpc = vi.fn(async () => ({ data: 0, error: null }));
    await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T03:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      maxAgeDays: 7,
      log: () => undefined,
    });
    expect(rpc).toHaveBeenCalledWith("prune_quote_client_diagnostics_v1", { p_max_age_days: 7 });
  });

  it("maps an RPC-level error to internal_error — never throws, never surfaces the raw message", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "permission denied for table some_internal_detail" } }));
    const log = vi.fn();

    const outcome = await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T03:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      log,
    });

    expect(outcome).toEqual({ kind: "internal_error" });
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("permission denied");
  });

  it("maps a rejected RPC call (network failure) to the same internal_error — never throws", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const log = vi.fn();

    const outcome = await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T03:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      log,
    });

    expect(outcome).toEqual({ kind: "internal_error" });
    expect(log).toHaveBeenCalledWith({ kind: "internal_error" } satisfies RetentionSweepOutcome);
  });

  it("falls back to a count of 0 if the RPC ever returned a non-numeric data value — fails closed, never throws on the shape", async () => {
    const rpc = vi.fn(async () => ({ data: "not-a-number", error: null }));
    const outcome = await runQuoteClientDiagnosticsRetentionSweep(new Date("2026-11-02T03:00:00.000Z"), {
      rpc: fakeRpc(rpc),
      log: () => undefined,
    });
    expect(outcome).toEqual({ kind: "pruned", deletedCount: 0 });
  });
});
