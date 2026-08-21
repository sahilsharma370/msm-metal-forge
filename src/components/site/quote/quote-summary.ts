import {
  EMIRATE_LABELS,
  FULFILMENT_LABELS,
  PREFERRED_CONTACT_LABELS,
  PREFERRED_PORT_LABELS,
  TRADE_REQUIREMENT_LABELS,
  UNIT_LABELS,
  getMaterialLabel,
  getSubtypeLabel,
} from "./quote-options";
import {
  buyerDetailsStepSchema,
  isBuyerContactComplete,
  isBuyerDestinationComplete,
  isMaterialComplete,
  isSellerContactComplete,
  isSellerLocationComplete,
  isSellerMaterialDetailsComplete,
  isSellerPickupComplete,
  normalizePhoneNumber,
  parseDateOnly,
  type QuoteFormValues,
} from "./quote-schema";

/**
 * Pure business-rule gate for Review/dev-preview — ignores UI timing (required
 * vs needs-attention) entirely. Deliberately validates the FULL active step
 * schemas rather than deriving from `getRawReadiness`'s per-row items: the
 * Buyer "Quantity" row above intentionally checks quantity/unit only (Fix 2),
 * so an invalid optional Needed-by date wouldn't surface anywhere unless it's
 * checked here directly against the full `buyerDetailsStepSchema`.
 */
export function isReadyForReview(values: QuoteFormValues): boolean {
  if (values.intent !== "sell" && values.intent !== "buy") return false;
  if (!isMaterialComplete(values)) return false;
  if (values.intent === "sell") {
    return (
      isSellerMaterialDetailsComplete(values) &&
      isSellerLocationComplete(values) &&
      isSellerPickupComplete(values) &&
      isSellerContactComplete(values)
    );
  }
  return (
    buyerDetailsStepSchema.safeParse(values).success &&
    isBuyerDestinationComplete(values) &&
    isBuyerContactComplete(values)
  );
}

function materialLine(values: QuoteFormValues): string {
  const label =
    values.material === "other"
      ? values.otherMaterialText?.trim()
      : getMaterialLabel(values.material);
  if (!label) return "Material not specified";
  const subtypeLabel =
    values.subtype === "other"
      ? values.subtypeOtherText?.trim()
      : getSubtypeLabel(values.material, values.subtype);
  return subtypeLabel && subtypeLabel !== "Not sure" ? `${label} · ${subtypeLabel}` : label;
}

function unitLabel(
  values: QuoteFormValues,
  unit: QuoteFormValues["sellerQuantityUnit"],
  other: string | undefined,
): string | undefined {
  if (!unit) return undefined;
  if (unit === "other") return other?.trim() || UNIT_LABELS.other;
  return UNIT_LABELS[unit];
}

