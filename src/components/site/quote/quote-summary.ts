import {
  EMIRATE_LABELS,
  FULFILMENT_LABELS,
  PREFERRED_CONTACT_LABELS,
  TRADE_REQUIREMENT_LABELS,
  UNIT_LABELS,
  getMaterialLabel,
  getSubtypeLabel,
} from "./quote-options";
import type { QuoteFormValues } from "./quote-schema";

export type ReadinessState = "complete" | "needs_attention" | "not_added_yet" | "recommended";

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  /** The step this field lives on — used to tell "not yet visited" apart from "visited but incomplete". */
  step: number;
}

type RawReadiness = "complete" | "incomplete" | "recommended";

interface RawReadinessItem {
  key: string;
  label: string;
  step: number;
  raw: RawReadiness;
}

function resolveState(
  raw: RawReadiness,
  step: number,
  furthestStepReached: number,
): ReadinessState {
  if (raw === "complete") return "complete";
  if (raw === "recommended") return "recommended";
  return step > furthestStepReached ? "not_added_yet" : "needs_attention";
}

function materialComplete(values: QuoteFormValues): boolean {
  if (!values.material) return false;
  if (values.material === "other") return !!values.otherMaterialText?.trim();
  return true;
}

function sellerQuantityComplete(values: QuoteFormValues): boolean {
  return !!values.sellerQuantityValue?.trim() && !!values.sellerQuantityUnit;
}

function sellerLocationComplete(values: QuoteFormValues): boolean {
  return !!values.sellerEmirate && !!values.sellerArea?.trim();
}

function buyerDestinationComplete(values: QuoteFormValues): boolean {
  if (values.buyerTradeRequirement === "local") {
    return (
      !!values.buyerDestinationEmirate &&
      !!values.buyerDestinationArea?.trim() &&
      !!values.buyerFulfilment
    );
  }
  if (values.buyerTradeRequirement === "import") {
    return !!values.buyerDestinationEmirate;
  }
  if (values.buyerTradeRequirement === "export") {
    return !!values.buyerDestinationCountry?.trim() && !!values.buyerDestinationCityPort?.trim();
  }
  return false;
}

function buyerCompanyOk(values: QuoteFormValues): boolean {
  if (values.buyerTradeRequirement === "local") return true;
  return !!values.buyerCompany?.trim();
}

function getSellerReadinessRaw(values: QuoteFormValues): RawReadinessItem[] {
  return [
    {
      key: "enquiryType",
      label: "Enquiry type",
      step: 1,
      raw: values.intent === "sell" ? "complete" : "incomplete",
    },
    {
      key: "material",
      label: "Material",
      step: 2,
      raw: materialComplete(values) ? "complete" : "incomplete",
    },
    {
      key: "quantity",
      label: "Quantity",
      step: 3,
      raw: values.sellerQuantityUnsure
        ? "incomplete"
        : sellerQuantityComplete(values)
          ? "complete"
          : "incomplete",
    },
    {
      key: "location",
      label: "Location",
      step: 4,
      raw: sellerLocationComplete(values) ? "complete" : "incomplete",
    },
    {
      key: "pickup",
      label: "Pickup",
      step: 4,
      raw: values.sellerPickupRequired ? "complete" : "incomplete",
    },
    {
      key: "contact",
      label: "Contact details",
      step: 5,
      raw: values.sellerName?.trim() && values.sellerPhone?.trim() ? "complete" : "incomplete",
    },
    {
      key: "photos",
      label: "Photos",
      step: 5,
      raw: values.sellerPhotos.length > 0 ? "complete" : "recommended",
    },
  ];
}

function getBuyerReadinessRaw(values: QuoteFormValues): RawReadinessItem[] {
  return [
    {
      key: "enquiryType",
      label: "Enquiry type",
      step: 1,
      raw: values.intent === "buy" ? "complete" : "incomplete",
    },
    {
      key: "material",
      label: "Material",
      step: 2,
      raw: materialComplete(values) ? "complete" : "incomplete",
    },
    {
      key: "quantity",
      label: "Quantity",
      step: 3,
      raw:
        values.buyerQuantityValue?.trim() && values.buyerQuantityUnit ? "complete" : "incomplete",
    },
    {
      key: "tradeRoute",
      label: "Trade route",
      step: 3,
      raw: values.buyerTradeRequirement ? "complete" : "incomplete",
    },
    {
      key: "destination",
      label: "Destination & logistics",
      step: 4,
      raw: buyerDestinationComplete(values) ? "complete" : "incomplete",
    },
    {
      key: "contact",
      label: "Contact details",
      step: 5,
      raw:
        values.buyerContactPerson?.trim() && values.buyerPhone?.trim() && buyerCompanyOk(values)
          ? "complete"
          : "incomplete",
    },
    {
      key: "specification",
      label: "Specification / documents",
      step: 5,
      raw:
        values.buyerAdditionalSpec?.trim() ||
        values.materialSpec?.trim() ||
        values.buyerDocuments.length > 0
          ? "complete"
          : "recommended",
    },
  ];
}

