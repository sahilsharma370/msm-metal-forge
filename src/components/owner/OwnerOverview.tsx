import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerPageHeader, OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import type { UseOwnerLeadOverviewResult } from "./use-owner-lead-overview";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  formatUaeDateTime,
  formatUaeCalendarDateShort,
} from "./owner-lead-format";
import type { OwnerLeadOverviewData } from "@/lib/owner/owner-lead-overview-contract";

/**
 * CHECKPOINT C2L-V3 / OWNER DESKTOP REFINEMENT — the /owner/overview page
 * body. Purely presentational (every piece of state comes from
 * useOwnerLeadOverview, owned by the route). Fixed operational reading
 * order: (1) four KPI cards, (2) breakdowns, (3) seven-day trend. Panels are
 * now the same matte navy surface as every other operational panel in this
 * batch (`border border-white/10 bg-navy-deep/95`) — glass stays reserved
 * for the shell's stationary nav capsule only (see OwnerNav.tsx).
 *
 * The "Follow-ups due" attention panel that previously lived here has been
 * removed (visible-section removal only) — the underlying
 * stale/attentionCount/attentionLeads fields still exist on
 * OwnerLeadOverviewData and are still computed server-side
 * (owner-lead-overview.server.ts is untouched); this component simply no
 * longer renders them.
 *
 * No revenue, conversion, percentage, or forecast figures anywhere — only
 * literal counts already present in the owner-visible lead data.
 */
export interface OwnerOverviewProps extends UseOwnerLeadOverviewResult {}

/** The shared matte panel surface for every Overview card — one declaration, reused everywhere below instead of restating the recipe per component. */
const OVERVIEW_PANEL_CLASS = "rounded-2xl border border-white/10 bg-navy-deep/95";

/**
 * The four headline KPI cards — action-first order (New, Open, Completed,
 * Total). All four are now plain, static cards: the existing contracts have
 * no URL-driven filter/search-schema support for the Enquiries list to deep-
 * link into (see use-owner-lead-list.ts), and inventing one would be a
 * scope/contract expansion this batch doesn't authorize — so none of them
 * offer a pointer/hover affordance that implies a drill-down the app can't
 * actually perform. Navigation to Enquiries stays available through the
 * primary nav, as it always was. No icons anywhere in this row either: none
 * of New/Open/Completed/Total has a single glyph that reads as clearly and
 * consistently meaningful as the other three, and a card-by-card mixture of
 * "some have icons, some don't" was exactly the incoherence being corrected.
 */
function StatTile({ label, value, hint }: { readonly label: string; readonly value: number; readonly hint?: string }) {
  return (
    <div className={`${OVERVIEW_PANEL_CLASS} px-5 py-4`}>
      <p className="text-xs font-medium text-foreground/70">{label}</p>
      <p className="font-display mt-1 text-[32px] leading-none font-semibold text-foreground">{value}</p>
      {/* CHECKPOINT OWNER DESKTOP CORRECTION (contrast pass) — the Open
          card's "Includes New & other active statuses" hint was at /50,
          faint enough to be hard to read on the navy card; bumped to /65. */}
      {hint ? <p className="mt-1 text-[11px] text-foreground/65">{hint}</p> : null}
    </div>
  );
}

/**
 * CHECKPOINT C2M-A — restores the complete ordered category vocabulary
 * (the API always returned every category with an honest 0 for the ones
 * that never occurred — see zeroCounts() in owner-lead-overview.server.ts —
 * only this component's own rendering ever hid them). A zero-count
 * category still renders — label, an empty (unfilled) track, and a plain
 * muted "0" — so the owner can see the complete system at a glance, just
 * visually de-emphasized (reduced opacity, no bar, no percentage) rather
 * than fabricating a bar that isn't there. A non-zero bar's width is now
 * `count / total enquiries` (the same grand total for every panel), not
 * `count / the largest value in that one panel` — so bar length is
 * comparable across panels and actually means something quantitative,
 * paired with its exact count. Bar width still represents `count / total
 * enquiries` internally (so length stays comparable across panels), but no
 * percentage label is shown any more — count-only, per this batch's own
 * correction. Bars use the same restrained mid-tier copper token as the
 * seven-day chart, never the bright primary-button treatment.
 */
