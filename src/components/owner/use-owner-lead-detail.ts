import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerLeadDetailSuccessBody } from "@/lib/owner/owner-lead-detail-contract";
import { fetchOwnerLeadDetail, type OwnerLeadsTransportDeps } from "./owner-leads-transport";

/**
 * CHECKPOINT C2J-D — the owner Manage lead-detail page's data hook.
 * Aborts and discards any in-flight request the instant `leadId` changes
 * or the component unmounts, and guards against a stale response
 * resolving after a newer one via the same request-token pattern as
 * use-owner-lead-list.ts.
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
  const [state, setState] = useState<OwnerLeadDetailHookState>({
    data: null,
    isLoading: true,
    error: null,
    notFound: false,
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

    setState((previous) => ({ ...previous, isLoading: true, error: null, notFound: false }));

    void fetchOwnerLeadDetail(leadId, deps, controller.signal).then((result) => {
      if (requestTokenRef.current !== token) return;
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

      setState({ data: result.data, isLoading: false, error: null, notFound: false, unauthorized: false });
    });
  }, [leadId, deps]);

  useEffect(() => {
    load();
    return () => {
      abortControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  return { state, refresh: load };
}