/** `furthestStepReached` distinguishes a genuinely-skipped required field ("Needs attention") from one the user hasn't reached yet ("Not added yet"). */
export function getReadiness(values: QuoteFormValues, furthestStepReached = 6): ReadinessItem[] {
  const raw =
    values.intent === "buy" ? getBuyerReadinessRaw(values) : getSellerReadinessRaw(values);
  return raw.map((item) => ({
    key: item.key,
    label: item.label,
    step: item.step,
    state: resolveState(item.raw, item.step, furthestStepReached),
  }));
}

/** Blocking items only — "recommended" items (photos/spec) never gate submission. */
export function isReadyForReview(values: QuoteFormValues): boolean {
  return getReadiness(values, 6).every((item) => item.state !== "needs_attention");
}

function materialLine(values: QuoteFormValues): string {
  const label =
    values.material === "other"
      ? values.otherMaterialText?.trim()
      : getMaterialLabel(values.material);
  const subtype = getSubtypeLabel(values.material, values.subtype);
  if (!label) return "Material not specified";
  return subtype && subtype !== "Not sure" ? `${label} · ${subtype}` : label;
}

function compactQuantity(
  value: string | undefined,
  unit: QuoteFormValues["sellerQuantityUnit"],
): string | undefined {
  if (!value?.trim() || !unit) return undefined;
  return `${value.trim()} ${UNIT_LABELS[unit]}`;
}

/** "Area, Emirate" — the natural order people use when describing a UAE location. */
function naturalLocation(
  area: string | undefined,
  emirateLabel: string | undefined,
): string | undefined {
  return [area?.trim(), emirateLabel].filter(Boolean).join(", ") || undefined;
}

function buyerDestinationLine(values: QuoteFormValues): string | undefined {
  if (values.buyerTradeRequirement === "local") {
    return naturalLocation(
      values.buyerDestinationArea,
      values.buyerDestinationEmirate ? EMIRATE_LABELS[values.buyerDestinationEmirate] : undefined,
    );
  }
  if (values.buyerTradeRequirement === "import") {
    return values.buyerDestinationEmirate
      ? `${EMIRATE_LABELS[values.buyerDestinationEmirate]}, UAE (import arrival)`
      : undefined;
  }
  if (values.buyerTradeRequirement === "export") {
    return (
      [values.buyerDestinationCityPort?.trim(), values.buyerDestinationCountry?.trim()]
        .filter(Boolean)
        .join(", ") || undefined
    );
  }
  return undefined;
}

/** Deterministic one-line "Smart Quote Brief" shown on the Review step. */
export function buildSmartBrief(values: QuoteFormValues): string {
  const parts: string[] = [];
  if (values.intent === "sell") {
    parts.push("Sell enquiry");
    parts.push(materialLine(values));
    if (values.sellerQuantityUnsure) {
      parts.push("quantity unsure");
    } else {
      const qty = compactQuantity(values.sellerQuantityValue, values.sellerQuantityUnit);
      if (qty) parts.push(`approx. ${qty}`);
    }
    if (values.sellerEmirate) parts.push(EMIRATE_LABELS[values.sellerEmirate]);
    if (values.sellerPickupRequired === "yes") parts.push("pickup required");
    if (values.sellerPhotos.length > 0) {
      parts.push(
        `${values.sellerPhotos.length} photo${values.sellerPhotos.length === 1 ? "" : "s"} attached`,
      );
    }
  } else if (values.intent === "buy") {
    parts.push("Buy enquiry");
    parts.push(materialLine(values));
    const qty = compactQuantity(values.buyerQuantityValue, values.buyerQuantityUnit);
    if (qty) parts.push(qty);
    if (values.buyerTradeRequirement)
      parts.push(TRADE_REQUIREMENT_LABELS[values.buyerTradeRequirement]);
    const destination = buyerDestinationLine(values);
    if (destination) parts.push(`destination: ${destination}`);
  } else {
    return "Enquiry details not yet complete.";
  }
  return `${parts.filter(Boolean).join(" · ")}.`;
}

function pushBullet(lines: string[], label: string, value: string | undefined | null): void {
  const trimmed = value?.trim();
  if (trimmed) lines.push(`- ${label}: ${trimmed}`);
}

