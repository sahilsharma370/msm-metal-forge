import { useCallback, useRef, useState } from "react";
import { exportOwnerLeadsCsv, type OwnerLeadExportQuery, type OwnerLeadsTransportDeps } from "./owner-leads-transport";

/**
 * CHECKPOINT C2M-A — the Export CSV action's hook: a synchronous ref lock
 * (matching every other owner mutation hook's own double-submit guard),
 * and the actual browser download via a short-lived Blob URL (created and
 * revoked entirely inside this hook — never left dangling).
 */

export interface OwnerLeadExportState {
  readonly isExporting: boolean;
  readonly error: string | null;
}

export interface UseOwnerLeadExportResult {
  readonly state: OwnerLeadExportState;
  readonly exportCsv: (query: OwnerLeadExportQuery) => Promise<void>;
  readonly clearError: () => void;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const ALREADY_IN_PROGRESS_MESSAGE = "An export is already in progress.";

export function useOwnerLeadExport(deps: OwnerLeadsTransportDeps, onUnauthorized: () => void): UseOwnerLeadExportResult {
  const [state, setState] = useState<OwnerLeadExportState>({ isExporting: false, error: null });
  const pendingRef = useRef(false);

  const exportCsv = useCallback(
    async (query: OwnerLeadExportQuery) => {
      if (pendingRef.current) {
        setState((previous) => ({ ...previous, error: ALREADY_IN_PROGRESS_MESSAGE }));
        return;
      }
      pendingRef.current = true;
      setState({ isExporting: true, error: null });

      const result = await exportOwnerLeadsCsv(query, deps);
      pendingRef.current = false;

      if (result.kind === "unauthorized") {
        setState({ isExporting: false, error: null });
        onUnauthorized();
        return;
      }
      if (result.kind === "error" || result.kind === "aborted") {
        setState({ isExporting: false, error: result.kind === "error" ? result.message : "Something went wrong. Please try again." });
        return;
      }

      const url = URL.createObjectURL(result.blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setState({ isExporting: false, error: null });
    },
    [deps, onUnauthorized],
  );

  const clearError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);

  return { state, exportCsv, clearError };
}

export { SESSION_EXPIRED_MESSAGE as OWNER_LEAD_EXPORT_SESSION_EXPIRED_MESSAGE };
