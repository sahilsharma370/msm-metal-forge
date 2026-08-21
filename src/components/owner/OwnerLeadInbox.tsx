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
import type { OwnerLeadView } from "@/lib/owner/owner-leads-contract";

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
    <div role="tablist" aria-label="Enquiries view" className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-navy-deep/95 p-1">
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
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
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
          overweighted copper on this exact screen. */}
      <OwnerPageHeader
        title="Enquiries"
        description={state.isInitialLoading ? "Every completed enquiry, newest first." : loadedCountLabel}
      />

      <div aria-live="polite" className="sr-only">
        {state.isRefreshing ? "Refreshing enquiries…" : null}
        {state.error ? `Could not load enquiries: ${state.error}` : null}
        {exportState.isExporting ? "Preparing CSV export…" : null}
        {exportState.error ? `CSV export failed: ${exportState.error}` : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${OWNER_CONTAINER_CLASS} flex flex-col gap-5 py-6`}>
          {/* CHECKPOINT C2M-A — view control + Export CSV. Export is never
              offered for Trash (nothing to export — Trash is deliberately
              excluded from every export), and is visually secondary
              (outline, no copper fill) to the header's own primary
              `+ Add enquiry` action. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OwnerLeadViewTabs view={state.view} onChange={setView} disabled={isBusy} />
            {exportableView ? (
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
            ) : null}
          </div>

          {exportState.error ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{exportState.error}</span>
              <button type="button" onClick={onClearExportError} className="font-medium underline-offset-2 hover:underline">
                Dismiss
              </button>
            </div>
          ) : null}

          {/* CHECKPOINT OWNER DESKTOP CORRECTION (compact filters pass) —
              reduced padding matches the filter row's own tightened
              density; still the same matte operational surface recipe as
              every other panel in this batch. */}
          <div className="rounded-2xl border border-white/10 bg-navy-deep/95 p-3">
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

          {/* The dedicated lead-list surface. */}
          <section aria-label="Enquiries" className="rounded-2xl border border-white/10 bg-navy-deep/95">
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
                {/* CHECKPOINT OWNER DESKTOP CORRECTION / C2M-A — a quiet
                    column-heading row, sharing the list's ONE column
                    template (now declared once on the parent `<ul>` below
                    and inherited by every row via CSS subgrid — see
                    OwnerLeadListItem.tsx's own header comment). Desktop-only
                    (sm:grid), matching the rows' own responsive behaviour.
                    "(UAE)" is disclosed once here rather than repeated on
                    every row's own timestamp. */}
                <div
                  className={`hidden border-b border-white/10 px-4 py-1.5 text-[10px] font-semibold tracking-wide text-foreground/45 uppercase sm:flex ${OWNER_LEAD_ROW_GRID_CLASS}`}
                >
                  <span>Contact</span>
                  <span>Material / quantity</span>
                  <span>Location</span>
                  <span>Status</span>
                  <span>Received (UAE)</span>
                  <span>Type / reference</span>
                  <span aria-hidden="true" />
                </div>
                <ul className={OWNER_LEAD_ROW_GRID_CLASS}>
                  {state.items.map((lead) => (
                    <OwnerLeadListItem key={lead.id} lead={lead} />
                  ))}
                </ul>
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