function condLabel(condition: NonNullable<QuoteFormValues["sellerCondition"]>): string {
  return {
    clean_separated: "Clean / separated",
    mixed: "Mixed material",
    used_surplus: "Used / surplus",
    not_sure: "Not sure",
  }[condition];
}

/** Deterministic WhatsApp handoff message — never emits "undefined" or empty rows. */
export function buildWhatsAppMessage(values: QuoteFormValues): string {
  const lines: string[] = [];

  if (values.intent === "sell") {
    lines.push("Hello MSM Scrap, I'd like to sell scrap.", "", "Enquiry summary");
    pushBullet(lines, "Material", materialLine(values));
    pushBullet(
      lines,
      "Approx. quantity",
      values.sellerQuantityUnsure
        ? "Not sure"
        : compactQuantity(values.sellerQuantityValue, values.sellerQuantityUnit),
    );
    pushBullet(
      lines,
      "Condition",
      values.sellerCondition ? condLabel(values.sellerCondition) : undefined,
    );
    pushBullet(
      lines,
      "Location",
      naturalLocation(
        values.sellerArea,
        values.sellerEmirate ? EMIRATE_LABELS[values.sellerEmirate] : undefined,
      ),
    );
    pushBullet(
      lines,
      "Pickup",
      values.sellerPickupRequired === "yes"
        ? "Yes"
        : values.sellerPickupRequired === "no"
          ? "No"
          : values.sellerPickupRequired === "not_sure"
            ? "Not sure"
            : undefined,
    );
    pushBullet(
      lines,
      "Preferred contact",
      values.sellerPreferredContact
        ? PREFERRED_CONTACT_LABELS[values.sellerPreferredContact]
        : undefined,
    );

    const closing: string[] = [];
    if (values.sellerName?.trim()) closing.push(`- Name: ${values.sellerName.trim()}`);
    if (values.sellerCompany?.trim()) closing.push(`- Company: ${values.sellerCompany.trim()}`);
    if (values.sellerPhotos.length > 0) closing.push("- I will attach the photos here.");
    if (closing.length > 0) lines.push("", ...closing);

    lines.push("", "Could you review this and advise the next step?");
  } else if (values.intent === "buy") {
    lines.push("Hello MSM Scrap, I'd like to buy material.", "", "Enquiry summary");
    pushBullet(lines, "Material", materialLine(values));
    pushBullet(
      lines,
      "Required quantity",
      compactQuantity(values.buyerQuantityValue, values.buyerQuantityUnit),
    );
    pushBullet(
      lines,
      "Trade route",
      values.buyerTradeRequirement
        ? TRADE_REQUIREMENT_LABELS[values.buyerTradeRequirement]
        : undefined,
    );
    pushBullet(lines, "Destination", buyerDestinationLine(values));
    const logistics =
      values.buyerTradeRequirement === "local"
        ? values.buyerFulfilment
          ? FULFILMENT_LABELS[values.buyerFulfilment]
          : undefined
        : values.buyerLogisticsRequirement
          ? FULFILMENT_LABELS[values.buyerLogisticsRequirement]
          : undefined;
    pushBullet(lines, "Fulfilment/logistics requirement", logistics);
    pushBullet(lines, "Required-by", values.buyerRequiredByDate);
    pushBullet(lines, "Specification", values.buyerAdditionalSpec ?? values.materialSpec);

    const closing: string[] = [];
    if (values.buyerContactPerson?.trim())
      closing.push(`- Contact person: ${values.buyerContactPerson.trim()}`);
    if (values.buyerCompany?.trim()) closing.push(`- Company: ${values.buyerCompany.trim()}`);
    if (values.buyerDocuments.length > 0)
      closing.push("- I will attach the specification or document here.");
    if (closing.length > 0) lines.push("", ...closing);

    lines.push("", "Please confirm availability and the next step.");
  }

  return lines.join("\n").trim();
}

export function buildWhatsAppUrl(phoneNumber: string, message: string): string {
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * Display-only UAE phone formatting for the Review screen — never mutates the
 * stored value, and falls back to the raw trimmed input for anything that
 * doesn't match a recognisable UAE shape rather than guessing at digits.
 */
export function formatPhoneForDisplay(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const digits = trimmed.replace(/[^\d+]/g, "");

  const withCountryCode = digits.startsWith("+971")
    ? digits.slice(4)
    : digits.startsWith("971")
      ? digits.slice(3)
      : digits.startsWith("0")
        ? digits.slice(1)
        : undefined;

  if (withCountryCode && /^\d{9}$/.test(withCountryCode)) {
    return `+971 ${withCountryCode.slice(0, 2)} ${withCountryCode.slice(2, 5)} ${withCountryCode.slice(5)}`;
  }
  return trimmed;
}
