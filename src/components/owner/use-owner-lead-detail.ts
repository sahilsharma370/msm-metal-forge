import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { OwnerLeadDetailSuccessBody } from "@/lib/owner/owner-lead-detail-contract";
import { fetchOwnerLeadDetail, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import { getCachedOwnerData, isOwnerDataFresh, ownerDetailQueryKey, setCachedOwnerData } from "./owner-data-cache";

/**
 * CHECKPOINT C2J-D — the owner Manage lead-detail page's data hook.
 * Aborts and discards any in-flight request the instant `leadId` changes
 * or the component unmounts, and guards against a stale response
 * resolving after a newer one via the same request-token pattern as
 * use-owner-lead-list.ts.
 *
 * PERF — a still-fresh cached snapshot for this exact leadId is served
 * immediately (no network) on mount/leadId-change; a present-but-stale one
 * is served immediately too, with a silent background refresh kicked off
 * right after (stale-while-revalidate) rather than showing a loading
 * skeleton over data the owner can already see. explicit refresh() (the
 * header Refresh button, and every mutation's own onMutated callback) is
 * unaffected — it always hits the network and always re-caches the result.
 */

export type OwnerLeadDetailData = OwnerLeadDetailSuccessBody["data"];

export interface OwnerLeadDetailHookState {
  readonly data: OwnerLeadDetailData | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly notFound: boolean;
  readonly unauthorized: boolean;
}

export interface UseOwnerLeadDetailResult {
  readonly state: OwnerLeadDetailHookState;
  readonly refresh: () => void;
}

export function useOwnerLeadDetail(leadId: string, deps: OwnerLeadsTransportDeps): UseOwnerLeadDetailResult {
  const queryClient = useQueryClient();
  const [state, setState] = useState<OwnerLeadDetailHookState>({
    data: null,
    isLoading: true,
    error: null,
    notFound: false,
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
        setState((previous) => ({ ...previous, isLoading: true, error: null, notFound: false }));
      }

      void fetchOwnerLeadDetail(leadId, deps, controller.signal).then((result) => {
        if (requestTokenRef.current !== token) return;
        // Isolation — see use-owner-lead-list.ts's identical comment: the
        // token check alone cannot catch a request whose hook instance has
        // since fully unmounted (logout/account switch), since nothing
        // ever bumps that orphaned token again. A promise already settled
        // before abort() ran is not retroactively rejected by it, so
        // `result.kind === "aborted"` isn't a reliable backstop either —
        // checking the controller's own signal directly is.
        if (controller.signal.aborted) return;
        if (result.kind === "aborted") return;

        if (result.kind === "unauthorized") {
          setState((previous) => ({ ...previous, isLoading: false, unauthorized: true }));
          return;
        }
        if (result.kind === "error") {
          // The detail API itself already collapses "nonexistent" and
          // "incomplete" into the identical 404 — this hook only branches on
          // the HTTP status category (404 vs everything else) to pick a
          // calmer "not found, go back" UI instead of a "retry" UI; it never
          // learns *why* a 404 happened, matching the API's own
          // never-distinguish-why intent.
          setState((previous) => ({
            ...previous,
            isLoading: false,
            error: result.message,
            notFound: result.status === 404,
          }));
          return;
        }

        setCachedOwnerData(queryClient, ownerDetailQueryKey(leadId), result.data);
        setState({ data: result.data, isLoading: false, error: null, notFound: false, unauthorized: false });
      });
    },
    [leadId, deps, queryClient],
  );

  useEffect(() => {
    // Correctness — leadId changing (A -> B) must always supersede
    // whatever fetch was in flight for the previous leadId, even when B
    // turns out to be an instant cache hit that never calls load() itself:
    // without bumping the token/aborting here, A's still-running fetch
    // could resolve after B's cached data is already showing, and its own
    // stale-response guard would wrongly still match, silently overwriting
    // B with A's now-irrelevant result.
    abortControllerRef.current?.abort();
    requestTokenRef.current += 1;

    const cacheKey = ownerDetailQueryKey(leadId);
    const cached = getCachedOwnerData<OwnerLeadDetailData>(queryClient, cacheKey);

    if (cached) {
      // Serve instantly, no network, no loading flash — whether fresh or
      // stale. A stale hit still gets a real background refresh right
      // below; a fresh hit needs nothing more within the freshness window.
      setState({ data: cached, isLoading: false, error: null, notFound: false, unauthorized: false });
      if (isOwnerDataFresh(queryClient, cacheKey)) {
        return () => abortControllerRef.current?.abort();
      }
    }

    load({ silent: !!cached });
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // A bare `load` reference, not `() => load()` — the latter is a fresh
  // closure every render, which breaks referential stability for anything
  // depending on `refresh`'s own identity (registerRefresh's effect below
  // depends on it; a new identity every render reproduces the exact
  // "unbroken render loop" this module's own CHECKPOINT C2J-D1 precedent
  // already fixed once for `deps`). `load` itself is already stable
  // (useCallback, and `options` defaults to undefined when called with no
  // arguments) and was always called as `refresh()` with no arguments
  // anywhere in this codebase.
  return { state, refresh: load };
}
