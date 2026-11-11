import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, MapPin, Phone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OwnerLeadListItem as OwnerLeadListItemType } from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  formatQuantity,
  formatPhoneForDisplay,
  formatUaeDateTimeConcise,
  formatCaptureChannelVia,
  formatEmirateLabel,
  formatPersonName,
} from "./owner-lead-format";

/**
 * A single Enquiries row. A real `<a>` (via TanStack `Link`), never a
 * clickable `<div>`, so it is keyboard-reachable and screen-reader-
 * announced as a link on its own.
 *
 * Column order (left to right): Contact | Material/quantity | Location |
 * Status | Received (UAE) | Type | Reference | Chevron. Every DATA column
 * is left-aligned (both the cell as a whole, via the shared grid's
 * `justify-items-start`, and each line within it) — only the trailing
 * Chevron overrides this, via `justify-self-center`, to sit centred in its
 * own narrow track.
 *
 * The column template is declared exactly ONCE, on the shared `<ul>` in
 * OwnerLeadInbox.tsx; every row (`<li>` + its `<Link>`) opts into
 * `grid-cols-subgrid` + `col-span-full` via CSS subgrid, so no row ever
 * recomputes its own track sizes independently.
 */
export interface OwnerLeadListItemProps {
  readonly lead: OwnerLeadListItemType;
}

/**
 * The ONE column template, shared by the parent `<ul>` (OwnerLeadInbox.tsx),
 * its column-heading row, and every row's subgrid — one declaration,
 * guaranteed alignment, never independently-sized tracks that can drift
 * apart. Eight tracks: Contact, Material/quantity, Location, Status,
 * Received, Type, Reference, Chevron — Type and Reference are separate
 * fixed-width tracks (no longer a shared combo box) so the badge and
 * reference never crowd each other. Chevron keeps its own fixed narrow
 * trailing track. `justify-items-start` (and on OWNER_LEAD_ROW_SUBGRID_CLASS
 * below) left-aligns every cell under its header.
 *
 * `gap-x-4` — deliberately NOT the `gap-4` shorthand. On the header (one
 * row) and each row's own subgrid (also one row) that distinction is inert,
 * but on the parent `<ul>` every `<li>` is itself a grid ROW of this same
 * grid — `gap-4` would set `row-gap` too, inserting an extra 16px band
 * between every pair of rows on top of each row's own `border-b`. Since a
 * row-gap only ever appears *between* rows, the first row (nothing above
 * it) never got one, while every row after it did — reading as "extra
 * blank space above the content" on every row but the first, once row
 * heights became uniform enough to make that 16px band visually obvious.
 * `gap-x-4` keeps the needed 16px between columns without adding any
 * vertical space between rows at all — row separation is the `border-b`
 * alone, matching every row's identical padding.
 *
 * Status track stays `165px` at both breakpoints — sized to the longest
 * entries in OWNER_LEAD_STATUS_LABELS, "Needs information" and
 * "Pickup / delivery" (17 characters each): ~7px/char at the badge's
 * `text-xs font-semibold` (12px) → 119px text + 28px `px-3.5` padding +
 * 2px `border` = 149px, plus a ~16px containment allowance = 165px. That
 * required width doesn't change with alignment mode (left vs centred) —
 * only where the badge sits inside the track changes, not how much room
 * it needs — so the value carries over unchanged now that Status is
 * left-aligned instead of centred.
 *
 * GRID-DENSITY CORRECTION (`sm`) — Contact/Material/Location's `fr`
 * multipliers were reduced (`1.3/1.2/1` → `0.9/0.75/0.65`) because they
 * were consuming far more width than their actual content (a name+phone, a
 * material+quantity, an emirate+area) ever needs, which pushed every
 * column from Status onward needlessly far right. Reference changed from a
 * bare fixed `140px` to `minmax(140px,0.3fr)` — a guaranteed floor (never
 * narrower than its old fixed width) plus a small `fr` share, so it — not
 * Contact/Material/Location — absorbs the freed width.
 *
 * `lg` — a SECOND, larger correction: the first three columns switched
 * from `fr`-based (proportional, and still too generous even after the
 * `sm` reduction above) to bare FIXED pixel widths — `220px`/`200px`/
 * `190px` — a compact, content-sized allowance for Contact/Material/
 * Location instead of a proportional share of whatever's left. Because
 * these three no longer claim `fr` space at all, Status/Received/Type/
 * Reference all start substantially further left than either the original
 * or the first (`fr`-based) correction achieved. Reference is
 * `minmax(170px,1fr)` — the ONLY remaining `fr` track at `lg`, so it alone
 * absorbs 100% of whatever width isn't consumed by the seven fixed/floored
 * tracks before it, which is what keeps the Chevron's own fixed `24px`
 * track anchored flush at the grid's right edge regardless of viewport
 * width.
 *
 * `lg` — THIRD, precise re-spacing pass (Status/Received right, Type left,
 * Reference/Chevron unmoved): Location `190px→206px` (+16px, pushing
 * Status's start — and, since Status's own width is unchanged, Received's
 * start too — 16px right); Received `155px→123px` (-32px, so despite
 * starting 16px later it now ENDS 16px earlier, moving Type's start 16px
 * left); Type `100px→116px` (+16px, so despite starting 16px earlier it
 * still ENDS at its original position). Net change across Location/
 * Received/Type = +16-32+16 = 0px, so the total fixed-track budget
 * consumed before Reference is unchanged — Reference (the sole `fr` track)
 * and Chevron land at their exact prior positions with no edit needed to
 * either.
 */
