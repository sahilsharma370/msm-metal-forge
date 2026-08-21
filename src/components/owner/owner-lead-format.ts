import { normalizePhoneNumber } from "@/components/site/quote/quote-schema";
import { buildWhatsAppUrl } from "@/components/site/quote/quote-summary";
import { EMIRATE_LABELS, type QuoteEmirate } from "@/components/site/quote/quote-options";
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

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION (list hierarchy pass) — the list row's
 * "Via {channel}" secondary line under the received timestamp. Deliberately
 * a distinct, lowercase-except-brand-names vocabulary from
 * OWNER_LEAD_CAPTURE_CHANNEL_LABELS above (which stays Title Case for
 * badges/detail/forms elsewhere) — this phrase reads as a sentence
 * fragment, not a label.
 */
const OWNER_LEAD_CAPTURE_CHANNEL_VIA_LABELS: Record<OwnerLeadCaptureChannel, string> = {
  website: "Via website",
  phone: "Via phone",
  whatsapp: "Via WhatsApp",
  walk_in: "Via walk-in",
  owner_manual: "Via manual entry",
};

export function formatCaptureChannelVia(channel: OwnerLeadCaptureChannel): string {
  return OWNER_LEAD_CAPTURE_CHANNEL_VIA_LABELS[channel];
}

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION (small fixes pass) — presentation-case
 * emirate name for the Enquiries list row (e.g. "sharjah" -> "Sharjah"),
 * reusing the ONE canonical EMIRATE_LABELS map already used by the Quote
 * flow and Quick Add form — never a second label list, and never a change
 * to the stored lowercase-enum value itself. Falls back to the raw value
 * for anything outside the known 7-emirate vocabulary (defensive only —
 * the DB CHECK constraint already guarantees this never happens in practice).
 */
export function formatEmirateLabel(emirate: string | null): string | null {
  if (!emirate) return null;
  return EMIRATE_LABELS[emirate as QuoteEmirate] ?? emirate;
}

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION (capitalization pass) — presentation-
 * only Title Case for a customer's contact name, e.g. "rakesh" -> "Rakesh".
 * A word already carrying an uppercase letter past its first character
 * (e.g. "McDonald", "MOHAMMED") is left exactly as typed — re-casing it
 * would be as likely to break an intentional spelling as to fix an
 * accidental one. Splits on spaces/hyphens so each side of a hyphenated
 * name is capitalized independently ("al-farsi" -> "Al-Farsi"). Purely a
 * display transform — the stored contact name is never mutated, and this
 * is never applied to free-text Area.
 */
export function formatPersonName(name: string | null): string | null {
  if (!name) return name;
  return name.replace(/[^\s-]+/g, (word) => {
    if (word.length === 0) return word;
    const rest = word.slice(1);
    if (/\p{Lu}/u.test(rest)) return word;
    return word.charAt(0).toUpperCase() + rest;
  });
}

/** CHECKPOINT OWNER DESKTOP CORRECTION (Overview pass) — the seven-day chart's per-day label, e.g. "15 Aug" rather than the raw "08-15" slice of a YYYY-MM-DD key. `dateKey` is already a UAE calendar date with no time/zone of its own (see owner-lead-overview.server.ts's own uaeDateKey) — parsed as UTC midnight, which a +4h Asia/Dubai conversion can only ever move forward within that same calendar date, never roll it back a day. */
const UAE_CALENDAR_DATE_SHORT_FORMATTER = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", day: "numeric", month: "short" });
export function formatUaeCalendarDateShort(dateKey: string): string {
  return UAE_CALENDAR_DATE_SHORT_FORMATTER.format(new Date(`${dateKey}T00:00:00Z`));
}

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
  not_required: "Notification not required",
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
  lead_details_updated: "Enquiry details updated",
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
// CHECKPOINT C2M-A — concise row-level UAE timestamp. The list already
// discloses "UAE" once at the column-heading level (see OwnerLeadInbox's
// "Channel / received (UAE)" heading), so every row repeating "(UAE time)"
// is pure noise there; the detail screen keeps the full, exact timestamp
// via formatUaeDateTime above, unchanged.
// ---------------------------------------------------------------------------

const UAE_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" });
const UAE_TIME_ONLY_FORMATTER = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", hour12: true });
const UAE_DAY_MONTH_FORMATTER = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", day: "2-digit", month: "short" });
const UAE_DAY_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", day: "2-digit", month: "short", year: "numeric" });

/**
 * "Today, 3:29 PM" / "Yesterday, 5:03 PM" / "18 Aug, 5:03 PM" — the year is
 * appended only when it differs from the current UAE calendar year. UAE
 * observes no DST (see this project's own UAE-day-bucketing precedent in
 * owner-lead-overview.server.ts), so a plain 24h subtraction always lands
 * on the correct previous Asia/Dubai calendar day. `now` is an injectable
 * parameter purely for deterministic testing; real call sites omit it.
 */
