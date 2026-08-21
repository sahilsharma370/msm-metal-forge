import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, MapPin, Phone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OwnerLeadListItem as OwnerLeadListItemType } from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_STATUS_BADGE_CLASS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_NOTIFICATION_STATUS_LABELS,
  formatQuantity,
  formatPhoneForDisplay,
  formatUaeDateTimeConcise,
  formatCaptureChannelVia,
  formatEmirateLabel,
  formatPersonName,
} from "./owner-lead-format";

/**
 * CHECKPOINT C2J-D / C2L-V4 / OWNER DESKTOP REFINEMENT / OWNER DESKTOP
 * CORRECTION / C2M-A / OWNER DESKTOP CORRECTION (hierarchy pass) — a single
 * Enquiries row. A real `<a>` (via TanStack `Link`), never a clickable
 * `<div>`, so it is keyboard-reachable and screen-reader-announced as a
 * link on its own.
 *
 * Column order (left to right): Contact | Material/quantity | Location |
 * Status | Received (UAE) | Type/reference | Chevron. Within each column,
 * one line is the "primary" reading value (customer name, material name,
 * emirate, the received timestamp) at consistent size/weight, and a second
 * line is always muted secondary detail (phone, quantity, area, capture
 * channel) — reference is the smallest, quietest text on the row (still
 * present and searchable, just no longer competing with the customer's
 * name for attention).
 *
 * Alignment: the shared grid uses `items-start` (not `items-center`) so
 * every column's PRIMARY line — including the single-line Status badge —
 * starts at the same row-top baseline, regardless of whether a given
 * column has a second, secondary line beneath it.
 *
 * CHECKPOINT C2M-A — alignment fix (still in force): the column template
 * is declared exactly ONCE, on the shared `<ul>` in OwnerLeadInbox.tsx;
 * every row (`<li>` + its `<Link>`) opts into `grid-cols-subgrid` +
 * `col-span-full` via CSS subgrid, so no row ever recomputes its own track
 * sizes independently.
 */
export interface OwnerLeadListItemProps {
  readonly lead: OwnerLeadListItemType;
}

/** The ONE column template, shared by the parent `<ul>` (OwnerLeadInbox.tsx), its column-heading row, and every row's subgrid — one declaration, guaranteed alignment, never independently-sized tracks that can drift apart. */
export const OWNER_LEAD_ROW_GRID_CLASS =
  "sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_120px_150px_150px_16px] sm:items-start sm:gap-4";

/** Applied to a row's own `<li>`/`<Link>` so it participates in the parent grid's columns via subgrid rather than establishing its own independent track sizing. */
const OWNER_LEAD_ROW_SUBGRID_CLASS = "sm:col-span-full sm:grid sm:grid-cols-subgrid";

/** A restrained placeholder for a genuinely missing value — never an ambiguous blank gap in an otherwise-populated row. */
const MISSING = "—";

/** Consistent primary-line treatment shared by Contact/Material/Location's first line — equally readable, none competing harder than another. */
const PRIMARY_TEXT_CLASS = "truncate text-sm font-medium text-foreground";
/** Consistent secondary-line treatment — phone, quantity, area, capture channel all read as quiet supporting detail. */
const SECONDARY_TEXT_CLASS = "truncate text-xs text-muted-foreground";

