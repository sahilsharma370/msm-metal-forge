/**
 * CHECKPOINT C2H-B1 (design: docs/email-design/owner-approved.png) — pure
 * owner-notification email rendering. No I/O, no Supabase, no provider —
 * a plain function from validated lead data to {subject, text, html},
 * unit-testable without any network or database.
 *
 * Field source of truth: the exact structured columns of public.leads (see
 * supabase/migrations/20260811165757_create_quote_backend_foundation.sql),
 * never leads.submission_snapshot — the structured columns are already
 * server-validated/normalized, and using them here means this module can
 * never accidentally render a raw, unvalidated client value. Every field
 * below corresponds to a real column; nothing is invented, and a branch's
 * irrelevant fields (buyer_* for a sell lead, seller_* for a buy lead) are
 * never read, matching leads_branch_field_isolation's own DB-level
 * guarantee that they are always null anyway.
 *
 * Privacy: no attachments, no Storage path (private or signed/public URL —
 * this module never receives one), no service-role/admin values. Every
 * customer-controlled string is HTML-escaped before going into the html
 * body, and every value that ends up in subject/from/to/reply-to anywhere
 * in this checkpoint's pipeline is newline-stripped (see
 * sanitizeHeaderValue) — defense in depth even though the DB's own CHECK
 * constraints already bound most of these fields' shapes.
 *
 * Sender/recipient/subject/provider/dashboard-authorization/delivery/
 * idempotency behavior is entirely owned by dispatch-notification.server.ts
 * and is unchanged by this design update — this module only ever returns
 * {subject, text, html}; it has no say in who the email goes to or how.
 */
import {
  escapeHtml,
  escapeMultilineHtml,
  humanizeCode,
  unitLabel,
  sanitizeHeaderValue,
  emailDocumentHtml,
  referenceBlockHtml,
  sectionHeadingHtml,
  tableRowHtml,
  footerHtml,
  logoHeaderHtml,
  EMAIL_NAVY,
  EMAIL_COPPER,
  EMAIL_GRAY_FOOTER,
} from "./email-template-shared";

/** Matches the approved design's own wording ("Pickup: Required") rather than echoing the raw "yes"/"no" submission value — mirrors PICKUP_CHOICES (src/components/site/quote/quote-schema.ts: "yes" | "no" | "not_sure") without importing that client-only module here. */
const PICKUP_LABELS: Record<string, string> = {
  yes: "Required",
  no: "Not required",
  not_sure: "Not sure",
};

function pickupLabel(value: string): string {
  return PICKUP_LABELS[value] ?? humanizeCode(value);
}

/** Phone/Email contact-row values become real tel:/mailto: links styled in the brand's copper accent — every other row keeps the plain escaped-text treatment. The href itself is independently escaped/stripped (defense in depth, matching this module's own established posture), never trusting the already-validated upstream value alone. */
function contactRowValueHtml(label: string, value: string): string {
  if (label === "Phone") {
    const telHref = value.replace(/[^\d+]/g, "");
    return `<a href="tel:${escapeHtml(telHref)}" style="color:${EMAIL_COPPER};text-decoration:none;">${escapeMultilineHtml(value)}</a>`;
  }
  if (label === "Email") {
    return `<a href="mailto:${escapeHtml(value)}" style="color:${EMAIL_COPPER};text-decoration:none;">${escapeMultilineHtml(value)}</a>`;
  }
  return escapeMultilineHtml(value);
}

export { escapeHtml, sanitizeHeaderValue };

export interface OwnerNotificationFileStats {
  /** Total declared quote_upload_slots rows for this lead — never a filename, path, or per-file detail. */
  readonly count: number;
  /** leads.file_upload_status verbatim: 'none' | 'pending' | 'complete' | 'partial' | 'failed'. */
  readonly status: string;
}

/**
 * Mirrors the subset of public.leads columns this email ever reads,
 * field-for-field — see this module's own header comment for why
 * submission_snapshot is never used instead.
 */
