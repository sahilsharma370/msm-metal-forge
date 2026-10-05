import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Archive, Download, Inbox, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerLeadFilters } from "./OwnerLeadFilters";
import { OwnerLeadListItem, OWNER_LEAD_ROW_GRID_CLASS } from "./OwnerLeadListItem";
import { OwnerPageHeader, OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import { DEFAULT_OWNER_LEAD_LIST_PAGE_LIMIT, type UseOwnerLeadListResult } from "./use-owner-lead-list";
import type { OwnerLeadExportState } from "./use-owner-lead-export";
import type { OwnerLeadExportQuery } from "./owner-leads-transport";
import type { OwnerLeadListItem as OwnerLeadListItemType, OwnerLeadView } from "@/lib/owner/owner-leads-contract";

/**
 * CHECKPOINT C2J-D / C2M-A — the /owner Enquiries page body: real
 * API-backed list, genuine loading/empty/error states, the Inbox/Archived/
 * Trash view control, and the Export CSV action. Purely presentational —
 * every piece of state and every action comes from useOwnerLeadList /
 * useOwnerLeadExport (owned by the route, see routes/owner/index.tsx), so
 * this component is trivial to test with plain fake props.
 */
export interface OwnerLeadInboxProps extends UseOwnerLeadListResult {
  readonly exportState: OwnerLeadExportState;
  readonly onExportCsv: (query: OwnerLeadExportQuery) => Promise<void>;
  readonly onClearExportError: () => void;
}

const VIEW_TABS: readonly { readonly view: OwnerLeadView; readonly label: string; readonly icon: typeof Inbox }[] = [
  { view: "inbox", label: "Inbox", icon: Inbox },
  { view: "archived", label: "Archived", icon: Archive },
  { view: "trash", label: "Trash", icon: Trash2 },
];

/**
 * CHECKPOINT C2M-A — the Inbox/Archived/Trash view control. Deliberately
 * the matte navy/copper control language (border-white/10, copper-tinted
 * active state), never the shell's own glass segmented control — the
 * centered `Overview | Enquiries` glass nav is approved and reserved for
 * that one stationary-navigation role only; this is page-level content, not
 * navigation chrome.
 */
function OwnerLeadViewTabs({ view, onChange, disabled }: { readonly view: OwnerLeadView; readonly onChange: (view: OwnerLeadView) => void; readonly disabled: boolean }) {
  return (
    // CHECKPOINT OWNER ENQUIRIES REFERENCE PASS — border/background removed
    // at `lg` (`lg:border-0 lg:bg-transparent lg:p-0`): this cluster now
    // sits inside the unified command bar (see OwnerLeadInbox's render),
    // which already supplies that one surface — repeating it here would
    // stack two bordered boxes, which the reference avoids. Below `lg`,
    // unchanged (still its own bordered pill cluster).
    <div role="tablist" aria-label="Enquiries view" className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-navy-deep/95 p-1 lg:border-0 lg:bg-transparent lg:p-0">
      {VIEW_TABS.map(({ view: tabView, label, icon: Icon }) => {
        const isActive = view === tabView;
        return (
          <button
            key={tabView}
            type="button"
            role="tab"
            id={`owner-lead-view-tab-${tabView}`}
            aria-selected={isActive}
            aria-current={isActive ? "true" : undefined}
            disabled={disabled}
            onClick={() => {
              if (!isActive) onChange(tabView);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
              isActive ? "bg-copper/15 font-semibold text-copper-bright" : "text-foreground/70 hover:bg-white/5 hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Desktop-only moving hover/focus indicator — a thin left rail that
 * translates to whichever row is currently hovered or keyboard-focused
 * (never permanently attached to the first row). Position is read from the
 * DOM once per hover/focus change (`offsetTop`/`offsetHeight`), not
 * recomputed every frame; `onMouseOver`/`onFocus` on the shared `<ul>`
 * (both bubble) means a single pair of handlers covers every row without
 * OwnerLeadListItem needing any new prop. There is no separate
 * "selected row" concept in this list, so the indicator simply fades out
 * (opacity 0) on pointer/focus leave rather than returning anywhere.
 *
 * The rail's own visibility toggle is `hidden sm:block` — matching the
 * chevron's own `sm:block` and the row grid's own `sm:grid` exactly. It
 * previously read `lg:block`, a breakpoint that didn't match either of
 * those, so between `sm` and `lg` the rows rendered in full grid/table
 * layout (and the chevron already responded to hover) while the rail's
 * `display` stayed `none` regardless of `indicator` state — it could never
 * paint no matter what the event handlers computed. `z-10` is added
 * defensively so the rail (already `position:absolute`, which paints above
 * the rows' own `position:static` boxes per normal stacking-context order)
 * stays unambiguously above any future row background/overlay.
 *
 * `top-0 left-0` — both explicit. `left-0` alone (no `top-0`) leaves `top`
 * at its CSS default of `auto`; for an absolutely-positioned item inside a
 * `display:grid` container with no `grid-row`/`grid-column` of its own
 * (this rail's case), an unset `top` falls back to the item's "static
 * position," a value derived from grid auto-placement rather than a
 * guaranteed `0`. `row.offsetTop` (used below) is measured directly
 * against this same `<ul>`'s top edge — pinning the rail's own `top` to
 * that identical `0` baseline via an explicit class, rather than leaving it
 * to a fallback computation, keeps both values unambiguously in the same
 * coordinate space.
 *
 * The parent renders this with `key={view}` — switching Inbox/Archived/
 * Trash fully remounts it, so a stale `indicator` position from the
 * previous view's rows can never carry over and render at the wrong
 * (e.g. first) row of the new list.
 */
function OwnerLeadRows({ items }: { readonly items: readonly OwnerLeadListItemType[] }) {
  const containerRef = useRef<HTMLUListElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  function activateFrom(target: EventTarget | null) {
    const container = containerRef.current;
    const row = target instanceof HTMLElement ? target.closest("li") : null;
    if (!container || !row || !container.contains(row)) return;
    setIndicator({ top: row.offsetTop, height: row.offsetHeight });
  }

  return (
    <ul
      ref={containerRef}
      className={`relative sm:px-4 ${OWNER_LEAD_ROW_GRID_CLASS}`}
      onMouseOver={(event) => activateFrom(event.target)}
      onMouseLeave={() => setIndicator(null)}
      onFocus={(event) => activateFrom(event.target)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIndicator(null);
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-10 hidden w-0.5 rounded-r-full bg-copper transition-[transform,opacity] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:block"
        style={{
          transform: `translateY(${indicator?.top ?? 0}px)`,
          height: indicator?.height ?? 0,
          opacity: indicator ? 1 : 0,
        }}
      />
      {items.map((lead) => (
        <OwnerLeadListItem key={lead.id} lead={lead} />
      ))}
    </ul>
  );
}

function SkeletonRows() {
  return (
    <ul aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <li key={index} className="flex items-center justify-between gap-4 border-b border-border px-4 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-20" />
        </li>
      ))}
    </ul>
  );
}

const VIEW_EMPTY_COPY: Record<OwnerLeadView, { readonly title: string; readonly body: string }> = {
  inbox: {
    title: "No enquiries yet.",
    body: "New website, phone and WhatsApp enquiries will appear here as soon as they come in.",
  },
  archived: {
    title: "No archived enquiries.",
    body: "Enquiries you mark Archived from the status control will collect here.",
  },
  trash: {
    title: "Trash is empty.",
    body: "Enquiries you move to Trash will collect here until you restore them.",
  },
};

export function OwnerLeadInbox({
  state,
  draftFilters,
  setDraftFilters,
  applyFilters,
  clearFilters,
  setView,
  loadMore,
  retry,
  exportState,
  onExportCsv,
  onClearExportError,
}: OwnerLeadInboxProps) {
  const hasActiveFilters = Object.values(state.appliedFilters).some((value) => value !== undefined && value !== "");
  const showSkeleton = state.isInitialLoading && state.items.length === 0;
  const showEmptyState = !state.isInitialLoading && !state.error && state.items.length === 0;
  const showErrorState = !!state.error && state.items.length === 0;
  const isBusy = state.isInitialLoading || state.isRefreshing;
  const emptyCopy = VIEW_EMPTY_COPY[state.view];
  // Export is never offered for Trash — narrowed to a local const (rather
  // than re-checking `state.view !== "trash"` inline) so the exported
  // view's type stays "inbox" | "archived" inside the click handler below;
  // TypeScript does not narrow a captured object property through a
  // nested closure.
  const exportableView: "inbox" | "archived" | null = state.view === "trash" ? null : state.view;

  const loadedCountLabel = `${state.items.length} ${state.items.length === 1 ? "enquiry" : "enquiries"}`;
  // A short first page (fewer items than one full page, and nothing more to
  // load) never had real pagination context — "You've reached the end of
  // the list" is meaningless noise there. It only earns its place once a
  // genuine full page was loaded first.
  const showEndOfListFooter = !state.hasMore && state.items.length >= DEFAULT_OWNER_LEAD_LIST_PAGE_LIMIT;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* CHECKPOINT OWNER DESKTOP CORRECTION — no page-level "+ Add enquiry"
          here any more: the persistent header (OwnerShell) already provides
          the one canonical copy of this action, and showing it twice
          overweighted copper on this exact screen.
          CHECKPOINT OWNER ENQUIRIES REFERENCE PASS — Export CSV now renders
          as this header's own `actions` slot (title row, far right) instead
          of sharing a row with the Inbox/Archived/Trash tabs below —
          exact same button, handler and conditions, just relocated. */}
      <OwnerPageHeader
        title="Enquiries"
        description={state.isInitialLoading ? "Every completed enquiry, newest first." : loadedCountLabel}
        noDesktopDivider
        actions={
          exportableView ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={exportState.isExporting}
              onClick={() => {
                onClearExportError();
                void onExportCsv({
                  view: exportableView,
                  ...(state.appliedFilters.status ? { status: state.appliedFilters.status } : {}),
                  ...(state.appliedFilters.intent ? { intent: state.appliedFilters.intent } : {}),
                  ...(state.appliedFilters.material ? { material: state.appliedFilters.material } : {}),
                  ...(state.appliedFilters.captureChannel ? { captureChannel: state.appliedFilters.captureChannel } : {}),
                  ...(state.appliedFilters.q ? { q: state.appliedFilters.q } : {}),
                });
              }}
            >
              {exportState.isExporting ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              {exportState.isExporting ? "Exporting…" : "Export CSV"}
            </Button>
          ) : undefined
        }
      />

      <div aria-live="polite" className="sr-only">
        {state.isRefreshing ? "Refreshing enquiries…" : null}
        {state.error ? `Could not load enquiries: ${state.error}` : null}
        {exportState.isExporting ? "Preparing CSV export…" : null}
        {exportState.error ? `CSV export failed: ${exportState.error}` : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-col gap-5 py-6 lg:pt-4`}>
          {exportState.error ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{exportState.error}</span>
              <button type="button" onClick={onClearExportError} className="font-medium underline-offset-2 hover:underline">
                Dismiss
              </button>
            </div>
          ) : null}

          {/* CHECKPOINT OWNER ENQUIRIES REFERENCE PASS — Inbox/Archived/
              Trash and the search/filter form now share one unified
              command-bar surface at `lg` and up (a single flex row: tabs,
              a vertical separator, then the filters form as a flex-1
              sibling — the filters form's own internal grid, unchanged,
              still governs Search/Status/Type/Material/Channel proportions
              inside that shared width). Below `lg`, this is byte-identical
              to before: two separately-boxed rows (tabs row, then the
              filters card). Export CSV moved to the page-title header
              above (see OwnerPageHeader actions) — no longer shares this
              row, exact same button/handler/conditions. */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4 lg:rounded-xl lg:border lg:border-white/10 lg:bg-navy-deep/95 lg:bg-gradient-to-b lg:from-white/[0.03] lg:to-transparent lg:p-4">
            <div className="flex flex-wrap items-center gap-3 lg:flex-none">
              <OwnerLeadViewTabs view={state.view} onChange={setView} disabled={isBusy} />
            </div>
            <span aria-hidden="true" className="hidden w-px self-stretch bg-white/10 lg:block" />
            <div className="rounded-2xl border border-white/10 bg-navy-deep/95 p-3 lg:flex-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
              <OwnerLeadFilters
                draftFilters={draftFilters}
                setDraftFilters={setDraftFilters}
                onApply={applyFilters}
                onClear={clearFilters}
                hasActiveFilters={hasActiveFilters}
                isBusy={isBusy}
                view={state.view}
              />
            </div>
          </div>

          {/* The dedicated lead-list surface. */}
          <section aria-label="Enquiries" className="rounded-2xl border border-white/10 bg-navy-deep/95 lg:rounded-xl lg:bg-gradient-to-b lg:from-white/[0.025] lg:to-transparent">
            {showSkeleton ? <SkeletonRows /> : null}

            {showErrorState ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
                <p className="text-sm text-foreground">{state.error}</p>
                <Button type="button" variant="outline" onClick={retry}>
                  Retry
                </Button>
              </div>
            ) : null}

            {showEmptyState ? (
              <div className="flex h-[180px] flex-col items-center justify-center gap-2 px-4 text-center">
                <Inbox className="size-5 text-foreground/60" aria-hidden="true" />
                <p className="font-display text-sm font-medium text-foreground">
                  {hasActiveFilters ? "No enquiries match these filters." : emptyCopy.title}
                </p>
                <p className="max-w-xs text-xs text-foreground/60">
                  {hasActiveFilters ? "Try clearing or adjusting your search and filters." : emptyCopy.body}
                </p>
                {hasActiveFilters ? (
                  <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : state.view === "inbox" ? (
                  <Button asChild variant="outline" size="sm" className="gap-1.5">
                    <Link to="/owner/leads/new">
                      <Plus className="size-4" aria-hidden="true" />
                      Record an enquiry
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {!showSkeleton && state.items.length > 0 ? (
              <>
                {/* A quiet column-heading row, sharing the list's ONE
                    column template with every row (see OwnerLeadListItem's
                    own header comment) — `sm:grid` only, never a competing
                    `sm:flex` on this same element, so the header can't
                    drift out of alignment with the rows' own subgrid.
                    Desktop-only, matching the rows. "(UAE)" is disclosed
                    once here rather than repeated on every row's own
                    timestamp. */}
                <div
                  className={`hidden border-b border-white/10 px-4 py-1.5 text-left text-[10px] font-semibold tracking-wide text-foreground/45 uppercase sm:grid lg:py-3 ${OWNER_LEAD_ROW_GRID_CLASS}`}
                >
                  <span>Contact</span>
                  <span>Material / quantity</span>
                  <span>Location</span>
                  <span>Status</span>
                  <span>Received (UAE)</span>
                  <span>Type</span>
                  <span>Reference</span>
                  <span aria-hidden="true" />
                </div>
                <OwnerLeadRows key={state.view} items={state.items} />
              </>
            ) : null}

            {!showSkeleton && state.items.length > 0 && (state.hasMore || showEndOfListFooter) ? (
              <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-5">
                {state.hasMore ? (
                  <Button type="button" variant="outline" onClick={loadMore} disabled={state.isLoadingMore}>
                    {state.isLoadingMore ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Loading…
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">You've reached the end of the list.</p>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
