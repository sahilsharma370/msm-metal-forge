import { z } from "zod";
import type {
  QuoteIntent,
  QuoteInitialContext,
  QuoteMaterialKey,
  QuoteTradeRoute,
} from "./quote-search";
import {
  CONDITIONS,
  EMIRATES,
  FULFILMENT_CHOICES,
  PICKUP_CHOICES,
  PREFERRED_CONTACTS,
  PREFERRED_PORTS,
  QUOTE_UNITS,
} from "./quote-options";

/** A locally-selected photo/document. Never leaves the browser in this pass. */
export interface QuoteLocalFile {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
}

/**
 * Full wizard shape. Every field is optional at the react-hook-form level —
 * branching (seller vs buyer, local vs import/export) means no single step
 * owns a fixed set of required fields, so "required-ness" is enforced by the
 * per-step zod schemas below (run manually on Continue), not by a single
 * whole-form resolver.
 */
export interface QuoteFormValues {
  intent?: QuoteIntent | undefined;

  material?: QuoteMaterialKey | undefined;
  subtype?: string | undefined;
  subtypeOtherText?: string | undefined;
  otherMaterialText?: string | undefined;
  materialSpec?: string | undefined;

  sellerQuantityValue?: string | undefined;
  sellerQuantityUnit?: (typeof QUOTE_UNITS)[number] | undefined;
  sellerQuantityUnitOther?: string | undefined;
  sellerQuantityUnsure?: boolean | undefined;
  sellerCondition?: (typeof CONDITIONS)[number] | undefined;
  sellerDescription?: string | undefined;

  buyerQuantityValue?: string | undefined;
  buyerQuantityUnit?: (typeof QUOTE_UNITS)[number] | undefined;
  buyerQuantityUnitOther?: string | undefined;
  buyerTradeRequirement?: QuoteTradeRoute | undefined;
  buyerRequiredByDate?: string | undefined;
  buyerAdditionalSpec?: string | undefined;

  sellerEmirate?: (typeof EMIRATES)[number] | undefined;
  sellerArea?: string | undefined;
  sellerMapLink?: string | undefined;
  sellerPickupRequired?: (typeof PICKUP_CHOICES)[number] | undefined;
  sellerPickupDate?: string | undefined;
  sellerAccessNote?: string | undefined;

  buyerDestinationEmirate?: (typeof EMIRATES)[number] | undefined;
  buyerDestinationArea?: string | undefined;
  buyerDestinationMapLink?: string | undefined;
  buyerFulfilment?: (typeof FULFILMENT_CHOICES)[number] | undefined;
  buyerDestinationCountry?: string | undefined;
  buyerDestinationCityPort?: string | undefined;
  buyerPreferredPort?: (typeof PREFERRED_PORTS)[number] | undefined;
  buyerPreferredPortOther?: string | undefined;
  buyerOriginCountryPreference?: string | undefined;
  buyerLogisticsRequirement?: (typeof FULFILMENT_CHOICES)[number] | undefined;
  buyerLogisticsNote?: string | undefined;

  sellerPhotos: QuoteLocalFile[];
  sellerName?: string | undefined;
  sellerPhone?: string | undefined;
  sellerCompany?: string | undefined;
  sellerEmail?: string | undefined;
  sellerPreferredContact?: (typeof PREFERRED_CONTACTS)[number] | undefined;
  sellerNotes?: string | undefined;

  buyerCompany?: string | undefined;
  buyerContactPerson?: string | undefined;
  buyerPhone?: string | undefined;
  buyerEmail?: string | undefined;
  buyerDocuments: QuoteLocalFile[];
  buyerPreferredContact?: (typeof PREFERRED_CONTACTS)[number] | undefined;
  buyerNotes?: string | undefined;
}

export function buildDefaultQuoteValues(context: QuoteInitialContext): QuoteFormValues {
  return {
    intent: context.intent,
    material: context.material,
    buyerTradeRequirement: context.tradeRoute,
    sellerQuantityUnsure: false,
    sellerPhotos: [],
    buyerDocuments: [],
  };
}

