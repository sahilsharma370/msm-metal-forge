// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOwnerLeadList } from "./use-owner-lead-list";
import * as transport from "./owner-leads-transport";
import type { OwnerAuthClient } from "./owner-auth-client";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, fetchOwnerLeadList: vi.fn() };
});

const fetchOwnerLeadListMock = vi.mocked(transport.fetchOwnerLeadList);

function fakeAuthClient(): OwnerAuthClient {
  return { getAccessToken: vi.fn().mockResolvedValue("at-1"), setSession: vi.fn(), signOut: vi.fn() };
}

function leadItem(id: string) {
  return {
    id,
    reference: `MSM-260101-${id}`,
    status: "new" as const,
    intent: "sell" as const,
    captureChannel: "website" as const,
    material: "copper" as const,
    materialSubtype: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    submissionCompletedAt: "2026-01-01T00:05:00.000Z",
    contact: { name: "Ahmed", phone: "+971501234567" },
    location: { emirate: "dubai" as const, area: "Al Quoz" },
    quantity: { value: 100, unit: "kg" as const },
    fileUploadStatus: "complete",
    notificationStatus: "sent" as const,
    deletedAt: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnerLeadList — initial load", () => {
  it("fetches on mount with the default limit and no filters/cursor", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));
    expect(fetchOwnerLeadListMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }), deps, expect.anything());
    const [query] = fetchOwnerLeadListMock.mock.calls[0]!;
    expect(query.cursor).toBeUndefined();
  });
});

describe("useOwnerLeadList — filters", () => {
  it("applyFilters sends exactly the applied filters and resets the cursor", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));

    act(() => result.current.setDraftFilters((previous) => ({ ...previous, status: "contacted", q: "Ahmed" })));
    act(() => result.current.applyFilters());

    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(2));
    const [query] = fetchOwnerLeadListMock.mock.calls[1]!;
    expect(query).toEqual(expect.objectContaining({ status: "contacted", q: "Ahmed", limit: 20 }));
    expect(query.cursor).toBeUndefined();
  });

  it("clears the accumulated items the instant filters are applied (never shows stale-filter content)", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    const pending = deferred<transport.OwnerApiResult<{ leads: []; page: { nextCursor: null; hasMore: false } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(pending.promise as never);
    act(() => result.current.applyFilters());
    expect(result.current.state.items).toHaveLength(0);
  });
});

describe("useOwnerLeadList — load more", () => {
  it("appends the next page using nextCursor, without duplicating ids the list already has", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({
      kind: "ok",
      data: { leads: [leadItem("a"), leadItem("b")], page: { nextCursor: "cursor-1", hasMore: true } },
    });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.items).toHaveLength(2));

    fetchOwnerLeadListMock.mockResolvedValueOnce({
      kind: "ok",
      // "b" is a duplicate the server should never send, but the hook must
      // not double it up even if it did.
      data: { leads: [leadItem("b"), leadItem("c")], page: { nextCursor: null, hasMore: false } },
    });
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.state.hasMore).toBe(false));

    expect(result.current.state.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    const [, , lastQuery] = fetchOwnerLeadListMock.mock.calls[1]!;
    void lastQuery;
    expect(fetchOwnerLeadListMock.mock.calls[1]![0]).toEqual(expect.objectContaining({ cursor: "cursor-1" }));
  });

  it("does not call fetch again once hasMore is false", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    act(() => result.current.loadMore());
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);
  });
});

describe("useOwnerLeadList — refresh preserves content while loading", () => {
  it("keeps existing items visible and marks isRefreshing while a refresh is in flight", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    const pending = deferred<transport.OwnerApiResult<{ leads: ReturnType<typeof leadItem>[]; page: { nextCursor: string | null; hasMore: boolean } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(pending.promise as never);
    act(() => result.current.refresh());

    expect(result.current.state.items).toHaveLength(1); // still visible
    expect(result.current.state.isRefreshing).toBe(true);

    act(() => pending.resolve({ kind: "ok", data: { leads: [leadItem("a"), leadItem("b")], page: { nextCursor: null, hasMore: false } } }));
    await waitFor(() => expect(result.current.state.items).toHaveLength(2));
  });
});

describe("useOwnerLeadList — view (CHECKPOINT C2M-A)", () => {
  it("defaults to the 'inbox' view and sends it on the initial fetch", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));
    expect(result.current.state.view).toBe("inbox");
    expect(fetchOwnerLeadListMock).toHaveBeenCalledWith(expect.objectContaining({ view: "inbox" }), deps, expect.anything());
  });

  it("setView refetches from scratch with the new view, clearing accumulated items, and preserves the applied filters", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("b")], page: { nextCursor: null, hasMore: false } } });
    act(() => result.current.setDraftFilters(() => ({ status: "contacted" })));
    act(() => result.current.applyFilters());
    await waitFor(() => expect(result.current.state.items.map((item) => item.id)).toEqual(["b"]));

    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("t")], page: { nextCursor: null, hasMore: false } } });
    act(() => result.current.setView("trash"));

    await waitFor(() => expect(result.current.state.items.map((item) => item.id)).toEqual(["t"]));
    expect(result.current.state.view).toBe("trash");
    const [query] = fetchOwnerLeadListMock.mock.calls[2]!;
    expect(query).toEqual(expect.objectContaining({ view: "trash", status: "contacted" }));
  });
});

describe("useOwnerLeadList — stale response protection", () => {
  it("an older request that resolves after a newer one is discarded, never overwriting the newer result", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps));
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));

    const older = deferred<transport.OwnerApiResult<{ leads: ReturnType<typeof leadItem>[]; page: { nextCursor: string | null; hasMore: boolean } }>>();
    const newer = deferred<transport.OwnerApiResult<{ leads: ReturnType<typeof leadItem>[]; page: { nextCursor: string | null; hasMore: boolean } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(older.promise as never);
    act(() => result.current.setDraftFilters(() => ({ status: "contacted" })));
    act(() => result.current.applyFilters());

    fetchOwnerLeadListMock.mockReturnValueOnce(newer.promise as never);
    act(() => result.current.setDraftFilters(() => ({ status: "quote_sent" })));
    act(() => result.current.applyFilters());

    // Newer resolves first with its own real result…
    act(() => newer.resolve({ kind: "ok", data: { leads: [leadItem("new")], page: { nextCursor: null, hasMore: false } } }));
    await waitFor(() => expect(result.current.state.items.map((i) => i.id)).toEqual(["new"]));

    // …then the stale older request finally resolves — it must not clobber the newer state.
    act(() => older.resolve({ kind: "ok", data: { leads: [leadItem("stale")], page: { nextCursor: null, hasMore: false } } }));
    expect(result.current.state.items.map((item) => item.id)).toEqual(["new"]);
  });
});
