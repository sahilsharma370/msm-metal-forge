import { z } from "zod";
// CHECKPOINT C2F-C: @/lib/quote/*, not @/server/quote/* — this file is
// imported by client code, and the project build hard-denies any
// client-side import resolving under **/server/** regardless of the
// imported file's own runtime safety (see quote-submission-identity.ts's
// doc comment for the full explanation).
import { MAX_FILES } from "@/lib/quote/submission-schema";
import {
  CONDITIONS,
  EMIRATES,
  FULFILMENT_CHOICES,
  PICKUP_CHOICES,
  PREFERRED_CONTACTS,
  PREFERRED_PORTS,
  QUOTE_UNITS,
} from "./quote-options";
import { QUOTE_INTENTS, QUOTE_MATERIAL_KEYS, QUOTE_TRADE_ROUTES } from "./quote-search";
import type { QuoteFormValues } from "./quote-schema";

/**
 * CHECKPOINT C2F-C — cross-tab scope correction (see the report for detail):
 * sessionStorage is per-tab, not a live-shared channel. Duplicating a tab
 * copies its sessionStorage at the moment of duplication, but every write
 * after that point is local to the tab that made it — two tabs sharing the
 * same "copy" diverge from their very next save. Nothing in this module
 * claims otherwise: every function here recovers state within the ONE tab
 * that wrote it, on reload of that same tab, and nothing more. Real
 * cross-tab coordination (e.g. "block a second tab from double-submitting
 * the same draft") would need a BroadcastChannel or a small non-PII
 * localStorage lease — designed as a recommendation for CHECKPOINT C2F-D,
 * not implemented here, since nothing in this storage layer requires it for
 * correctness.
 */

/**
 * Storage key is never renamed across schema versions: the payload's own
 * `version` field is what drives migration, not the key name. A key rename
 * would make every already-open tab's v1 draft permanently invisible to
 * this code (it would look for a different key and simply never find it) —
 * a silent, undetectable loss of exactly the recovery data this module
 * exists to preserve. "msm-quote-draft-v1" is a literal, not a live version
 * marker; it stays exactly as CHECKPOINT C2F-A shipped it.
 */
const DRAFT_KEY = "msm-quote-draft-v1";
/** F-13: a stale draft (e.g. from a much earlier visit) is discarded rather than silently resumed. Applies to the submission-attempt recovery state too — both live in the one envelope below and share the one savedAt. */
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;

const optionalString = z.string().optional().catch(undefined);
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values).optional().catch(undefined);
}

/**
 * Mirrors QuoteFormValues minus the two File[] fields (`sellerPhotos`,
 * `buyerDocuments`) — files never survive a reload, only their presence is
 * remembered (`hadSellerPhotos`/`hadBuyerDocuments`) so the UI can prompt the
 * user to re-select them.
 */
const draftValuesSchema = z.object({
  intent: optionalEnum(QUOTE_INTENTS),
  material: optionalEnum(QUOTE_MATERIAL_KEYS),
  subtype: optionalString,
  subtypeOtherText: optionalString,
  otherMaterialText: optionalString,
  materialSpec: optionalString,
  sellerQuantityValue: optionalString,
  sellerQuantityUnit: optionalEnum(QUOTE_UNITS),
  sellerQuantityUnitOther: optionalString,
  sellerQuantityUnsure: z.boolean().optional().catch(undefined),
  sellerCondition: optionalEnum(CONDITIONS),
  sellerDescription: optionalString,
  buyerQuantityValue: optionalString,
  buyerQuantityUnit: optionalEnum(QUOTE_UNITS),
  buyerQuantityUnitOther: optionalString,
  buyerTradeRequirement: optionalEnum(QUOTE_TRADE_ROUTES),
  buyerRequiredByDate: optionalString,
  buyerAdditionalSpec: optionalString,
  sellerEmirate: optionalEnum(EMIRATES),
  sellerArea: optionalString,
  sellerMapLink: optionalString,
  sellerPickupRequired: optionalEnum(PICKUP_CHOICES),
  sellerPickupDate: optionalString,
  sellerAccessNote: optionalString,
  buyerDestinationEmirate: optionalEnum(EMIRATES),
  buyerDestinationArea: optionalString,
  buyerDestinationMapLink: optionalString,
  buyerFulfilment: optionalEnum(FULFILMENT_CHOICES),
  buyerDestinationCountry: optionalString,
  buyerDestinationCityPort: optionalString,
  buyerPreferredPort: optionalEnum(PREFERRED_PORTS),
  buyerPreferredPortOther: optionalString,
  buyerOriginCountryPreference: optionalString,
  buyerLogisticsRequirement: optionalEnum(FULFILMENT_CHOICES),
  buyerLogisticsNote: optionalString,
  sellerName: optionalString,
  sellerPhone: optionalString,
  sellerCompany: optionalString,
  sellerEmail: optionalString,
  sellerPreferredContact: optionalEnum(PREFERRED_CONTACTS),
  sellerNotes: optionalString,
  buyerCompany: optionalString,
  buyerContactPerson: optionalString,
  buyerPhone: optionalString,
  buyerEmail: optionalString,
  buyerPreferredContact: optionalEnum(PREFERRED_CONTACTS),
  buyerNotes: optionalString,
});

