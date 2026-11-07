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
import { logUnhandledError, describeWebCryptoAvailability } from "@/lib/error-capture";
import type { QuoteClientDiagnosticsSnapshot } from "./quote-client-diagnostics-beacon";

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

/**
 * Every stage a client_exception's thrown cause could have last reported
 * progress for — the same phase names submit() already reports via
 * onProgress, plus two fallbacks: "before_computing_identity" for the
 * (currently unreachable in practice, since onProgress's first call is
 * synchronous and unconditional) case where no progress event fired at all
 * before the throw inside createQuoteSubmissionEngine's own wrapper, and
 * "unknown" for a caller's OWN last-resort catch that never had access to
 * the engine's internal stage-tracking at all (see QuoteExperience.tsx's
 * own call site comment). Deliberately exported so logs/tests can name it
 * without a string literal drifting out of sync with
 * QuoteSubmissionProgressEvent's own phases.
 */
export type QuoteClientExceptionStage =
  | QuoteSubmissionProgressEvent["phase"]
  | "before_computing_identity"
  | "unknown";

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
  | {
      /**
       * Never produced by submitInternal below — createQuoteSubmissionEngine's
       * own wrapper (see its submit() implementation) synthesizes this
       * whenever submitInternal's promise rejects, i.e. an
       * actual thrown exception rather than one of submitInternal's own
       * typed returns. Kept as its own kind, distinct from "server_error",
       * purely so the Review banner can show a different fixed diagnostic
       * code for the two — see quote-submission-copy.ts's own comment.
       *
       * `stage` is the last progress phase reported before the throw — a
       * closed, PII/token-free enum (never the error's own message/stack),
       * logged via logUnhandledError so a future occurrence can be
       * distinguished (e.g. "failed before any request was sent" vs. "failed
       * after initiate/upload/complete already succeeded server-side")
       * without ever capturing what actually threw.
       *
       * `leadId`/`reference` are present ONLY when createQuoteSubmissionEngine's
       * own catch recovers a persisted "initiated" attempt right after
       * catching — i.e. ONLY when a real server response already confirmed a
       * lead exists, never a guess from the stage alone. A "pre_initiate"
       * attempt (we asked the server but never got a response — e.g. the
       * throw happened inside initiate() itself) does NOT qualify: that is
       * a genuine "we don't know" case, not a confirmed lead, so these stay
       * absent and the banner stays the plain generic message. MEASURED
       * GAP, fixed — before this, EVERY client_exception, including one
       * thrown well after a real lead was already created server-side
       * (uploading/completing), carried no leadId/reference at all, so the
       * Review banner showed the exact same "something went wrong" wording
       * whether nothing had happened yet or a real enquiry already existed
       * — see quote-submission-copy.ts's own client_exception case for the
       * banner-level fix this enables.
       */
      readonly kind: "client_exception";
      readonly retryable: true;
      readonly stage: QuoteClientExceptionStage;
      readonly leadId?: string;
      readonly reference?: string;
    }
  | {
      /** CHECKPOINT C2G — the Turnstile token was missing/invalid/expired/duplicate or failed Siteverify. A brand-new challenge token is required before retrying; the caller's answers and in-flight attempt are otherwise untouched. */
      readonly kind: "human_verification_required";
    }
  | {
      /** CHECKPOINT C2G — a Cloudflare Worker rate-limit binding rejected this request. Always safe to retry after waiting; never treated as failure and never clears the persisted attempt. */
      readonly kind: "rate_limited";
      readonly retryable: true;
    }
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
  /**
   * QT-CLI audit — the server-visible diagnostic beacon (see
   * quote-client-diagnostics-beacon.ts). Defaults to a genuine no-op, NOT
   * the real network-calling function: every one of this engine's own
   * tests exercises the client_exception catch path below without
   * supplying this, and the real sendQuoteClientDiagnosticsBeacon would
   * otherwise fire an uncontrolled background fetch() in every one of
   * them (no test here injects a fake fetchImpl for it, unlike `transport`
   * itself, which every test already fakes explicitly). QuoteExperience.tsx
   * — the one real production call site — passes the real
   * sendQuoteClientDiagnosticsBeacon explicitly; nothing else needs to.
   */
  readonly sendDiagnosticsBeacon?: (snapshot: QuoteClientDiagnosticsSnapshot) => Promise<void>;
}