function BreakdownList({
  title,
  entries,
  total,
}: {
  readonly title: string;
  readonly entries: readonly (readonly [label: string, count: number])[];
  readonly total: number;
}) {
  return (
    <div className={`${OVERVIEW_PANEL_CLASS} p-4`}>
      <h3 className="font-display mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="space-y-2.5">
        {entries.map(([label, count]) => {
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            // CHECKPOINT OWNER DESKTOP CORRECTION (contrast pass) — zero
            // rows stay visually de-emphasized relative to non-zero rows
            // (never competing with active values), but /45 opacity plus a
            // /50 count made both the label and the "0" uncomfortably faint
            // against the navy card. Bumped to /65 row opacity + /70 count
            // text — still clearly muted, now comfortably readable.
            <li key={label} className={`flex items-center gap-4 ${count === 0 ? "opacity-65" : ""}`}>
              <span className="w-32 shrink-0 truncate text-xs text-foreground/80">{label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                {count > 0 ? <span className="block h-full rounded-full bg-copper" style={{ width: `${percent}%` }} /> : null}
              </span>
              <span className={`w-8 shrink-0 text-right text-xs ${count > 0 ? "font-medium text-foreground" : "text-foreground/70"}`}>
                {count}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION (sparkline pass) — replaces the prior
 * CSS bar chart with a restrained inline SVG line (no chart library, no
 * area fill/gradient/glow/animation/tooltip). The UAE-day bucketing/counting
 * logic is entirely untouched (still `dailyCounts` straight from the API) —
 * only the visual representation changed. A genuinely empty day's point
 * sits exactly on the baseline (never padded to look non-empty, matching
 * this panel's own prior "honest zeros" rule); the exact count and date
 * stay plain, always-visible text under each point, and the row keeps its
 * one accessible group label so a screen reader gets a coherent summary
 * rather than seven disconnected decorative points. `viewBox` uses
 * abstract units (not pixels) with `preserveAspectRatio="none"` so the line
 * scales to whatever width the panel renders at, matching the container's
 * own responsive sizing rather than a fixed pixel chart. CHECKPOINT OWNER
 * DESKTOP CORRECTION (sparkline alignment pass) — each point now sits at
 * the centre of its own day-slot (matching the count/date labels below,
 * which are laid out as seven equal flex slots), and markers are plain
 * absolutely-positioned HTML dots rather than SVG `<circle>`s: under
 * `preserveAspectRatio="none"`, x and y scale by different factors (the
 * viewBox is 100x32 against a wide, short rendered box), which stretches
 * any SVG-geometry circle into a horizontal oval — `vector-effect:
 * non-scaling-stroke` only protects stroke width, not a circle's radius. A
 * small fixed-size CSS dot positioned by percentage is unaffected by that
 * scaling and stays genuinely round at any width.
 */
function DailyCountsSparkline({ dailyCounts }: { readonly dailyCounts: OwnerLeadOverviewData["dailyCounts"] }) {
  const total = dailyCounts.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...dailyCounts.map((day) => day.count));

  const VIEWBOX_WIDTH = 100;
  const VIEWBOX_HEIGHT = 32;
  const TOP_PADDING = 4;
  const BASELINE_Y = VIEWBOX_HEIGHT - 4;

  const points = dailyCounts.map((day, index) => {
    // Centred in this day's equal-width slot (not edge-to-edge) — matches
    // the seven equal flex slots the count/date labels render in below, and
    // keeps the first/last points fully inside the chart rather than
    // sitting flush on its left/right edge.
    const x = ((index + 0.5) / dailyCounts.length) * VIEWBOX_WIDTH;
    const y = day.count === 0 ? BASELINE_Y : BASELINE_Y - (day.count / max) * (BASELINE_Y - TOP_PADDING);
    return { x, y, day };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className={`${OVERVIEW_PANEL_CLASS} p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-foreground">Enquiries — last 7 days</h3>
        {total === 0 ? <span className="text-xs text-foreground/60">No enquiries in this window.</span> : null}
      </div>
      <div role="group" aria-label={`Enquiries per day: ${dailyCounts.map((day) => `${day.date}, ${day.count}`).join("; ")}`}>
        <div className="relative h-16 w-full">
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1={BASELINE_Y}
              x2={VIEWBOX_WIDTH}
              y2={BASELINE_Y}
              className="stroke-white/10"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={linePoints}
              fill="none"
              className="stroke-copper"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {points.map((point) => (
            <span
              key={point.day.date}
              aria-hidden="true"
              className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-copper"
              style={{ left: `${point.x}%`, top: `${(point.y / VIEWBOX_HEIGHT) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between gap-2">
          {dailyCounts.map((day) => (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-0.5">
              <span className="text-xs font-medium text-foreground">{day.count}</span>
              <span className="text-[10px] text-foreground/60">{formatUaeCalendarDateShort(day.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OwnerOverview({ state, refresh }: OwnerOverviewProps) {
  if (state.isLoading && !state.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <OwnerPageHeader title="Overview" />
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-1 flex-col gap-5 py-6`}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <OwnerPageHeader title="Overview" />
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-col items-center gap-3 py-16 text-center`}>
          <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
          <p className="text-sm text-foreground">{state.error}</p>
          <Button type="button" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const data = state.data;
  if (!data) return null;

  const statusEntries = Object.entries(OWNER_LEAD_STATUS_LABELS).map(
    ([status, label]) => [label, data.byStatus[status as keyof typeof data.byStatus] ?? 0] as const,
  );
  const intentEntries = Object.entries(OWNER_LEAD_INTENT_LABELS).map(
    ([intent, label]) => [label, data.byIntent[intent as keyof typeof data.byIntent] ?? 0] as const,
  );
  const materialEntries = Object.entries(OWNER_LEAD_MATERIAL_LABELS).map(
    ([material, label]) => [label, data.byMaterial[material as keyof typeof data.byMaterial] ?? 0] as const,
  );
  const channelEntries = Object.entries(OWNER_LEAD_CAPTURE_CHANNEL_LABELS).map(
    ([channel, label]) => [label, data.byCaptureChannel[channel as keyof typeof data.byCaptureChannel] ?? 0] as const,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OwnerPageHeader title="Overview" description={`Updated ${formatUaeDateTime(data.generatedAt) ?? data.generatedAt}`} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-col gap-5 py-6`}>
          {/* 1. Four primary KPI cards — action-first order. All four are
              plain static cards; see StatTile's own comment for why. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="New" value={data.totals.new} />
            <StatTile label="Open" value={data.totals.open} hint="Includes New & other active statuses" />
            <StatTile label="Completed" value={data.totals.completed} />
            <StatTile label="Total enquiries" value={data.totals.total} />
          </div>

          {/* 2. Status/material/enquiry-type/source breakdowns — two
              independent balanced columns (each its own natural-height
              stack of two panels) rather than a single 2x2 grid, which
              previously left a large blank gap whenever one row's panels
              were taller than the other's. Left: Status, then Enquiry
              type. Right: Material, then Source. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <BreakdownList title="Status" entries={statusEntries} total={data.totals.total} />
              <BreakdownList title="Enquiry type" entries={intentEntries} total={data.totals.total} />
            </div>
            <div className="flex flex-col gap-4">
              <BreakdownList title="Material" entries={materialEntries} total={data.totals.total} />
              <BreakdownList title="Source" entries={channelEntries} total={data.totals.total} />
            </div>
          </div>

          {/* 3. Enquiries in the last 7 UAE days — last in reading order. */}
          <DailyCountsSparkline dailyCounts={data.dailyCounts} />
        </div>
      </div>
    </div>
  );
}