export type QuoteDraftValues = z.infer<typeof draftValuesSchema>;

/** Recognized only to migrate forward — see readEnvelope. Never written by this build. */
const draftEnvelopeSchemaV1 = z.object({
  version: z.literal(1),
  step: z.number().int().min(1).max(6).catch(1),
  values: draftValuesSchema,
  hadSellerPhotos: z.boolean().catch(false),
  hadBuyerDocuments: z.boolean().catch(false),
  savedAt: z.number().catch(0),
});

const CURRENT_DRAFT_VERSION = 2;

/**
 * Deliberately camelCase (matching every other field in this module) rather
 * than canonicalize.ts's snake_case CanonicalFileDeclaration — this is a
 * storage-envelope shape, not the wire contract. Only the three
 * declared-metadata fields: never a File/Blob, previewUrl, objectUrl or any
 * Storage object path.
 */
const persistedFileDeclarationSchema = z
  .object({
    originalFilename: z.string(),
    declaredMimeType: z.string(),
    declaredByteSize: z.number(),
  })
  .strict();

export type PersistedFileDeclaration = z.infer<typeof persistedFileDeclarationSchema>;

/**
 * Mirrors initiate's UploadSlotResponse (src/server/quote/initiate-quote.ts)
 * minus `storagePath` — a Storage object path must never be written to
 * sessionStorage. Everything else kept here is small, display-only
 * metadata: enough to know which slot is which, what was declared for it,
 * and (as of CHECKPOINT C2F-C1) its authoritative server-confirmed status —
 * never anything usable to address an object in the bucket directly.
 *
 * `status` is a strict enum, not a bare string, for the same fail-closed
 * reason every other schema in this module is strict: a corrupt or
 * unrecognized value here must invalidate this one persisted slot (via this
 * field's own parse failure propagating up to submissionAttemptSchema's
 * `.catch(NONE_ATTEMPT)`), never be silently accepted and later
 * misinterpreted as some particular recovery state.
 */
const persistedUploadSlotSchema = z
  .object({
    slotId: z.string(),
    slotIndex: z.number().int(),
    kind: z.enum(["seller_photo", "buyer_document"]),
    status: z.enum(["pending", "uploading", "verified", "failed", "expired"]),
    expiresAt: z.string(),
    originalFilename: z.string(),
    declaredMimeType: z.string(),
    declaredByteSize: z.number(),
  })
  .strict();

export type PersistedUploadSlot = z.infer<typeof persistedUploadSlotSchema>;

/**
 * Discriminated union, not one all-or-nothing object: a leadId/reference/
 * uploadSlots set genuinely does not exist until initiate has actually
 * succeeded, so a single flat optional-everything shape would let invalid
 * states (e.g. a leadId with no idempotencyKey) type-check. "none" is the
 * default/absent state; "pre_initiate" exists once an identity has been
 * computed but initiate has not yet been (successfully) called;
 * "initiated" exists only after a real server response — never inferred,
 * never assumed from a stale reference.
 */
const submissionAttemptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("pre_initiate"),
      idempotencyKey: z.string().uuid(),
      payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
      files: z.array(persistedFileDeclarationSchema).max(MAX_FILES),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("initiated"),
      idempotencyKey: z.string().uuid(),
      payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
      files: z.array(persistedFileDeclarationSchema).max(MAX_FILES),
      leadId: z.string().uuid(),
      /**
       * Display continuity only (e.g. "Welcome back — MSM-000123"). Nothing
       * in this module, or anywhere reading this envelope, ever treats the
       * mere presence of leadId/reference as proof a submission succeeded —
       * that can only ever come from a genuine server response (an
       * initiate call, replay or fresh). A tampered or stale value here
       * changes only what is displayed, never any success/completion state.
       */
      reference: z.string(),
      uploadSlots: z.array(persistedUploadSlotSchema).max(MAX_FILES),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .strict(),
]);

export type QuoteSubmissionAttempt = z.infer<typeof submissionAttemptSchema>;

const NONE_ATTEMPT: QuoteSubmissionAttempt = { kind: "none" };

/**
 * In-memory mirror of the attempt slice, consulted by loadSubmissionAttempt
 * whenever a real-storage read can't be trusted — see that function's own
 * doc comment near the bottom of this file for the full explanation of why
 * this exists and its exact limits. Declared here (rather than next to
 * loadSubmissionAttempt) so readEnvelope below — which must reset it
 * whenever it confirms the real envelope is genuinely absent/discarded, not
 * just when a read throws — can reference it without a forward-declaration
 * gap.
 */
let memoryAttemptFallback: QuoteSubmissionAttempt = NONE_ATTEMPT;

const draftEnvelopeSchemaV2 = z.object({
  version: z.literal(CURRENT_DRAFT_VERSION),
  step: z.number().int().min(1).max(6).catch(1),
  values: draftValuesSchema,
  hadSellerPhotos: z.boolean().catch(false),
  hadBuyerDocuments: z.boolean().catch(false),
  savedAt: z.number().catch(0),
  attempt: submissionAttemptSchema.catch(NONE_ATTEMPT),
});

export type QuoteDraftEnvelope = z.infer<typeof draftEnvelopeSchemaV2>;

/**
 * MEASURED GAP (found tracing the QT-CLI client_exception path, not
 * reproduced on any specific device): every other sessionStorage touch in
 * this file is already try/catch-guarded (readEnvelope/writeEnvelope/
 * clearQuoteDraft/clearSubmissionAttempt) — this check was the one
 * exception. Merely accessing `window.sessionStorage` as a property (never
 * mind calling a method on it) is documented WebKit/browser behavior to
 * throw a SecurityError in some storage-restricted contexts — notably some
 * in-app WebViews (e.g. opening a link from inside another app), which can
 * impose stricter storage sandboxing than either a standalone browser app
 * or Safari itself. `typeof x` does not suppress an exception thrown by
 * evaluating `x` when `x` is a property access with a throwing getter — only
 * bare, undeclared identifiers are exception-safe under `typeof`. Fails
 * closed to "not usable" rather than propagating, exactly like every sibling
 * guard in this file already does.
 */
function isBrowser(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Reads and migrates whatever is currently in storage to the current (v2)
 * envelope shape, or null if there is nothing usable. This is the ONE place
 * version migration happens — every exported read/write function below
 * goes through it, so a v1 draft saved before this checkpoint is never
 * silently invisible to a new build. Malformed JSON, a schema mismatch
 * against every known version (including an unknown future version), or an
 * expired save all fail closed to null rather than throwing.
 */
/**
 * Shared by every "the stored envelope is being discarded" branch in
 * readEnvelope below (malformed JSON, unknown/corrupt version, expired).
 * MEASURED GAP, fixed — each of these used to removeItem the real envelope
 * without telling memoryAttemptFallback, so a STALE in-memory attempt
 * could outlive a confirmed-discarded real one and get incorrectly
 * resurrected by loadSubmissionAttempt's own fallback (caught by
 * quote-storage.test.ts's existing "clearQuoteDraft... together" test).
 * This is a CONFIRMED discard, never an ambiguous failure, so resetting
 * the mirror here is always correct, never a guess.
 */
function discardEnvelopeAndReportNone(): null {
  memoryAttemptFallback = NONE_ATTEMPT;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore — nothing more we can do if storage itself is unreachable.
  }
  return null;
}

