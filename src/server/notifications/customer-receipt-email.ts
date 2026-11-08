/**
 * CHECKPOINT (design: docs/email-design/customer-approved.png) — pure
 * customer-facing enquiry-received confirmation email rendering. No I/O,
 * no Supabase, no provider — mirrors owner-notification-email.ts's own
 * "plain function from validated lead data to {subject, text, html},
 * unit-testable without any network or database" shape exactly.
 *
 * Deliberately minimal content, by design (not an oversight): subject
 * carries the reference; body carries only the reference, Sell/Buy,
 * material, and approximate quantity, plus one fixed follow-up sentence.
 * Nothing else — no phone, no exact location (emirate/area/map link), no
 * company, no notes, no file/photo status, no dashboard link, no price or
 * response-time promise. This is an external, customer-facing message with
 * a materially different privacy/commitment posture than the owner
 * notification, so it is its own renderer rather than a parameterized
 * variant of renderOwnerNotificationEmail — reuses the shared table-safe
 * HTML building blocks (email-template-shared.ts) rather than duplicating
 * them, but never the owner template's recipient, dashboardUrl, or
 * file-status concepts.
 *
 * Sender/recipient/subject/provider/delivery/idempotency behavior is
 * entirely owned by dispatch-notification.server.ts and is unchanged by
 * this design update — this module only ever returns {subject, text,
 * html}.
 */
import {
  escapeHtml,
  humanizeCode,
  unitLabel,
  sanitizeHeaderValue,
  emailDocumentHtml,
  referenceBlockHtml,
  tableRowHtmlUppercaseLabel,
  footerHtmlInline,
  EMAIL_NAVY,
  EMAIL_COPPER,
  EMAIL_GRAY_HAIRLINE,
} from "./email-template-shared";
import type { OwnerNotificationLeadData } from "./owner-notification-email";

/**
 * Reuses OwnerNotificationLeadData's shape (already fetched/transformed once
 * per dispatch) purely for its field layout — this renderer only ever reads
 * reference/intent/material(+subtype/other text) and the active branch's
 * quantity fields from it, never any seller- or buyer-prefixed contact,
 * location, notes or file-related field.
 */
export type CustomerReceiptLeadData = OwnerNotificationLeadData;

export interface RenderedCustomerReceiptEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The one fixed body paragraph — never varied, never combined with a price, availability, or response-time claim. Exact approved copy from docs/email-design/customer-approved.png. */
export const CUSTOMER_RECEIPT_BODY_PARAGRAPH =
  "Thank you for contacting MSM Scrap. Our team will review the details and contact you using your preferred method.";

function materialLabel(lead: CustomerReceiptLeadData): string | null {
  const base = lead.material === "other" ? (lead.materialOtherText ?? "Other") : humanizeCode(lead.material);
  const subtype =
    lead.materialSubtype === "other"
      ? (lead.materialSubtypeOtherText ?? "Other")
      : lead.materialSubtype
        ? humanizeCode(lead.materialSubtype)
        : null;
  return subtype ? `${base} — ${subtype}` : base;
}

function formatQuantity(value: string | null, unit: string | null, unitOther: string | null): string | null {
  if (!value) return null;
  const label = unit === "other" ? (unitOther ?? "other") : unit ? unitLabel(unit) : "";
  return label ? `${value} ${label}` : value;
}

function quantityLine(lead: CustomerReceiptLeadData): string | null {
  if (lead.intent === "sell") {
    if (lead.sellerQuantityUnsure) return "Not sure";
    return formatQuantity(lead.sellerQuantityValue, lead.sellerQuantityUnit, lead.sellerQuantityUnitOther);
  }
  return formatQuantity(lead.buyerQuantityValue, lead.buyerQuantityUnit, lead.buyerQuantityUnitOther);
}

/** The single full-width copper rule beneath the logo header — the customer design's own divider treatment (distinct from the owner design's two-tone copper+navy rule). Thin bar with deliberate padding above and below so it never touches the eyebrow row that follows. */
function copperRuleHtml(): string {
  return (
    `<tr><td style="padding:14px 0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="background-color:${EMAIL_COPPER};height:2px;font-size:0;line-height:0;">&nbsp;</td>` +
    `</tr></table></td></tr>`
  );
}

export function renderCustomerReceiptEmail(lead: CustomerReceiptLeadData): RenderedCustomerReceiptEmail {
  const intentLabel = lead.intent === "sell" ? "Sell to MSM" : "Buy from MSM";
  const subject = sanitizeHeaderValue(`Enquiry received — ${lead.reference}`);
  const material = materialLabel(lead);
  const quantity = quantityLine(lead);

  const textLines: string[] = [
    "MSM Scrap",
    "",
    "Your enquiry is in.",
    CUSTOMER_RECEIPT_BODY_PARAGRAPH,
    "",
    `Reference: ${lead.reference}`,
    `Request: ${intentLabel}`,
    ...(material ? [`Material: ${material}`] : []),
    ...(quantity ? [`Approx. quantity: ${quantity}`] : []),
    "",
    "Please keep this reference for any follow-up.",
  ];
  const text = textLines.join("\n");

  const rowSpecs: Array<{ label: string; value: string }> = [
    { label: "Request", value: escapeHtml(intentLabel) },
    ...(material ? [{ label: "Material", value: escapeHtml(material) }] : []),
    ...(quantity ? [{ label: "Approx. quantity", value: escapeHtml(quantity) }] : []),
  ];
  const rowsHtml = rowSpecs
    .map((row, i) => tableRowHtmlUppercaseLabel(row.label, row.value, i === rowSpecs.length - 1))
    .join("");

  const bodyRows =
    `<tr><td style="color:${EMAIL_COPPER};font-size:12px;font-weight:700;letter-spacing:0.05em;">ENQUIRY &nbsp;/&nbsp; CONFIRMED</td></tr>` +
    `<tr><td style="color:${EMAIL_NAVY};font-size:24px;font-weight:700;line-height:1.3;padding-top:8px;">Your enquiry is in.</td></tr>` +
    `<tr><td style="color:#374151;font-size:14px;font-weight:400;line-height:1.5;padding-top:12px;">${escapeHtml(CUSTOMER_RECEIPT_BODY_PARAGRAPH)}</td></tr>` +
    `<tr><td style="padding-top:18px;">${referenceBlockHtml(lead.reference)}</td></tr>` +
    `<tr><td style="padding-top:10px;border-top:1px solid ${EMAIL_GRAY_HAIRLINE};font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table></td></tr>` +
    `<tr><td style="color:#374151;font-size:14px;font-weight:400;line-height:1.5;padding-top:18px;">Please keep this reference for any follow-up.</td></tr>`;

  const footer = footerHtmlInline(
    `<a href="https://msmscrap.com" style="color:${EMAIL_COPPER};font-size:12px;font-weight:400;text-decoration:none;">msmscrap.com</a>`,
  );

  const html = emailDocumentHtml(subject, copperRuleHtml() + bodyRows, footer);

  return { subject, text, html };
}
