import type { QuoteMaterialKey, QuoteTradeRoute } from "./quote-search";

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

export const QUOTE_STEP_NAMES = [
  "Enquiry Type",
  "Material",
  "Material Details",
  "Location & Logistics",
  "Photos, Documents & Contact",
  "Review Request",
] as const;

export const QUOTE_TOTAL_STEPS = QUOTE_STEP_NAMES.length;
