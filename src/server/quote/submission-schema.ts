import { z } from "zod";
import {
  enquiryTypeStepSchema,
  materialStepSchema,
  sellerDetailsStepSchema,
  buyerDetailsStepSchema,
  sellerLogisticsStepSchema,
  buyerLogisticsStepSchema,
  sellerContactStepSchema,
  buyerContactStepSchema,
  normalizePhoneNumber,
} from "@/components/site/quote/quote-schema";
import {
  QUOTE_UNITS,
  CONDITIONS,
  PICKUP_CHOICES,
  EMIRATES,
  FULFILMENT_CHOICES,
  PREFERRED_CONTACTS,
  PREFERRED_PORTS,
} from "@/components/site/quote/quote-options";
import {
  QUOTE_INTENTS,
  QUOTE_MATERIAL_KEYS,
  QUOTE_SOURCES,
  QUOTE_TRADE_ROUTES,
} from "@/components/site/quote/quote-search";
import type { CanonicalJsonValue } from "./canonicalize";

/**
 * This is the exact set of keys create_website_quote_v1's own submission
 * shape check accepts (see the migration's `where k not in (...)` list) —
 * every one of the current frontend QuoteFormValues fields (minus
 * sellerPhotos/buyerDocuments, which travel separately as `files`) plus
 * `source`. Keeping this list identical to the RPC's is what "reject
 * unknown submission keys" actually means end to end: the same 48 names,
 * enforced independently at two layers, never a superset at either one.
 */
const SUBMISSION_KEYS = [
  "intent",
  "source",
  "material",
  "subtype",
  "subtypeOtherText",
  "otherMaterialText",
  "materialSpec",
  "sellerQuantityValue",
  "sellerQuantityUnit",
  "sellerQuantityUnitOther",
  "sellerQuantityUnsure",
  "sellerCondition",
  "sellerDescription",
  "buyerQuantityValue",
  "buyerQuantityUnit",
  "buyerQuantityUnitOther",
  "buyerTradeRequirement",
  "buyerRequiredByDate",
  "buyerAdditionalSpec",
  "sellerEmirate",
  "sellerArea",
  "sellerMapLink",
  "sellerPickupRequired",
  "sellerPickupDate",
  "sellerAccessNote",
  "buyerDestinationEmirate",
  "buyerDestinationArea",
  "buyerDestinationMapLink",
  "buyerFulfilment",
  "buyerDestinationCountry",
  "buyerDestinationCityPort",
  "buyerPreferredPort",
  "buyerPreferredPortOther",
  "buyerOriginCountryPreference",
  "buyerLogisticsRequirement",
  "buyerLogisticsNote",
  "sellerName",
  "sellerPhone",
  "sellerCompany",
  "sellerEmail",
  "sellerPreferredContact",
  "sellerNotes",
  "buyerCompany",
  "buyerContactPerson",
  "buyerPhone",
  "buyerEmail",
  "buyerPreferredContact",
  "buyerNotes",
] as const;

/** Buyer-only fields — mirrors leads_branch_field_isolation's buyer-field list (plus materialSpec) exactly, so "invalid branch" here means the same thing it means at the DB layer. */
const BUYER_ONLY_KEYS = [
  "buyerQuantityValue",
  "buyerQuantityUnit",
  "buyerQuantityUnitOther",
  "buyerTradeRequirement",
  "buyerRequiredByDate",
  "buyerAdditionalSpec",
  "buyerDestinationEmirate",
  "buyerDestinationArea",
  "buyerDestinationMapLink",
  "buyerFulfilment",
  "buyerDestinationCountry",
  "buyerDestinationCityPort",
  "buyerPreferredPort",
  "buyerPreferredPortOther",
  "buyerOriginCountryPreference",
  "buyerLogisticsRequirement",
  "buyerLogisticsNote",
  "buyerCompany",
  "buyerContactPerson",
  "buyerPhone",
  "buyerEmail",
  "buyerPreferredContact",
  "buyerNotes",
  "materialSpec",
] as const;