export function formatUaeDateTimeConcise(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const time = UAE_TIME_ONLY_FORMATTER.format(date);
  const dateKey = UAE_DATE_KEY_FORMATTER.format(date);
  const todayKey = UAE_DATE_KEY_FORMATTER.format(now);
  if (dateKey === todayKey) return `Today, ${time}`;

  const yesterdayKey = UAE_DATE_KEY_FORMATTER.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (dateKey === yesterdayKey) return `Yesterday, ${time}`;

  const sameYear = dateKey.slice(0, 4) === todayKey.slice(0, 4);
  const dayMonth = (sameYear ? UAE_DAY_MONTH_FORMATTER : UAE_DAY_MONTH_YEAR_FORMATTER).format(date);
  return `${dayMonth}, ${time}`;
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

/** `mailto:` needs no normalization the way phone numbers do — a stored email already passed the same-shape CHECK constraint at write time (lowercase, one @, no whitespace). Returns null only when there is genuinely no email to link to. */
export function buildOwnerMailtoHref(email: string | null): string | null {
  return email ? `mailto:${email}` : null;
}

export type OwnerLeadPrimaryContactAction = "call" | "whatsapp" | "email";

/**
 * CHECKPOINT C2M-A — resolves which single contact action is primary
 * (copper) on the detail screen's Contact card, in priority order:
 *
 *   1. The customer's own stated preferredContact, whenever the matching
 *      channel actually has a value (a stated preference with nothing to
 *      act on is not usable).
 *   2. For a Quick Add lead (preferredContact is never captured there —
 *      see owner-lead-quick-add-contract.ts's own header comment), the
 *      capture channel is used as a safe hint ONLY when it unambiguously
 *      implies a method: 'whatsapp' -> WhatsApp, 'phone' -> Call.
 *      'walk_in'/'website'/'owner_manual' carry no contact-method signal
 *      and are deliberately not guessed.
 *   3. Otherwise, Call before WhatsApp before Email — matching this
 *      screen's pre-existing "Call is primary whenever available" default.
 *
 * Never returns a method whose underlying value doesn't exist — the caller
 * (OwnerLeadDetailView) additionally never renders an action button at all
 * for a method with no value, regardless of what this function returns.
 */
export function resolvePrimaryContactAction(input: {
  readonly preferredContact: string | null;
  readonly captureChannel: OwnerLeadCaptureChannel;
  readonly hasPhone: boolean;
  readonly hasEmail: boolean;
}): OwnerLeadPrimaryContactAction | null {
  const { preferredContact, captureChannel, hasPhone, hasEmail } = input;

  if (preferredContact === "whatsapp" && hasPhone) return "whatsapp";
  if (preferredContact === "call" && hasPhone) return "call";
  if (preferredContact === "email" && hasEmail) return "email";

  if (!preferredContact) {
    if (captureChannel === "whatsapp" && hasPhone) return "whatsapp";
    if (captureChannel === "phone" && hasPhone) return "call";
  }

  if (hasPhone) return "call";
  if (hasEmail) return "email";
  return null;
}

/**
 * CHECKPOINT C2M-A — display-only UAE phone grouping, e.g.
 * "+971501234567" -> "+971 50 123 4567". Never used for `tel:`/WhatsApp
 * hrefs (buildTelHref/buildOwnerWhatsAppHref keep using the canonical
 * E.164 form via normalizePhoneNumber, untouched) — this is purely
 * cosmetic, local grouping logic rather than a phone-formatting library,
 * since no such dependency already exists in this codebase and one row-
 * level display tweak does not justify adding one. A non-UAE E.164 number
 * (any country code other than +971) falls back to a generic
 * "country code, then the rest" split rather than guessing a grouping
 * scheme this function cannot verify (country-code length varies 1-3
 * digits in a way that can't be reliably detected from the digit string
 * alone) — a non-UAE number is returned unchanged rather than risking an
 * incorrect grouping. This project's contact base is UAE-only in practice.
 */
export function formatPhoneForDisplay(canonicalPhone: string | null): string | null {
  if (!canonicalPhone) return null;
  const uae = canonicalPhone.match(/^\+971(\d{9})$/);
  if (!uae) return canonicalPhone;
  const digits = uae[1] as string;
  return `+971 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
}

// ---------------------------------------------------------------------------
// CHECKPOINT C2M-A — restrained, semantic status-badge colour mapping.
// Applied as a className override on top of the shared ui/Badge's
// `variant="outline"` base (tailwind-merge resolves the conflicting
// border/bg/text utilities in the caller's favour — see src/lib/utils.ts's
// own `cn` helper) rather than adding new badgeVariants entries, since
// these six colours are specific to lead-status semantics and have no
// other consumer in the design system. Every treatment stays a translucent
// tint + soft border, matching `warning`/`accent`'s own restrained recipe —
// never a solid, bright fill ("rainbow badges").
// ---------------------------------------------------------------------------

const ACTIVE_PROGRESSION_STATUS_CLASS = "border-sky-400/30 bg-sky-400/10 text-sky-300";

export const OWNER_LEAD_STATUS_BADGE_CLASS: Record<OwnerLeadStatus, string> = {
  new: "border-copper-bright/40 bg-copper-bright/10 text-copper-bright",
  needs_information: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  contacted: ACTIVE_PROGRESSION_STATUS_CLASS,
  inspection: ACTIVE_PROGRESSION_STATUS_CLASS,
  quote_sent: ACTIVE_PROGRESSION_STATUS_CLASS,
  pickup_delivery: ACTIVE_PROGRESSION_STATUS_CLASS,
  completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  lost: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  archived: "border-white/15 bg-white/5 text-foreground/55",
};
