/**
 * CHECKPOINT C2F-C — pure helpers for explaining, after a same-tab reload,
 * what happened to a user's photo/document selection. Browser File objects
 * never survive JSON serialization (they are not structured-cloneable into
 * sessionStorage), so this module never tries to restore one — it only
 * decides what to tell the user and whether a freshly re-selected File is
 * plausibly the one they had before.
 */

/**
 * Deliberately its own small shape — camelCase, only the three fields this
 * module needs — rather than importing quote-submission-identity.ts's
 * snake_case CanonicalFileDeclaration (the server wire shape) or
 * quote-storage.ts's PersistedFileDeclaration (a storage-envelope
 * specific type). Both of those are structurally assignable to this one,
 * so callers holding either can pass it straight through.
 */
export interface RecoverableFileDeclaration {
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly declaredByteSize: number;
}

/**
 * CHECKPOINT C2F-C1: exactly quote_upload_slots.status's own five values
 * (see that column's CHECK constraint) — this module's own local copy,
 * structurally identical to initiate-quote.ts's UploadSlotStatus and
 * quote-storage.ts's PersistedUploadSlot['status'], for the same reason
 * RecoverableFileDeclaration is its own local shape rather than an import:
 * every one of those is structurally assignable here, so callers holding
 * any of them can pass it straight through with no conversion step.
 */
export type UploadSlotStatus = "pending" | "uploading" | "verified" | "failed" | "expired";

export type FileRecoveryStatus =
  | { readonly kind: "none_intended" }
  | { readonly kind: "present" }
  | { readonly kind: "lost"; readonly declarations: readonly RecoverableFileDeclaration[] };

/**
 * Distinguishes the three states a returning user's file selection can be
 * in: nothing was ever declared, browser File objects are currently present
 * (a fresh selection this page load), or files were declared but the
 * in-memory File objects are gone — the state every declared selection is
 * guaranteed to be in immediately after any reload.
 */
export function determineFileRecoveryStatus(
  declarations: readonly RecoverableFileDeclaration[],
  currentFileCount: number,
): FileRecoveryStatus {
  if (declarations.length === 0) return { kind: "none_intended" };
  if (currentFileCount === 0) return { kind: "lost", declarations };
  return { kind: "present" };
}

/**
 * Whether a freshly re-selected browser File is plausibly the same file
 * originally declared, compared on name/type/size only — that is all
 * either side ever has, since file bytes were never persisted (see the
 * module doc comment). This is explicitly a declaration match, not a
 * content/hash comparison: a false positive here is still caught
 * downstream, because the upload endpoint independently inspects the
 * actual bytes against the slot's own server-held declared metadata and
 * rejects a mismatch there regardless of what this function decided.
 */
export function doesFileMatchDeclaration(
  file: File,
  declaration: RecoverableFileDeclaration,
): boolean {
  return (
    file.name === declaration.originalFilename &&
    file.type === declaration.declaredMimeType &&
    file.size === declaration.declaredByteSize
  );
}

/**
 * CHECKPOINT C2F-C1: create_website_quote_v1's upload_slots response
 * (supabase/migrations/20260814150000_expose_upload_slot_status.sql) now
 * includes each slot's authoritative status, read directly from
 * quote_upload_slots.status on both first success and idempotent replay —
 * closing the gap CHECKPOINT C2F-C originally found and refused to work
 * around (see git history for that checkpoint's own always-false
 * implementation and its reasoning against inventing a client-side
 * heuristic). A resumed draft can now safely know which of its declared
 * slots were already verified before a reload, straight from the server —
 * never inferred from a stored leadId/reference, local progress, or the
 * fact that initiate replay merely returned successfully.
 */
export function isSlotKnownVerified(status: UploadSlotStatus): boolean {
  return status === "verified";
}

/**
 * Per-slot recovery guidance once a slot's authoritative status is known
 * (i.e. after CHECKPOINT C2F-C1's initiate replay, not the earlier
 * declaration-only case determineFileRecoveryStatus above still covers for
 * a pre_initiate attempt that has no server status at all yet):
 *
 * - verified: the file genuinely exists server-side. Never re-prompted for,
 *   regardless of whether a local File object happens to be present —
 *   isSlotKnownVerified(status) is what callers should gate "skip this
 *   slot" on, not this status.
 * - uploading: a claim was taken but never finalized. After any reload the
 *   in-memory File object attempting it is gone (see the module doc
 *   comment), so this is reported as its own distinct, honest state —
 *   in-progress, NOT guessed complete — rather than folded into "lost"
 *   (which would imply a plain reselect-and-retry is all that is needed)
 *   or "verified".
 * - pending: no claim was ever taken. Needs a File object to proceed —
 *   `present` if one currently exists this session, `needs_reselection` if
 *   the declaration exists but no File object currently does (guaranteed
 *   true immediately after any reload).
 * - failed / expired: terminal. This slot itself can never be revived or
 *   reused — release_quote_upload_claim_v1 and finalize_quote_upload_v2
 *   both structurally forbid ever un-failing/un-expiring/reusing a slot,
 *   and there is deliberately no reset/revival RPC (see
 *   20260813114500_lead_completion_lifecycle.sql's own scope note). This
 *   function mirrors that: `restart_required` is reported, never anything
 *   that could be mistaken for "reselect a file and retry this same slot".
 */
export type SlotRecoveryStatus =
  | { readonly kind: "verified" }
  | { readonly kind: "uploading" }
  | { readonly kind: "present" }
  | { readonly kind: "needs_reselection"; readonly declaration: RecoverableFileDeclaration }
  | { readonly kind: "restart_required"; readonly declaration: RecoverableFileDeclaration };

export function determineSlotRecoveryStatus(
  status: UploadSlotStatus,
  declaration: RecoverableFileDeclaration,
  currentFileCount: number,
): SlotRecoveryStatus {
  if (status === "verified") return { kind: "verified" };
  if (status === "uploading") return { kind: "uploading" };
  if (status === "failed" || status === "expired") {
    return { kind: "restart_required", declaration };
  }
  // status === "pending"
  return currentFileCount > 0 ? { kind: "present" } : { kind: "needs_reselection", declaration };
}
