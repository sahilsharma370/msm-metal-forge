import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OwnerLeadDetailHookState } from "./use-owner-lead-detail";
import { OwnerLeadDetailView } from "./OwnerLeadDetailView";
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

export function OwnerLeadDetailPage({ leadId, state, retry, deps, onUnauthorized }: OwnerLeadDetailPageProps) {
  if (state.isLoading && !state.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div aria-busy="true" aria-live="polite" className="space-y-3">
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
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-16 text-center">
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
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <div className="mb-4">
          <BackToEnquiriesLink />
        </div>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-16 text-center">
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
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <BackToEnquiriesLink />
      </div>
      <OwnerLeadDetailView leadId={leadId} data={state.data} deps={deps} onUnauthorized={onUnauthorized} />
    </div>
  );
}