/* ------------------------------------------------------------------------ *
 * Shared validity predicates (F-07 / F-08) — the SAME functions drive step
 * validation (via the zod schemas below), Review/dev-preview gating and
 * readiness (quote-summary.ts imports these directly). There is exactly one
 * place that decides whether a phone/email/contact is valid.
 * ------------------------------------------------------------------------ */

function normalizePhoneDigits(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

/**
 * UAE numbers are checked against the real national length (+971 + 9 digits);
 * anything else falls back to a permissive-but-bounded international check
 * (8-15 digits) so legitimate overseas buyers are never blocked (E-09).
 */
export function isValidPhoneNumber(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  const digits = normalizePhoneDigits(trimmed);

  const looksUae = digits.startsWith("+971") || digits.startsWith("971") || digits.startsWith("05");
  if (looksUae) {
    const national = digits.startsWith("+971")
      ? digits.slice(4)
      : digits.startsWith("971")
        ? digits.slice(3)
        : digits.slice(1); // local 0-prefixed
    return /^\d{9}$/.test(national);
  }

  const intl = digits.startsWith("+") ? digits.slice(1) : digits;
  return /^\d{8,15}$/.test(intl);
}

export function isValidEmailAddress(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  return z.string().email().safeParse(trimmed).success;
}

/** Reused by materialStepSchema and readiness — a selected-but-unspecified "Other" never counts as valid. */
export function isMaterialComplete(
  material: QuoteMaterialKey | undefined,
  otherText: string | undefined,
): boolean {
  if (!material) return false;
  if (material === "other") return !!otherText?.trim();
  return true;
}

export function isSellerContactComplete(values: QuoteFormValues): boolean {
  if (!values.sellerName?.trim()) return false;
  if (!isValidPhoneNumber(values.sellerPhone)) return false;
  if (values.sellerEmail?.trim() && !isValidEmailAddress(values.sellerEmail)) return false;
  if (values.sellerPreferredContact === "email" && !isValidEmailAddress(values.sellerEmail))
    return false;
  if (!values.sellerPreferredContact) return false;
  return true;
}

export function isBuyerContactComplete(values: QuoteFormValues): boolean {
  if (!values.buyerContactPerson?.trim()) return false;
  if (!isValidPhoneNumber(values.buyerPhone)) return false;
  if (values.buyerEmail?.trim() && !isValidEmailAddress(values.buyerEmail)) return false;
  if (values.buyerPreferredContact === "email" && !isValidEmailAddress(values.buyerEmail))
    return false;
  if (!values.buyerPreferredContact) return false;
  if (values.buyerTradeRequirement !== "local" && !values.buyerCompany?.trim()) return false;
  return true;
}

/* ------------------------------------------------------------------------ */

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter your phone or WhatsApp number.")
  .refine((val) => isValidPhoneNumber(val), "Enter a valid phone or WhatsApp number.");

const optionalEmailSchema = z
  .string()
  .trim()
  .optional()
  .refine((val) => !val || isValidEmailAddress(val), "Enter a valid email.");

const requiredText = (message: string, min = 1) => z.string().trim().min(min, message);

/** Rejects blank/whitespace-only and single-character placeholder text (E-17 / E-18) while allowing short legitimate names. */
const meaningfulText = (message: string) => z.string().trim().min(2, message);

function isPastDate(value: string): boolean {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true; // unparsable is treated as invalid, not "past"
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime() < today.getTime();
}

/** Blank is valid; anything entered must look like a real link (C-03) — permissive enough for Google's various short/share URL shapes. */
const optionalMapLinkSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (val) => !val || /^https?:\/\/\S+\.\S+/i.test(val),
    "Enter a valid map link or leave this blank.",
  );

/** Optional date field: blank is valid, but an entered date must parse and must not be in the past (C-07 / D-07). */
const optionalFutureDateSchema = z
  .string()
  .trim()
  .optional()
  .refine((val) => !val || !Number.isNaN(new Date(val).getTime()), "Enter a valid date.")
  .refine((val) => !val || !isPastDate(val), "Choose today or a future date.");

export const enquiryTypeStepSchema = z.object({
  intent: z.enum(["sell", "buy"], { message: "Choose whether you want to sell or buy." }),
});

