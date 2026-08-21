import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OwnerLeadDetailHookState } from "./use-owner-lead-detail";
import { OwnerLeadDetailView } from "./OwnerLeadDetailView";
import { OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import type { OwnerLeadsTransportDeps } from "./owner-leads-transport";

/**
 * CHECKPOINT C2J-D — the /owner/leads/:leadId page body: loading skeleton,
 * the real detail view, or a calm "not found"/error state with a Back to
 * enquiries control (the mobile-required control, but present at every
 * width — it's the same single detail page on mobile and desktop, see this
 * checkpoint's own routing decision).
 */
export interface OwnerLeadDetailPageProps {
  readonly leadId: string;
  readonly state: OwnerLeadDetailHookState;
  readonly retry: () => void;
  readonly deps: OwnerLeadsTransportDeps;
  readonly onUnauthorized: () => void;
  /** Owner "Edit enquiry" — true for one render right after a successful save redirected back here (see routes/owner/leads/$leadId.tsx's own transient `saved` search param handling). By the time this is ever true, `state.data` already reflects the saved values — this hook fetches fresh detail on every mount, so there is nothing stale to reconcile. */
  readonly showSavedBanner?: boolean;
  readonly onDismissSavedBanner?: (() => void) | undefined;
}

function BackToEnquiriesLink() {
  return (
    <Link
      to="/owner"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to enquiries
    </Link>
  );
}

export function OwnerLeadDetailPage({
  leadId,
  state,
  retry,
  deps,
  onUnauthorized,
  showSavedBanner = false,
  onDismissSavedBanner,
}: OwnerLeadDetailPageProps) {
  if (state.isLoading && !state.data) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div aria-busy="true" aria-live="polite" className="max-w-3xl space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (state.notFound) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div className="flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-navy-deep/95 px-4 py-16 text-center">
          <AlertCircle className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">This enquiry couldn't be found.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            It may have been removed, or the link may be out of date.
          </p>
        </div>
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div className="flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-navy-deep/95 px-4 py-16 text-center">
          <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
          <p className="text-sm text-foreground">{state.error}</p>
          <Button type="button" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!state.data) {
    return null;
  }

  return (
    <div>
      <div className={`${OWNER_CONTAINER_CLASS} pt-4`}>
        <BackToEnquiriesLink />
      </div>
      {showSavedBanner ? (
        <div className={`${OWNER_CONTAINER_CLASS} pt-4`}>
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 rounded-xl border border-copper-bright/30 bg-copper-bright/10 px-4 py-2.5 text-sm text-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4 text-copper-bright" aria-hidden="true" />
              Enquiry updated.
            </span>
            <button
              type="button"
              onClick={onDismissSavedBanner}
              aria-label="Dismiss"
              className="rounded text-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      <OwnerLeadDetailView leadId={leadId} data={state.data} deps={deps} onUnauthorized={onUnauthorized} onMutated={retry} />
    </div>
  );
}
