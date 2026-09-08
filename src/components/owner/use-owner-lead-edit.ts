import { useCallback, useRef, useState } from "react";
import { updateOwnerLeadDetails as updateOwnerLeadDetailsTransport, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import type { OwnerLeadEditRequest } from "@/lib/owner/owner-lead-detail-contract";

/**
 * Owner "Edit enquiry" — the submission hook for the dedicated edit screen.
 * Matches use-owner-lead-quick-add.ts's own shape: a synchronous ref check
 * guards a double-submit (in addition to, not instead of, the form
 * disabling its own Save control while `state.isSubmitting` is true), and
 * this hook owns none of the form's field state — a failed submission (or a
 * 409 conflict) leaves the caller's own entered values completely
 * untouched, matching this checkpoint's "server failure retains entered
 * form values" requirement.
 *
 * `conflict` is true for BOTH a stale expectedUpdatedAt (someone else
 * changed the lead first) and a NOT_EDITABLE rejection (the lead became
 * archived/trashed mid-edit) — both are a 409 the caller should react to by
 * offering to reload the lead's current state rather than retrying the same
 * write; the already-sanitized `message` text distinguishes which one it was.
 */

export interface OwnerLeadEditState {
  readonly isSubmitting: boolean;
  readonly error: string | null;
}

export type OwnerLeadEditOutcome =
  | { readonly ok: true; readonly updated: boolean; readonly updatedAt: string }
  | { readonly ok: false; readonly conflict: boolean; readonly message: string };

export interface UseOwnerLeadEditResult {
  readonly state: OwnerLeadEditState;
  readonly submit: (request: OwnerLeadEditRequest) => Promise<OwnerLeadEditOutcome>;
  readonly clearError: () => void;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const ALREADY_IN_PROGRESS_MESSAGE = "This enquiry is already being saved.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function useOwnerLeadEdit(deps: OwnerLeadsTransportDeps, leadId: string, onUnauthorized: () => void): UseOwnerLeadEditResult {
  const [state, setState] = useState<OwnerLeadEditState>({ isSubmitting: false, error: null });
  const pendingRef = useRef(false);

  const submit = useCallback(
    async (request: OwnerLeadEditRequest): Promise<OwnerLeadEditOutcome> => {
      if (pendingRef.current) {
        return { ok: false, conflict: false, message: ALREADY_IN_PROGRESS_MESSAGE };
      }
      pendingRef.current = true;
      setState((previous) => ({ ...previous, isSubmitting: true, error: null }));

      const result = await updateOwnerLeadDetailsTransport(leadId, request, deps);
      pendingRef.current = false;

      if (result.kind === "unauthorized") {
        setState((previous) => ({ ...previous, isSubmitting: false }));
        onUnauthorized();
        return { ok: false, conflict: false, message: SESSION_EXPIRED_MESSAGE };
      }
      if (result.kind === "error" || result.kind === "aborted") {
        const message = result.kind === "error" ? result.message : GENERIC_ERROR_MESSAGE;
        const conflict = result.kind === "error" && result.status === 409;
        setState((previous) => ({ ...previous, isSubmitting: false, error: message }));
        return { ok: false, conflict, message };
      }

      setState((previous) => ({ ...previous, isSubmitting: false, error: null }));
      return { ok: true, updated: result.data.updated, updatedAt: result.data.updatedAt };
    },
    [leadId, deps, onUnauthorized],
  );

  const clearError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);

  return { state, submit, clearError };
}
