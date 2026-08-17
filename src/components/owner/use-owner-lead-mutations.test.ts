// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOwnerLeadMutations } from "./use-owner-lead-mutations";
import * as transport from "./owner-leads-transport";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, changeOwnerLeadStatus: vi.fn(), addOwnerLeadNote: vi.fn() };
});

const changeOwnerLeadStatusMock = vi.mocked(transport.changeOwnerLeadStatus);
const addOwnerLeadNoteMock = vi.mocked(transport.addOwnerLeadNote);
const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnerLeadMutations — changeStatus", () => {
  it("calls onMutated after a successful status change", async () => {
    changeOwnerLeadStatusMock.mockResolvedValue({ kind: "ok", data: { changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" } });
    const onMutated = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, vi.fn()));
    await act(async () => {
      const outcome = await result.current.changeStatus({ expectedStatus: "new", newStatus: "contacted" });
      expect(outcome).toEqual({ ok: true });
    });
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a 409 conflict and still calls onMutated (to pick up the real current state)", async () => {
    changeOwnerLeadStatusMock.mockResolvedValue({ kind: "error", message: "This lead was already updated.", status: 409 });
    const onMutated = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, vi.fn()));
    await act(async () => {
      const outcome = await result.current.changeStatus({ expectedStatus: "new", newStatus: "contacted" });
      expect(outcome).toEqual({ ok: false, conflict: true, message: "This lead was already updated." });
    });
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(result.current.state.statusError).toBe("This lead was already updated.");
  });

  it("a non-conflict error sets statusError and does not call onMutated", async () => {
    changeOwnerLeadStatusMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const onMutated = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, vi.fn()));
    await act(async () => {
      await result.current.changeStatus({ expectedStatus: "new", newStatus: "contacted" });
    });
    expect(onMutated).not.toHaveBeenCalled();
    expect(result.current.state.statusError).toBe("Something went wrong. Please try again.");
  });

  it("calls onUnauthorized and never onMutated on a 401", async () => {
    changeOwnerLeadStatusMock.mockResolvedValue({ kind: "unauthorized" });
    const onMutated = vi.fn();
    const onUnauthorized = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, onUnauthorized));
    await act(async () => {
      await result.current.changeStatus({ expectedStatus: "new", newStatus: "contacted" });
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onMutated).not.toHaveBeenCalled();
  });

  it("a concurrent second call while one is pending is rejected without a second transport call (double-submit guard)", async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof transport.changeOwnerLeadStatus>>) => void;
    changeOwnerLeadStatusMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, vi.fn(), vi.fn()));

    let firstOutcomePromise!: ReturnType<typeof result.current.changeStatus>;
    act(() => {
      firstOutcomePromise = result.current.changeStatus({ expectedStatus: "new", newStatus: "contacted" });
    });
    await waitFor(() => expect(result.current.state.isChangingStatus).toBe(true));

    const secondOutcome = await result.current.changeStatus({ expectedStatus: "new", newStatus: "lost", lostReason: "x" });
    expect(secondOutcome.ok).toBe(false);
    expect(changeOwnerLeadStatusMock).toHaveBeenCalledTimes(1);

    resolveFirst({ kind: "ok", data: { changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" } });
    await act(async () => {
      await firstOutcomePromise;
    });
  });
});

describe("useOwnerLeadMutations — addNote", () => {
  it("calls onMutated after a successful note add", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "ok", data: { activityId: "a1", note: "hello", createdAt: "2026-01-01T00:00:00.000Z" } });
    const onMutated = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, vi.fn()));
    await act(async () => {
      const outcome = await result.current.addNote("hello");
      expect(outcome).toEqual({ ok: true });
    });
    expect(onMutated).toHaveBeenCalledTimes(1);
  });

  it("a failed note add sets noteError and never calls onMutated", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const onMutated = vi.fn();
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, onMutated, vi.fn()));
    await act(async () => {
      await result.current.addNote("hello");
    });
    expect(onMutated).not.toHaveBeenCalled();
    expect(result.current.state.noteError).toBe("Something went wrong. Please try again.");
  });

  it("clearNoteError/clearStatusError reset their respective error fields", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "error", message: "boom", status: 500 });
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, vi.fn(), vi.fn()));
    await act(async () => {
      await result.current.addNote("hello");
    });
    expect(result.current.state.noteError).toBe("boom");
    act(() => result.current.clearNoteError());
    expect(result.current.state.noteError).toBeNull();
  });
});

describe("useOwnerLeadMutations — addNote request id stability (CHECKPOINT C2J-E correction pass)", () => {
  it("a retry of the same unchanged text after a failure reuses the identical requestId", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, vi.fn(), vi.fn()));

    await act(async () => {
      await result.current.addNote("Call back tomorrow");
    });
    await act(async () => {
      await result.current.addNote("Call back tomorrow");
    });

    expect(addOwnerLeadNoteMock).toHaveBeenCalledTimes(2);
    const [, , firstRequestId] = addOwnerLeadNoteMock.mock.calls[0]!;
    const [, , secondRequestId] = addOwnerLeadNoteMock.mock.calls[1]!;
    expect(firstRequestId).toBe(secondRequestId);
  });

  it("a genuinely new note (different text) after a prior failure gets a fresh requestId", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, vi.fn(), vi.fn()));

    await act(async () => {
      await result.current.addNote("First note");
    });
    await act(async () => {
      await result.current.addNote("A completely different note");
    });

    const [, , firstRequestId] = addOwnerLeadNoteMock.mock.calls[0]!;
    const [, , secondRequestId] = addOwnerLeadNoteMock.mock.calls[1]!;
    expect(firstRequestId).not.toBe(secondRequestId);
  });

  it("after a confirmed success, submitting the same text again as a new note gets a fresh requestId", async () => {
    addOwnerLeadNoteMock.mockResolvedValue({ kind: "ok", data: { activityId: "a1", note: "Thanks!", createdAt: "2026-01-01T00:00:00.000Z" } });
    const { result } = renderHook(() => useOwnerLeadMutations("lead-1", fakeDeps, vi.fn(), vi.fn()));

    await act(async () => {
      await result.current.addNote("Thanks!");
    });
    await act(async () => {
      await result.current.addNote("Thanks!");
    });

    const [, , firstRequestId] = addOwnerLeadNoteMock.mock.calls[0]!;
    const [, , secondRequestId] = addOwnerLeadNoteMock.mock.calls[1]!;
    expect(firstRequestId).not.toBe(secondRequestId);
  });
});