// OVERFLOW-SOURCE FIX — the `lg:` tracks below used to be bare fixed pixel
// widths (220px/200px/206px/165px/123px/116px + a minmax(170px,1fr)
// Reference floor + 24px Chevron). Summed with their 7 gap-x-4 gaps (112px)
// and the row's own sm:px-4 padding (32px), that's a hard 1368px minimum —
// wider than OWNER_CONTAINER_CLASS's available content width
// (max-w-[1760px], minus its own lg:px-12 padding) on any viewport
// narrower than ~1464px, forcing genuine horizontal overflow (confirmed via
// this arithmetic, not just the reported scrollbar strip) at ordinary
// laptop widths like 1366/1440px even though `lg:` had already engaged.
// Wrapping each in `minmax(0, Npx)` (and dropping Reference's own 170px
// floor to plain `1fr`) makes every one of those tracks a *ceiling*, not a
// floor: at any width with enough room — including the 2048px reference
// screenshot — every track still renders at exactly its original preferred
// size, byte-identical visually; only below that ~1464px threshold do they
// now shrink proportionally instead of forcing the table wider than its
// container. Chevron's bare `24px` is deliberately left as-is — its own
// contribution to the total is negligible and it holds a fixed-size icon.
export const OWNER_LEAD_ROW_GRID_CLASS =
  "sm:grid sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.75fr)_minmax(0,0.65fr)_165px_150px_100px_minmax(140px,0.3fr)_16px] sm:items-center sm:justify-items-start sm:gap-x-4 lg:grid-cols-[minmax(0,220px)_minmax(0,200px)_minmax(0,206px)_minmax(0,165px)_minmax(0,123px)_minmax(0,116px)_minmax(0,1fr)_24px]";

/** Applied to a row's own `<li>`/`<Link>` so it participates in the parent grid's columns via subgrid rather than establishing its own independent track sizing. */
const OWNER_LEAD_ROW_SUBGRID_CLASS = "sm:col-span-full sm:grid sm:grid-cols-subgrid sm:justify-items-start";