function readEnvelope(): QuoteDraftEnvelope | null {
  if (!isBrowser()) return null;
  // MEASURED GAP — a DIFFERENT failure mode from isBrowser()'s own gap
  // (already fixed): here the `window.sessionStorage` property access
  // itself succeeds (isBrowser() correctly reports true), but getItem
  // ITSELF throws — e.g. a storage policy that allows accessing the
  // object but denies actual reads/writes. This was the one storage
  // operation in this file not already guarded; every other one (including
  // setItem below) already fails closed to null/no-op instead of
  // propagating. Deliberately does NOT reset memoryAttemptFallback here —
  // a throw is an AMBIGUOUS failure (unlike the confirmed discards below),
  // which is exactly the case the fallback exists for.
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    // MEASURED GAP, fixed — a null `raw` is NOT the confirmed-empty signal
    // this comment used to claim. getItem returning null is observably
    // identical whether (a) nothing was ever saved this page load — mirror
    // is already NONE_ATTEMPT, its default, so leaving it alone changes
    // nothing — or (b) a prior saveSubmissionAttempt DID run but its
    // setItem silently threw (writeEnvelope's own guard swallows that),
    // so nothing ever actually persisted even though a save was intended.
    // Resetting the mirror here used to treat (b) as (a), erasing exactly
    // the in-memory record this fallback exists to preserve — every
    // subsequent loadSubmissionAttempt() call in the SAME failure mode
    // hits this same branch again and re-erases it, so even a same-page
    // retry immediately after a successful initiate+save would see no
    // existing attempt and mint a brand-new idempotency key. No code path
    // in this module ever removes the real key without also explicitly
    // resetting the mirror itself (clearQuoteDraft, clearSubmissionAttempt,
    // discardEnvelopeAndReportNone below all do) — so there is no genuine
    // discard this branch alone needs to detect; leaving the mirror
    // untouched here is always safe.
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    // Fix 12 (carried over): malformed JSON must not linger forever.
    return discardEnvelopeAndReportNone();
  }

  let envelope: QuoteDraftEnvelope;
  const v2 = draftEnvelopeSchemaV2.safeParse(parsedJson);
  if (v2.success) {
    envelope = v2.data;
  } else {
    const v1 = draftEnvelopeSchemaV1.safeParse(parsedJson);
    if (!v1.success) {
      // Neither the current version nor the one known prior version —
      // corrupt, partial, or an unknown future version. Fail closed.
      return discardEnvelopeAndReportNone();
    }
    envelope = {
      version: CURRENT_DRAFT_VERSION,
      step: v1.data.step,
      values: v1.data.values,
      hadSellerPhotos: v1.data.hadSellerPhotos,
      hadBuyerDocuments: v1.data.hadBuyerDocuments,
      savedAt: v1.data.savedAt,
      attempt: NONE_ATTEMPT,
    };
  }

  if (Date.now() - envelope.savedAt > DRAFT_EXPIRY_MS) {
    return discardEnvelopeAndReportNone();
  }
  return envelope;
}

function writeEnvelope(envelope: QuoteDraftEnvelope): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // Storage full/unavailable (private mode, quota) — draft simply won't persist.
  }
}