/** Seller-only fields — mirrors leads_branch_field_isolation's seller-field list exactly (sellerQuantityUnsure must be false/absent rather than simply absent, matching the DB constraint's own `seller_quantity_unsure = false` clause). */
const SELLER_ONLY_KEYS = [
  "sellerQuantityValue",
  "sellerQuantityUnit",
  "sellerQuantityUnitOther",
  "sellerCondition",
  "sellerDescription",
  "sellerEmirate",
  "sellerArea",
  "sellerMapLink",
  "sellerPickupRequired",
  "sellerPickupDate",
  "sellerAccessNote",
  "sellerName",
  "sellerPhone",
  "sellerCompany",
  "sellerEmail",
  "sellerPreferredContact",
  "sellerNotes",
] as const;

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();

/**
 * Shape/type layer only — declares what TYPE each field is, never a
 * requiredness rule (those all come from the reused step schemas below).
 * `.strict()` is what makes "reject unknown submission keys" happen for
 * free, with a clean zod issue, rather than a hand-rolled key-set scan.
 */
export const submissionShapeSchema = z
  .object({
    intent: z.enum(QUOTE_INTENTS),
    source: z.enum(QUOTE_SOURCES),
    material: z.enum(QUOTE_MATERIAL_KEYS),
    subtype: optionalTrimmed(60),
    subtypeOtherText: optionalTrimmed(200),
    otherMaterialText: optionalTrimmed(200),
    materialSpec: optionalTrimmed(300),
    sellerQuantityValue: optionalTrimmed(30),
    sellerQuantityUnit: z.enum(QUOTE_UNITS).optional(),
    sellerQuantityUnitOther: optionalTrimmed(60),
    sellerQuantityUnsure: z.boolean().optional(),
    sellerCondition: z.enum(CONDITIONS).optional(),
    sellerDescription: optionalTrimmed(2000),
    buyerQuantityValue: optionalTrimmed(30),
    buyerQuantityUnit: z.enum(QUOTE_UNITS).optional(),
    buyerQuantityUnitOther: optionalTrimmed(60),
    buyerTradeRequirement: z.enum(QUOTE_TRADE_ROUTES).optional(),
    buyerRequiredByDate: optionalTrimmed(10),
    buyerAdditionalSpec: optionalTrimmed(2000),
    sellerEmirate: z.enum(EMIRATES).optional(),
    sellerArea: optionalTrimmed(150),
    sellerMapLink: optionalTrimmed(2000),
    sellerPickupRequired: z.enum(PICKUP_CHOICES).optional(),
    sellerPickupDate: optionalTrimmed(10),
    sellerAccessNote: optionalTrimmed(500),
    buyerDestinationEmirate: z.enum(EMIRATES).optional(),
    buyerDestinationArea: optionalTrimmed(150),
    buyerDestinationMapLink: optionalTrimmed(2000),
    buyerFulfilment: z.enum(FULFILMENT_CHOICES).optional(),
    buyerDestinationCountry: optionalTrimmed(120),
    buyerDestinationCityPort: optionalTrimmed(120),
    buyerPreferredPort: z.enum(PREFERRED_PORTS).optional(),
    buyerPreferredPortOther: optionalTrimmed(120),
    buyerOriginCountryPreference: optionalTrimmed(120),
    buyerLogisticsRequirement: z.enum(FULFILMENT_CHOICES).optional(),
    buyerLogisticsNote: optionalTrimmed(2000),
    sellerName: optionalTrimmed(120),
    sellerPhone: optionalTrimmed(20),
    sellerCompany: optionalTrimmed(150),
    sellerEmail: optionalTrimmed(254),
    sellerPreferredContact: z.enum(PREFERRED_CONTACTS).optional(),
    sellerNotes: optionalTrimmed(2000),
    buyerCompany: optionalTrimmed(150),
    buyerContactPerson: optionalTrimmed(120),
    buyerPhone: optionalTrimmed(20),
    buyerEmail: optionalTrimmed(254),
    buyerPreferredContact: z.enum(PREFERRED_CONTACTS).optional(),
    buyerNotes: optionalTrimmed(2000),
  })
  .strict();

