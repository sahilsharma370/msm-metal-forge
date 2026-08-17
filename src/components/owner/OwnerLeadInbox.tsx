import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OwnerLeadFilters } from "./OwnerLeadFilters";
import { OwnerLeadListItem } from "./OwnerLeadListItem";
import type { UseOwnerLeadListResult } from "./use-owner-lead-list";

/**
 * CHECKPOINT C2J-D — the /owner inbox page body: real API-backed list,
 * genuine loading/empty/error states, no fabricated example row. Purely
 * presentational — every piece of state and every action comes from
 * useOwnerLeadList (owned by the route, see routes/owner/index.tsx), so
 * this component is trivial to test with plain fake props.
 */
export interface OwnerLeadInboxProps extends UseOwnerLeadListResult {}

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

export function OwnerLeadInbox({ state, draftFilters, setDraftFilters, applyFilters, clearFilters, loadMore, retry }: OwnerLeadInboxProps) {
  const hasActiveFilters = Object.values(state.appliedFilters).some((value) => value !== undefined && value !== "");
  const showSkeleton = state.isInitialLoading && state.items.length === 0;
  const showEmptyState = !state.isInitialLoading && !state.error && state.items.length === 0;
  const showErrorState = !!state.error && state.items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OwnerLeadFilters
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        onApply={applyFilters}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
        resultCount={state.items.length}
        isBusy={state.isInitialLoading || state.isRefreshing}
      />

      <div aria-live="polite" className="sr-only">
        {state.isRefreshing ? "Refreshing enquiries…" : null}
        {state.error ? `Could not load enquiries: ${state.error}` : null}
      </div>

      <section aria-label="Enquiries" className="flex-1 overflow-y-auto">
        {showSkeleton ? <SkeletonRows /> : null}

        {showErrorState ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
            <p className="text-sm text-foreground">{state.error}</p>
            <Button type="button" variant="outline" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : null}

        {showEmptyState ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              {hasActiveFilters ? "No enquiries match these filters." : "No enquiries yet."}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {hasActiveFilters
                ? "Try clearing or adjusting your search and filters."
                : "New website, phone and WhatsApp enquiries will appear here as soon as they come in."}
            </p>
            {hasActiveFilters ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : null}

        {!showSkeleton && state.items.length > 0 ? (
          <ul>
            {state.items.map((lead) => (
              <OwnerLeadListItem key={lead.id} lead={lead} />
            ))}
          </ul>
        ) : null}

        {!showSkeleton && state.items.length > 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6">
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
  );
}
