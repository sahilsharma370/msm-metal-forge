// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOwnerLeadDetail } from "./use-owner-lead-detail";
import * as transport from "./owner-leads-transport";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, fetchOwnerLeadDetail: vi.fn() };
});

const fetchOwnerLeadDetailMock = vi.mocked(transport.fetchOwnerLeadDetail);
const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnerLeadDetail — fetch lifecycle", () => {
  it("fetches the given leadId on mount", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "ok", data: { lead: {}, files: [], activities: [], notification: {} } as never });
    const { result } = renderHook(() => useOwnerLeadDetail("lead-1", fakeDeps));
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));
    expect(fetchOwnerLeadDetailMock).toHaveBeenCalledWith("lead-1", fakeDeps, expect.anything());
  });

  it("refetches when leadId changes", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "ok", data: { lead: {}, files: [], activities: [], notification: {} } as never });
    const { result, rerender } = renderHook(({ leadId }) => useOwnerLeadDetail(leadId, fakeDeps), { initialProps: { leadId: "lead-1" } });
    await waitFor(() => expect(result.current.state.isLoading).toBe(false));
    rerender({ leadId: "lead-2" });
    await waitFor(() => expect(fetchOwnerLeadDetailMock).toHaveBeenLastCalledWith("lead-2", fakeDeps, expect.anything()));
  });
});

describe("useOwnerLeadDetail — session expiration", () => {
  it("sets unauthorized on a 401 result", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "unauthorized" });
    const { result } = renderHook(() => useOwnerLeadDetail("lead-1", fakeDeps));
    await waitFor(() => expect(result.current.state.unauthorized).toBe(true));
  });
});

describe("useOwnerLeadDetail — not-found vs generic error", () => {
  it("marks notFound only for a 404 status", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "error", message: "Not found.", status: 404 });
    const { result } = renderHook(() => useOwnerLeadDetail("lead-1", fakeDeps));
    await waitFor(() => expect(result.current.state.notFound).toBe(true));
  });

  it("does not mark notFound for a 500 status, leaving it retryable", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const { result } = renderHook(() => useOwnerLeadDetail("lead-1", fakeDeps));
    await waitFor(() => expect(result.current.state.error).not.toBeNull());
    expect(result.current.state.notFound).toBe(false);
  });
});
