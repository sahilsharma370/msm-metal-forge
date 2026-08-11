import { z } from "zod";
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

const DRAFT_KEY = "msm-quote-draft-v1";
const DRAFT_VERSION = 1;
/** F-13: a stale draft (e.g. from a much earlier visit) is discarded rather than silently resumed. */
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

const draftEnvelopeSchema = z.object({
  version: z.literal(DRAFT_VERSION),
  step: z.number().int().min(1).max(6).catch(1),
  values: draftValuesSchema,
  hadSellerPhotos: z.boolean().catch(false),
  hadBuyerDocuments: z.boolean().catch(false),
  savedAt: z.number().catch(0),
});

export type QuoteDraftValues = z.infer<typeof draftValuesSchema>;
export type QuoteDraftEnvelope = z.infer<typeof draftEnvelopeSchema>;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function saveQuoteDraft(step: number, values: QuoteFormValues): void {
  if (!isBrowser()) return;
  const { sellerPhotos, buyerDocuments, ...rest } = values;
  const envelope: QuoteDraftEnvelope = {
    version: DRAFT_VERSION,
    step,
    values: rest,
    hadSellerPhotos: sellerPhotos.length > 0,
    hadBuyerDocuments: buyerDocuments.length > 0,
    savedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // Storage full/unavailable (private mode, quota) — draft simply won't persist.
  }
}

export function loadQuoteDraft(): QuoteDraftEnvelope | null {
  if (!isBrowser()) return null;
  const raw = window.sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = draftEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    if (Date.now() - result.data.savedAt > DRAFT_EXPIRY_MS) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return result.data;
  } catch {
    // Fix 12: malformed JSON (not just a schema/version mismatch) must not linger forever.
    try {
      window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore — nothing more we can do if storage itself is unreachable.
    }
    return null;
  }
}

export function clearQuoteDraft(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore — nothing to clean up if storage isn't reachable.
  }
}
