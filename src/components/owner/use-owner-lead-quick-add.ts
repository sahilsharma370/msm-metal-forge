import { useCallback, useRef, useState } from "react";
import { createOwnerQuickAddLead as createOwnerQuickAddLeadTransport, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import type { OwnerLeadQuickAddRequest } from "@/lib/owner/owner-lead-quick-add-contract";

/**
 * CHECKPOINT C2J-F — the owner Quick Add submission hook. Matches
 * use-owner-lead-mutations.ts's own addNote shape: a synchronous ref check
 * guards a double-submit (in addition to, not instead of, the form
 * disabling its own submit control while `state.isSubmitting` is true), and
 * requestId is only regenerated when the submitted fields actually change —
 * a retry of the identical form data (e.g. after a network error, or a
 * double-click that slips past the ref lock) resends the SAME requestId so
 * create_owner_quick_add_lead_v1's own idempotent replay logic recognizes
 * it and never creates a second lead.
 *
 * Deliberately owns none of the form's input state — a failed submission
 * leaves the caller's own field state completely untouched, which is what
 * "failure preserves entered form data" actually means here: this hook
 * never clears or resets anything on error, only on a genuine success.
 */

export interface OwnerLeadQuickAddState {
  readonly isSubmitting: boolean;
  readonly error: string | null;
}

export type OwnerLeadQuickAddOutcome =
  | { readonly ok: true; readonly leadId: string; readonly reference: string }
  | { readonly ok: false; readonly message: string };

export interface UseOwnerLeadQuickAddResult {
  readonly state: OwnerLeadQuickAddState;
  readonly submit: (input: Omit<OwnerLeadQuickAddRequest, "requestId">) => Promise<OwnerLeadQuickAddOutcome>;
  readonly clearError: () => void;
  /** Call after a successful create-another flow so the next enquiry gets a fresh identity even if its fields happen to match the prior one exactly. */
  readonly resetAttempt: () => void;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const ALREADY_IN_PROGRESS_MESSAGE = "This enquiry is already being saved.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export function useOwnerLeadQuickAdd(deps: OwnerLeadsTransportDeps, onUnauthorized: () => void): UseOwnerLeadQuickAddResult {
  const [state, setState] = useState<OwnerLeadQuickAddState>({ isSubmitting: false, error: null });
  const pendingRef = useRef(false);
  const lastAttemptRef = useRef<{ readonly requestId: string; readonly fingerprint: string } | null>(null);

  const submit = useCallback(
    async (input: Omit<OwnerLeadQuickAddRequest, "requestId">): Promise<OwnerLeadQuickAddOutcome> => {
      if (pendingRef.current) {
        return { ok: false, message: ALREADY_IN_PROGRESS_MESSAGE };
      }
      pendingRef.current = true;
      setState((previous) => ({ ...previous, isSubmitting: true, error: null }));

      const fingerprint = JSON.stringify(input);
      const previousAttempt = lastAttemptRef.current;
      const requestId = previousAttempt && previousAttempt.fingerprint === fingerprint ? previousAttempt.requestId : crypto.randomUUID();
      lastAttemptRef.current = { requestId, fingerprint };

      const result = await createOwnerQuickAddLeadTransport({ ...input, requestId }, deps);
      pendingRef.current = false;

      if (result.kind === "unauthorized") {
        setState((previous) => ({ ...previous, isSubmitting: false }));
        onUnauthorized();
        return { ok: false, message: SESSION_EXPIRED_MESSAGE };
      }
      if (result.kind === "error" || result.kind === "aborted") {
        const message = result.kind === "error" ? result.message : GENERIC_ERROR_MESSAGE;
        setState((previous) => ({ ...previous, isSubmitting: false, error: message }));
        return { ok: false, message };
      }

      lastAttemptRef.current = null;
      setState((previous) => ({ ...previous, isSubmitting: false, error: null }));
      return { ok: true, leadId: result.data.leadId, reference: result.data.reference };
    },
    [deps, onUnauthorized],
  );

  const clearError = useCallback(() => setState((previous) => ({ ...previous, error: null })), []);
  const resetAttempt = useCallback(() => {
    lastAttemptRef.current = null;
  }, []);

  return { state, submit, clearError, resetAttempt };
}
