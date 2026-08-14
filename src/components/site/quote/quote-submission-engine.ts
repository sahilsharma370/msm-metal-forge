import {
  computeQuoteSubmissionIdentity,
  selectRelevantLocalFiles,
  resolveIdempotencyKey,
  type CanonicalFileDeclaration,
} from "./quote-submission-identity";
import {
  loadSubmissionAttempt,
  saveSubmissionAttempt,
  clearSubmissionAttempt,
  reconcileSubmissionAttempt,
  toPersistedUploadSlot,
  type QuoteSubmissionAttempt,
  type PersistedUploadSlot,
  type PersistedFileDeclaration,
} from "./quote-storage";
import {
  isSlotKnownVerified,
  determineSlotRecoveryStatus,
  claimMatchingFile,
  type RecoverableFileDeclaration,
} from "./quote-file-recovery";
import type { QuoteTransport, InitiateUploadSlot } from "./quote-submission-transport";
import type { QuoteFormValues } from "./quote-schema";
import type { QuoteInitialContext } from "./quote-search";

/**
 * CHECKPOINT C2F-D — the headless orchestration engine that drives one
 * Quote submission end to end (initiate -> upload every unresolved eligible
 * slot -> complete) against the three existing secure HTTP endpoints, using
 * only the browser-safe CHECKPOINT C2F-C/C2F-C1 building blocks:
 * computeQuoteSubmissionIdentity for validation/normalization/hashing,
 * resolveIdempotencyKey for key reuse, quote-storage.ts for the persisted
 * attempt envelope, and quote-file-recovery.ts for authoritative
 * per-slot-status recovery guidance and File matching.
 *
 * This module builds ORCHESTRATION LOGIC ONLY — no visual component, no
 * Submit button wiring (that is CHECKPOINT C2F-E). It never logs a customer
 * answer, phone/email, filename, payload, token, raw server error or
 * Storage path: every progress event and outcome below carries only coarse
 * phase names, slot UUIDs/indices, counts, and the server's OWN already-
 * sanitized error code/message — never anything this module derived from
 * raw request/response internals.
 */

// ---------------------------------------------------------------------------
// UI-independent progress events
// ---------------------------------------------------------------------------

export type QuoteSubmissionProgressEvent =
  | { readonly phase: "computing_identity" }
  | { readonly phase: "initiating" }
  | { readonly phase: "resolving_slots" }
  | { readonly phase: "uploading"; readonly slotIndex: number; readonly slotId: string; readonly uploadedCount: number; readonly totalCount: number }
  | { readonly phase: "completing" };

// ---------------------------------------------------------------------------
// Outcome — the one thing submit() ever resolves to. Every branch is a
// small, UI-safe, already-typed result; never a thrown exception for an
// expected condition (network/API/malformed-response failures are all
// outcomes, not throws) and never raw database/server internals.
// ---------------------------------------------------------------------------

export type QuoteSubmissionOutcome =
  | {
      readonly kind: "success";
      readonly leadId: string;
      readonly reference: string;
      readonly submissionCompletedAt: string;
      readonly alreadyCompleted: boolean;
    }
  | { readonly kind: "validation_error"; readonly issues: readonly { readonly path: string; readonly message: string }[] }
  | {
      readonly kind: "needs_reselection";
      readonly leadId: string;
      readonly reference: string;
      readonly slots: readonly {
        readonly slotIndex: number;
        readonly slotId: string;
        readonly declaration: RecoverableFileDeclaration;
      }[];
    }
  | {
      /** A terminal (failed/expired) slot, or one discovered terminal only when an upload was actually attempted (SLOT_UNAVAILABLE) — this lead's file set can never be completed as declared. No new lead is ever started automatically; that decision is left for an explicit later checkpoint. */
      readonly kind: "restart_required";
      readonly leadId: string;
      readonly reference: string;
      readonly slotIndex: number;
      readonly slotId: string;
    }
  | {
      /** A claim lease on this slot is still fresh elsewhere (another tab/request) — safe to retry shortly; never treated as failure or as license to start a new lead. */
      readonly kind: "upload_in_progress";
      readonly leadId: string;
      readonly reference: string;
      readonly slotIndex: number;
      readonly slotId: string;
    }
  | {
      /** This slot was already verified with DIFFERENT content than the currently-selected File — reselecting the exact original file (not restarting the lead) is what's needed. */
      readonly kind: "content_mismatch";
      readonly leadId: string;
      readonly reference: string;
      readonly slotIndex: number;
      readonly slotId: string;
    }
  | {
      readonly kind: "upload_failed";
      readonly leadId: string;
      readonly reference: string;
      readonly slotIndex: number;
      readonly slotId: string;
      readonly retryable: boolean;
    }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "not_ready"; readonly leadId: string; readonly reference: string }
  | { readonly kind: "server_rejected"; readonly issues: readonly { readonly path: string; readonly message: string }[] }
  | { readonly kind: "network_error"; readonly retryable: true }
  | { readonly kind: "server_error"; readonly retryable: boolean }
  | { readonly kind: "aborted" };

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** The four quote-storage.ts functions this engine needs — defaults to the real ones; overridable so a pure unit test needs no sessionStorage/window at all. */
export interface QuoteAttemptStore {
  loadSubmissionAttempt(): QuoteSubmissionAttempt;
  saveSubmissionAttempt(attempt: QuoteSubmissionAttempt): void;
  clearSubmissionAttempt(): void;
  reconcileSubmissionAttempt(currentPayloadHash: string): QuoteSubmissionAttempt;
}

