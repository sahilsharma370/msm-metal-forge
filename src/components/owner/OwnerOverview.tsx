import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileStack,
  FileText,
  Link2,
  Package,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import type { UseOwnerLeadOverviewResult } from "./use-owner-lead-overview";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  formatUaeCalendarDateShort,
} from "./owner-lead-format";
import { OWNER_LEAD_STATUS_VALUES, OWNER_LEAD_MATERIAL_VALUES, OWNER_LEAD_CAPTURE_CHANNEL_VALUES } from "@/lib/owner/owner-leads-contract";
import type { OwnerLeadOverviewData, OwnerLeadOverviewWindow, OwnerOverviewDailyCount } from "@/lib/owner/owner-lead-overview-contract";

/**
 * Visual-correction pass — matched against a canonical target screenshot
 * (1672x941) rather than the original inspiration reference. Data/logic is
 * unchanged from the prior pass (see useOwnerLeadOverview); every edit here
 * is styling only: explicit hex colours (never `var(--copper)` as an SVG
 * fill — Recharts does not reliably resolve CSS custom properties there,
 * which was rendering the donut's "orange" segment as flat grey), fixed
 * compact card heights instead of viewport-proportional sizing, and a
 * page-local compact heading composed directly here (never touching
 * OwnerPageHeader's own shared default styling, which Enquiries also
 * uses).
 */
export interface OwnerOverviewProps extends UseOwnerLeadOverviewResult {}

// ---------------------------------------------------------------------------
// Target-sampled colour tokens — Overview-page-local only, deliberately not
// routed through the shared `--copper` CSS variable (see module comment).
// ---------------------------------------------------------------------------

const OVERVIEW_BG = "#000F24";
const ORANGE = "#FB7C36";
const BUYING_BLUE = "#4D92FC";
const TRACK_BG = "#132846";
const CARD_BORDER_COLOR = "#1E3A5F";
const TEXT_SECONDARY = "#B9C7DC";
const TEXT_MUTED = "#7E93B3";

const CARD_CLASS = "rounded-[13px] border bg-gradient-to-b from-[#021B38] to-[#00112E]";
const CARD_STYLE = { borderColor: `${CARD_BORDER_COLOR}99` };

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, trivially testable in isolation. Unchanged from
// the prior pass.
// ---------------------------------------------------------------------------

/** Total across a daily-count series. */
export function sumDailyCounts(days: readonly OwnerOverviewDailyCount[]): number {
  return days.reduce((sum, day) => sum + day.count, 0);
}

/** Highest single day's count in a series (0 for an empty/zero series). */
export function peakDailyCount(days: readonly OwnerOverviewDailyCount[]): number {
  return days.reduce((max, day) => Math.max(max, day.count), 0);
}

/** "18 Sep — 24 Sep" from a daily-count series' own first/last UAE calendar dates — never re-derives "today" itself, just formats the boundary dates the API already computed. */
export function formatUaeDateRangeLabel(days: readonly OwnerOverviewDailyCount[]): string {
  if (days.length === 0) return "";
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  return `${formatUaeCalendarDateShort(first.date)} — ${formatUaeCalendarDateShort(last.date)}`;
}

/** Dynamic Y-axis ticks: 5 evenly-spaced rounded values (0..niceMax) where niceMax is always a clean multiple of 4 steps — e.g. a peak of 11 yields [0,3,6,9,12]. A zero-peak series still yields [0,1,2,3,4] rather than a degenerate all-zero axis. */
export function computeNiceYAxisTicks(maxValue: number): readonly number[] {
  const step = Math.max(1, Math.ceil(maxValue / 4));
  return [0, step, step * 2, step * 3, step * 4];
}

/** count/max as a 0-100 bar width — 0, never NaN/Infinity, when max is 0 (an all-zero list). */
function safeBarPercent(count: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
}