/**
 * One shared, FIXED height for every row — not a `min-height`. A floor lets
 * naturally-taller content (different line counts, an extra badge) keep
 * growing past it, so two rows can still end up with different *computed*
 * heights even though both satisfy the floor; a fixed height removes that
 * content-driven variance entirely; every ordinary row (two-line cells,
 * one badge) renders at exactly this height regardless of which cells
 * happen to be one line vs two. 64px comfortably contains the tallest
 * ordinary content (two text lines ~38px + `py-2.5` ~20px padding, border-
 * box) with room to spare, and still fits the rare second-line indicator
 * (notification-attention / In Trash) without clipping — but a row that
 * genuinely needed a third line would have to be handled separately, since
 * a fixed height cannot grow. Applied to both the `<li>` (the actual grid
 * row/track) and the `<Link>` inside it, per this pass's explicit
 * requirement — the `<li>`'s own value makes the outer grid's row track
 * itself that exact size, rather than relying on the inner `<Link>` alone.
 */
const ROW_HEIGHT_CLASS = "sm:h-[64px]";

/** A restrained placeholder for a genuinely missing value — never an ambiguous blank gap in an otherwise-populated row. */
const MISSING = "—";

/** Consistent primary-line treatment shared by Contact/Material/Location's first line — equally readable, none competing harder than another. */
const PRIMARY_TEXT_CLASS = "truncate text-sm font-medium text-foreground";
/** Consistent secondary-line treatment — phone, quantity, area, capture channel all read as quiet supporting detail. */
const SECONDARY_TEXT_CLASS = "truncate text-xs text-muted-foreground";
/** A left-aligned, two-line (primary + secondary) cell stack — Contact/Material/Location/Received all share this exact wrapper so their content lines up flush under the header and groups cleanly regardless of line-length differences. */
const CELL_STACK_CLASS = "flex min-w-0 max-w-full flex-col items-start gap-0.5 text-left";
/** Fixed-width leading slot for the Location primary line's optional MapPin icon (`size-3` = 12px, matched exactly) — always rendered, with or without the icon inside it, so the line's visible text starts at the same x-axis whether a location value is present ("emirate" branch) or absent ("Not provided" branch). Never conditionally omitted. */
const LOCATION_ICON_SLOT_CLASS = "inline-flex w-3 shrink-0 items-center justify-center";

