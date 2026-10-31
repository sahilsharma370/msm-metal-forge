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

/**
 * Single shared phone normalizer for seller and buyer. Allowed input
 * characters: digits, one optional leading `+`, spaces, hyphens, parentheses
 * — anything else (letters, a second `+`, a `+` not at the start) fails the
 * character-set check below and is rejected outright.
 *
 * UAE forms (`05XXXXXXXX`, `9715XXXXXXXX`, `+9715XXXXXXXX`) all normalize to
 * the canonical `+9715XXXXXXXX` (mobile-prefix `5` + exactly 9 national
 * digits). Anything else must already carry a leading `+` and resolve to
 * 8-15 digits — a bare unprefixed digit string is never treated as an
 * international number, only as a possible (and here rejected) UAE local form.
 *
 * Returns the canonical `+<digits>` string, or `null` if invalid.
 */
export function normalizePhoneNumber(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) return null;

  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let uaeNational: string | null = null;
  if (hasLeadingPlus && digits.startsWith("971")) {
    uaeNational = digits.slice(3);
  } else if (!hasLeadingPlus && digits.startsWith("971") && digits.length > 9) {
    uaeNational = digits.slice(3);
  } else if (!hasLeadingPlus && digits.startsWith("0")) {
    uaeNational = digits.slice(1);
  }

  if (uaeNational !== null) {
    return /^5\d{8}$/.test(uaeNational) ? `+971${uaeNational}` : null;
  }

  if (!hasLeadingPlus) return null; // no bare unprefixed digit string is treated as international
  // E.164-style: total 8-15 digits, and the digits after the (already-stripped) `+`
  // must not themselves start with 0 (Fix 2 — a leading zero here is never a real
  // country calling code, e.g. "+0123456789" is not a valid international number).
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export function isValidPhoneNumber(raw: string | undefined): boolean {
  return normalizePhoneNumber(raw) !== null;
}

export function isValidEmailAddress(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return false;
  return z.string().email().safeParse(trimmed).success;
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

/**
 * `<input type="date">` always yields `YYYY-MM-DD`; parsing that as local
 * calendar components (not via `new Date(str)`, which reads it as UTC
 * midnight) avoids the previous-day shift in negative-UTC-offset timezones (Fix 9).
 *
 * `new Date(year, monthIndex, day)` silently *rolls over* an impossible date
 * (e.g. Feb 31 becomes Mar 3) instead of failing, so an impossible calendar
 * date must be caught by round-tripping the constructed date's own
 * year/month/day back against the input components (Fix 5).
 */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    const roundTrips =
      date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    return roundTrips ? date : null;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function isPastDate(value: string): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) return true; // unparsable is treated as invalid, not "past"
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime() < today.getTime();
}

/** Shared by `optionalFutureDateSchema` and readiness (Fix 3) — blank is valid, otherwise must parse and not be in the past. */
export function isValidOptionalDate(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return true;
  return parseDateOnly(trimmed) !== null && !isPastDate(trimmed);
}

/** Closed allowlist of real Google country-code TLD shapes — deliberately finite, never an open `[a-z.]+` wildcard (Fix 4). */
const GOOGLE_CCTLDS =
  "ae|co\\.uk|co\\.in|co\\.jp|co\\.za|com\\.au|com\\.sg|de|fr|it|es|nl|ca|com\\.br|co\\.kr|ru|ch|se|no|dk|fi|pl|pt|gr|ie|be|at|com\\.mx|com\\.tr|co\\.id|com\\.eg|co\\.ke|com\\.sa|qa|com\\.kw|com\\.pk|co\\.th|com\\.vn|com\\.ph|co\\.nz";
const GOOGLE_COUNTRY_HOST = new RegExp(`^(www\\.)?google\\.(${GOOGLE_CCTLDS})$`);
const GOOGLE_COUNTRY_MAPS_HOST = new RegExp(`^maps\\.google\\.(${GOOGLE_CCTLDS})$`);

/**
 * Blank is valid; anything entered must resolve to a genuine Google Maps
 * link. Every accepted host is checked by *exact* match (or a closed
 * country-TLD allowlist) rather than a permissive suffix pattern, so a
 * lookalike like `google.evil.com` or `maps.google.evil.com` — which would
 * pass a naive `/^google\.[a-z.]+$/`-style check — is rejected outright.
 */