export type SubmissionShape = z.infer<typeof submissionShapeSchema>;

/**
 * Branch isolation, enforced at the API layer for a clean 400 instead of
 * only ever surfacing as an opaque DB constraint violation later. Mirrors
 * leads_branch_field_isolation field-for-field (see the lists above) — the
 * DB constraint remains the final authority regardless; this is the same
 * rule enforced earlier, not a different or weaker one.
 */
export const submissionSchema = submissionShapeSchema.superRefine((value, ctx) => {
  if (value.intent === "sell") {
    for (const key of BUYER_ONLY_KEYS) {
      if (value[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "This field is not valid for a sell enquiry.",
        });
      }
    }
  } else if (value.intent === "buy") {
    for (const key of SELLER_ONLY_KEYS) {
      if (value[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "This field is not valid for a buy enquiry.",
        });
      }
    }
    if (value.sellerQuantityUnsure === true) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerQuantityUnsure"],
        message: "This field is not valid for a buy enquiry.",
      });
    }
  }
});

/**
 * Full business-rule completeness — reuses the exact step schemas the
 * frontend itself validates Continue/Review against (materialStepSchema
 * plus the active branch's Details/Logistics/Contact schemas), mirroring
 * isReadyForReview's own composition in quote-summary.ts. This is
 * deliberately NOT a reimplementation: every requiredness rule here is the
 * same zod schema instance the browser runs, so there is no second,
 * potentially-drifting copy of "what a complete Quote submission requires".
 */
export function checkSubmissionCompleteness(value: SubmissionShape): z.ZodIssue[] {
  const issues: z.ZodIssue[] = [];
  const collect = (result: z.SafeParseReturnType<unknown, unknown>) => {
    if (!result.success) issues.push(...result.error.issues);
  };

  collect(enquiryTypeStepSchema.safeParse(value));
  collect(materialStepSchema.safeParse(value));

  if (value.intent === "sell") {
    collect(sellerDetailsStepSchema.safeParse(value));
    collect(sellerLogisticsStepSchema.safeParse(value));
    collect(sellerContactStepSchema.safeParse(value));
  } else if (value.intent === "buy") {
    collect(buyerDetailsStepSchema.safeParse(value));
    collect(buyerLogisticsStepSchema.safeParse(value));
    collect(buyerContactStepSchema.safeParse(value));
  }

  return issues;
}

// ---------------------------------------------------------------------------
// File declarations
// ---------------------------------------------------------------------------

/** Mirrors quote_upload_slots.declared_mime_type's CHECK constraint and QuotePhotoPicker's own (module-private) ACCEPTED_TYPES_WITH_PDF — kept in sync by hand since neither is exported for reuse. */
const FILE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
/** Mirrors quote_upload_slots.declared_byte_size's CHECK constraint (1..8388608) and QuotePhotoPicker's MAX_FILE_SIZE_BYTES. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 5;

/** Mirrors lead_files/quote_upload_slots.original_filename's CHECK constraint: bounded length, no control characters, no path separators. */
const fileDeclarationSchema = z
  .object({
    original_filename: z
      .string()
      .min(1)
      .max(255)
      // eslint-disable-next-line no-control-regex -- intentional: rejecting control characters is the point of this check.
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "Filename contains a control character.")
      .refine(
        (value) => !value.includes("/") && !value.includes("\\"),
        "Filename must not contain a path separator.",
      ),
    declared_mime_type: z.enum(FILE_MIME_TYPES),
    declared_byte_size: z.number().int().min(1).max(MAX_FILE_BYTES),
  })
  .strict();