export function OwnerLeadListItem({ lead }: OwnerLeadListItemProps) {
  const needsNotificationAttention = lead.notificationStatus === "attention";
  const isTrashed = lead.deletedAt !== null;
  const quantity = formatQuantity(lead.quantity.value, lead.quantity.unit);
  const submitted = formatUaeDateTimeConcise(lead.submissionCompletedAt);
  const displayPhone = formatPhoneForDisplay(lead.contact.phone);
  const emirateLabel = formatEmirateLabel(lead.location.emirate);
  const hasLocation = Boolean(emirateLabel || lead.location.area);

  return (
    <li className={`border-b border-white/10 last:border-b-0 ${OWNER_LEAD_ROW_SUBGRID_CLASS} ${ROW_HEIGHT_CLASS}`}>
      <Link
        to="/owner/leads/$leadId"
        params={{ leadId: lead.id }}
        className={`group flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${OWNER_LEAD_ROW_SUBGRID_CLASS} ${ROW_HEIGHT_CLASS} sm:items-center sm:gap-4 sm:px-0`}
      >
        {/* 1. Contact — name is the row's strongest primary text, phone second. */}
        <div className={CELL_STACK_CLASS}>
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
        </div>

        {/* 2. Material + quantity — material first and primary, quantity/unit second. */}
        <div className={CELL_STACK_CLASS}>
          <p className={PRIMARY_TEXT_CLASS}>{OWNER_LEAD_MATERIAL_LABELS[lead.material]}</p>
          <p className={SECONDARY_TEXT_CLASS}>{quantity ?? MISSING}</p>
        </div>

        {/* 3. Location — emirate first and primary (with the location icon),
            area/secondary location second. A wholly missing location is one
            restrained "Not provided" line, never a broken empty line.
            LOCATION_ICON_SLOT_CLASS is always rendered — present with the
            MapPin icon inside it, or empty — so the primary line's visible
            text always starts at the exact same x-axis whether or not a
            location value exists, instead of "Not provided" sitting flush
            left while an icon-bearing row's text sits ~16px further right. */}
        <div className={CELL_STACK_CLASS}>
          {hasLocation ? (
            <>
              <p className={`inline-flex items-center gap-1 ${PRIMARY_TEXT_CLASS}`}>
                <span className={LOCATION_ICON_SLOT_CLASS} aria-hidden="true">
                  {emirateLabel ? <MapPin className="size-3 text-foreground/50" aria-hidden="true" /> : null}
                </span>
                {emirateLabel ?? MISSING}
              </p>
              <p className={SECONDARY_TEXT_CLASS}>{lead.location.area ?? MISSING}</p>
            </>
          ) : (
            <p className={`inline-flex items-center gap-1 ${SECONDARY_TEXT_CLASS}`}>
              <span className={LOCATION_ICON_SLOT_CLASS} aria-hidden="true" />
              Not provided
            </p>
          )}
        </div>

        {/* 4. Status — neutral, semibold text (CHECKPOINT OWNER ENQUIRIES
            SIX-CIRCLE PASS — per-status colour removed; status is no
            longer the row's own colour-coded signal, just a clearly
            weighted value). No dot, badge, or pill. Left-aligned flush with
            the Status track's left edge. The notification-attention
            indicator, when present, sits below it, left-aligned too. */}
        <div className={CELL_STACK_CLASS}>
          <p className="truncate text-sm font-semibold text-foreground">{OWNER_LEAD_STATUS_LABELS[lead.status]}</p>
          {needsNotificationAttention ? (
            <Badge
              variant="outline"
              className="inline-flex w-fit items-center gap-1 whitespace-nowrap border-rose-400/25 bg-rose-400/10 text-[10px] text-rose-300"
              title="Owner email notification could not be delivered. The enquiry is safely stored."
            >
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              Email alert failed
            </Badge>
          ) : null}
        </div>

        {/* 5. Received (UAE) — the timestamp is the first line; the capture channel reads beneath it as a quiet "Via ..." fragment, never repeating "(UAE time)" per row. */}
        <div className={CELL_STACK_CLASS}>
          <p className={PRIMARY_TEXT_CLASS}>{submitted ?? MISSING}</p>
          <p className={SECONDARY_TEXT_CLASS}>{formatCaptureChannelVia(lead.captureChannel)}</p>
        </div>

        {/* 6. Type (Selling/Buying) — neutral text, same PRIMARY_TEXT_CLASS
            typography as every other primary value (CHECKPOINT OWNER
            ENQUIRIES SIX-CIRCLE PASS — per-intent colour removed, matching
            Status's own neutral treatment). Its own column now that it's
            no longer sharing a track with the reference. */}
        <div className="flex min-w-0 max-w-full items-center">
          <p className={PRIMARY_TEXT_CLASS}>{OWNER_LEAD_INTENT_LABELS[lead.intent]}</p>
        </div>

        {/* 7. Reference — its own column, restrained but visually important:
            the existing copper-bright accent, semibold, the app's own sans
            font (never monospace). The In Trash indicator, when present,
            sits beneath it, matching the Status column's own
            primary-badge-plus-conditional-secondary-line pattern so it
            never grows the row beyond the shared row height. */}
        <div className={CELL_STACK_CLASS}>
          <p className="min-w-0 truncate text-sm font-semibold text-copper-bright">{lead.reference}</p>
          {isTrashed ? (
            <Badge variant="outline" className="inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap border-white/15 bg-white/5 text-[10px] text-foreground/55">
              <Trash2 className="size-3" aria-hidden="true" />
              In Trash
            </Badge>
          ) : null}
        </div>

        <ChevronRight
          className="hidden size-4 shrink-0 justify-self-center text-foreground/40 transition-[transform,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[2px] group-hover:text-copper group-focus-within:translate-x-[2px] group-focus-within:text-copper sm:block"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
