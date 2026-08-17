import { useCallback, useRef, useState } from "react";
import {
  changeOwnerLeadStatus as changeOwnerLeadStatusTransport,
  addOwnerLeadNote as addOwnerLeadNoteTransport,
  type OwnerLeadStatusChangeInput,
  type OwnerLeadsTransportDeps,
} from "./owner-leads-transport";

/**
 * CHECKPOINT C2J-E — the owner lead-detail status-change and private-note
 * mutation hook. Deliberately does NOT hand-roll optimistic local patching
 * of the detail state held by use-owner-lead-detail.ts: on any successful
 * mutation (and on a 409 conflict, to pick up the lead's real current
 * state) it calls the caller-supplied `onMutated` — which the detail page
 * wires to useOwnerLeadDetail's own `refresh()` — so the single source of
 * truth for lead/activity state is always a real server response, never a
 * client-guessed merge. This is an in-place async refetch, not a full page
 * reload, so it still satisfies "reconcile without full reload".
 *
 * Each of changeStatus/addNote guards against a double-submit with a
 * synchronous ref check (set before the first `await`), matching the
 * established pattern already used for file access — this is in addition
 * to, not instead of, the UI itself disabling its submit control while
 * `state.isChangingStatus` / `state.isAddingNote` is true.
 *
 * CHECKPOINT C2J-E correction pass — addNote's real (server-enforced)
 * duplicate-submission protection: lastNoteAttemptRef remembers the
 * (requestId, normalized body) of the most recent NOT-YET-SUCCEEDED
 * attempt. Calling addNote again with the identical trimmed body reuses
 * that same requestId (a genuine retry, e.g. after a network error) so
 * add_lead_note_v1's own idempotent replay logic on the server can
 * recognize it and avoid a duplicate row even if this hook's synchronous
 * ref-lock above were somehow bypassed. A successful call, or a call with
 * different text, clears/regenerates the id — the next logical note gets
 * its own fresh identity.
 */

export interface OwnerLeadMutationsState {
  readonly isChangingStatus: boolean;
  readonly statusError: string | null;
  readonly isAddingNote: boolean;
  readonly noteError: string | null;
}

export type OwnerLeadMutationOutcome = { readonly ok: true } | { readonly ok: false; readonly conflict: boolean; readonly message: string };

export interface UseOwnerLeadMutationsResult {
  readonly state: OwnerLeadMutationsState;
  readonly changeStatus: (input: OwnerLeadStatusChangeInput) => Promise<OwnerLeadMutationOutcome>;
  readonly addNote: (body: string) => Promise<OwnerLeadMutationOutcome>;
  readonly clearStatusError: () => void;
  readonly clearNoteError: () => void;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const ALREADY_IN_PROGRESS_STATUS_MESSAGE = "A status change is already in progress.";
const ALREADY_IN_PROGRESS_NOTE_MESSAGE = "This note is already being saved.";

export function useOwnerLeadMutations(
  leadId: string,
  deps: OwnerLeadsTransportDeps,
  onMutated: () => void,
  onUnauthorized: () => void,
): UseOwnerLeadMutationsResult {
  const [state, setState] = useState<OwnerLeadMutationsState>({
    isChangingStatus: false,
    statusError: null,
    isAddingNote: false,
    noteError: null,
  });

  const statusPendingRef = useRef(false);
  const notePendingRef = useRef(false);
  const lastNoteAttemptRef = useRef<{ requestId: string; body: string } | null>(null);

  const changeStatus = useCallback(
    async (input: OwnerLeadStatusChangeInput): Promise<OwnerLeadMutationOutcome> => {
      if (statusPendingRef.current) {
        return { ok: false, conflict: false, message: ALREADY_IN_PROGRESS_STATUS_MESSAGE };
      }
      statusPendingRef.current = true;
      setState((previous) => ({ ...previous, isChangingStatus: true, statusError: null }));

      const result = await changeOwnerLeadStatusTransport(leadId, input, deps);
      statusPendingRef.current = false;

      if (result.kind === "unauthorized") {
        setState((previous) => ({ ...previous, isChangingStatus: false }));
        onUnauthorized();
        return { ok: false, conflict: false, message: SESSION_EXPIRED_MESSAGE };
      }
      if (result.kind === "error" || result.kind === "aborted") {
        const message = result.kind === "error" ? result.message : "Something went wrong. Please try again.";
        const conflict = result.kind === "error" && result.status === 409;
        setState((previous) => ({ ...previous, isChangingStatus: false, statusError: message }));
        if (conflict) onMutated();
        return { ok: false, conflict, message };
      }

      setState((previous) => ({ ...previous, isChangingStatus: false, statusError: null }));
      onMutated();
      return { ok: true };
    },
    [leadId, deps, onMutated, onUnauthorized],
  );

  const addNote = useCallback(
    async (body: string): Promise<OwnerLeadMutationOutcome> => {
      if (notePendingRef.current) {
        return { ok: false, conflict: false, message: ALREADY_IN_PROGRESS_NOTE_MESSAGE };
      }
      notePendingRef.current = true;
      setState((previous) => ({ ...previous, isAddingNote: true, noteError: null }));

      const previousAttempt = lastNoteAttemptRef.current;
      const requestId = previousAttempt && previousAttempt.body === body ? previousAttempt.requestId : crypto.randomUUID();
      lastNoteAttemptRef.current = { requestId, body };

      const result = await addOwnerLeadNoteTransport(leadId, body, requestId, deps);
      notePendingRef.current = false;

      if (result.kind === "unauthorized") {
        setState((previous) => ({ ...previous, isAddingNote: false }));
        onUnauthorized();
        return { ok: false, conflict: false, message: SESSION_EXPIRED_MESSAGE };
      }
      if (result.kind === "error" || result.kind === "aborted") {
        const message = result.kind === "error" ? result.message : "Something went wrong. Please try again.";
        setState((previous) => ({ ...previous, isAddingNote: false, noteError: message }));
        return { ok: false, conflict: false, message };
      }

      lastNoteAttemptRef.current = null;
      setState((previous) => ({ ...previous, isAddingNote: false, noteError: null }));
      onMutated();
      return { ok: true };
    },
    [leadId, deps, onMutated, onUnauthorized],
  );

  const clearStatusError = useCallback(() => setState((previous) => ({ ...previous, statusError: null })), []);
  const clearNoteError = useCallback(() => setState((previous) => ({ ...previous, noteError: null })), []);

  return { state, changeStatus, addNote, clearStatusError, clearNoteError };
}