export interface SubmitQuoteInput {
  readonly values: QuoteFormValues;
  readonly context: QuoteInitialContext;
  /** CHECKPOINT C2G — a fresh Cloudflare Turnstile token obtained by the caller immediately before this submit() call; never persisted, never logged, forwarded only to transport.initiate(). */
  readonly turnstileToken: string;
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

/**
 * Internal-only diagnostic hooks — never exposed via QuoteSubmissionOutcome
 * or any UI-facing type, so this stays purely an input to
 * createQuoteSubmissionEngine's own logging decision (see its catch
 * handler below), never a change to what the UI renders or how it
 * navigates. Every hook is a plain boolean/value setter: no PII, no form
 * data, no raw exception, nothing resembling a payload hash is ever
 * passed through here.
 */
interface SubmitInternalDiagnostics {
  /**
   * Called exactly once, the moment this call's own payloadHash becomes
   * known — i.e. right after identity computation succeeds, never before,
   * never a guess. Lets createQuoteSubmissionEngine's outer catch below
   * verify a recovered "initiated" attempt actually belongs to THIS
   * submission (same payloadHash) before ever attaching its leadId/
   * reference to a client_exception outcome — without this, a stale
   * attempt left over from an entirely unrelated earlier/abandoned
   * submission could be misattributed to the one that's currently
   * failing, which would be actively MISLEADING (worse than the generic
   * message it replaces), not merely imprecise.
   */
  onIdentityKnown(payloadHash: string): void;
  /**
   * Called immediately before transport.initiate() is actually invoked.
   *
   * NAMING, deliberate: this is "initiateInvoked", never "request sent" —
   * the measurement point is the engine's own call into the
   * quote-submission-transport.ts abstraction, not the raw fetch()
   * boundary inside it. This module has no visibility into whether
   * quote-submission-transport.ts's own internals (JSON.stringify, the
   * AbortController/timeout setup in runFetch, the actual fetchImpl call)
   * got as far as touching the network before any eventual throw — only
   * that THIS call was made. Instrumenting the literal fetch() boundary
   * inside quote-submission-transport.ts was considered and deliberately
   * not done: QuoteTransport's per-call methods have a fixed signature
   * shared by every test fake in this codebase, and threading a
   * network-level callback through it would mean a broader interface
   * change for a distinction the real transport's own exhaustive
   * typed-return design (every genuine fetch/parse failure already
   * becomes a typed, non-throwing result — see runFetch's own try/catch
   * blocks) makes rare in practice: by the time transport.initiate()
   * itself throws at all, it is almost always because something OUTSIDE
   * the network call threw, not inside it.
   */
  onInitiateInvoked(): void;
  /**
   * Called the instant transport.initiate() resolves to ANY result — ok or
   * not — never on a throw/rejection.
   *
   * NAMING, deliberate: this is "initiateSettled", never "HTTP response
   * received" — same reasoning as onInitiateInvoked's own doc comment.
   * "Settled" means transport.initiate()'s own promise resolved without
   * throwing, which for the real transport implementation in practice
   * only happens after a real HTTP response was received and parsed (its
   * every other failure mode is a typed, non-throwing return) — but that
   * is an observed property of today's transport, not a guarantee this
   * field's name should claim. Still fires even for a typed
   * (non-exception) failure response, since those never reach the
   * generic catch this diagnostic feeds anyway — recording it
   * unconditionally here is simpler and no less accurate than only
   * recording it on the success path.
   */
  onInitiateSettled(): void;
}

async function submitInternal(
  input: SubmitQuoteInput,
  transport: QuoteTransport,
  store: QuoteAttemptStore,
  onProgress: (event: QuoteSubmissionProgressEvent) => void,
  now: () => number,
  diagnostics: SubmitInternalDiagnostics,
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
  diagnostics.onIdentityKnown(identity.payloadHash);

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
  diagnostics.onInitiateInvoked();
  const initiateResult = await transport.initiate(
    { idempotencyKey, submission: identity.submission, files: identity.files, turnstileToken: input.turnstileToken },
    signal,
  );
  diagnostics.onInitiateSettled();

  if (!initiateResult.ok) {
    if (initiateResult.transportFailure === "aborted") return { kind: "aborted" };
    if (initiateResult.transportFailure) return { kind: "network_error", retryable: true };
    if (initiateResult.code === "VERIFICATION_REQUIRED") {
      return { kind: "human_verification_required" };
    }
    if (initiateResult.code === "RATE_LIMITED") {
      return { kind: "rate_limited", retryable: true };
    }
    if (initiateResult.code === "IDEMPOTENCY_CONFLICT") {
      // The locally-resolved key was already used server-side with a
      // different payload — the stale local record can no longer be
      // trusted for this hash. Clearing it lets the very next submit()
      // mint a fresh key naturally (resolveIdempotencyKey always mints a
      // new one when no matching existing attempt remains) — never an
      // automatic retry with the same conflicting key from inside this call.
      //
      // MEASURED GAP (QT-CLI trace) — best-effort only: this cleanup is a
      // local-recovery-state nicety, not a precondition for reporting the
      // outcome the server just told us about. A throw here must never
      // convert a known, specific outcome into the generic client_exception
      // — see the identical reasoning at the genuine-completion cleanup
      // below, where this exact bug was found.
      try {
        store.clearSubmissionAttempt();
      } catch {
        // Swallowed deliberately — see comment above.
      }
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
        case "RATE_LIMITED":
          return { kind: "rate_limited", retryable: true };
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
    if (completeResult.code === "RATE_LIMITED") {
      return { kind: "rate_limited", retryable: true };
    }
    return { kind: "server_error", retryable: completeResult.retryable };
  }

  // ---- 20. Genuine completion: clear the attempt, but the final server
  // confirmation the UI needs travels back in the returned outcome, not in
  // storage. -----------------------------------------------------------
  //
  // MEASURED GAP (found during the QT-CLI trace), now fixed — this call
  // was previously unguarded, so a throw here (e.g. the quote-storage.ts
  // isBrowser() gap already fixed, or any other future storage failure)
  // would reject this function's promise INSTEAD of returning the success
  // below, converting an already-genuine, server-confirmed completion into
  // a customer-visible client_exception/QT-CLI error. This is a PLAUSIBLE
  // explanation consistent with the one reported "failed UI, successful
  // enquiry" incident, not a confirmed one — no device log from that
  // incident ever captured what actually threw, so this is a real,
  // independently-found defect being fixed on its own merits, not a
  // claim that it IS what happened that one time. Cleanup here is best-effort
  // only: transport.complete has already returned ok:true, so the success
  // below is owed regardless of whether local recovery state can be
  // cleared. Worst case on a swallowed failure: a stale "initiated" attempt
  // lingers in sessionStorage — harmless, since any later submit() for a
  // materially different payload invalidates it via reconcileSubmissionAttempt's
  // own hash check, and a retry with the SAME unchanged values safely
  // re-confirms success via the server's own already_completed replay
  // (verified in quote-submission-engine.test.ts).
  try {
    store.clearSubmissionAttempt();
  } catch {
    // Swallowed deliberately — see comment above.
  }
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
  // Default is a genuine no-op, not the real beacon — see
  // QuoteSubmissionEngineDeps's own doc comment on sendDiagnosticsBeacon
  // for why.
  const sendDiagnosticsBeacon = deps.sendDiagnosticsBeacon ?? (() => Promise.resolve());

  let inFlight: Promise<QuoteSubmissionOutcome> | null = null;

  return {
    submit(input: SubmitQuoteInput): Promise<QuoteSubmissionOutcome> {
      if (inFlight) return inFlight;

      // MEASURED GAP (QT-CLI trace) — submitInternal is designed to always
      // resolve to a typed outcome, never throw, but every caller
      // previously relied on that as an assumption rather than a guarantee
      // this module itself enforces: a throw anywhere inside it (e.g. the
      // now-fixed quote-storage.ts isBrowser() gap, or the Web Crypto calls
      // in quote-submission-identity.ts, neither of which is DI'd here)
      // would reject this promise uncaught, forcing every CALLER of
      // submit() to independently remember to guard against that — which
      // QuoteExperience.tsx's own call site comment already documented as a
      // real, previously-unguarded risk. Catching it HERE, once, means
      // every current and future caller gets the same safety net
      // automatically, and the exact progress phase last reported before
      // the throw (never the error's own message/stack) is preserved as
      // `stage` — this is deliberately NOT a guess at which specific call
      // threw; it only records where the pipeline had gotten to.
      let lastPhase: QuoteSubmissionProgressEvent["phase"] | null = null;
      const trackedOnProgress = (event: QuoteSubmissionProgressEvent) => {
        lastPhase = event.phase;
        onProgress(event);
      };
      // Set exactly once, the moment THIS call's own payloadHash becomes
      // known (see SubmitInternalDiagnostics's onIdentityKnown doc
      // comment) — null the whole time if the throw happened before
      // identity computation even finished, in which case there is no
      // hash to compare against and recovery below correctly never fires.
      let currentPayloadHash: string | null = null;
      // Diagnostic-only, never exposed via QuoteSubmissionOutcome or any
      // UI-facing value — see SubmitInternalDiagnostics's own doc comment
      // and this catch handler's own logUnhandledError call below, the
      // only place these are ever read.
      let initiateInvoked = false;
      let initiateSettled = false;

      const run = submitInternal(input, deps.transport, store, trackedOnProgress, now, {
        onIdentityKnown: (hash) => {
          currentPayloadHash = hash;
        },
        onInitiateInvoked: () => {
          initiateInvoked = true;
        },
        onInitiateSettled: () => {
          initiateSettled = true;
        },
      })
        .catch((error: unknown): QuoteSubmissionOutcome => {
          const stage: QuoteClientExceptionStage = lastPhase ?? "before_computing_identity";
          // `stage` is this module's own closed QuoteClientExceptionStage
          // enum — never anything derived from `error` — so passing it as
          // logUnhandledError's `extra` is safe under that function's own
          // contract (see its doc comment). The outcome's own `stage`
          // field alone (returned to the UI, never logged) was previously
          // the only place this existed. IMPORTANT SCOPE LIMIT:
          // logUnhandledError's production path writes via
          // originalConsoleError — plain console.error.bind(console),
          // captured in error-capture.ts — which is this BROWSER's own
          // local DevTools console only. There is no server-side log
          // store or remote aggregation here. This makes the stage
          // retrievable only in a LIVE session on the affected device
          // (e.g. Safari/Chrome Remote Web Inspector connected at the
          // time, or the user's own screen recording) — never a
          // after-the-fact remote/historical lookup once that device is
          // no longer connected.
          // Future-QT-CLI-diagnostics audit, added — three more bounded
          // booleans/enums alongside `stage`, same closed-value contract:
          // never the raw error, never form data/name/phone/files/token,
          // never a URL, never a payload hash. `initiateInvoked`/
          // `initiateSettled` narrow WHERE around the initiate call a
          // throw landed (see SubmitInternalDiagnostics's own doc comment
          // for exactly what these do and do not claim — never "request
          // sent"/"HTTP response received" literally, since the actual
          // fetch() boundary inside quote-submission-transport.ts is not
          // instrumented); the three Web Crypto flags record only WHETHER
          // each API exists in this browser right now, never any value
          // drawn from it. Entirely best-effort: this whole block is
          // wrapped so that even a failure IN the diagnostics themselves
          // (e.g. `crypto` itself throwing on property access in some
          // exotic restricted context) can never mask or replace the real
          // client_exception outcome below — it only means this one log
          // call is skipped.
          let webCrypto: Readonly<Record<string, boolean>> = {};
          try {
            webCrypto = describeWebCryptoAvailability();
            logUnhandledError(error, "quote_submit_client_exception", {
              stage,
              initiateInvoked,
              initiateSettled,
              ...webCrypto,
            });
          } catch {
            // Ignore — see comment above.
          }
          // Server-visible counterpart to the console-only log above — see
          // src/server/quote/quote-client-diagnostics.ts and this
          // beacon's own module doc comment for the full "why" (console
          // logging alone is unobservable in Google's in-app browser, and
          // was separately confirmed NOT solved by enabling Cloudflare
          // Workers Observability on the deployed Worker, which is off).
          // Deliberately NOT awaited — firing it synchronously here and
          // letting it resolve on its own is what makes "never blocks
          // submission" true in practice, not just in the beacon
          // function's own contract. The inner `.catch()` alone only
          // guards an asynchronous REJECTION; it does nothing for a
          // SYNCHRONOUS throw from calling sendDiagnosticsBeacon(...)
          // itself (a caller-injected function, not necessarily one that
          // follows its own documented contract) — that throw would
          // happen before `.catch` is ever reached, escaping this whole
          // `.catch((error) => {...})` callback and rejecting the
          // engine's own returned promise, replacing the correct
          // client_exception outcome below with nothing at all (a rejected
          // submit() call). MEASURED GAP, fixed — the outer try/catch
          // makes this diagnostic send fully best-effort against BOTH
          // failure modes, exactly like every other diagnostic step above
          // it, so the real outcome this function is about to return can
          // never be replaced by a misbehaving injected dependency.
          try {
            void sendDiagnosticsBeacon({
              stage,
              initiateInvoked,
              initiateSettled,
              subtleAvailable: webCrypto["subtleAvailable"] ?? false,
              getRandomValuesAvailable: webCrypto["getRandomValuesAvailable"] ?? false,
              randomUUIDAvailable: webCrypto["randomUUIDAvailable"] ?? false,
            }).catch(() => undefined);
          } catch {
            // Ignore — see comment above.
          }
          // MEASURED GAP, fixed — recover leadId/reference from storage
          // ONLY when a real server response already confirmed a lead
          // ("initiated", never "pre_initiate"/"none") exists AND its own
          // payloadHash matches THIS call's currentPayloadHash. The
          // payloadHash check is the whole point, not a nicety: without
          // it, a stale "initiated" attempt left over from an entirely
          // unrelated earlier submission (confirmed by a real test — see
          // quote-submission-engine.test.ts) could get attached to a
          // DIFFERENT, currently-failing submission that has nothing to do
          // with it — a wrong leadId/reference pair on this outcome,
          // regardless of whether the copy layer currently surfaces that
          // distinction (quote-submission-copy.ts's own comment explains
          // why it deliberately doesn't, for this release). If
          // currentPayloadHash is still null (the throw
          // happened before identity computation even finished), there is
          // nothing to compare against, so recovery correctly never fires.
          // Best-effort either way: a throw from the store read here must
          // never mask the original exception's own client_exception
          // outcome — it only means these two fields stay absent, same as
          // before this fix.
          let recovered: { leadId: string; reference: string } | undefined;
          try {
            const attempt = store.loadSubmissionAttempt();
            if (
              attempt.kind === "initiated" &&
              currentPayloadHash !== null &&
              attempt.payloadHash === currentPayloadHash
            ) {
              recovered = { leadId: attempt.leadId, reference: attempt.reference };
            }
          } catch {
            // Ignore — see comment above.
          }
          return { kind: "client_exception", retryable: true, stage, ...recovered };
        })
        .finally(() => {
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