export const materialStepSchema = z
  .object({
    material: z.enum(["copper", "aluminium", "steel_iron", "lead", "other"], {
      message: "Select a material.",
    }),
    otherMaterialText: z.string().trim().optional(),
    subtype: z.string().trim().optional(),
    subtypeOtherText: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.material === "other" && !val.otherMaterialText?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherMaterialText"],
        message: "Describe the material.",
      });
    }
    if (val.subtype === "other" && !val.subtypeOtherText?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["subtypeOtherText"],
        message: "Describe the material type.",
      });
    }
  });

export const sellerDetailsStepSchema = z
  .object({
    sellerQuantityValue: z.string().trim().optional(),
    sellerQuantityUnit: z.enum(QUOTE_UNITS).optional(),
    sellerQuantityUnitOther: z.string().trim().optional(),
    sellerQuantityUnsure: z.boolean().optional(),
    sellerCondition: z.enum(CONDITIONS, { message: "Select the material condition." }),
  })
  .superRefine((val, ctx) => {
    if (val.sellerQuantityUnsure) return;
    if (!val.sellerQuantityValue?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerQuantityValue"],
        message: "Enter an approximate quantity or choose Not sure.",
      });
      // B-09: don't also flag the unit when the quantity value itself is missing.
      return;
    }
    const numeric = Number(val.sellerQuantityValue.trim());
    if (!Number.isFinite(numeric) || numeric <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerQuantityValue"],
        message: "Enter a quantity greater than zero.",
      });
      return;
    }
    if (!val.sellerQuantityUnit) {
      ctx.addIssue({ code: "custom", path: ["sellerQuantityUnit"], message: "Select a unit." });
      return;
    }
    if (val.sellerQuantityUnit === "other" && !val.sellerQuantityUnitOther?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerQuantityUnitOther"],
        message: "Specify the unit.",
      });
    }
  });

export const buyerDetailsStepSchema = z
  .object({
    buyerQuantityValue: requiredText("Enter the required quantity."),
    buyerQuantityUnit: z.enum(QUOTE_UNITS, { message: "Select a unit." }),
    buyerQuantityUnitOther: z.string().trim().optional(),
    buyerTradeRequirement: z.enum(["local", "import", "export"], {
      message: "Select a trade requirement.",
    }),
    buyerRequiredByDate: optionalFutureDateSchema,
    buyerAdditionalSpec: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    const numeric = Number(val.buyerQuantityValue.trim());
    if (!Number.isFinite(numeric) || numeric <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["buyerQuantityValue"],
        message: "Enter a quantity greater than zero.",
      });
    }
    if (val.buyerQuantityUnit === "other" && !val.buyerQuantityUnitOther?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["buyerQuantityUnitOther"],
        message: "Specify the unit.",
      });
    }
  });

export const sellerLogisticsStepSchema = z.object({
  sellerEmirate: z.enum(EMIRATES, { message: "Select an emirate." }),
  sellerArea: meaningfulText("Enter the area."),
  sellerMapLink: optionalMapLinkSchema,
  sellerPickupRequired: z.enum(PICKUP_CHOICES, { message: "Let us know if pickup is required." }),
  sellerPickupDate: optionalFutureDateSchema,
  sellerAccessNote: z.string().trim().optional(),
});

