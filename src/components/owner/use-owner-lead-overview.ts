import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerLeadOverviewSuccessBody } from "@/lib/owner/owner-lead-overview-contract";
import { fetchOwnerLeadOverview, type OwnerLeadsTransportDeps } from "./owner-leads-transport";

/**
 * CHECKPOINT C2K — the owner overview page's data hook. Same shape as
 * use-owner-lead-detail.ts (single fetch, no pagination): abort-and-discard
 * on unmount, stale-response protection via a monotonically increasing
 * request token.
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
  const [state, setState] = useState<OwnerLeadOverviewHookState>({
    data: null,
    isLoading: true,
    error: null,
    unauthorized: false,
  });

  const requestTokenRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;

    setState((previous) => ({ ...previous, isLoading: true, error: null }));

    void fetchOwnerLeadOverview(deps, controller.signal).then((result) => {
      if (requestTokenRef.current !== token) return;
      if (result.kind === "aborted") return;

      if (result.kind === "unauthorized") {
        setState((previous) => ({ ...previous, isLoading: false, unauthorized: true }));
        return;
      }
      if (result.kind === "error") {
        setState((previous) => ({ ...previous, isLoading: false, error: result.message }));
        return;
      }

      setState({ data: result.data, isLoading: false, error: null, unauthorized: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, refresh: load };
}
