// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOwnerLeadQuickAdd } from "./use-owner-lead-quick-add";
import * as transport from "./owner-leads-transport";
import type { OwnerLeadQuickAddRequest } from "@/lib/owner/owner-lead-quick-add-contract";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, createOwnerQuickAddLead: vi.fn() };
});

const createOwnerQuickAddLeadMock = vi.mocked(transport.createOwnerQuickAddLead);
const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };

const FIELDS: Omit<OwnerLeadQuickAddRequest, "requestId"> = {
  intent: "sell",
  channel: "phone",
  material: "copper",
  contactName: "Ahmed",
  contactPhone: "+971501234567",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnerLeadQuickAdd — submit success", () => {
  it("returns ok with leadId/reference on a successful create", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({
      kind: "ok",
      data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false },
    });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));
    await act(async () => {
      const outcome = await result.current.submit(FIELDS);
      expect(outcome).toEqual({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF" });
    });
  });
});

describe("useOwnerLeadQuickAdd — submit failure preserves nothing of its own (no input state to clear)", () => {
  it("a failed submission sets state.error and returns ok: false", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));
    await act(async () => {
      await result.current.submit(FIELDS);
    });
    expect(result.current.state.error).toBe("Something went wrong. Please try again.");
  });

  it("clearError resets state.error", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({ kind: "error", message: "boom", status: 500 });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));
    await act(async () => {
      await result.current.submit(FIELDS);
    });
    expect(result.current.state.error).toBe("boom");
    act(() => result.current.clearError());
    expect(result.current.state.error).toBeNull();
  });
});

describe("useOwnerLeadQuickAdd — unauthorized", () => {
  it("calls onUnauthorized on a 401 and returns ok: false", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({ kind: "unauthorized" });
    const onUnauthorized = vi.fn();
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, onUnauthorized));
    await act(async () => {
      const outcome = await result.current.submit(FIELDS);
      expect(outcome.ok).toBe(false);
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("useOwnerLeadQuickAdd — double-submit lock", () => {
  it("a concurrent second submit while one is pending is rejected without a second transport call", async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof transport.createOwnerQuickAddLead>>) => void;
    createOwnerQuickAddLeadMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));

    let firstOutcomePromise!: ReturnType<typeof result.current.submit>;
    act(() => {
      firstOutcomePromise = result.current.submit(FIELDS);
    });
    await waitFor(() => expect(result.current.state.isSubmitting).toBe(true));

    const secondOutcome = await result.current.submit(FIELDS);
    expect(secondOutcome.ok).toBe(false);
    expect(createOwnerQuickAddLeadMock).toHaveBeenCalledTimes(1);

    resolveFirst({ kind: "ok", data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false } });
    await act(async () => {
      await firstOutcomePromise;
    });
  });
});

describe("useOwnerLeadQuickAdd — requestId stability (mirrors use-owner-lead-mutations.ts's own addNote pattern)", () => {
  it("a retry of the exact same fields after a failure reuses the identical requestId", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));

    await act(async () => {
      await result.current.submit(FIELDS);
    });
    await act(async () => {
      await result.current.submit(FIELDS);
    });

    expect(createOwnerQuickAddLeadMock).toHaveBeenCalledTimes(2);
    const firstRequest = createOwnerQuickAddLeadMock.mock.calls[0]![0] as OwnerLeadQuickAddRequest;
    const secondRequest = createOwnerQuickAddLeadMock.mock.calls[1]![0] as OwnerLeadQuickAddRequest;
    expect(firstRequest.requestId).toBe(secondRequest.requestId);
  });

  it("genuinely different fields after a prior failure get a fresh requestId", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));

    await act(async () => {
      await result.current.submit(FIELDS);
    });
    await act(async () => {
      await result.current.submit({ ...FIELDS, contactName: "A Different Person" });
    });

    const firstRequest = createOwnerQuickAddLeadMock.mock.calls[0]![0] as OwnerLeadQuickAddRequest;
    const secondRequest = createOwnerQuickAddLeadMock.mock.calls[1]![0] as OwnerLeadQuickAddRequest;
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId);
  });

  it("after a confirmed success, resetAttempt makes the next identical submission get a fresh requestId", async () => {
    createOwnerQuickAddLeadMock.mockResolvedValue({
      kind: "ok",
      data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false },
    });
    const { result } = renderHook(() => useOwnerLeadQuickAdd(fakeDeps, vi.fn()));

    await act(async () => {
      await result.current.submit(FIELDS);
    });
    await act(async () => {
      await result.current.submit(FIELDS);
    });

    const firstRequest = createOwnerQuickAddLeadMock.mock.calls[0]![0] as OwnerLeadQuickAddRequest;
    const secondRequest = createOwnerQuickAddLeadMock.mock.calls[1]![0] as OwnerLeadQuickAddRequest;
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId);
  });
});
