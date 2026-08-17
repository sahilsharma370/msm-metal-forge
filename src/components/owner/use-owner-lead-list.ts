import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerLeadListItem, OwnerLeadStatus, OwnerLeadIntent, OwnerLeadMaterial, OwnerLeadCaptureChannel } from "@/lib/owner/owner-leads-contract";
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
}

export interface UseOwnerLeadListResult {
  readonly state: OwnerLeadListHookState;
  readonly draftFilters: OwnerLeadListFilters;
  readonly setDraftFilters: (updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => void;
  readonly applyFilters: () => void;
  readonly clearFilters: () => void;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

type PendingKind = "initial" | "refresh" | "loadMore";

function toQuery(filters: OwnerLeadListFilters, cursor: string | undefined): OwnerLeadListQuery {
  return {
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
  });

  const requestTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(
    (kind: PendingKind, filters: OwnerLeadListFilters, cursor: string | undefined) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;

      setState((previous) => ({
        ...previous,
        appliedFilters: filters,
        isInitialLoading: kind === "initial",
        isRefreshing: kind === "refresh",
        isLoadingMore: kind === "loadMore",
        error: null,
      }));

      void fetchOwnerLeadList(toQuery(filters, cursor), deps, controller.signal).then((result) => {
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
    runFetch("initial", EMPTY_FILTERS, undefined);
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = useCallback(() => {
    setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
    runFetch("initial", draftFilters, undefined);
  }, [draftFilters, runFetch]);

  const clearFilters = useCallback(() => {
    setDraftFiltersState(() => EMPTY_FILTERS);
    setState((previous) => ({ ...previous, items: [], hasMore: false, nextCursor: null }));
    runFetch("initial", EMPTY_FILTERS, undefined);
  }, [runFetch]);

  const refresh = useCallback(() => {
    runFetch("refresh", state.appliedFilters, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.appliedFilters]);

  const loadMore = useCallback(() => {
    if (!state.hasMore || !state.nextCursor || state.isLoadingMore) return;
    runFetch("loadMore", state.appliedFilters, state.nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.appliedFilters, state.hasMore, state.nextCursor, state.isLoadingMore]);

  const retry = useCallback(() => {
    runFetch(state.items.length > 0 ? "refresh" : "initial", state.appliedFilters, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFetch, state.appliedFilters, state.items.length]);

  const setDraftFilters = useCallback((updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => {
    setDraftFiltersState(updater);
  }, []);

  return { state, draftFilters, setDraftFilters, applyFilters, clearFilters, refresh, loadMore, retry };
}