export interface OwnerNotificationLeadData {
  readonly reference: string;
  readonly intent: "sell" | "buy";
  readonly material: string;
  readonly materialSubtype: string | null;
  readonly materialSubtypeOtherText: string | null;
  readonly materialOtherText: string | null;
  readonly materialSpec: string | null;

  readonly sellerQuantityValue: string | null;
  readonly sellerQuantityUnit: string | null;
  readonly sellerQuantityUnitOther: string | null;
  readonly sellerQuantityUnsure: boolean;
  readonly sellerCondition: string | null;
  readonly sellerDescription: string | null;
  readonly sellerEmirate: string | null;
  readonly sellerArea: string | null;
  readonly sellerMapLink: string | null;
  readonly sellerPickupRequired: string | null;
  readonly sellerPickupDate: string | null;
  readonly sellerAccessNote: string | null;
  readonly sellerName: string | null;
  readonly sellerPhone: string | null;
  readonly sellerCompany: string | null;
  readonly sellerEmail: string | null;
  readonly sellerPreferredContact: string | null;
  readonly sellerNotes: string | null;

  readonly buyerQuantityValue: string | null;
  readonly buyerQuantityUnit: string | null;
  readonly buyerQuantityUnitOther: string | null;
  readonly buyerTradeRequirement: string | null;
  readonly buyerRequiredByDate: string | null;
  readonly buyerAdditionalSpec: string | null;
  readonly buyerDestinationEmirate: string | null;
  readonly buyerDestinationArea: string | null;
  readonly buyerDestinationMapLink: string | null;
  readonly buyerFulfilment: string | null;
  readonly buyerDestinationCountry: string | null;
  readonly buyerDestinationCityPort: string | null;
  readonly buyerPreferredPort: string | null;
  readonly buyerPreferredPortOther: string | null;
  readonly buyerOriginCountryPreference: string | null;
  readonly buyerLogisticsRequirement: string | null;
  readonly buyerLogisticsNote: string | null;
  readonly buyerCompany: string | null;
  readonly buyerContactPerson: string | null;
  readonly buyerPhone: string | null;
  readonly buyerEmail: string | null;
  readonly buyerPreferredContact: string | null;
  readonly buyerNotes: string | null;

  /** ISO 8601 — leads.submitted_at verbatim. */
  readonly submittedAt: string;
}

export interface OwnerNotificationEmailOptions {
  /** Only rendered as a link when the caller (the dispatcher, reading getEmailConfig()) supplies one — never guessed or constructed here. Unchanged authorization behavior from before this design update. */
  readonly dashboardUrl?: string;
}

export interface RenderedOwnerEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function formatQuantity(value: string | null, unit: string | null, unitOther: string | null): string | null {
  if (!value) return null;
  const label = unit === "other" ? (unitOther ?? "other") : unit ? unitLabel(unit) : "";
  return label ? `${value} ${label}` : value;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  // leads.seller_pickup_date / buyer_required_by_date are plain `date` columns (YYYY-MM-DD) — rendered as-is, never re-parsed with a timezone-sensitive Date object.
  return value;
}

