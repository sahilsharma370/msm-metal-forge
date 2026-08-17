import { normalizePhoneNumber } from "@/components/site/quote/quote-schema";
import { buildWhatsAppUrl } from "@/components/site/quote/quote-summary";
import type {
  OwnerLeadStatus,
  OwnerLeadCaptureChannel,
  OwnerLeadMaterial,
  OwnerLeadIntent,
  OwnerNotificationSummaryStatus,
} from "@/lib/owner/owner-leads-contract";
import type { OwnerLeadFileUploadStatus, OwnerLeadActivityActorType } from "@/lib/owner/owner-lead-detail-contract";

/**
 * CHECKPOINT C2J-D — pure, no-I/O display formatting for the owner Manage
 * UI. Every map below is total over its vocabulary's real values (imported
 * from the canonical contracts, never re-typed by hand) so a new value
 * added to the contract in a future checkpoint fails a type check here
 * rather than silently rendering nothing. Reuses the site's own existing
 * normalizePhoneNumber/buildWhatsAppUrl — no second implementation.
 */

// ---------------------------------------------------------------------------
// Vocabulary labels
// ---------------------------------------------------------------------------

export const OWNER_LEAD_STATUS_LABELS: Record<OwnerLeadStatus, string> = {
  new: "New",
  needs_information: "Needs information",
  contacted: "Contacted",
  inspection: "Inspection",
  quote_sent: "Quote sent",
  pickup_delivery: "Pickup / delivery",
  completed: "Completed",
  lost: "Lost",
  archived: "Archived",
};

export const OWNER_LEAD_CAPTURE_CHANNEL_LABELS: Record<OwnerLeadCaptureChannel, string> = {
  website: "Website",
  phone: "Phone",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  owner_manual: "Manual entry",
};

export const OWNER_LEAD_MATERIAL_LABELS: Record<OwnerLeadMaterial, string> = {
  copper: "Copper",
  aluminium: "Aluminium",
  steel_iron: "Steel / iron",
  lead: "Lead",
  other: "Other",
};

export const OWNER_LEAD_INTENT_LABELS: Record<OwnerLeadIntent, string> = {
  sell: "Selling",
  buy: "Buying",
};

export const OWNER_NOTIFICATION_STATUS_LABELS: Record<OwnerNotificationSummaryStatus, string> = {
  sent: "Sent",
  pending: "Pending",
  attention: "Attention required",
};

export const OWNER_LEAD_FILE_UPLOAD_STATUS_LABELS: Record<OwnerLeadFileUploadStatus, string> = {
  pending: "Uploading",
  complete: "Complete",
  failed: "Failed",
};

export const OWNER_LEAD_ACTIVITY_ACTOR_LABELS: Record<OwnerLeadActivityActorType, string> = {
  system: "System",
  owner: "Owner",
};

const OWNER_LEAD_ACTIVITY_EVENT_LABELS: Record<string, string> = {
  lead_created: "Enquiry received",
  submission_completed: "Submission completed",
  status_changed: "Status changed",
  note_added: "Private note added",
};

/** Falls back to a humanized version of an unrecognized event_type (underscores -> spaces, capitalized) rather than showing raw snake_case, without inventing a fixed vocabulary the database itself does not enforce. */
export function formatActivityEventType(eventType: string): string {
  const known = OWNER_LEAD_ACTIVITY_EVENT_LABELS[eventType];
  if (known) return known;
  const humanized = eventType.replace(/_/g, " ").trim();
  return humanized.length > 0 ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : eventType;
}

const QUANTITY_UNIT_LABELS: Record<string, string> = {
  kg: "kg",
  tonnes: "tonnes",
  pieces: "pcs",
  load: "load",
  other: "unit",
};

export function formatQuantityUnit(unit: string | null): string {
  if (!unit) return "";
  return QUANTITY_UNIT_LABELS[unit] ?? unit;
}

export function formatQuantity(value: number | null, unit: string | null): string | null {
  if (value === null) return null;
  const unitLabel = formatQuantityUnit(unit);
  return unitLabel ? `${formatNumber(value)} ${unitLabel}` : formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-AE").format(value);
}

// ---------------------------------------------------------------------------
// Free-text labels for the smaller enquiry vocabularies — same
// underscore-to-words fallback rule as activity event types, since some of
// these (e.g. seller_quantity_unit_other) are genuinely free text, not a
// fixed CHECK-constraint vocabulary.
// ---------------------------------------------------------------------------

const SIMPLE_VOCAB_LABELS: Record<string, string> = {
  clean_separated: "Clean, separated",
  mixed: "Mixed",
  used_surplus: "Used / surplus",
  not_sure: "Not sure",
  yes: "Yes",
  no: "No",
  whatsapp: "WhatsApp",
  call: "Call",
  email: "Email",
  local: "Local",
  import: "Import",
  export: "Export",
  delivery: "Delivery",
  collection: "Collection",
  discuss: "To discuss",
  jebel_ali: "Jebel Ali",
  khalifa_port: "Khalifa Port",
  other: "Other",
  no_preference: "No preference",
};

/** Safe, generic label lookup for the small enquiry-branch vocabularies (condition, pickup, preferred contact, trade requirement, fulfilment, preferred port) — falls back to a humanized version of the raw value for anything unmapped, never blank. */
export function formatSimpleVocab(value: string | null): string | null {
  if (!value) return null;
  const known = SIMPLE_VOCAB_LABELS[value];
  if (known) return known;
  const humanized = value.replace(/_/g, " ").trim();
  return humanized.length > 0 ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : value;
}

// ---------------------------------------------------------------------------
// Dates — Asia/Dubai display, matching this project's own UAE-only
// business context (see generate_lead_reference()'s own Asia/Dubai day
// code). The underlying ISO timestamp is never mutated, only displayed.
// ---------------------------------------------------------------------------

const UAE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-AE", {
  timeZone: "Asia/Dubai",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Returns null for an unparseable timestamp rather than showing "Invalid Date". */
export function formatUaeDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${UAE_DATE_TIME_FORMATTER.format(date)} (UAE time)`;
}

// ---------------------------------------------------------------------------
// File sizes
// ---------------------------------------------------------------------------

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 ? 1 : 0;
  return `${value.toFixed(precision)} ${BYTE_UNITS[unitIndex]}`;
}

// ---------------------------------------------------------------------------
// Call / WhatsApp — reuses normalizePhoneNumber (the one canonical phone
// normalizer) and buildWhatsAppUrl (the one canonical wa.me URL builder,
// already established in quote-summary.ts) rather than a second
// implementation of either.
// ---------------------------------------------------------------------------

export function buildTelHref(phone: string | null): string | null {
  const canonical = normalizePhoneNumber(phone ?? undefined);
  return canonical ? `tel:${canonical}` : null;
}

/** No prefilled message in this checkpoint — an empty body still produces a valid wa.me link that opens a chat with the contact. */
export function buildOwnerWhatsAppHref(phone: string | null): string | null {
  const canonical = normalizePhoneNumber(phone ?? undefined);
  if (!canonical) return null;
  return buildWhatsAppUrl(canonical.replace(/^\+/, ""), "");
}
