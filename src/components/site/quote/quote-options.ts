import type { QuoteIntent, QuoteMaterialKey, QuoteTradeRoute } from "./quote-search";

/**
 * PROVISIONAL business config. Swap this number when a dedicated quote-desk
 * WhatsApp line is assigned — nothing else in the Quote Experience needs to
 * change, every WhatsApp handoff reads from here.
 */
export const QUOTE_WHATSAPP_NUMBER_PROVISIONAL = "971508491233";

export const QUOTE_UNITS = ["kg", "tonnes", "pieces", "load", "other"] as const;
export type QuoteUnit = (typeof QUOTE_UNITS)[number];
/** Deliberately compact — used both on the unit pills and in review/WhatsApp summaries ("500 kg", not "500 Kilograms"). */
export const UNIT_LABELS: Record<QuoteUnit, string> = {
  kg: "kg",
  tonnes: "tonnes",
  pieces: "pieces",
  load: "load",
  other: "other",
};

export const CONDITIONS = ["clean_separated", "mixed", "used_surplus", "not_sure"] as const;
export type QuoteCondition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<QuoteCondition, string> = {
  clean_separated: "Clean and separated",
  mixed: "Mixed or unsorted",
  used_surplus: "Used or surplus",
  not_sure: "Not sure",
};

export const PICKUP_CHOICES = ["yes", "no", "not_sure"] as const;
export type QuotePickupChoice = (typeof PICKUP_CHOICES)[number];
export const PICKUP_CHOICE_LABELS: Record<QuotePickupChoice, string> = {
  yes: "Yes",
  no: "No",
  not_sure: "Not sure",
};

export const EMIRATES = [
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
] as const;
export type QuoteEmirate = (typeof EMIRATES)[number];
export const EMIRATE_LABELS: Record<QuoteEmirate, string> = {
  abu_dhabi: "Abu Dhabi",
  dubai: "Dubai",
  sharjah: "Sharjah",
  ajman: "Ajman",
  umm_al_quwain: "Umm Al Quwain",
  ras_al_khaimah: "Ras Al Khaimah",
  fujairah: "Fujairah",
};

export const FULFILMENT_CHOICES = ["delivery", "collection", "discuss"] as const;
export type QuoteFulfilment = (typeof FULFILMENT_CHOICES)[number];
/** Actor-based copy (D-13) — subject to owner confirmation of exact wording. */
export const FULFILMENT_LABELS: Record<QuoteFulfilment, string> = {
  delivery: "MSM-arranged delivery",
  collection: "Buyer-arranged collection",
  discuss: "Discuss with MSM",
};

export const PREFERRED_CONTACTS = ["whatsapp", "call", "email"] as const;
export type QuotePreferredContact = (typeof PREFERRED_CONTACTS)[number];
export const PREFERRED_CONTACT_LABELS: Record<QuotePreferredContact, string> = {
  whatsapp: "WhatsApp",
  call: "Call",
  email: "Email",
};

/** Customer-facing, perspective-explicit route terminology (D-06). */
export const TRADE_REQUIREMENT_LABELS: Record<QuoteTradeRoute, string> = {
  local: "UAE local supply",
  import: "Import into UAE",
  export: "Export from UAE",
};

/** D-18: `other` (known but unlisted, reveals a port-name field) is kept separate from `no_preference` (genuinely unsure/open). */
export const PREFERRED_PORTS = ["jebel_ali", "khalifa_port", "other", "no_preference"] as const;
export type QuotePreferredPort = (typeof PREFERRED_PORTS)[number];
export const PREFERRED_PORT_LABELS: Record<QuotePreferredPort, string> = {
  jebel_ali: "Jebel Ali",
  khalifa_port: "Khalifa Port",
  other: "Other",
  no_preference: "No preference / Not sure",
};

export interface MaterialSubtype {
  value: string;
  label: string;
}

export interface MaterialFamily {
  key: QuoteMaterialKey;
  name: string;
  subtypes: MaterialSubtype[];
}

const NOT_SURE: MaterialSubtype = { value: "not_sure", label: "Not sure" };
const OTHER_SUBTYPE: MaterialSubtype = { value: "other", label: "Other" };

export const MATERIAL_FAMILIES: MaterialFamily[] = [
  {
    key: "copper",
    name: "Copper",
    subtypes: [
      { value: "wire_cable", label: "Wire & Cable" },
      { value: "pipes_coils", label: "Pipes & Coils" },
      { value: "radiators", label: "Radiators" },
      { value: "sheets", label: "Sheets" },
      OTHER_SUBTYPE,
      NOT_SURE,
    ],
  },
  {
    key: "aluminium",
    name: "Aluminium",
    subtypes: [
      { value: "profiles_frames", label: "Profiles & Frames" },
      { value: "sheets_panels", label: "Sheets & Panels" },
      { value: "cast_aluminium", label: "Cast Aluminium" },
      { value: "aluminium_cable", label: "Aluminium Cable" },
      OTHER_SUBTYPE,
      NOT_SURE,
    ],
  },
  {
    key: "steel_iron",
    name: "Steel & Iron",
    subtypes: [
      { value: "rebar_beams", label: "Rebar & Beams" },
      { value: "plates_pipes", label: "Plates & Pipes" },
      { value: "machinery_scrap", label: "Machinery Scrap" },
      { value: "sheet_metal", label: "Sheet Metal" },
      OTHER_SUBTYPE,
      NOT_SURE,
    ],
  },
  {
    key: "lead",
    name: "Lead",
    subtypes: [
      { value: "sheets_pipes", label: "Sheets & Pipes" },
      { value: "cable_sheathing", label: "Cable Sheathing" },
      { value: "wheel_weights", label: "Wheel Weights" },
      { value: "industrial_lead", label: "Industrial Lead" },
      OTHER_SUBTYPE,
      NOT_SURE,
    ],
  },
  {
    key: "other",
    name: "Other / Not listed",
    subtypes: [],
  },
];

