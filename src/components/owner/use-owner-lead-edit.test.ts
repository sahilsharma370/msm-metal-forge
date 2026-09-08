// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOwnerLeadEdit } from "./use-owner-lead-edit";
import * as transport from "./owner-leads-transport";
import type { OwnerLeadEditRequest } from "@/lib/owner/owner-lead-detail-contract";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, updateOwnerLeadDetails: vi.fn() };
});

const updateOwnerLeadDetailsMock = vi.mocked(transport.updateOwnerLeadDetails);
const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };
const LEAD_ID = "11111111-1111-1111-1111-111111111111";

const REQUEST: OwnerLeadEditRequest = {
  contactName: "Ahmed Seller",
  contactPhone: "+971501234567",
  material: "copper",
  expectedUpdatedAt: "2026-01-01T00:05:00.000Z",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnerLeadEdit — submit success", () => {
  it("returns ok with updated/updatedAt on a successful save", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({
      kind: "ok",
      data: { updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] },
    });
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));
    await act(async () => {
      const outcome = await result.current.submit(REQUEST);
      expect(outcome).toEqual({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z" });
    });
  });
});

describe("useOwnerLeadEdit — server failure retains entered form values (this hook owns none of its own)", () => {
  it("a failed submission sets state.error and returns ok: false, conflict: false", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));
    await act(async () => {
      const outcome = await result.current.submit(REQUEST);
      expect(outcome).toEqual({ ok: false, conflict: false, message: "Something went wrong. Please try again." });
    });
    expect(result.current.state.error).toBe("Something went wrong. Please try again.");
  });

  it("clearError resets state.error", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({ kind: "error", message: "boom", status: 500 });
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));
    await act(async () => {
      await result.current.submit(REQUEST);
    });
    expect(result.current.state.error).toBe("boom");
    act(() => result.current.clearError());
    expect(result.current.state.error).toBeNull();
  });
});

describe("useOwnerLeadEdit — stale-update / not-editable conflict", () => {
  it("a 409 response is reported as conflict: true", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({ status: 409, kind: "error", message: "This enquiry was already updated. Please refresh and try again." });
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));
    await act(async () => {
      const outcome = await result.current.submit(REQUEST);
      expect(outcome).toEqual({ ok: false, conflict: true, message: "This enquiry was already updated. Please refresh and try again." });
    });
  });

  it("a non-409 error is reported as conflict: false", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({ status: 500, kind: "error", message: "Something went wrong. Please try again." });
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));
    await act(async () => {
      const outcome = await result.current.submit(REQUEST);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.conflict).toBe(false);
    });
  });
});

describe("useOwnerLeadEdit — unauthorized", () => {
  it("calls onUnauthorized on a 401 and returns ok: false", async () => {
    updateOwnerLeadDetailsMock.mockResolvedValue({ kind: "unauthorized" });
    const onUnauthorized = vi.fn();
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, onUnauthorized));
    await act(async () => {
      const outcome = await result.current.submit(REQUEST);
      expect(outcome.ok).toBe(false);
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("useOwnerLeadEdit — duplicate-submit prevention", () => {
  it("a concurrent second submit while one is pending is rejected without a second transport call", async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof transport.updateOwnerLeadDetails>>) => void;
    updateOwnerLeadDetailsMock.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const { result } = renderHook(() => useOwnerLeadEdit(fakeDeps, LEAD_ID, vi.fn()));

    let firstOutcomePromise!: ReturnType<typeof result.current.submit>;
    act(() => {
      firstOutcomePromise = result.current.submit(REQUEST);
    });
    await waitFor(() => expect(result.current.state.isSubmitting).toBe(true));

    const secondOutcome = await result.current.submit(REQUEST);
    expect(secondOutcome.ok).toBe(false);
    expect(updateOwnerLeadDetailsMock).toHaveBeenCalledTimes(1);

    resolveFirst({ kind: "ok", data: { updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] } });
    await act(async () => {
      await firstOutcomePromise;
    });
  });
});