export function saveQuoteDraft(step: number, values: QuoteFormValues): void {
  if (!isBrowser()) return;
  const { sellerPhotos, buyerDocuments, ...rest } = values;
  // Read-modify-write: a submission attempt (if any) is preserved across
  // ordinary typed-answer saves. Whether it should instead be invalidated
  // because the payload materially changed is a separate decision —
  // reconcileSubmissionAttempt below, driven by a freshly computed hash,
  // not this synchronous save.
  const existing = readEnvelope();
  writeEnvelope({
    version: CURRENT_DRAFT_VERSION,
    step,
    values: rest,
    hadSellerPhotos: sellerPhotos.length > 0,
    hadBuyerDocuments: buyerDocuments.length > 0,
    savedAt: Date.now(),
    attempt: existing?.attempt ?? NONE_ATTEMPT,
  });
}

export function loadQuoteDraft(): QuoteDraftEnvelope | null {
  return readEnvelope();
}

/** Genuine success or Start Over: clears typed answers AND submission identity together — never one without the other. */
export function clearQuoteDraft(): void {
  // MEASURED GAP, fixed — this removes the ENTIRE envelope, attempt slice
  // included, but previously only via the real sessionStorage key, never
  // telling memoryAttemptFallback — leaving it stale and able to be
  // incorrectly resurrected by loadSubmissionAttempt's own fallback (see
  // discardEnvelopeAndReportNone's comment for the same class of bug).
  // Unconditional, matching saveSubmissionAttempt's own mirroring: clearing
  // the draft always means "no attempt exists anymore" for this page's own
  // bookkeeping, regardless of whether the real removeItem below succeeds.
  memoryAttemptFallback = NONE_ATTEMPT;
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore — nothing to clean up if storage isn't reachable.
  }
}

// ---------------------------------------------------------------------------
// Submission-attempt recovery state (CHECKPOINT C2F-C)
// ---------------------------------------------------------------------------

/**
 * MEASURED GAP (found auditing the storage-unavailable retry path) — two
 * DIFFERENT failure modes both land here, and BOTH were confirmed
 * empirically (not just reasoned about) to mint a fresh idempotency key on
 * every retry without this fallback:
 *
 * 1. isBrowser() is false (the property access itself throws, already
 *    fixed there) — every load/save becomes a silent no-op.
 * 2. isBrowser() is TRUE (the property access succeeds) but getItem/
 *    setItem themselves throw — e.g. a storage policy that allows
 *    accessing the object but denies actual reads/writes. Even after
 *    guarding getItem/setItem individually (see readEnvelope/
 *    writeEnvelope — getItem fails closed to null, setItem's failure was
 *    already swallowed), a save that silently fails to persist is
 *    indistinguishable from "nothing was ever saved" on the next read,
 *    UNLESS something else remembers it for this page's own lifetime.
 *
 * Either way, resolveIdempotencyKey can only reuse an existing key by
 * finding one via loadSubmissionAttempt — if it always reports "none" (or
 * silently loses what WAS just saved), a retry of the exact same
 * still-open submission (same form values, same payload hash) mints a
 * BRAND-NEW crypto.randomUUID() every single call. transport.initiate's
 * idempotent-replay guarantee is keyed on (idempotencyKey, payloadHash)
 * together, so a different key on retry is a genuinely new request to the
 * server — risking a second lead for one real submission.
 *
 * Scope: only the ATTEMPT slice (idempotency key + server-confirmed
 * recovery state) — never the typed-answer draft, which has no equivalent
 * duplicate-request risk and is left to keep degrading to a plain no-op
 * (resuming typed answers after a reload simply can't work without real
 * storage, an acceptable, pre-existing limitation; minting a second lead
 * is not). This mirror only survives for this page's lifetime, same as
 * every other module-level variable here — it cannot and does not survive
 * a RELOAD. With no durable storage available at all, a reload followed by
 * a retry of "the same enquiry" is a real, unmitigated duplicate-lead risk
 * this file cannot close — there is no durable medium left to remember the
 * key across that specific disruption. This fallback only fixes retrying
 * WITHOUT reloading, which is what the UI's own Retry button actually
 * does — it is not, and must never be described as, a guarantee against
 * duplicates after a reload in a storage-unavailable browser.
 *
 * (The variable itself — memoryAttemptFallback — is declared earlier in
 * this file, right after NONE_ATTEMPT, so readEnvelope can also reset it
 * whenever it confirms the real envelope is genuinely gone.)
 */