export function isValidMapLink(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return true; // blank is valid — this only judges a *present* value
  if (!/^https?:\/\//i.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return path.startsWith("/maps"); // reject goo.gl shortlinks unrelated to Maps
  if (host === "maps.google.com") return true;
  if (host === "google.com" || host === "www.google.com") return path.startsWith("/maps");
  if (GOOGLE_COUNTRY_MAPS_HOST.test(host)) return true;
  if (GOOGLE_COUNTRY_HOST.test(host)) return path.startsWith("/maps");
  return false;
}

const optionalMapLinkSchema = z
  .string()
  .trim()
  .optional()
  .refine((val) => isValidMapLink(val), "Enter a valid Google Maps link or leave this blank.");

/** Optional date field: blank is valid, but an entered date must parse and must not be in the past (C-07 / D-07). */
const optionalFutureDateSchema = z
  .string()
  .trim()
  .optional()
  .refine((val) => !val || parseDateOnly(val) !== null, "Enter a valid date.")
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

/** Shared by the full buyer Details step schema AND the narrow quantity-only readiness schema below (Fix 2) — one place decides what "valid quantity" means. */
function refineBuyerQuantity(
  val: {
    buyerQuantityValue: string;
    buyerQuantityUnit: (typeof QUOTE_UNITS)[number];
    buyerQuantityUnitOther?: string | undefined;
  },
  ctx: z.RefinementCtx,
) {
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
}

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
  .superRefine(refineBuyerQuantity);

/**
 * Fix 2: the Buyer "Quantity" readiness row must reflect quantity/unit only —
 * NOT Trade route or Needed-by date, which live in `buyerDetailsStepSchema`
 * (used for the full Step-3 Continue gate) but have their own readiness rows
 * (Trade route) or only block Review, not this specific row (Needed-by date).
 */
const buyerQuantityOnlySchema = z
  .object({
    buyerQuantityValue: requiredText("Enter the required quantity."),
    buyerQuantityUnit: z.enum(QUOTE_UNITS, { message: "Select a unit." }),
    buyerQuantityUnitOther: z.string().trim().optional(),
  })
  .superRefine(refineBuyerQuantity);

export const sellerLogisticsStepSchema = z
  .object({
    sellerEmirate: z.enum(EMIRATES, { message: "Select an emirate." }),
    sellerArea: meaningfulText("Enter the area."),
    sellerMapLink: optionalMapLinkSchema,
    sellerPickupRequired: z.enum(PICKUP_CHOICES, {
      message: "Let us know if pickup is required.",
    }),
    // Validated conditionally below (Fix 6) — a stale/invalid date behind a
    // hidden "No"/"Not sure" choice must never block this step.
    sellerPickupDate: z.string().trim().optional(),
    sellerAccessNote: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.sellerPickupRequired !== "yes" || !val.sellerPickupDate) return;
    if (parseDateOnly(val.sellerPickupDate) === null) {
      ctx.addIssue({ code: "custom", path: ["sellerPickupDate"], message: "Enter a valid date." });
    } else if (isPastDate(val.sellerPickupDate)) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerPickupDate"],
        message: "Choose today or a future date.",
      });
    }
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

/** Fix 1: Company is optional/recommended on every buyer route (local, import, export) — never required. */
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
  })
  .superRefine((val, ctx) => {
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

/**
 * C2L-Q1 — Stage 2 ("Material & Requirements") merges the former steps 2
 * (Material) and 3 (Material Details) into one screen with one Continue
 * gate: an intersection schema that requires BOTH sides to pass. Zod's
 * `.and()` runs both schemas (including their own `superRefine` checks) and
 * merges every issue from both sides into one ZodError, each with its
 * original field `path` intact — `applyStageValidationIssues` in
 * QuoteExperience relies on that to set errors and focus the first invalid
 * field regardless of which of the two original steps it came from.
 */
export function getStage2Schema(intent: QuoteIntent | undefined) {
  return materialStepSchema.and(
    intent === "sell" ? sellerDetailsStepSchema : buyerDetailsStepSchema,
  );
}

export type QuoteStageSchema = QuoteStepSchema | ReturnType<typeof getStage2Schema>;

/**
 * C2L-Q1 — the single canonical resolver for the 5-stage presentation:
 * stage 1 = Enquiry Type, stage 2 = Material & Requirements (combined),
 * stage 3 = Location & Logistics, stage 4 = Contact & Evidence, stage 5 =
 * Review & Submit (no schema of its own — it only ever re-validates the
 * other four). Both the per-stage Continue gate and the submission-error
 * routing (`findFirstInvalidStage`) share this one function so they can
 * never disagree about what a given stage requires.
 */
export function getStageSchema(
  stage: number,
  intent: QuoteIntent | undefined,
): QuoteStageSchema | null {
  const isSeller = intent === "sell";
  switch (stage) {
    case 1:
      return enquiryTypeStepSchema;
    case 2:
      return getStage2Schema(intent);
    case 3:
      return isSeller ? sellerLogisticsStepSchema : buyerLogisticsStepSchema;
    case 4:
      return isSeller ? sellerContactStepSchema : buyerContactStepSchema;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------ *
 * Fix 3: readiness completeness predicates. Wherever a row maps 1:1 onto a
 * step schema, completeness is derived by parsing against that EXACT schema
 * (`safeParse`) instead of a hand-written mirror — this makes drift between
 * step validation and the readiness rail structurally impossible. Only the
 * seller Location/Pickup split (two rail rows sharing one schema) still needs
 * hand-written predicates; those reuse the same shared helpers the schema itself uses.
 * ------------------------------------------------------------------------ */

export function isMaterialComplete(values: QuoteFormValues): boolean {
  return materialStepSchema.safeParse(values).success;
}

export function isSellerMaterialDetailsComplete(values: QuoteFormValues): boolean {
  return sellerDetailsStepSchema.safeParse(values).success;
}

export function isBuyerQuantityComplete(values: QuoteFormValues): boolean {
  return buyerQuantityOnlySchema.safeParse(values).success;
}

export function isSellerLocationComplete(values: QuoteFormValues): boolean {
  if (!values.sellerEmirate) return false;
  if (!values.sellerArea || values.sellerArea.trim().length < 2) return false;
  if (!isValidMapLink(values.sellerMapLink)) return false;
  return true;
}

export function isSellerPickupComplete(values: QuoteFormValues): boolean {
  if (!values.sellerPickupRequired) return false;
  // Fix 6: a hidden date behind "No"/"Not sure" must never block Pickup readiness.
  if (values.sellerPickupRequired === "yes" && !isValidOptionalDate(values.sellerPickupDate)) {
    return false;
  }
  return true;
}

export function isBuyerDestinationComplete(values: QuoteFormValues): boolean {
  if (!values.buyerTradeRequirement) return false; // buyerLogisticsStepSchema validates nothing when the route itself is unset
  return buyerLogisticsStepSchema.safeParse(values).success;
}

export function isSellerContactComplete(values: QuoteFormValues): boolean {
  return sellerContactStepSchema.safeParse(values).success;
}

export function isBuyerContactComplete(values: QuoteFormValues): boolean {
  return buyerContactStepSchema.safeParse(values).success;
}