interface RankedEntry {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/** Sell/Buy split as two percentages that always sum to exactly 100 (when total > 0) — `sellPercent` is rounded to the nearest integer (11/16 -> 68.75% -> 69%, matching the approved reference), and `buyPercent` is the exact remainder, never independently rounded, so the pair can never drift off 100. */
function computeDonutSplit(sell: number, buy: number): { readonly sellPercent: number; readonly buyPercent: number } {
  const total = sell + buy;
  if (total === 0) return { sellPercent: 0, buyPercent: 0 };
  const sellPercent = Math.round((sell / total) * 100);
  return { sellPercent, buyPercent: 100 - sellPercent };
}

// ---------------------------------------------------------------------------
// KPI row — fixed 116px-tall cards (one-screen-fit pass — was 127px), icon
// rendered directly (no tinted square), number anchored to the card's
// bottom edge.
// ---------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  status,
}: {
  readonly icon: typeof FileText;
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
  /** Omitted (Total) navigates to Enquiries with no filter; a status value deep-links straight to that status. */
  readonly status?: (typeof OWNER_LEAD_STATUS_VALUES)[number];
}) {
  return (
    <div className={`${CARD_CLASS} flex h-[116px] flex-col justify-between px-4 py-3.5`} style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-5 shrink-0" style={{ color: ORANGE }} aria-hidden="true" />
          <span className="truncate text-sm font-medium" style={{ color: TEXT_SECONDARY }}>
            {label}
          </span>
        </div>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-[#5C7699] hover:bg-white/5 hover:text-[#FB7C36]"
          aria-label={`View ${label} in Enquiries`}
        >
          <Link to="/owner" search={status ? { status } : {}}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <div>
        <p className="font-display text-[40px] leading-none font-semibold tabular-nums text-white">{value}</p>
        {/* CHECKPOINT OWNER OVERVIEW SIX-CIRCLE PASS — always rendered (never
            conditionally omitted), `invisible` (not absent) when there is no
            real hint: the outer card uses `justify-between` to bottom-pin
            this value+hint block as a single unit, so the value's own
            baseline previously sat higher on every card WITH a hint (Open)
            than on every card WITHOUT one (Total/New/Completed) — the hint
            line's own height was what the block's bottom edge measured
            from. Reserving the same slot on every card unconditionally
            means the value's own position is identical across all four,
            regardless of which one happens to carry a hint. */}
        <p className={`mt-1 truncate text-[11px] ${hint ? "" : "invisible"}`} style={{ color: TEXT_MUTED }}>
          {hint ?? "placeholder"}
        </p>
      </div>
    </div>
  );
}

/**
 * CHECKPOINT OWNER MOBILE HEADER FIX — a fixed 2-column grid below `lg` left
 * each card's own label row (icon + text + chevron) with only ~50px for the
 * text at phone widths, truncating even short labels like "New"/"Open" to a
 * single letter at 320px. One column below `sm` gives every label its full
 * card width instead.
 */
function KpiRow({ window: dataWindow }: { readonly window: OwnerLeadOverviewWindow }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard icon={FileStack} label="Total enquiries" value={dataWindow.totals.total} />
      <KpiCard icon={FileText} label="New" value={dataWindow.totals.new} status="new" />
      <KpiCard icon={Clock} label="Open" value={dataWindow.totals.open} hint="Includes New & other active statuses" />
      <KpiCard icon={CheckCircle2} label="Completed" value={dataWindow.totals.completed} status="completed" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranked horizontal bar list — shared by Status pipeline / Material mix /
// Source. Bar width is normalized against the HIGHEST count in this one
// list (never the grand total). `flex-1` + `justify-between` on the list
// itself (not a fixed row gap) is what makes the same component correctly
// fill 9 rows inside a 360px card and 5 rows inside a 216px card without a
// separate density variant.
// ---------------------------------------------------------------------------

function RankedBarList({ entries }: { readonly entries: readonly RankedEntry[] }) {
  const max = entries.reduce((m, entry) => Math.max(m, entry.count), 0);
  return (
    <ul className="flex flex-1 flex-col justify-between">
      {entries.map((entry) => {
        const percent = safeBarPercent(entry.count, max);
        return (
          <li key={entry.key} className="flex items-center gap-3">
            <span className="w-[112px] shrink-0 truncate text-[13px]" style={{ color: TEXT_SECONDARY }}>
              {entry.label}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: TRACK_BG }}>
              {percent > 0 ? <span className="block h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: ORANGE }} /> : null}
            </span>
            <span className="w-8 shrink-0 text-right text-[13px] font-medium tabular-nums text-white">{entry.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function CardTitle({ icon: Icon, children }: { readonly icon?: typeof Package; readonly children: string }) {
  return (
    <h3 className="mb-2 flex shrink-0 items-center gap-2 text-lg font-semibold text-white">
      {Icon ? <Icon className="size-4" style={{ color: ORANGE }} aria-hidden="true" /> : null}
      {children}
    </h3>
  );
}

function StatusPipeline({ window: dataWindow }: { readonly window: OwnerLeadOverviewWindow }) {
  const entries: RankedEntry[] = OWNER_LEAD_STATUS_VALUES.map((status) => ({
    key: status,
    label: OWNER_LEAD_STATUS_LABELS[status],
    count: dataWindow.byStatus[status] ?? 0,
  }));
  return (
    <div className={`${CARD_CLASS} flex h-full min-h-0 flex-col p-4`} style={CARD_STYLE}>
      <CardTitle>Status pipeline</CardTitle>
      <RankedBarList entries={entries} />
    </div>
  );
}

function MaterialMix({ window: dataWindow }: { readonly window: OwnerLeadOverviewWindow }) {
  const entries: RankedEntry[] = [...OWNER_LEAD_MATERIAL_VALUES]
    .map((material) => ({ key: material, label: OWNER_LEAD_MATERIAL_LABELS[material], count: dataWindow.byMaterial[material] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return (
    <div className={`${CARD_CLASS} flex h-[204px] flex-col p-4`} style={CARD_STYLE}>
      <CardTitle icon={Package}>Material mix</CardTitle>
      <RankedBarList entries={entries} />
    </div>
  );
}

function Source({ window: dataWindow }: { readonly window: OwnerLeadOverviewWindow }) {
  const entries: RankedEntry[] = OWNER_LEAD_CAPTURE_CHANNEL_VALUES.map((channel) => ({
    key: channel,
    label: OWNER_LEAD_CAPTURE_CHANNEL_LABELS[channel],
    count: dataWindow.byCaptureChannel[channel] ?? 0,
  }));
  return (
    <div className={`${CARD_CLASS} flex h-[204px] flex-col p-4`} style={CARD_STYLE}>
      <CardTitle icon={Link2}>Source</CardTitle>
      <RankedBarList entries={entries} />
    </div>
  );
}

/**
 * Selling (orange) vs Buying (blue) donut, total centred with a `TOTAL`
 * label beneath it, Selling/Buying summarised as two aligned rows (square
 * marker, label, count, muted percentage) to the right of a subtle
 * divider, with a second subtle divider between the two rows themselves.
 * `computeDonutSplit` guarantees the two percentages always sum to exactly
 * 100 (when total > 0).
 *
 * `paddingAngle` on `<Pie>` opens the small gaps between the two ring
 * segments the approved reference shows; it has no visible effect on the
 * zero-total fallback (a single full-circle entry has no second segment
 * to gap against).
 *
 * `<Cell>` elements are rendered one-per-entry via `chartData.map()`,
 * DIRECTLY as `<Pie>` children — never wrapped in a `<>...</>` Fragment.
 * Recharts walks `Pie`'s children looking for `Cell` elements to associate
 * with each data index; a Fragment wrapper breaks that association and it
 * silently falls back to its own default grey fill instead of the `fill`
 * prop actually passed — this, not an unresolved CSS variable, was the
 * real cause of the grey segment (fills here were already explicit hex).
 */
function EnquiryTypeRow({ color, label, count, percent }: { readonly color: string; readonly label: string; readonly count: number; readonly percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="flex-1 truncate text-[13px]" style={{ color: TEXT_SECONDARY }}>
        {label}
      </span>
      <span className="text-[15px] font-semibold tabular-nums text-white">{count}</span>
      <span className="w-9 shrink-0 text-right text-[12px] tabular-nums" style={{ color: TEXT_MUTED }}>
        {percent}%
      </span>
    </div>
  );
}

function EnquiryType({ window: dataWindow }: { readonly window: OwnerLeadOverviewWindow }) {
  const sell = dataWindow.byIntent.sell ?? 0;
  const buy = dataWindow.byIntent.buy ?? 0;
  const total = sell + buy;
  const { sellPercent, buyPercent } = computeDonutSplit(sell, buy);
  const chartData =
    total > 0
      ? [
          { key: "sell", value: sell, fill: ORANGE },
          { key: "buy", value: buy, fill: BUYING_BLUE },
        ]
      : [{ key: "empty", value: 1, fill: TRACK_BG }];

  return (
    <div className={`${CARD_CLASS} flex h-[204px] flex-col p-3`} style={CARD_STYLE}>
      <CardTitle icon={ArrowLeftRight}>Enquiry type</CardTitle>
      {/* CHECKPOINT OWNER OVERVIEW SIX-CIRCLE PASS — restores the approved
          ~148px donut (a prior "one-screen-fit" pass had shrunk it to
          120px to fit this card's own 204px height at p-4 padding). Tighter
          p-3 padding on this one card (not the shared CARD_CLASS other
          cards still use) recovers exactly the ~12px needed: title row
          (~32px incl. margin) + 148px circle + p-3's 24px vertical padding
          = 204px, the unchanged card height every sibling in this row also
          uses. Stroke scaled proportionally with the diameter (7px at
          120px -> 9px at 148px) so the ring reads the same relative
          thickness, not thinner for being on a bigger circle. paddingAngle
          is now always 0 — clean adjoining segments, no gap between
          Selling/Buying, matching the approved reference exactly (an
          earlier pass had added a 6° gap; removed). Same centre, same
          colours, 12-o'clock start (startAngle=90/endAngle=-270),
          unchanged. */}
      <div className="grid flex-1 grid-cols-[148px_1px_1fr] items-center gap-4">
        <div className="relative size-[148px] shrink-0" role="img" aria-label={`Selling ${sell} (${sellPercent}%), Buying ${buy} (${buyPercent}%)`}>
          <div aria-hidden="true" className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  innerRadius={65}
                  outerRadius={74}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-[27px] leading-none font-bold tabular-nums text-white">{total}</span>
            <span className="text-[11px] leading-none font-medium tracking-wide uppercase" style={{ color: TEXT_MUTED }}>
              Total
            </span>
          </div>
        </div>
        <span aria-hidden="true" className="h-[136px] w-px justify-self-center" style={{ backgroundColor: TRACK_BG }} />
        <div className="flex flex-col justify-center gap-2.5">
          <EnquiryTypeRow color={ORANGE} label="Selling" count={sell} percent={sellPercent} />
          <span aria-hidden="true" className="h-px w-full" style={{ backgroundColor: TRACK_BG }} />
          <EnquiryTypeRow color={BUYING_BLUE} label="Buying" count={buy} percent={buyPercent} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend — 7-day area chart / 30-day grid, switched purely client-side.
// ---------------------------------------------------------------------------

function TrendXAxisTick({ x, y, payload, isLast }: { readonly x?: number; readonly y?: number; readonly payload?: { readonly value: string }; readonly isLast: boolean }) {
  if (x === undefined || y === undefined || !payload) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fill={TEXT_MUTED} fontSize={10}>
        {formatUaeCalendarDateShort(payload.value)}
      </text>
      {isLast ? (
        <text x={0} y={0} dy={25} textAnchor="middle" fill={ORANGE} fontSize={10} fontWeight={600}>
          Today
        </text>
      ) : null}
    </g>
  );
}

function TrendValueLabel({ x, y, value }: { readonly x?: number; readonly y?: number; readonly value?: number }) {
  if (x === undefined || y === undefined || value === undefined) return null;
  return (
    <text x={x} y={y - 9} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize={11} fontWeight={600}>
      {value}
    </text>
  );
}

function SevenDayChart({ days }: { readonly days: readonly OwnerOverviewDailyCount[] }) {
  const peak = peakDailyCount(days);
  const ticks = computeNiceYAxisTicks(peak);
  const yMax = ticks[ticks.length - 1] ?? 1;
  const lastDate = days[days.length - 1]?.date;

  return (
    <div
      role="group"
      aria-label={`Enquiries per day: ${days.map((day) => `${formatUaeCalendarDateShort(day.date)}, ${day.count}`).join("; ")}`}
      className="min-h-0 flex-1"
    >
      <ResponsiveContainer width="100%" height="100%">
        {/* right: 22 (was 10) — the last tick's "Today" label is centred
            (textAnchor="middle") on that tick's x position, same as every
            other date label; at fontSize 10/fontWeight 600, roughly half
            its ~30px width extends past the plot's right edge, and a 10px
            margin didn't contain it. The point/tick position itself is
            unchanged — only the plot's own right margin grows enough to
            keep the already-centred label fully inside the card. */}
        <AreaChart data={[...days]} margin={{ top: 20, right: 22, bottom: 20, left: 0 }}>
          <defs>
            <linearGradient id="trendAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ORANGE} stopOpacity={0.32} />
              <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(255,255,255,0.08)" />
          <XAxis dataKey="date" axisLine={false} tickLine={false} interval={0} tick={(props) => <TrendXAxisTick {...props} isLast={props.payload?.value === lastDate} />} />
          <YAxis domain={[0, yMax]} ticks={[...ticks]} axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: TEXT_MUTED, fontSize: 11 }} width={22} />
          <Area
            type="linear"
            dataKey="count"
            stroke={ORANGE}
            strokeWidth={2}
            fill="url(#trendAreaGradient)"
            dot={{ r: 4, fill: ORANGE, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
            label={<TrendValueLabel />}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ThirtyDayGrid({ days, todayDate }: { readonly days: readonly OwnerOverviewDailyCount[]; readonly todayDate: string }) {
  return (
    <div
      role="group"
      aria-label={`Enquiries per day: ${days.map((day) => `${formatUaeCalendarDateShort(day.date)}, ${day.count}`).join("; ")}`}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isToday = day.date === todayDate;
          return (
            <div
              key={day.date}
              className="flex flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-2"
              style={{ borderColor: isToday ? ORANGE : `${CARD_BORDER_COLOR}99`, color: isToday ? ORANGE : TEXT_SECONDARY }}
            >
              <span className="text-[10px] font-medium">{formatUaeCalendarDateShort(day.date)}</span>
              <span className="text-sm font-semibold text-white">{day.count}</span>
              {isToday ? (
                <span className="text-[9px] font-semibold" style={{ color: ORANGE }}>
                  Today
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TrendRange = 7 | 30;

/** `range` is owned by the page (`OwnerOverview`'s own state, driven by the header's `DateRangeControl`) — this panel is a pure display of whichever window that selection points to, never a second independent toggle. */
function TrendPanel({ window: dataWindow, range }: { readonly window: OwnerLeadOverviewWindow; readonly range: TrendRange }) {
  const days = dataWindow.dailyCounts;
  const total = sumDailyCounts(days);
  const peak = peakDailyCount(days);
  const todayDate = days[days.length - 1]?.date ?? "";

  return (
    <div className={`${CARD_CLASS} flex h-full min-h-0 flex-col p-4`} style={CARD_STYLE}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-white">Enquiries — last {range} days</h3>
        <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
          {total} {total === 1 ? "enquiry" : "enquiries"} · Peak {peak}
        </p>
      </div>
      {range === 7 ? <SevenDayChart days={days} /> : <ThirtyDayGrid days={days} todayDate={todayDate} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page-local compact heading + date-range control — deliberately not
// OwnerPageHeader (that component's own default `py-5 lg:py-4` / `text-4xl`
// sizing is shared with Enquiries; this page needed a visibly more compact
// treatment, so it composes its own heading here instead of adding a mode
// flag to the shared component).
// ---------------------------------------------------------------------------

function DateRangeControl({ range, onRangeChange, rangeLabel }: { readonly range: TrendRange; readonly onRangeChange: (range: TrendRange) => void; readonly rangeLabel: string }) {
  return (
    <div className="flex h-[52px] items-center gap-3 rounded-xl border px-3" style={{ borderColor: `${CARD_BORDER_COLOR}99`, backgroundColor: "#021B38" }}>
      <Select value={String(range)} onValueChange={(value) => onRangeChange(value === "30" ? 30 : 7)}>
        <SelectTrigger className="h-7 w-auto gap-1.5 border-none bg-transparent px-0 text-sm font-medium text-white shadow-none focus:ring-0">
          <Calendar className="size-4" style={{ color: ORANGE }} aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-white/10 bg-[#021B38] text-white">
          <SelectItem value="7">Last 7 days</SelectItem>
          <SelectItem value="30">Last 30 days</SelectItem>
        </SelectContent>
      </Select>
      <span aria-hidden="true" className="h-4 w-px bg-white/15" />
      <span className="text-sm whitespace-nowrap" style={{ color: TEXT_SECONDARY }}>
        {rangeLabel}
      </span>
    </div>
  );
}

function OverviewHeading({ actions }: { readonly actions?: ReactNode }) {
  return (
    <div className={`${OWNER_CONTAINER_CLASS} flex shrink-0 flex-wrap items-start justify-between gap-4 pt-4 pb-2`}>
      <div>
        <h2 className="font-display text-[36px] leading-[1.15] font-semibold text-white">Overview</h2>
        <p className="mt-1 text-lg leading-[1.3]" style={{ color: TEXT_SECONDARY }}>
          Enquiry performance at a glance
        </p>
      </div>
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function OwnerOverview({ state, refresh }: OwnerOverviewProps) {
  // CHECKPOINT OWNER OVERVIEW SIX-CIRCLE PASS — default range is 30 days
  // (Last 7 days is the alternative, selectable from the same control) —
  // the code previously defaulted to 7; flagged explicitly in this pass's
  // own report in case 7 was actually the intended default.
  const [headerRange, setHeaderRange] = useState<TrendRange>(30);

  if (state.isLoading && !state.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: OVERVIEW_BG }}>
        <OverviewHeading />
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-1 flex-col gap-4 pb-6`}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-[116px] w-full" />
            ))}
          </div>
          <Skeleton className="h-[360px] w-full" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-[204px] w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: OVERVIEW_BG }}>
        <OverviewHeading />
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-col items-center gap-3 py-16 text-center`}>
          <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
          <p className="text-sm text-white">{state.error}</p>
          <Button type="button" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const data = state.data;
  if (!data) return null;

  // CHECKPOINT OWNER OVERVIEW RANGE-SCOPING FIX — the ONE place the
  // selected range is resolved to its own fully-scoped bundle; every card
  // below reads from this same `dataWindow`, never the raw `data` object
  // directly, so the KPIs/status pipeline/material mix/enquiry type/source
  // can never again silently diverge from the trend's own range the way
  // they did when only dailyCounts/dailyCounts30 were windowed.
  const dataWindow = headerRange === 7 ? data.sevenDay : data.thirtyDay;
  const rangeLabel = formatUaeDateRangeLabel(dataWindow.dailyCounts);

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: OVERVIEW_BG }}>
      <OverviewHeading actions={<DateRangeControl range={headerRange} onRangeChange={setHeaderRange} rangeLabel={rangeLabel} />} />
      {/*
        Height cascade for a no-scroll fit on sufficiently tall desktop
        viewports: this scroll container and the column inside it are both
        `h-full min-h-0`, so the middle (Trend/Status) row — the one
        `flex-1` element — resolves to "whatever's actually left" after the
        KPI row and the bottom row (both intrinsic/fixed height) are
        subtracted, instead of the previous fixed `h-[360px]` forcing a
        constant total regardless of how much room the viewport had. A
        `min-h-[300px]` floor on that row means a genuinely short viewport
        can't compress it into clipping — the column's own required height
        then exceeds the container's, and `overflow-y-auto` scrolls exactly
        as before on those screens. The bottom row's own height is
        untouched (still the three fixed-216px cards, including the
        approved, unmodified `EnquiryType` donut).
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${OWNER_CONTAINER_CLASS} flex h-full min-h-0 flex-col gap-3 pb-4`}>
          <KpiRow window={dataWindow} />

          <div className="grid min-h-[300px] flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="min-h-0 lg:col-span-2">
              <TrendPanel window={dataWindow} range={headerRange} />
            </div>
            <StatusPipeline window={dataWindow} />
          </div>

          <div className="grid shrink-0 grid-cols-1 gap-4 lg:grid-cols-3">
            <MaterialMix window={dataWindow} />
            <EnquiryType window={dataWindow} />
            <Source window={dataWindow} />
          </div>
        </div>
      </div>
    </div>
  );
}
