// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOwnerLeadList } from "./use-owner-lead-list";
import * as transport from "./owner-leads-transport";
import type { OwnerAuthClient } from "./owner-auth-client";
import { getCachedOwnerData, ownerListQueryKey } from "./owner-data-cache";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, fetchOwnerLeadList: vi.fn() };
});

const fetchOwnerLeadListMock = vi.mocked(transport.fetchOwnerLeadList);

/** A fresh QueryClient per render — the hook now reads/writes a shared cache through it (see owner-data-cache.ts), so each test needs its own isolated store, never leaking a cached snapshot into a later, unrelated test. Plain createElement, not JSX — this file is .ts, not .tsx. Accepts an optional pre-built client so a test can seed/inspect it directly. */
function createWrapper(queryClient: QueryClient = new QueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

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
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    // A genuinely different, never-before-fetched filter combination — a
    // cache miss (PERF — see use-owner-lead-list.ts's own
    // loadFreshOrFromCache), so this still exercises a real in-flight
    // fetch. Re-applying the *same* already-cached filters is covered
    // separately below — that case correctly serves cached items
    // instantly instead of clearing to empty.
    act(() => result.current.setDraftFilters((previous) => ({ ...previous, status: "contacted" })));
    const pending = deferred<transport.OwnerApiResult<{ leads: []; page: { nextCursor: null; hasMore: false } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(pending.promise as never);
    act(() => result.current.applyFilters());
    expect(result.current.state.items).toHaveLength(0);
  });

  it("re-applying the same already-cached filters serves cached items instantly, with no new fetch (PERF)", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);

    act(() => result.current.applyFilters()); // draftFilters is still the same empty filters already cached
    expect(result.current.state.items).toHaveLength(1);
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1); // no new network call within the freshness window
  });
});

describe("useOwnerLeadList — load more", () => {
  it("appends the next page using nextCursor, without duplicating ids the list already has", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({
      kind: "ok",
      data: { leads: [leadItem("a"), leadItem("b")], page: { nextCursor: "cursor-1", hasMore: true } },
    });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));

    act(() => result.current.loadMore());
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);
  });
});

describe("useOwnerLeadList — refresh preserves content while loading", () => {
  it("keeps existing items visible and marks isRefreshing while a refresh is in flight", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));
    expect(result.current.state.view).toBe("inbox");
    expect(fetchOwnerLeadListMock).toHaveBeenCalledWith(expect.objectContaining({ view: "inbox" }), deps, expect.anything());
  });

  it("setView refetches from scratch with the new view, clearing accumulated items, and preserves the applied filters", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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

describe("useOwnerLeadList — PERF: cache-hit switching cannot be overwritten by a stale in-flight fetch", () => {
  it("switching to a cached filter while a different (uncached) filter's fetch is still in flight: the stale fetch's late response can never overwrite the cache-hit's state", async () => {
    // Mount with the default empty filters — this is "B" for this test:
    // its result gets cached under (inbox, {}).
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [leadItem("b")], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.state.items.map((item) => item.id)).toEqual(["b"]));

    // Switch to "A" (status: contacted) — a genuine cache miss, so a real
    // fetch starts. Deliberately never resolved yet.
    const pendingA = deferred<transport.OwnerApiResult<{ leads: ReturnType<typeof leadItem>[]; page: { nextCursor: null; hasMore: false } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(pendingA.promise as never);
    act(() => result.current.setDraftFilters(() => ({ status: "contacted" })));
    act(() => result.current.applyFilters());
    expect(result.current.state.items).toHaveLength(0); // cleared while A's own fetch is in flight

    // Switch back to "B" — already cached and fresh, so this must be an
    // instant, no-network cache hit restoring B's items immediately,
    // without waiting for A's still-pending fetch at all.
    act(() => result.current.applyFilters({}));
    expect(result.current.state.items.map((item) => item.id)).toEqual(["b"]);

    // A's fetch finally resolves — late, and for a filter combination the
    // owner is no longer even looking at. It must be discarded, never
    // allowed to overwrite B's correctly-displayed cached state.
    await act(async () => {
      pendingA.resolve({ kind: "ok", data: { leads: [leadItem("a")], page: { nextCursor: null, hasMore: false } } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state.items.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("useOwnerLeadList — stale response protection", () => {
  it("an older request that resolves after a newer one is discarded, never overwriting the newer result", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const { result } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper() });
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

describe("useOwnerLeadList — isolation: a late response after the hook unmounts (account switch) cannot repopulate the cache", () => {
  it("a fetch that settles after unmount (e.g. logout/account switch) never writes into the shared cache", async () => {
    fetchOwnerLeadListMock.mockResolvedValueOnce({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const deps = { authClient: fakeAuthClient(), fetchImpl: fetch };
    const queryClient = new QueryClient();
    const { result, unmount } = renderHook(() => useOwnerLeadList(deps), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(result.current.state.isInitialLoading).toBe(false));

    // A genuine cache miss (different filters) starts a real fetch — deliberately never resolved yet.
    const pending = deferred<transport.OwnerApiResult<{ leads: ReturnType<typeof leadItem>[]; page: { nextCursor: null; hasMore: false } }>>();
    fetchOwnerLeadListMock.mockReturnValueOnce(pending.promise as never);
    act(() => result.current.setDraftFilters(() => ({ status: "contacted" })));
    act(() => result.current.applyFilters());

    // Unmount now — standing in for a logout/account switch: the owner's
    // whole route tree (and this hook instance) is torn down while the
    // fetch above is still in flight. The hook's own cleanup calls
    // abort(), but this mock's promise does NOT reject on abort — it only
    // settles when told to, below — the same as a real browser race where
    // the response had already arrived (the promise already settled)
    // before abort() was even called: abort() cannot retroactively reject
    // an already-settled promise. This isolates the guard this test
    // targets (an explicit `controller.signal.aborted` check) from
    // reliance on the transport always winning that race.
    unmount();

    // The late response finally "arrives" — for a now fully unmounted
    // instance, standing in for the previous owner's dead session.
    await act(async () => {
      pending.resolve({ kind: "ok", data: { leads: [leadItem("stale-previous-owner")], page: { nextCursor: null, hasMore: false } } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Must never have written the previous owner's stale data into the
    // shared cache — a different owner's fresh session later reusing this
    // exact (view, filters) key must never see it.
    const cached = getCachedOwnerData(queryClient, ownerListQueryKey("inbox", { status: "contacted" }));
    expect(cached).toBeUndefined();
  });
});