export const buyerLogisticsStepSchema = z
  .object({
    buyerTradeRequirement: z.enum(["local", "import", "export"]).optional(),
    buyerDestinationEmirate: z.enum(EMIRATES).optional(),
    buyerDestinationArea: z.string().trim().optional(),
    buyerDestinationMapLink: optionalMapLinkSchema,
    buyerFulfilment: z.enum(FULFILMENT_CHOICES).optional(),
    buyerDestinationCountry: z.string().trim().optional(),
    buyerDestinationCityPort: z.string().trim().optional(),
    buyerPreferredPort: z.enum(PREFERRED_PORTS).optional(),
    buyerPreferredPortOther: z.string().trim().optional(),
    buyerOriginCountryPreference: z.string().trim().optional(),
    buyerLogisticsRequirement: z.enum(FULFILMENT_CHOICES).optional(),
    buyerLogisticsNote: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.buyerTradeRequirement === "local") {
      if (!val.buyerDestinationEmirate) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationEmirate"],
          message: "Select a destination emirate.",
        });
      }
      if (!val.buyerDestinationArea?.trim() || val.buyerDestinationArea.trim().length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationArea"],
          message: "Enter the destination area.",
        });
      }
      if (!val.buyerFulfilment) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerFulfilment"],
          message: "Select a fulfilment option.",
        });
      }
    } else if (val.buyerTradeRequirement === "import") {
      if (!val.buyerDestinationEmirate) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationEmirate"],
          message: "Select the emirate the material should arrive in.",
        });
      }
      if (val.buyerPreferredPort === "other" && !val.buyerPreferredPortOther?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerPreferredPortOther"],
          message: "Enter the port name.",
        });
      }
      // D-27: a logistics choice is required across every branch; "Discuss with MSM" is the safe fallback.
      if (!val.buyerLogisticsRequirement) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerLogisticsRequirement"],
          message: "Select a logistics requirement.",
        });
      }
    } else if (val.buyerTradeRequirement === "export") {
      if (!val.buyerDestinationCountry?.trim() || val.buyerDestinationCountry.trim().length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationCountry"],
          message: "Enter the destination country.",
        });
      }
      if (!val.buyerDestinationCityPort?.trim() || val.buyerDestinationCityPort.trim().length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationCityPort"],
          message: "Enter the destination city or port.",
        });
      }
      // D-27 (HIGH-PRIORITY BUG): export previously allowed Continue with logistics left blank.
      if (!val.buyerLogisticsRequirement) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerLogisticsRequirement"],
          message: "Select a logistics requirement.",
        });
      }
    }
  });

export const sellerContactStepSchema = z
  .object({
    sellerName: requiredText("Enter your name."),
    sellerPhone: phoneSchema,
    sellerCompany: z.string().trim().optional(),
    sellerEmail: optionalEmailSchema,
    sellerPreferredContact: z.enum(PREFERRED_CONTACTS, {
      message: "Select a preferred contact method.",
    }),
    sellerNotes: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.sellerPreferredContact === "email" && !isValidEmailAddress(val.sellerEmail)) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerEmail"],
        message: "Enter a valid email — it's your preferred contact method.",
      });
    }
  });

export const buyerContactStepSchema = z
  .object({
    buyerCompany: z.string().trim().optional(),
    buyerContactPerson: requiredText("Enter the contact person's name."),
    buyerPhone: phoneSchema,
    buyerEmail: optionalEmailSchema,
    buyerPreferredContact: z.enum(PREFERRED_CONTACTS, {
      message: "Select a preferred contact method.",
    }),
    buyerNotes: z.string().trim().optional(),
    buyerTradeRequirement: z.enum(["local", "import", "export"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.buyerTradeRequirement !== "local" && !val.buyerCompany?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["buyerCompany"],
        message: "Company is required for import/export enquiries.",
      });
    }
    if (val.buyerPreferredContact === "email" && !isValidEmailAddress(val.buyerEmail)) {
      ctx.addIssue({
        code: "custom",
        path: ["buyerEmail"],
        message: "Enter a valid email — it's your preferred contact method.",
      });
    }
  });

export type QuoteStepSchema =
  | typeof enquiryTypeStepSchema
  | typeof materialStepSchema
  | typeof sellerDetailsStepSchema
  | typeof buyerDetailsStepSchema
  | typeof sellerLogisticsStepSchema
  | typeof buyerLogisticsStepSchema
  | typeof sellerContactStepSchema
  | typeof buyerContactStepSchema;

/** Returns the zod schema (and the field slice it validates) for a given step + branch. */
export function getStepSchema(
  step: number,
  intent: QuoteIntent | undefined,
): QuoteStepSchema | null {
  const isSeller = intent === "sell";
  switch (step) {
    case 1:
      return enquiryTypeStepSchema;
    case 2:
      return materialStepSchema;
    case 3:
      return isSeller ? sellerDetailsStepSchema : buyerDetailsStepSchema;
    case 4:
      return isSeller ? sellerLogisticsStepSchema : buyerLogisticsStepSchema;
    case 5:
      return isSeller ? sellerContactStepSchema : buyerContactStepSchema;
    default:
      return null;
  }
}