export function getMaterialFamily(key: QuoteMaterialKey | undefined): MaterialFamily | undefined {
  return MATERIAL_FAMILIES.find((m) => m.key === key);
}

export function getMaterialLabel(key: QuoteMaterialKey | undefined): string | undefined {
  return getMaterialFamily(key)?.name;
}

export function getSubtypeLabel(
  materialKey: QuoteMaterialKey | undefined,
  subtypeValue: string | undefined,
): string | undefined {
  if (!subtypeValue) return undefined;
  const family = getMaterialFamily(materialKey);
  return family?.subtypes.find((s) => s.value === subtypeValue)?.label;
}

/**
 * Internal wizard steps (1-6) — unchanged since CHECKPOINT C2F. Still the
 * numbering `quote-schema.ts`'s per-step schemas and `quote-storage.ts`'s
 * persisted `step` field use; kept only for that internal bookkeeping. The
 * customer-facing presentation is now the 5-stage model below.
 */
export const QUOTE_STEP_NAMES = [
  "Enquiry Type",
  "Material",
  "Material Details",
  "Location & Logistics",
  "Photos, Documents & Contact",
  "Review Request",
] as const;

export const QUOTE_TOTAL_STEPS = QUOTE_STEP_NAMES.length;

/**
 * C2L-Q1 — the 5-stage customer-facing presentation. Stage 2 ("Material &
 * Requirements") merges the former internal steps 2 (Material) and 3
 * (Material Details) into one screen with one Continue gate; every other
 * stage maps 1:1 onto its internal step. See `stageOf` below for the exact
 * step->stage mapping, which doubles as the legacy-draft migration: a draft
 * saved by the old 6-step build (which may have `step: 3`) lands on exactly
 * the same stage a fresh 5-stage draft would, with no separate migration
 * pass needed — the mapping is a pure, stable function, so it can never
 * "re-migrate" a value that's already correct.
 */
/**
 * C2L-Q2 — short, compact labels for the header's progress segments only
 * (desktop shows all 5 side by side, mobile shows none — just the current
 * "Step X of 5 · <label>" text using this same set). The fuller,
 * branch-aware customer wording ("Location & collection" vs "Delivery
 * details", etc.) lives in `getStageEyebrow` below and is used inside each
 * stage's own content heading, not in this compact chrome.
 */
export const QUOTE_STAGE_NAMES = ["Request", "Material", "Logistics", "Contact", "Review"] as const;

export const QUOTE_TOTAL_STAGES = QUOTE_STAGE_NAMES.length;

/** old 1 -> new 1; old 2 or 3 -> new 2; old 4 -> new 3; old 5 -> new 4; old 6 -> new 5. */
export function stageOf(step: number): number {
  if (step <= 1) return 1;
  if (step <= 3) return 2;
  if (step === 4) return 3;
  if (step === 5) return 4;
  return 5;
}

/** The internal step to land on when *entering* a given stage (1-5) via Continue/Back/Edit — the one place stage<->step is inverted. */
export const STAGE_ENTRY_STEP: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 6 };

/**
 * C2L-Q2 — the branch-aware, customer-facing heading shown inside each
 * stage's own content (the "label-eyebrow" line above each stage's H2) —
 * distinct from the compact generic QUOTE_STAGE_NAMES used in the header
 * chrome. Every step component reads its own eyebrow from here so the
 * wording can't drift between components.
 */
export function getStageEyebrow(stage: number, intent: QuoteIntent | undefined): string {
  const isSeller = intent === "sell";
  switch (stage) {
    case 1:
      return "Request type";
    case 2:
      return "Material details";
    case 3:
      return isSeller ? "Location & collection" : "Delivery details";
    case 4:
      return isSeller ? "Contact & photos" : "Contact & documents";
    default:
      return "Review & send";
  }
}

/**
 * Display-only relabeling of the shared FULFILMENT_CHOICES enum for the
 * redesigned Location & Logistics stage — stored values (delivery/
 * collection/discuss) are unchanged; only the buyer-facing wording differs
 * by context (local/import share one clearer phrasing, export uses shipping
 * language). FULFILMENT_LABELS above is untouched and still used by
 * Review/WhatsApp copy.
 */
export const FULFILMENT_DISPLAY_LOCAL_IMPORT: Record<QuoteFulfilment, string> = {
  delivery: "MSM-arranged delivery",
  collection: "I'll arrange collection",
  discuss: "Discuss with MSM",
};
export const FULFILMENT_DISPLAY_EXPORT: Record<QuoteFulfilment, string> = {
  delivery: "MSM-arranged shipment",
  collection: "I'll arrange collection/shipping",
  discuss: "Discuss with MSM",
};

/** Display-only relabeling of buyerTradeRequirement for the "Supply route" pill group — stored values unchanged. */
export const TRADE_REQUIREMENT_DISPLAY_LABELS: Record<QuoteTradeRoute, string> = {
  local: "Within the UAE",
  import: "Import into the UAE",
  export: "Export from the UAE",
};
