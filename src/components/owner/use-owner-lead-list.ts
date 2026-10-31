import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerLeadListItem, OwnerLeadStatus, OwnerLeadIntent, OwnerLeadMaterial, OwnerLeadCaptureChannel, OwnerLeadView } from "@/lib/owner/owner-leads-contract";
import { fetchOwnerLeadList, type OwnerLeadsTransportDeps, type OwnerLeadListQuery } from "./owner-leads-transport";

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

export function useOwnerLeadList(deps: OwnerLeadsTransportDeps): UseOwnerLeadListResult {
  const [draftFilters, setDraftFiltersState] = useState<OwnerLeadListFilters>(EMPTY_FILTERS);
  const [state, setState] = useState<OwnerLeadListHookState>({
    items: [],
    hasMore: false,
    nextCursor: null,
    isInitialLoading: true,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    unauthorized: false,
    appliedFilters: EMPTY_FILTERS,
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
    [deps],
  );

  useEffect(() => {
    runFetch("initial", DEFAULT_VIEW, EMPTY_FILTERS, undefined);
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = useCallback(
    (overrideFilters?: OwnerLeadListFilters) => {
      setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
      runFetch("initial", state.view, overrideFilters ?? draftFilters, undefined);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [draftFilters, runFetch, state.view],
  );

  const clearFilters = useCallback(() => {
    setDraftFiltersState(() => EMPTY_FILTERS);
    setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
    runFetch("initial", state.view, EMPTY_FILTERS, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.view]);

  /** Switching Inbox/Archived/Trash always refetches from scratch — the owner's search/status/material/channel selections are preserved (not reset), matching this batch's own "preserve search and applicable filters within these views" requirement. */
  const setView = useCallback(
    (view: OwnerLeadView) => {
      setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
      runFetch("initial", view, state.appliedFilters, undefined);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [runFetch, state.appliedFilters],
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