export function loadSubmissionAttempt(): QuoteSubmissionAttempt {
  if (!isBrowser()) return memoryAttemptFallback;
  // readEnvelope() returning no attempt is ambiguous between "genuinely
  // nothing saved yet this page load" and "a save silently failed to
  // persist" (writeEnvelope's own setItem guard swallows that failure) —
  // the in-memory mirror (kept in sync on every save, below) resolves
  // that ambiguity in favor of whatever this page's own most recent save
  // actually intended, never in favor of treating a failed write as if it
  // had cleared the attempt.
  return readEnvelope()?.attempt ?? memoryAttemptFallback;
}

/**
 * Writes only the attempt slice; typed answers (values/step/hadXFiles) are
 * read back from current storage and preserved untouched. If no draft
 * envelope exists yet, a fresh one is created at step 1 with empty values —
 * defensive only; the real wizard flow always saves typed answers (via
 * saveQuoteDraft) well before any submission identity is ever computed.
 *
 * Mirrors into memoryAttemptFallback unconditionally, even when storage
 * appears available — cheap insurance against the exact "property access
 * works, but the write itself silently fails" case above, which this
 * function alone cannot detect (writeEnvelope's setItem guard already
 * swallows that failure, by design, for the typed-answer draft's sake).
 */
export function saveSubmissionAttempt(attempt: QuoteSubmissionAttempt): void {
  memoryAttemptFallback = attempt;
  if (!isBrowser()) return;
  const existing = readEnvelope();
  writeEnvelope({
    version: CURRENT_DRAFT_VERSION,
    step: existing?.step ?? 1,
    values: existing?.values ?? {},
    hadSellerPhotos: existing?.hadSellerPhotos ?? false,
    hadBuyerDocuments: existing?.hadBuyerDocuments ?? false,
    savedAt: Date.now(),
    attempt,
  });
}

export function clearSubmissionAttempt(): void {
  saveSubmissionAttempt(NONE_ATTEMPT);
}

/**
 * The one place "did the form change enough to invalidate a stored
 * idempotency key" is decided: given the payload hash freshly recomputed
 * from current form state, a stored pre_initiate/initiated attempt whose
 * own payloadHash no longer matches is stale and is cleared here — but
 * typed answers are never touched, only the attempt slice. Returns
 * whichever attempt is current after this call (the still-valid existing
 * one, or {kind:"none"} after a clear) so callers don't need a second read.
 */
export function reconcileSubmissionAttempt(currentPayloadHash: string): QuoteSubmissionAttempt {
  const attempt = loadSubmissionAttempt();
  if (attempt.kind === "none" || attempt.payloadHash === currentPayloadHash) {
    return attempt;
  }
  clearSubmissionAttempt();
  return NONE_ATTEMPT;
}

/** Maps initiate's UploadSlotResponse-shaped data to the persisted (storagePath-free) form. Small enough to inline at call sites, but kept here as the one place the field list is written down, next to persistedUploadSlotSchema itself. */
export function toPersistedUploadSlot(slot: {
  slotId: string;
  slotIndex: number;
  kind: "seller_photo" | "buyer_document";
  status: "pending" | "uploading" | "verified" | "failed" | "expired";
  expiresAt: string;
  originalFilename: string;
  declaredMimeType: string;
  declaredByteSize: number;
}): PersistedUploadSlot {
  return {
    slotId: slot.slotId,
    slotIndex: slot.slotIndex,
    kind: slot.kind,
    status: slot.status,
    expiresAt: slot.expiresAt,
    originalFilename: slot.originalFilename,
    declaredMimeType: slot.declaredMimeType,
    declaredByteSize: slot.declaredByteSize,
  };
}

/**
 * PersistedFileDeclaration (this module) and RecoverableFileDeclaration
 * (quote-file-recovery.ts) are structurally identical by design — the same
 * three fields, nothing extra either side would need stripped — so a
 * PersistedFileDeclaration[] can be passed directly to determineFileRecoveryStatus
 * / doesFileMatchDeclaration with no conversion step.
 */