export type FileDeclaration = z.infer<typeof fileDeclarationSchema>;

export const fileDeclarationsSchema = z.array(fileDeclarationSchema).max(MAX_FILES);

/** Mirrors quote_upload_slots_pdf_requires_buyer_document: a sell-intent lead's slots are always kind=seller_photo, which can never be a PDF. */
export function checkFilesAgainstIntent(
  intent: SubmissionShape["intent"],
  files: readonly FileDeclaration[],
): z.ZodIssue[] {
  if (intent !== "sell") return [];
  const issues: z.ZodIssue[] = [];
  files.forEach((file, index) => {
    if (file.declared_mime_type === "application/pdf") {
      issues.push({
        code: "custom",
        path: ["files", index, "declared_mime_type"],
        message: "PDF files are only accepted for buy enquiries.",
      });
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Top-level request body
// ---------------------------------------------------------------------------

/**
 * `.strict()` here is what makes "browser must not provide payload_hash"
 * true structurally: payloadHash/payload_hash is not a declared key, so any
 * attempt to send one is rejected as an unknown top-level key exactly like
 * any other unexpected field — there is no special-case code for it.
 *
 * `honeypot` is the C1 abuse-baseline field: optional, and the ONLY valid
 * value is an empty string. The current frontend never sends this key at
 * all (so it is simply absent, which `.optional()` accepts); a bot that
 * blindly fills every field it can see gets rejected here.
 */
export const initiateQuoteRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    submission: submissionSchema,
    files: fileDeclarationsSchema.default([]),
    honeypot: z.string().max(0, "Request rejected.").optional(),
  })
  .strict();

export type InitiateQuoteRequest = z.infer<typeof initiateQuoteRequestSchema>;

/**
 * Every one of the 48 known keys is always present in the output (absent ->
 * null), so the payload_hash computed from this is stable regardless of
 * whether the caller omitted a field or sent it as null, and so the same
 * object can be sent directly as create_website_quote_v1's p_submission
 * (whose own `->>'key'` extraction treats missing and null identically).
 *
 * CHECKPOINT C2F-B: sellerPhone/buyerPhone are additionally canonicalized
 * here via the same normalizePhoneNumber the frontend already validates
 * against (isValidPhoneNumber, used by phoneSchema in quote-schema.ts, is
 * itself defined as `normalizePhoneNumber(x) !== null` — the two can never
 * disagree). This is the ONE place both the payload_hash and
 * create_website_quote_v1's p_submission are produced from, so
 * canonicalizing here — rather than in initiate-quote.ts or on the raw
 * request — makes the canonical phone form part of both automatically, with
 * no second call site and no second normalization implementation.
 *
 * By the time this function runs, checkSubmissionCompleteness has already
 * required a present sellerPhone/buyerPhone to pass the exact same
 * phoneSchema check, so normalizePhoneNumber returning null here is not a
 * real runtime case — but the fallback keeps the original (already-
 * validated) text rather than silently discarding it, and branch isolation
 * (enforced upstream by submissionSchema's own superRefine) already
 * guarantees at most one of sellerPhone/buyerPhone is ever defined, so
 * normalizing one can never populate or affect the other.
 */
export function normalizeSubmission(value: SubmissionShape): { [key: string]: CanonicalJsonValue } {
  const normalized: { [key: string]: CanonicalJsonValue } = {};
  for (const key of SUBMISSION_KEYS) {
    const fieldValue = value[key];
    normalized[key] = fieldValue === undefined ? null : fieldValue;
  }
  if (typeof value.sellerPhone === "string") {
    normalized["sellerPhone"] = normalizePhoneNumber(value.sellerPhone) ?? value.sellerPhone;
  }
  if (typeof value.buyerPhone === "string") {
    normalized["buyerPhone"] = normalizePhoneNumber(value.buyerPhone) ?? value.buyerPhone;
  }
  return normalized;
}