export function OwnerLeadListItem({ lead }: OwnerLeadListItemProps) {
  const needsNotificationAttention = lead.notificationStatus === "attention";
  const isTrashed = lead.deletedAt !== null;
  const quantity = formatQuantity(lead.quantity.value, lead.quantity.unit);
  const submitted = formatUaeDateTimeConcise(lead.submissionCompletedAt);
  const displayPhone = formatPhoneForDisplay(lead.contact.phone);
  const emirateLabel = formatEmirateLabel(lead.location.emirate);
  const hasLocation = Boolean(emirateLabel || lead.location.area);

  return (
    <li className={`border-b border-white/10 last:border-b-0 ${OWNER_LEAD_ROW_SUBGRID_CLASS}`}>
      <Link
        to="/owner/leads/$leadId"
        params={{ leadId: lead.id }}
        className={`flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${OWNER_LEAD_ROW_SUBGRID_CLASS} sm:items-start sm:gap-4`}
      >
        {/* 1. Contact — name is the row's strongest primary text. */}
        <div className="min-w-0 space-y-0.5">
          <p className={PRIMARY_TEXT_CLASS}>{formatPersonName(lead.contact.name) ?? "No name provided"}</p>
          <span className={`inline-flex items-center gap-1 ${SECONDARY_TEXT_CLASS}`}>
            {displayPhone ? (
              <>
                <Phone className="size-3 shrink-0" aria-hidden="true" />
                {displayPhone}
              </>
            ) : (
              MISSING
            )}
          </span>
          {needsNotificationAttention ? (
            <Badge variant="destructive" className="inline-flex w-fit items-center gap-1 text-[10px]">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {OWNER_NOTIFICATION_STATUS_LABELS[lead.notificationStatus]}
            </Badge>
          ) : null}
        </div>

        {/* 2. Material + quantity — material name reads as equally primary as the customer's name. */}
        <div className="min-w-0 space-y-0.5">
          <p className={PRIMARY_TEXT_CLASS}>{OWNER_LEAD_MATERIAL_LABELS[lead.material]}</p>
          <p className={SECONDARY_TEXT_CLASS}>{quantity ?? MISSING}</p>
        </div>

        {/* 3. Location — emirate is the primary line, area is secondary
            detail. A wholly missing location (neither emirate nor area) is
            one restrained "Not provided" line, never two stacked em-dashes
            stacked on top of each other. */}
        <div className="min-w-0 space-y-0.5">
          {hasLocation ? (
            <>
              <p className={`inline-flex items-center gap-1 ${PRIMARY_TEXT_CLASS}`}>
                {emirateLabel ? <MapPin className="size-3 shrink-0 text-foreground/50" aria-hidden="true" /> : null}
                {emirateLabel ?? MISSING}
              </p>
              <p className={SECONDARY_TEXT_CLASS}>{lead.location.area ?? MISSING}</p>
            </>
          ) : (
            <p className={SECONDARY_TEXT_CLASS}>Not provided</p>
          )}
        </div>

        {/* 4. Status — restrained semantic colour per status, aligned to the same top baseline as every other column's primary line. */}
        <div className="min-w-0">
          <Badge variant="outline" className={`text-[10px] ${OWNER_LEAD_STATUS_BADGE_CLASS[lead.status]}`}>
            {OWNER_LEAD_STATUS_LABELS[lead.status]}
          </Badge>
        </div>

        {/* 5. Received (UAE) — the timestamp is the first line; the capture channel reads beneath it as a quiet "Via ..." fragment, never repeating "(UAE time)" per row. */}
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-xs text-foreground/80">{submitted ?? MISSING}</p>
          <p className={SECONDARY_TEXT_CLASS}>{formatCaptureChannelVia(lead.captureChannel)}</p>
        </div>

        {/* 6. Type / reference — a restrained type badge, with the reference as the smallest, quietest metadata on the row (still visible and searchable). */}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={lead.intent === "sell" ? "accent" : "secondary"} className="text-[10px]">
              {OWNER_LEAD_INTENT_LABELS[lead.intent]}
            </Badge>
            {isTrashed ? (
              <Badge variant="outline" className="inline-flex items-center gap-1 border-white/15 bg-white/5 text-[10px] text-foreground/55">
                <Trash2 className="size-3" aria-hidden="true" />
                In Trash
              </Badge>
            ) : null}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground/80">{lead.reference}</p>
        </div>

        <ChevronRight className="hidden size-4 shrink-0 text-foreground/40 sm:block" aria-hidden="true" />
      </Link>
    </li>
  );
}
