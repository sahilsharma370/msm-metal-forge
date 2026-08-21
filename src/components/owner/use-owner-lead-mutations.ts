import { useCallback, useRef, useState } from "react";
import {
  changeOwnerLeadStatus as changeOwnerLeadStatusTransport,
  addOwnerLeadNote as addOwnerLeadNoteTransport,
  trashOwnerLead as trashOwnerLeadTransport,
  restoreOwnerLead as restoreOwnerLeadTransport,
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
  readonly isTrashing: boolean;
  readonly trashError: string | null;
  readonly isRestoring: boolean;
  readonly restoreError: string | null;
}

export type OwnerLeadMutationOutcome = { readonly ok: true } | { readonly ok: false; readonly conflict: boolean; readonly message: string };

export interface UseOwnerLeadMutationsResult {
  readonly state: OwnerLeadMutationsState;
  readonly changeStatus: (input: OwnerLeadStatusChangeInput) => Promise<OwnerLeadMutationOutcome>;
  readonly addNote: (body: string) => Promise<OwnerLeadMutationOutcome>;
  readonly trashLead: () => Promise<OwnerLeadMutationOutcome>;
  readonly restoreLead: () => Promise<OwnerLeadMutationOutcome>;
  readonly clearStatusError: () => void;
  readonly clearNoteError: () => void;
  readonly clearTrashError: () => void;
  readonly clearRestoreError: () => void;
}

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const ALREADY_IN_PROGRESS_STATUS_MESSAGE = "A status change is already in progress.";
const ALREADY_IN_PROGRESS_NOTE_MESSAGE = "This note is already being saved.";
const ALREADY_IN_PROGRESS_TRASH_MESSAGE = "This enquiry is already being moved to Trash.";
const ALREADY_IN_PROGRESS_RESTORE_MESSAGE = "This enquiry is already being restored.";

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
    isTrashing: false,
    trashError: null,
    isRestoring: false,
    restoreError: null,
  });

  const statusPendingRef = useRef(false);
  const notePendingRef = useRef(false);
  const trashPendingRef = useRef(false);
  const restorePendingRef = useRef(false);
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

  /** CHECKPOINT C2M-A — Move to Trash. No confirmation logic lives here (the caller's own confirmation dialog handles that) — this is purely the mutation, matching changeStatus/addNote's own separation of concerns. */
  const trashLead = useCallback(async (): Promise<OwnerLeadMutationOutcome> => {
    if (trashPendingRef.current) {
      return { ok: false, conflict: false, message: ALREADY_IN_PROGRESS_TRASH_MESSAGE };
    }
    trashPendingRef.current = true;
    setState((previous) => ({ ...previous, isTrashing: true, trashError: null }));

    const result = await trashOwnerLeadTransport(leadId, deps);
    trashPendingRef.current = false;

    if (result.kind === "unauthorized") {
      setState((previous) => ({ ...previous, isTrashing: false }));
      onUnauthorized();
      return { ok: false, conflict: false, message: SESSION_EXPIRED_MESSAGE };
    }
    if (result.kind === "error" || result.kind === "aborted") {
      const message = result.kind === "error" ? result.message : "Something went wrong. Please try again.";
      setState((previous) => ({ ...previous, isTrashing: false, trashError: message }));
      return { ok: false, conflict: false, message };
    }

    setState((previous) => ({ ...previous, isTrashing: false, trashError: null }));
    onMutated();
    return { ok: true };
  }, [leadId, deps, onMutated, onUnauthorized]);

  const restoreLead = useCallback(async (): Promise<OwnerLeadMutationOutcome> => {
    if (restorePendingRef.current) {
      return { ok: false, conflict: false, message: ALREADY_IN_PROGRESS_RESTORE_MESSAGE };
    }
    restorePendingRef.current = true;
    setState((previous) => ({ ...previous, isRestoring: true, restoreError: null }));

    const result = await restoreOwnerLeadTransport(leadId, deps);
    restorePendingRef.current = false;

    if (result.kind === "unauthorized") {
      setState((previous) => ({ ...previous, isRestoring: false }));
      onUnauthorized();
      return { ok: false, conflict: false, message: SESSION_EXPIRED_MESSAGE };
    }
    if (result.kind === "error" || result.kind === "aborted") {
      const message = result.kind === "error" ? result.message : "Something went wrong. Please try again.";
      setState((previous) => ({ ...previous, isRestoring: false, restoreError: message }));
      return { ok: false, conflict: false, message };
    }

    setState((previous) => ({ ...previous, isRestoring: false, restoreError: null }));
    onMutated();
    return { ok: true };
  }, [leadId, deps, onMutated, onUnauthorized]);

  const clearStatusError = useCallback(() => setState((previous) => ({ ...previous, statusError: null })), []);
  const clearNoteError = useCallback(() => setState((previous) => ({ ...previous, noteError: null })), []);
  const clearTrashError = useCallback(() => setState((previous) => ({ ...previous, trashError: null })), []);
  const clearRestoreError = useCallback(() => setState((previous) => ({ ...previous, restoreError: null })), []);

  return { state, changeStatus, addNote, trashLead, restoreLead, clearStatusError, clearNoteError, clearTrashError, clearRestoreError };
}
