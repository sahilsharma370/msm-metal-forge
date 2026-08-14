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

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
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
function readEnvelope(): QuoteDraftEnvelope | null {
  if (!isBrowser()) return null;
  const raw = window.sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    // Fix 12 (carried over): malformed JSON must not linger forever.
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore — nothing more we can do if storage itself is unreachable.
    }
    return null;
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
      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // Ignore.
      }
      return null;
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
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore.
    }
    return null;
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

export function loadSubmissionAttempt(): QuoteSubmissionAttempt {
  return readEnvelope()?.attempt ?? NONE_ATTEMPT;
}

/**
 * Writes only the attempt slice; typed answers (values/step/hadXFiles) are
 * read back from current storage and preserved untouched. If no draft
 * envelope exists yet, a fresh one is created at step 1 with empty values —
 * defensive only; the real wizard flow always saves typed answers (via
 * saveQuoteDraft) well before any submission identity is ever computed.
 */
export function saveSubmissionAttempt(attempt: QuoteSubmissionAttempt): void {
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