/** Owner-facing timestamps are shown in Asia/Dubai; an unparseable input falls back to the original value rather than showing an invalid date. */
const SUBMITTED_AT_UAE_FORMATTER = new Intl.DateTimeFormat("en-AE", {
  timeZone: "Asia/Dubai",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Compact date-only form for the header eyebrow ("ENQUIRY / 05 NOV 2026") — the approved design's own header never shows a time, only the plain-text alternative does. */
const HEADER_DATE_UAE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatSubmittedAtUae(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${SUBMITTED_AT_UAE_FORMATTER.format(date)} (UAE time)`;
}

function formatHeaderDateUae(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return HEADER_DATE_UAE_FORMATTER.format(date).toUpperCase();
}

interface Row {
  readonly label: string;
  readonly value: string | null;
}

function rows(...entries: Row[]): Row[] {
  return entries.filter((row) => row.value !== null && row.value.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Section builders — each branch's fields split into the two approved-design
// sections ("MATERIAL & LOGISTICS" / "CUSTOMER CONTACT"). Every field the
// pre-redesign template rendered is still rendered here, unchanged — this
// only reorganizes presentation, it never drops a data field.
// ---------------------------------------------------------------------------

function sellerMaterialRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Condition", value: lead.sellerCondition ? humanizeCode(lead.sellerCondition) : null },
    { label: "Description", value: lead.sellerDescription },
    { label: "Emirate", value: lead.sellerEmirate ? humanizeCode(lead.sellerEmirate) : null },
    { label: "Area", value: lead.sellerArea },
    { label: "Map link", value: lead.sellerMapLink },
    { label: "Pickup", value: lead.sellerPickupRequired ? pickupLabel(lead.sellerPickupRequired) : null },
    { label: "Preferred pickup date", value: formatDate(lead.sellerPickupDate) },
    { label: "Access notes", value: lead.sellerAccessNote },
  );
}

function sellerContactRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Name", value: lead.sellerName },
    { label: "Preferred method", value: lead.sellerPreferredContact ? humanizeCode(lead.sellerPreferredContact) : null },
    { label: "Phone", value: lead.sellerPhone },
    { label: "Company", value: lead.sellerCompany },
    { label: "Email", value: lead.sellerEmail },
    { label: "Notes", value: lead.sellerNotes },
  );
}

function buyerMaterialRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Specification", value: lead.materialSpec },
    { label: "Trade route", value: lead.buyerTradeRequirement ? humanizeCode(lead.buyerTradeRequirement) : null },
    { label: "Needed by", value: formatDate(lead.buyerRequiredByDate) },
    { label: "Additional requirements", value: lead.buyerAdditionalSpec },
    { label: "Destination emirate", value: lead.buyerDestinationEmirate ? humanizeCode(lead.buyerDestinationEmirate) : null },
    { label: "Destination area", value: lead.buyerDestinationArea },
    { label: "Destination map link", value: lead.buyerDestinationMapLink },
    { label: "Fulfilment", value: lead.buyerFulfilment ? humanizeCode(lead.buyerFulfilment) : null },
    { label: "Destination country", value: lead.buyerDestinationCountry },
    { label: "Destination city/port", value: lead.buyerDestinationCityPort },
    {
      label: "Preferred port",
      value: lead.buyerPreferredPort === "other" ? lead.buyerPreferredPortOther : lead.buyerPreferredPort ? humanizeCode(lead.buyerPreferredPort) : null,
    },
    { label: "Origin preference", value: lead.buyerOriginCountryPreference },
    { label: "Logistics requirement", value: lead.buyerLogisticsRequirement ? humanizeCode(lead.buyerLogisticsRequirement) : null },
    { label: "Logistics note", value: lead.buyerLogisticsNote },
  );
}

function buyerContactRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Contact person", value: lead.buyerContactPerson },
    { label: "Preferred method", value: lead.buyerPreferredContact ? humanizeCode(lead.buyerPreferredContact) : null },
    { label: "Phone", value: lead.buyerPhone },
    { label: "Company", value: lead.buyerCompany },
    { label: "Email", value: lead.buyerEmail },
    { label: "Notes", value: lead.buyerNotes },
  );
}

export function materialLabel(lead: OwnerNotificationLeadData): string | null {
  const base = lead.material === "other" ? (lead.materialOtherText ?? "Other") : humanizeCode(lead.material);
  const subtype =
    lead.materialSubtype === "other"
      ? (lead.materialSubtypeOtherText ?? "Other")
      : lead.materialSubtype
        ? humanizeCode(lead.materialSubtype)
        : null;
  return subtype ? `${base} — ${subtype}` : base;
}

/** Quantity for the subheading line ("Aluminium · approx. 50 kg") and the Photos/Documents row — short form, distinct from the full-sentence fileStatusLabel used in the plain-text alternative. */
function quantityLabel(lead: OwnerNotificationLeadData): string | null {
  if (lead.intent === "sell") {
    if (lead.sellerQuantityUnsure) return "Not sure";
    return formatQuantity(lead.sellerQuantityValue, lead.sellerQuantityUnit, lead.sellerQuantityUnitOther);
  }
  return formatQuantity(lead.buyerQuantityValue, lead.buyerQuantityUnit, lead.buyerQuantityUnitOther);
}

function fileStatusLabel(stats: OwnerNotificationFileStats): string {
  switch (stats.status) {
    case "none":
      return "No files attached";
    case "pending":
      return `${stats.count} file${stats.count === 1 ? "" : "s"} declared — upload still in progress`;
    case "complete":
      return `${stats.count} file${stats.count === 1 ? "" : "s"} uploaded and verified`;
    case "partial":
      return `${stats.count} file${stats.count === 1 ? "" : "s"} declared — only some uploaded successfully`;
    case "failed":
      return `${stats.count} file${stats.count === 1 ? "" : "s"} declared — upload failed`;
    default:
      return `${stats.count} file${stats.count === 1 ? "" : "s"} declared`;
  }
}

/** Compact row value matching the approved design's "2 attached" style — the full sentence form (fileStatusLabel) is still what the plain-text alternative uses, for completeness there. */
function fileRowValue(stats: OwnerNotificationFileStats): string | null {
  switch (stats.status) {
    case "none":
      return null;
    case "pending":
      return `${stats.count} declared — in progress`;
    case "complete":
      return `${stats.count} attached`;
    case "partial":
      return `${stats.count} declared — partial`;
    case "failed":
      return `${stats.count} declared — failed`;
    default:
      return `${stats.count} declared`;
  }
}

// ---------------------------------------------------------------------------
// Two-tone (copper + navy) rule beneath the logo header — the approved
// design's own divider treatment, distinct from the customer design's
// single full-width copper rule.
// ---------------------------------------------------------------------------

function twoToneRuleHtml(): string {
  return (
    `<tr><td style="padding:14px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="background-color:${EMAIL_COPPER};height:2px;width:72px;font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="background-color:${EMAIL_NAVY};height:2px;font-size:0;line-height:0;">&nbsp;</td>` +
    `</tr></table></td></tr>`
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function renderOwnerNotificationEmail(
  lead: OwnerNotificationLeadData,
  fileStats: OwnerNotificationFileStats,
  options: OwnerNotificationEmailOptions = {},
): RenderedOwnerEmail {
  const isSell = lead.intent === "sell";
  const intentLabel = isSell ? "seller" : "buyer";
  const subject = sanitizeHeaderValue(`New ${intentLabel} enquiry — ${lead.reference}`);

  const materialRows = isSell ? sellerMaterialRows(lead) : buyerMaterialRows(lead);
  const contactRows = isSell ? sellerContactRows(lead) : buyerContactRows(lead);
  const filesLabel = isSell ? "Photos" : "Documents";
  const fileRow = fileRowValue(fileStats);

  // -------------------------------------------------------------------------
  // Plain-text alternative — every field the html renders, in the same
  // order, nothing added or omitted differently between the two.
  // -------------------------------------------------------------------------
  const textLines: string[] = [
    "MSM Scrap",
    "",
    isSell ? "New seller enquiry." : "New buyer enquiry.",
    [materialLabel(lead), quantityLabel(lead) ? `approx. ${quantityLabel(lead)}` : null].filter(Boolean).join(" · "),
    "",
    `Reference: ${lead.reference}`,
    "",
    "Material & logistics",
    ...materialRows.map((row) => `  ${row.label}: ${row.value}`),
    `  ${filesLabel}: ${fileStatusLabel(fileStats)}`,
    "",
    "Customer contact",
    ...contactRows.map((row) => `  ${row.label}: ${row.value}`),
    "",
    `Submitted: ${formatSubmittedAtUae(lead.submittedAt)}`,
  ];
  if (options.dashboardUrl) {
    textLines.push("", `View in dashboard: ${options.dashboardUrl}`);
  }
  const text = textLines.join("\n");

  // -------------------------------------------------------------------------
  // HTML — table-safe, inline-styled, matching owner-approved.png's
  // hierarchy: logo header, two-tone rule, heading, material/qty
  // subheading, reference block, "MATERIAL & LOGISTICS" rows (+ a Photos/
  // Documents row folded in, same section), "CUSTOMER CONTACT" rows,
  // optional dashboard link, footer.
  // -------------------------------------------------------------------------
  const rowsToHtml = (list: Row[]) =>
    list.map((row, i) => tableRowHtml(row.label, contactRowValueHtml(row.label, row.value ?? ""), i === list.length - 1 && !fileRow)).join("");

  const materialSectionRowsHtml =
    rowsToHtml(materialRows) + (fileRow ? tableRowHtml(filesLabel, escapeHtml(fileRow), true) : "");

  const materialLabelText = materialLabel(lead);
  const quantityLabelText = quantityLabel(lead);
  const subheadingParts = [
    materialLabelText ? escapeHtml(materialLabelText) : null,
    quantityLabelText ? `approx. ${escapeHtml(quantityLabelText)}` : null,
  ].filter((part): part is string => part !== null);

  // Secondary, compact, restrained letter-spacing — shares the row with the
  // now-120px-wide logo, so it must stay small to fit gracefully on mobile.
  const eyebrowHtml = `<span style="color:${EMAIL_COPPER};font-size:11px;font-weight:700;letter-spacing:0.05em;white-space:nowrap;">ENQUIRY &nbsp;/&nbsp; ${escapeHtml(formatHeaderDateUae(lead.submittedAt))}</span>`;

  const bodyRows =
    `<tr><td style="color:${EMAIL_NAVY};font-size:24px;font-weight:700;line-height:1.3;padding-top:18px;">${isSell ? "New seller enquiry." : "New buyer enquiry."}</td></tr>` +
    (subheadingParts.length > 0
      ? `<tr><td style="color:${EMAIL_NAVY};font-size:14px;font-weight:600;padding-top:4px;">${subheadingParts.join(" &middot; ")}</td></tr>`
      : "") +
    `<tr><td style="padding-top:18px;">${referenceBlockHtml(lead.reference)}</td></tr>` +
    `<tr><td style="padding-top:18px;border-top:1px solid #E5E7EB;font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td>${sectionHeadingHtml("Material & Logistics")}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${materialSectionRowsHtml}</table></td></tr>` +
    `<tr><td>${sectionHeadingHtml("Customer Contact")}</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsToHtml(contactRows)}</table></td></tr>` +
    (options.dashboardUrl
      ? `<tr><td style="padding-top:18px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td style="background-color:${EMAIL_NAVY};border-radius:6px;">` +
        `<a href="${escapeHtml(options.dashboardUrl)}" style="display:inline-block;padding:10px 18px;color:#FFFFFF;font-size:13px;font-weight:700;text-decoration:none;border-radius:6px;">View enquiry in dashboard &nbsp;&rarr;</a>` +
        `</td></tr></table></td></tr>`
      : "");

  const footer = footerHtml(`<div style="color:${EMAIL_GRAY_FOOTER};font-size:12px;font-weight:400;margin-top:4px;">Owner notification</div>`);

  const html = emailDocumentHtml(subject, twoToneRuleHtml() + bodyRows, footer, logoHeaderHtml(eyebrowHtml));

  return { subject, text, html };
}