const defaultAttemptStore: QuoteAttemptStore = {
  loadSubmissionAttempt,
  saveSubmissionAttempt,
  clearSubmissionAttempt,
  reconcileSubmissionAttempt,
};

export interface QuoteSubmissionEngineDeps {
  readonly transport: QuoteTransport;
  readonly store?: QuoteAttemptStore;
  readonly onProgress?: (event: QuoteSubmissionProgressEvent) => void;
  /** Injectable clock for deterministic createdAt/updatedAt in tests. */
  readonly now?: () => number;
}

export interface SubmitQuoteInput {
  readonly values: QuoteFormValues;
  readonly context: QuoteInitialContext;
  readonly signal?: AbortSignal;
}

export interface QuoteSubmissionEngine {
  submit(input: SubmitQuoteInput): Promise<QuoteSubmissionOutcome>;
  readonly isSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function toPersistedFileDeclaration(file: CanonicalFileDeclaration): PersistedFileDeclaration {
  return {
    originalFilename: file.original_filename,
    declaredMimeType: file.declared_mime_type,
    declaredByteSize: file.declared_byte_size,
  };
}

function toRecoverableDeclaration(slot: PersistedUploadSlot): RecoverableFileDeclaration {
  return {
    originalFilename: slot.originalFilename,
    declaredMimeType: slot.declaredMimeType,
    declaredByteSize: slot.declaredByteSize,
  };
}

/** Existing (payloadHash, idempotencyKey) pair from any non-"none" attempt — both pre_initiate and initiated carry both fields. */
function existingKeyPair(
  attempt: QuoteSubmissionAttempt,
): { readonly payloadHash: string; readonly idempotencyKey: string } | null {
  return attempt.kind === "none" ? null : { payloadHash: attempt.payloadHash, idempotencyKey: attempt.idempotencyKey };
}

// ---------------------------------------------------------------------------
// Core orchestration (single execution — the public engine wraps this with
// single-flight; every internal early return goes through here so exactly
// one code path ever produces an outcome)
// ---------------------------------------------------------------------------

async function submitInternal(
  input: SubmitQuoteInput,
  transport: QuoteTransport,
  store: QuoteAttemptStore,
  onProgress: (event: QuoteSubmissionProgressEvent) => void,
  now: () => number,
): Promise<QuoteSubmissionOutcome> {
  const { signal } = input;
  if (signal?.aborted) return { kind: "aborted" };

  // ---- 1/2/3. Validate, normalize and hash through the existing shared
  // implementation; reuse or mint the idempotency key. ----------------------
  onProgress({ phase: "computing_identity" });
  const identityResult = await computeQuoteSubmissionIdentity(input.values, input.context);
  if (!identityResult.ok) {
    return {
      kind: "validation_error",
      issues: identityResult.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }
  if (signal?.aborted) return { kind: "aborted" };
  const identity = identityResult.identity;

  const reconciled = store.reconcileSubmissionAttempt(identity.payloadHash);
  const idempotencyKey = resolveIdempotencyKey(identity.payloadHash, existingKeyPair(reconciled));
  const persistedFiles = identity.files.map(toPersistedFileDeclaration);

  // ---- 4. Persist a pre_initiate attempt before the first network request
  // — only when there is genuinely nothing usable yet for this exact
  // (key, hash) pair. A resume where an "initiated" (or already-matching
  // "pre_initiate") attempt exists is left as-is: downgrading it here would
  // throw away real recovery state for no benefit, since the initiate call
  // below is always issued regardless and is always a safe replay. --------
  if (reconciled.kind === "none") {
    store.saveSubmissionAttempt({
      kind: "pre_initiate",
      idempotencyKey,
      payloadHash: identity.payloadHash,
      files: persistedFiles,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const createdAt = reconciled.kind === "none" ? now() : reconciled.createdAt;

  // ---- 5. Call initiate exactly per its current contract. ----------------
  onProgress({ phase: "initiating" });
  const initiateResult = await transport.initiate(
    { idempotencyKey, submission: identity.submission, files: identity.files },
    signal,
  );

  if (!initiateResult.ok) {
    if (initiateResult.transportFailure === "aborted") return { kind: "aborted" };
    if (initiateResult.transportFailure) return { kind: "network_error", retryable: true };
    if (initiateResult.code === "IDEMPOTENCY_CONFLICT") {
      // The locally-resolved key was already used server-side with a
      // different payload — the stale local record can no longer be
      // trusted for this hash. Clearing it lets the very next submit()
      // mint a fresh key naturally (resolveIdempotencyKey always mints a
      // new one when no matching existing attempt remains) — never an
      // automatic retry with the same conflicting key from inside this call.
      store.clearSubmissionAttempt();
      return { kind: "idempotency_conflict" };
    }
    if (initiateResult.code === "VALIDATION_ERROR") {
      return { kind: "server_rejected", issues: initiateResult.fieldErrors ?? [] };
    }
    return { kind: "server_error", retryable: initiateResult.retryable };
  }
  if (signal?.aborted) return { kind: "aborted" };

  const { leadId, reference } = initiateResult.data;
  let persistedSlots: PersistedUploadSlot[] = initiateResult.data.uploadSlots.map(
    (slot: InitiateUploadSlot): PersistedUploadSlot => toPersistedUploadSlot(slot),
  );

  // ---- 6. Persist the initiated response without storagePath (toPersistedUploadSlot already strips it). ----
  const persistInitiated = () =>
    store.saveSubmissionAttempt({
      kind: "initiated",
      idempotencyKey,
      payloadHash: identity.payloadHash,
      files: persistedFiles,
      leadId,
      reference,
      uploadSlots: persistedSlots,
      createdAt,
      updatedAt: now(),
    });
  persistInitiated();

  // ---- 7/8/9. Resolve every slot's authoritative status, preserving
  // seller/buyer file isolation and exact (never double-claimed) slot/file
  // matching. -----------------------------------------------------------
  onProgress({ phase: "resolving_slots" });
  const relevantLocalFiles = selectRelevantLocalFiles(input.values, identity.submission.intent);
  let pool: readonly File[] = relevantLocalFiles.map((local) => local.file);

  const needsReselection: { slotIndex: number; slotId: string; declaration: RecoverableFileDeclaration }[] = [];
  const toUpload: { slot: PersistedUploadSlot; file: File }[] = [];
  let restartRequired: PersistedUploadSlot | null = null;

  for (const slot of persistedSlots) {
    if (isSlotKnownVerified(slot.status)) continue; // verified: skip upload entirely
    const declaration = toRecoverableDeclaration(slot);
    const recovery = determineSlotRecoveryStatus(slot.status, declaration, 0);
    if (recovery.kind === "restart_required") {
      restartRequired = slot;
      break;
    }
    // recovery.kind is "uploading" or "needs_reselection" here — file
    // presence is resolved separately via the shared pool so the same File
    // can never be claimed by two different slots.
    const claim = claimMatchingFile(pool, declaration);
    pool = claim.remainingPool;
    if (claim.matched) {
      toUpload.push({ slot, file: claim.matched });
    } else {
      needsReselection.push({ slotIndex: slot.slotIndex, slotId: slot.slotId, declaration });
    }
  }

  if (restartRequired) {
    return {
      kind: "restart_required",
      leadId,
      reference,
      slotIndex: restartRequired.slotIndex,
      slotId: restartRequired.slotId,
    };
  }
  if (needsReselection.length > 0) {
    return { kind: "needs_reselection", leadId, reference, slots: needsReselection };
  }

  // ---- 9/10. Upload only unresolved eligible slots, sequentially — never
  // mark a file successful before the upload API itself confirms it. ------
  for (const { slot, file } of toUpload) {
    if (signal?.aborted) return { kind: "aborted" };
    onProgress({
      phase: "uploading",
      slotIndex: slot.slotIndex,
      slotId: slot.slotId,
      uploadedCount: persistedSlots.filter((s) => s.status === "verified").length,
      totalCount: persistedSlots.length,
    });

    const uploadResult = await transport.upload({ slotId: slot.slotId, idempotencyKey, file }, signal);

    if (!uploadResult.ok) {
      if (uploadResult.transportFailure === "aborted") return { kind: "aborted" };
      if (uploadResult.transportFailure) return { kind: "network_error", retryable: true };
      switch (uploadResult.code) {
        case "UPLOAD_IN_PROGRESS":
          return { kind: "upload_in_progress", leadId, reference, slotIndex: slot.slotIndex, slotId: slot.slotId };
        case "SLOT_UNAVAILABLE":
          return { kind: "restart_required", leadId, reference, slotIndex: slot.slotIndex, slotId: slot.slotId };
        case "ALREADY_VERIFIED_MISMATCH":
          return { kind: "content_mismatch", leadId, reference, slotIndex: slot.slotIndex, slotId: slot.slotId };
        default:
          return {
            kind: "upload_failed",
            leadId,
            reference,
            slotIndex: slot.slotIndex,
            slotId: slot.slotId,
            retryable: uploadResult.retryable,
          };
      }
    }
    if (signal?.aborted) return { kind: "aborted" };

    // Only now — after the upload API's own 200 confirmation — is this one
    // slot recorded as verified, both in this run's working copy and in
    // persisted recovery state, so a crash/abort immediately after still
    // leaves an accurate resume point.
    persistedSlots = persistedSlots.map((s) => (s.slotId === slot.slotId ? { ...s, status: "verified" } : s));
    persistInitiated();
  }

  // ---- 11/12/13. Call complete only now that every required slot is
  // verified; success is reported only from a genuine complete response. --
  onProgress({ phase: "completing" });
  const completeResult = await transport.complete({ leadId, idempotencyKey }, signal);

  if (!completeResult.ok) {
    if (completeResult.transportFailure === "aborted") return { kind: "aborted" };
    if (completeResult.transportFailure) return { kind: "network_error", retryable: true };
    if (completeResult.code === "NOT_READY") {
      return { kind: "not_ready", leadId, reference };
    }
    return { kind: "server_error", retryable: completeResult.retryable };
  }

  // ---- 20. Genuine completion: clear the attempt, but the final server
  // confirmation the UI needs travels back in the returned outcome, not in
  // storage. ---------------------------------------------------------------
  store.clearSubmissionAttempt();
  return {
    kind: "success",
    leadId: completeResult.data.leadId,
    reference: completeResult.data.reference,
    submissionCompletedAt: completeResult.data.submissionCompletedAt,
    alreadyCompleted: completeResult.data.alreadyCompleted,
  };
}

// ---------------------------------------------------------------------------
// Public factory — single-flight wrapper
// ---------------------------------------------------------------------------

/**
 * Creates one engine instance with its own single-flight guard: while a
 * submit() call is in progress, any further submit() calls on the SAME
 * instance return the exact same in-flight promise rather than starting a
 * second, concurrent orchestration run — this is the real double-click/
 * duplicate-submission guard (requirement 16), not a debounce or a
 * disabled-button convention the caller has to remember to apply. Because
 * duplicate calls share one execution, they also share its AbortSignal;
 * only the signal passed to the call that actually started the in-flight
 * run has any effect.
 */
export function createQuoteSubmissionEngine(deps: QuoteSubmissionEngineDeps): QuoteSubmissionEngine {
  const store = deps.store ?? defaultAttemptStore;
  const onProgress = deps.onProgress ?? (() => undefined);
  const now = deps.now ?? (() => Date.now());

  let inFlight: Promise<QuoteSubmissionOutcome> | null = null;

  return {
    submit(input: SubmitQuoteInput): Promise<QuoteSubmissionOutcome> {
      if (inFlight) return inFlight;
      const run = submitInternal(input, deps.transport, store, onProgress, now).finally(() => {
        inFlight = null;
      });
      inFlight = run;
      return run;
    },
    get isSubmitting(): boolean {
      return inFlight !== null;
    },
  };
}
