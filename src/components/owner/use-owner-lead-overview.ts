import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { OwnerLeadOverviewSuccessBody } from "@/lib/owner/owner-lead-overview-contract";
import { fetchOwnerLeadOverview, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import { getCachedOwnerData, isOwnerDataFresh, ownerOverviewQueryKey, setCachedOwnerData } from "./owner-data-cache";

/**
 * CHECKPOINT C2K — the owner overview page's data hook. Same shape as
 * use-owner-lead-detail.ts (single fetch, no pagination): abort-and-discard
 * on unmount, stale-response protection via a monotonically increasing
 * request token.
 *
 * PERF — same stale-while-revalidate cache as use-owner-lead-detail.ts: a
 * cached snapshot (fresh or stale) is served instantly with no network; a
 * stale one gets a silent background refresh right after.
 */

export type OwnerLeadOverviewData = OwnerLeadOverviewSuccessBody["data"];

export interface OwnerLeadOverviewHookState {
  readonly data: OwnerLeadOverviewData | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly unauthorized: boolean;
}

export interface UseOwnerLeadOverviewResult {
  readonly state: OwnerLeadOverviewHookState;
  readonly refresh: () => void;
}

export function useOwnerLeadOverview(deps: OwnerLeadsTransportDeps): UseOwnerLeadOverviewResult {
  const queryClient = useQueryClient();
  const [state, setState] = useState<OwnerLeadOverviewHookState>({
    data: null,
    isLoading: true,
    error: null,
    unauthorized: false,
  });

  const requestTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (options?: { readonly silent?: boolean }) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const token = requestTokenRef.current + 1;
      requestTokenRef.current = token;

      if (!options?.silent) {
        setState((previous) => ({ ...previous, isLoading: true, error: null }));
      }

      void fetchOwnerLeadOverview(deps, controller.signal).then((result) => {
        if (requestTokenRef.current !== token) return;
        // Isolation — see use-owner-lead-list.ts's identical comment: the
        // token check alone cannot catch a request whose hook instance has
        // since fully unmounted (logout/account switch); checking the
        // controller's own signal directly closes that gap.
        if (controller.signal.aborted) return;
        if (result.kind === "aborted") return;

        if (result.kind === "unauthorized") {
          setState((previous) => ({ ...previous, isLoading: false, unauthorized: true }));
          return;
        }
        if (result.kind === "error") {
          setState((previous) => ({ ...previous, isLoading: false, error: result.message }));
          return;
        }

        setCachedOwnerData(queryClient, ownerOverviewQueryKey(), result.data);
        setState({ data: result.data, isLoading: false, error: null, unauthorized: false });
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [deps, queryClient],
  );

  useEffect(() => {
    const cacheKey = ownerOverviewQueryKey();
    const cached = getCachedOwnerData<OwnerLeadOverviewData>(queryClient, cacheKey);

    if (cached) {
      setState({ data: cached, isLoading: false, error: null, unauthorized: false });
      if (isOwnerDataFresh(queryClient, cacheKey)) {
        return () => abortControllerRef.current?.abort();
      }
    }

    load({ silent: !!cached });
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bare `load` reference — see use-owner-lead-detail.ts's identical
  // comment for why `() => load()` would break refresh's referential
  // stability and reproduce an unbroken render loop.
  return { state, refresh: load };
}
