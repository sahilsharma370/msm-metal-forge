/**
 * CHECKPOINT C2H-B1 — pure owner-notification email rendering. No I/O, no
 * Supabase, no provider — a plain function from validated lead data to
 * {subject, text, html}, unit-testable without any network or database.
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
 */

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
  /** Only rendered as a link when the caller (the dispatcher, reading getEmailConfig()) supplies one — never guessed or constructed here. */
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

/** Standard HTML entity escaping — the only thing standing between a customer-controlled string and the html body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips CR/LF so a customer-controlled value can never inject a second email header — applied to every value that ends up in subject/from/to/reply-to anywhere in this pipeline (this module only ever produces `subject`, which is why it's the only place this is called from here). */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Renders a block of free-text (notes/description) as escaped, paragraph-broken HTML — the only place this module turns customer newlines into markup, and only ever inside the body, never a header. */
function escapeMultilineHtml(value: string): string {
  return escapeHtml(value)
    .split(/\r?\n/)
    .map((line) => line || "&nbsp;")
    .join("<br>");
}

function humanizeCode(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatQuantity(value: string | null, unit: string | null, unitOther: string | null): string | null {
  if (!value) return null;
  const label = unit === "other" ? (unitOther ?? "other") : unit ? humanizeCode(unit) : "";
  return label ? `${value} ${label}` : value;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  // leads.seller_pickup_date / buyer_required_by_date are plain `date` columns (YYYY-MM-DD) — rendered as-is, never re-parsed with a timezone-sensitive Date object.
  return value;
}

interface Row {
  readonly label: string;
  readonly value: string | null;
}

function rows(...entries: Row[]): Row[] {
  return entries.filter((row) => row.value !== null && row.value.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildSellerRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Material", value: materialLabel(lead) },
    {
      label: "Quantity",
      value: lead.sellerQuantityUnsure
        ? "Not sure"
        : formatQuantity(lead.sellerQuantityValue, lead.sellerQuantityUnit, lead.sellerQuantityUnitOther),
    },
    { label: "Condition", value: lead.sellerCondition ? humanizeCode(lead.sellerCondition) : null },
    { label: "Description", value: lead.sellerDescription },
    { label: "Emirate", value: lead.sellerEmirate ? humanizeCode(lead.sellerEmirate) : null },
    { label: "Area", value: lead.sellerArea },
    { label: "Map link", value: lead.sellerMapLink },
    { label: "Pickup required", value: lead.sellerPickupRequired ? humanizeCode(lead.sellerPickupRequired) : null },
    { label: "Preferred pickup date", value: formatDate(lead.sellerPickupDate) },
    { label: "Access notes", value: lead.sellerAccessNote },
    { label: "Name", value: lead.sellerName },
    { label: "Phone", value: lead.sellerPhone },
    { label: "Company", value: lead.sellerCompany },
    { label: "Email", value: lead.sellerEmail },
    { label: "Preferred contact", value: lead.sellerPreferredContact ? humanizeCode(lead.sellerPreferredContact) : null },
    { label: "Notes", value: lead.sellerNotes },
  );
}

function buildBuyerRows(lead: OwnerNotificationLeadData): Row[] {
  return rows(
    { label: "Material", value: materialLabel(lead) },
    { label: "Specification", value: lead.materialSpec },
    { label: "Required quantity", value: formatQuantity(lead.buyerQuantityValue, lead.buyerQuantityUnit, lead.buyerQuantityUnitOther) },
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
    { label: "Contact person", value: lead.buyerContactPerson },
    { label: "Phone", value: lead.buyerPhone },
    { label: "Company", value: lead.buyerCompany },
    { label: "Email", value: lead.buyerEmail },
    { label: "Preferred contact", value: lead.buyerPreferredContact ? humanizeCode(lead.buyerPreferredContact) : null },
    { label: "Notes", value: lead.buyerNotes },
  );
}

function materialLabel(lead: OwnerNotificationLeadData): string | null {
  const base = lead.material === "other" ? (lead.materialOtherText ?? "Other") : humanizeCode(lead.material);
  const subtype =
    lead.materialSubtype === "other"
      ? (lead.materialSubtypeOtherText ?? "Other")
      : lead.materialSubtype
        ? humanizeCode(lead.materialSubtype)
        : null;
  return subtype ? `${base} — ${subtype}` : base;
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

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function renderOwnerNotificationEmail(
  lead: OwnerNotificationLeadData,
  fileStats: OwnerNotificationFileStats,
  options: OwnerNotificationEmailOptions = {},
): RenderedOwnerEmail {
  const intentLabel = lead.intent === "sell" ? "seller" : "buyer";
  const subject = sanitizeHeaderValue(`New ${intentLabel} enquiry — ${lead.reference}`);
  const sectionRows = lead.intent === "sell" ? buildSellerRows(lead) : buildBuyerRows(lead);

  const textLines: string[] = [
    "New MSM Scrap enquiry",
    `Reference: ${lead.reference}`,
    `Type: ${lead.intent === "sell" ? "Sell to MSM" : "Buy from MSM"}`,
    "",
    ...sectionRows.map((row) => `${row.label}: ${row.value}`),
    "",
    `Files: ${fileStatusLabel(fileStats)}`,
    `Submitted: ${lead.submittedAt}`,
  ];
  if (options.dashboardUrl) {
    textLines.push("", `View in dashboard: ${options.dashboardUrl}`);
  }
  const text = textLines.join("\n");

  const htmlRows = sectionRows
    .map(
      (row) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:4px 0;">${escapeMultilineHtml(row.value ?? "")}</td></tr>`,
    )
    .join("");
  const dashboardHtml = options.dashboardUrl
    ? `<p><a href="${escapeHtml(options.dashboardUrl)}">View in dashboard</a></p>`
    : "";
  const html =
    `<div>` +
    `<h1 style="font-size:18px;">New MSM Scrap enquiry</h1>` +
    `<p><strong>Reference:</strong> ${escapeHtml(lead.reference)}<br>` +
    `<strong>Type:</strong> ${lead.intent === "sell" ? "Sell to MSM" : "Buy from MSM"}</p>` +
    `<table cellspacing="0" cellpadding="0">${htmlRows}</table>` +
    `<p><strong>Files:</strong> ${escapeHtml(fileStatusLabel(fileStats))}<br>` +
    `<strong>Submitted:</strong> ${escapeHtml(lead.submittedAt)}</p>` +
    dashboardHtml +
    `</div>`;

  return { subject, text, html };
}
