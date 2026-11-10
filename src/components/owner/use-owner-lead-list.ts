import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { OwnerLeadListItem, OwnerLeadStatus, OwnerLeadIntent, OwnerLeadMaterial, OwnerLeadCaptureChannel, OwnerLeadView } from "@/lib/owner/owner-leads-contract";
import { fetchOwnerLeadList, type OwnerLeadsTransportDeps, type OwnerLeadListQuery } from "./owner-leads-transport";
import { getCachedOwnerData, isOwnerDataFresh, ownerListQueryKey, setCachedOwnerData } from "./owner-data-cache";

/**
 * CHECKPOINT C2J-D — the owner Manage inbox's data hook: draft/applied
 * filter state, keyset ("cursor") pagination with append-on-load-more, and
 * stale-response protection via a monotonically increasing request token
 * (in addition to AbortController — belt and braces, since a superseded
 * request could in principle still resolve after being aborted on some
 * runtimes/mocks). A newer request always wins; an older one that resolves
 * late is silently discarded, never allowed to overwrite fresher state.
 */

export const DEFAULT_OWNER_LEAD_LIST_PAGE_LIMIT = 20;

export interface OwnerLeadListFilters {
  readonly status?: OwnerLeadStatus;
  readonly intent?: OwnerLeadIntent;
  readonly material?: OwnerLeadMaterial;
  readonly captureChannel?: OwnerLeadCaptureChannel;
  readonly q?: string;
}

const EMPTY_FILTERS: OwnerLeadListFilters = {};
const DEFAULT_VIEW: OwnerLeadView = "inbox";