function compactQuantity(
  value: string | undefined,
  unit: QuoteFormValues["sellerQuantityUnit"],
  unitOther?: string,
): string | undefined {
  if (!value?.trim() || !unit) return undefined;
  const label = unit === "other" ? unitOther?.trim() || UNIT_LABELS.other : UNIT_LABELS[unit];
  return `${value.trim()} ${label}`;
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
      ? EMIRATE_LABELS[values.buyerDestinationEmirate]
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

/**
 * C2L-Q2 — a short identifying headline for Review's top recap: just intent
 * + material, e.g. "Selling Copper · Wire & Cable". Deliberately NOT the
 * fuller `buildSmartBrief` below (quantity/location/pickup etc.) — those
 * facts already live in the compact editable cards right underneath, and
 * repeating them in both places was the exact duplication this replaces.
 * `buildSmartBrief` itself is unchanged and still used on the post-success
 * confirmation screen, where there are no editable cards to fall back on.
 */
export function buildReviewHeadline(values: QuoteFormValues): string {
  if (values.intent !== "sell" && values.intent !== "buy") return "Your request";
  const material = materialLine(values);
  const materialText = material === "Material not specified" ? "your material" : material;
  return values.intent === "sell" ? `Selling ${materialText}` : `Buying ${materialText}`;
}

/** Deterministic one-line "Smart Quote Brief" shown on the post-success confirmation screen. */
export function buildSmartBrief(values: QuoteFormValues): string {
  const parts: string[] = [];
  if (values.intent === "sell") {
    parts.push("Sell enquiry");
    parts.push(materialLine(values));
    if (values.sellerQuantityUnsure) {
      parts.push("quantity unsure");
    } else {
      const qty = compactQuantity(
        values.sellerQuantityValue,
        values.sellerQuantityUnit,
        values.sellerQuantityUnitOther,
      );
      if (qty) parts.push(`approx. ${qty}`);
    }
    const location = naturalLocation(
      values.sellerArea,
      values.sellerEmirate ? EMIRATE_LABELS[values.sellerEmirate] : undefined,
    );
    if (location) parts.push(location);
    if (values.sellerPickupRequired === "yes") parts.push("pickup required");
    if (values.sellerPhotos.length > 0) {
      parts.push(
        `${values.sellerPhotos.length} photo${values.sellerPhotos.length === 1 ? "" : "s"} attached`,
      );
    }
  } else if (values.intent === "buy") {
    parts.push("Buy enquiry");
    parts.push(materialLine(values));
    const qty = compactQuantity(
      values.buyerQuantityValue,
      values.buyerQuantityUnit,
      values.buyerQuantityUnitOther,
    );
    if (qty) parts.push(qty);
    if (values.buyerTradeRequirement)
      parts.push(TRADE_REQUIREMENT_LABELS[values.buyerTradeRequirement]);
    const destination = buyerDestinationLine(values);
    if (destination) {
      parts.push(
        values.buyerTradeRequirement === "import"
          ? `Final delivery: ${destination}`
          : `destination: ${destination}`,
      );
    }
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
    clean_separated: "Clean and separated",
    mixed: "Mixed or unsorted",
    used_surplus: "Used or surplus",
    not_sure: "Not sure",
  }[condition];
}

function buyerLogisticsLabel(values: QuoteFormValues): string | undefined {
  const requirement =
    values.buyerTradeRequirement === "local"
      ? values.buyerFulfilment
      : values.buyerLogisticsRequirement;
  return requirement ? FULFILMENT_LABELS[requirement] : undefined;
}

/**
 * Deterministic WhatsApp handoff message — never emits "undefined" or empty
 * rows. `reference` (C2L-Q1) is the server's own authoritative reference,
 * passed only from the post-success confirmation screen — pre-submission
 * callers never have one, and this function has no way to fabricate one.
 */
export function buildWhatsAppMessage(values: QuoteFormValues, reference?: string): string {
  const lines: string[] = [];
  if (reference) lines.push(`Reference: ${reference}`, "");

  if (values.intent === "sell") {
    lines.push("Hello MSM Scrap, I'd like to sell scrap.", "", "Enquiry summary");
    pushBullet(lines, "Material", materialLine(values));
    pushBullet(
      lines,
      "Approx. quantity",
      values.sellerQuantityUnsure
        ? "Not sure"
        : compactQuantity(
            values.sellerQuantityValue,
            values.sellerQuantityUnit,
            values.sellerQuantityUnitOther,
          ),
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
    pushBullet(lines, "Maps link", values.sellerMapLink);
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
    if (values.sellerPickupRequired === "yes") {
      pushBullet(lines, "Preferred pickup date", formatDateForDisplay(values.sellerPickupDate));
      pushBullet(lines, "Access and loading notes", values.sellerAccessNote);
    }
    pushBullet(
      lines,
      "Preferred contact",
      values.sellerPreferredContact
        ? PREFERRED_CONTACT_LABELS[values.sellerPreferredContact]
        : undefined,
    );
    pushBullet(lines, "Notes", values.sellerNotes);

    const closing: string[] = [];
    if (values.sellerName?.trim()) closing.push(`- Name: ${values.sellerName.trim()}`);
    if (values.sellerCompany?.trim()) closing.push(`- Company: ${values.sellerCompany.trim()}`);
    if (values.sellerPhone?.trim())
      closing.push(`- Phone: ${formatPhoneForDisplay(values.sellerPhone)}`);
    if (values.sellerEmail?.trim()) closing.push(`- Email: ${values.sellerEmail.trim()}`);
    if (values.sellerPhotos.length > 0) {
      closing.push(`- Photos: ${values.sellerPhotos.length} selected — I will attach them here.`);
    }
    if (closing.length > 0) lines.push("", ...closing);

    lines.push("", "Could you review this and advise the next step?");
  } else if (values.intent === "buy") {
    lines.push("Hello MSM Scrap, I'd like to buy material.", "", "Enquiry summary");
    pushBullet(lines, "Material", materialLine(values));
    pushBullet(
      lines,
      "Required quantity",
      compactQuantity(
        values.buyerQuantityValue,
        values.buyerQuantityUnit,
        values.buyerQuantityUnitOther,
      ),
    );
    pushBullet(
      lines,
      "Trade route",
      values.buyerTradeRequirement
        ? TRADE_REQUIREMENT_LABELS[values.buyerTradeRequirement]
        : undefined,
    );
    pushBullet(lines, "Destination", buyerDestinationLine(values));
    if (values.buyerTradeRequirement === "local") {
      pushBullet(lines, "Maps link", values.buyerDestinationMapLink);
    }
    if (values.buyerTradeRequirement === "import") {
      pushBullet(
        lines,
        "Preferred port",
        values.buyerPreferredPort === "other"
          ? values.buyerPreferredPortOther
          : values.buyerPreferredPort
            ? PREFERRED_PORT_LABELS[values.buyerPreferredPort]
            : undefined,
      );
      pushBullet(lines, "Origin preference", values.buyerOriginCountryPreference);
    }
    pushBullet(lines, "Fulfilment/logistics requirement", buyerLogisticsLabel(values));
    if (values.buyerTradeRequirement !== "local") {
      pushBullet(lines, "Logistics note", values.buyerLogisticsNote);
    }
    pushBullet(lines, "Needed by", formatDateForDisplay(values.buyerRequiredByDate));
    pushBullet(lines, "Specification", values.materialSpec);
    pushBullet(lines, "Additional requirements", values.buyerAdditionalSpec);

    const closing: string[] = [];
    if (values.buyerContactPerson?.trim())
      closing.push(`- Contact person: ${values.buyerContactPerson.trim()}`);
    if (values.buyerCompany?.trim()) closing.push(`- Company: ${values.buyerCompany.trim()}`);
    if (values.buyerPhone?.trim())
      closing.push(`- Phone: ${formatPhoneForDisplay(values.buyerPhone)}`);
    if (values.buyerEmail?.trim()) closing.push(`- Email: ${values.buyerEmail.trim()}`);
    if (values.buyerNotes?.trim()) closing.push(`- Notes: ${values.buyerNotes.trim()}`);
    if (values.buyerDocuments.length > 0) {
      closing.push(
        `- Supporting files: ${values.buyerDocuments.length} selected — I will attach them here.`,
      );
    }
    if (closing.length > 0) lines.push("", ...closing);

    lines.push("", "Please confirm availability and the next step.");
  }

  return lines.join("\n").trim();
}

export function buildWhatsAppUrl(phoneNumber: string, message: string): string {
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * Display-only UAE phone formatting for Review/WhatsApp — never mutates the
 * stored value, and falls back to the raw trimmed input for anything that
 * doesn't match a recognisable UAE shape rather than guessing at digits.
 */
export function formatPhoneForDisplay(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const canonical = normalizePhoneNumber(raw);
  if (!canonical) return trimmed; // shouldn't reach Review/WhatsApp unvalidated, but never fabricate digits

  if (canonical.startsWith("+971") && canonical.length === 13) {
    const national = canonical.slice(4);
    return `+971 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  }
  return canonical;
}

/**
 * E-15: renders a stored ISO (`2026-09-24`) or free date string as `24 Sep 2026`.
 * Uses `parseDateOnly` (local calendar components, not UTC) so the displayed
 * day never shifts backward in negative-UTC-offset timezones (Fix 9). Falls
 * back to the raw value if unparsable.
 */
export function formatDateForDisplay(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = parseDateOnly(trimmed);
  if (!parsed) return trimmed;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