export interface OwnerLeadListHookState {
  readonly items: readonly OwnerLeadListItem[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly isInitialLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly unauthorized: boolean;
  readonly appliedFilters: OwnerLeadListFilters;
  /** CHECKPOINT C2M-A — the Enquiries screen's active Inbox/Archived/Trash tab. Independent of appliedFilters: switching views always refetches from scratch, but does not clear the owner's search/status/material/channel selections. */
  readonly view: OwnerLeadView;
}

export interface UseOwnerLeadListResult {
  readonly state: OwnerLeadListHookState;
  readonly draftFilters: OwnerLeadListFilters;
  readonly setDraftFilters: (updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => void;
  /** CHECKPOINT OWNER DESKTOP CORRECTION (compact filters pass) — accepts an optional explicit filters object so a caller (e.g. a Select's onValueChange, or a debounced search callback) can apply a value it just computed without waiting for `draftFilters` state to re-render first, avoiding a stale-closure race. Omitting it applies the hook's own current `draftFilters`, exactly as before. */
  readonly applyFilters: (overrideFilters?: OwnerLeadListFilters) => void;
  readonly clearFilters: () => void;
  readonly setView: (view: OwnerLeadView) => void;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

type PendingKind = "initial" | "refresh" | "loadMore";

function toQuery(view: OwnerLeadView, filters: OwnerLeadListFilters, cursor: string | undefined): OwnerLeadListQuery {
  return {
    view,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.intent ? { intent: filters.intent } : {}),
    ...(filters.material ? { material: filters.material } : {}),
    ...(filters.captureChannel ? { captureChannel: filters.captureChannel } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(cursor ? { cursor } : {}),
    limit: DEFAULT_OWNER_LEAD_LIST_PAGE_LIMIT,
  };
}

/**
 * `initialFilters` — lets a caller (the `/owner` route, reading its own
 * `?status=` search param) deep-link straight into a filtered view, e.g.
 * from an Overview KPI chevron. Read once at mount only (the same way
 * every other piece of this hook's initial state is captured once); a
 * later change to the caller's own value does not re-trigger a fetch —
 * that would fight the hook's own draft/applied filter model, which is
 * already the single owner of filter state after mount.
 */
interface CachedListSnapshot {
  readonly items: readonly OwnerLeadListItem[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export function useOwnerLeadList(deps: OwnerLeadsTransportDeps, initialFilters: OwnerLeadListFilters = EMPTY_FILTERS): UseOwnerLeadListResult {
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFiltersState] = useState<OwnerLeadListFilters>(initialFilters);
  const [state, setState] = useState<OwnerLeadListHookState>({
    items: [],
    hasMore: false,
    nextCursor: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    unauthorized: false,
    appliedFilters: initialFilters,
    view: DEFAULT_VIEW,
  });

  const requestTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(
    (kind: PendingKind, view: OwnerLeadView, filters: OwnerLeadListFilters, cursor: string | undefined) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;

      setState((previous) => ({
        ...previous,
        view,
        appliedFilters: filters,
        isInitialLoading: kind === "initial",
        isRefreshing: kind === "refresh",
        isLoadingMore: kind === "loadMore",
        error: null,
      }));

      void fetchOwnerLeadList(toQuery(view, filters, cursor), deps, controller.signal).then((result) => {
        if (requestTokenRef.current !== token) return; // superseded by a newer request — discard silently
        // Isolation — the request-token check above only protects against
        // a newer request from the SAME still-mounted hook instance; it
        // does nothing for a request whose instance has since unmounted
        // entirely (e.g. logout/account switch), since nothing ever
        // touches that orphaned token again. `abort()` is called on
        // unmount, but a promise that had already settled before abort()
        // ran is not retroactively rejected by it — `result.kind ===
        // "aborted"` alone cannot be trusted to catch that case. Checking
        // the controller's own signal directly closes it regardless of
        // whether the underlying fetch implementation honoured the abort.
        if (controller.signal.aborted) return;

        if (result.kind === "aborted") return;

        if (result.kind === "unauthorized") {
          setState((previous) => ({ ...previous, isInitialLoading: false, isRefreshing: false, isLoadingMore: false, unauthorized: true }));
          return;
        }

        if (result.kind === "error") {
          setState((previous) => ({
            ...previous,
            isInitialLoading: false,
            isRefreshing: false,
            isLoadingMore: false,
            error: result.message,
          }));
          return;
        }

        setState((previous) => {
          const existingIds = kind === "loadMore" ? new Set(previous.items.map((item) => item.id)) : new Set<string>();
          const nextItems =
            kind === "loadMore"
              ? [...previous.items, ...result.data.leads.filter((lead) => !existingIds.has(lead.id))]
              : result.data.leads;
          // Cache the full current snapshot (including anything already
          // appended via loadMore) under this exact (view, filters) key —
          // "already loaded data" for a later remount means whatever the
          // owner actually had on screen, not just a first page.
          setCachedOwnerData<CachedListSnapshot>(queryClient, ownerListQueryKey(view, filters), {
            items: nextItems,
            hasMore: result.data.page.hasMore,
            nextCursor: result.data.page.nextCursor,
          });
          return {
            ...previous,
            items: nextItems,
            hasMore: result.data.page.hasMore,
            nextCursor: result.data.page.nextCursor,
            isInitialLoading: false,
            isRefreshing: false,
            isLoadingMore: false,
            error: null,
            unauthorized: false,
          };
        });
      });
    },
    [deps, queryClient],
  );

  /**
   * PERF — the one entry point every "start a fresh listing for this
   * (view, filters)" call site uses (mount, applyFilters, clearFilters,
   * setView): a still-fresh cached snapshot is served instantly with no
   * network; a present-but-stale one is served instantly too, with a
   * silent background refresh (kind "refresh", not "initial" — keeps the
   * just-shown cached items visible instead of clearing to empty) kicked
   * off right after. Only a genuine cache miss falls back to the original
   * "clear to empty, then initial-load" behavior.
   */
  const loadFreshOrFromCache = useCallback(
    (view: OwnerLeadView, filters: OwnerLeadListFilters) => {
      // Correctness — switching to a (view, filters) combo that's already
      // cached must still supersede whatever fetch was previously in
      // flight for a DIFFERENT combo: without bumping the token/aborting
      // here, a still-running fetch for filter A — now stale, irrelevant —
      // could resolve after the cache-hit path below has already applied
      // filter B's data, and its own stale-response check (`token !==
      // requestTokenRef.current`) would wrongly still PASS, since nothing
      // incremented the token for a cache-hit that skips runFetch — A's
      // late response would silently overwrite B's correct state.
      abortControllerRef.current?.abort();
      requestTokenRef.current += 1;

      const cacheKey = ownerListQueryKey(view, filters);
      const cached = getCachedOwnerData<CachedListSnapshot>(queryClient, cacheKey);
      if (cached) {
        setState((previous) => ({
          ...previous,
          view,
          appliedFilters: filters,
          items: cached.items,
          hasMore: cached.hasMore,
          nextCursor: cached.nextCursor,
          isInitialLoading: false,
          isRefreshing: false,
          error: null,
          unauthorized: false,
        }));
        if (isOwnerDataFresh(queryClient, cacheKey)) return;
        runFetch("refresh", view, filters, undefined);
        return;
      }
      setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
      runFetch("initial", view, filters, undefined);
    },
    [queryClient, runFetch],
  );

  useEffect(() => {
    loadFreshOrFromCache(DEFAULT_VIEW, initialFilters);
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = useCallback(
    (overrideFilters?: OwnerLeadListFilters) => {
      loadFreshOrFromCache(state.view, overrideFilters ?? draftFilters);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [draftFilters, loadFreshOrFromCache, state.view],
  );

  const clearFilters = useCallback(() => {
    setDraftFiltersState(() => EMPTY_FILTERS);
    loadFreshOrFromCache(state.view, EMPTY_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFreshOrFromCache, state.view]);

  /** Switching Inbox/Archived/Trash always refetches from scratch — the owner's search/status/material/channel selections are preserved (not reset), matching this batch's own "preserve search and applicable filters within these views" requirement. */
  const setView = useCallback(
    (view: OwnerLeadView) => {
      loadFreshOrFromCache(view, state.appliedFilters);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [loadFreshOrFromCache, state.appliedFilters],
  );

  const refresh = useCallback(() => {
    runFetch("refresh", state.view, state.appliedFilters, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.view, state.appliedFilters]);

  const loadMore = useCallback(() => {
    if (!state.hasMore || !state.nextCursor || state.isLoadingMore) return;
    runFetch("loadMore", state.view, state.appliedFilters, state.nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.view, state.appliedFilters, state.hasMore, state.nextCursor, state.isLoadingMore]);

  const retry = useCallback(() => {
    runFetch(state.items.length > 0 ? "refresh" : "initial", state.view, state.appliedFilters, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.view, state.appliedFilters, state.items.length]);

  const setDraftFilters = useCallback((updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => {
    setDraftFiltersState(updater);
  }, []);

  return { state, draftFilters, setDraftFilters, applyFilters, clearFilters, setView, refresh, loadMore, retry };
}
