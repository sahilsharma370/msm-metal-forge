import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { OwnerPageHeader, OWNER_CONTAINER_CLASS } from "@/components/owner/OwnerPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { OwnerLeadEditForm, buildOwnerLeadEditFieldState } from "@/components/owner/OwnerLeadEditForm";
import { useOwnerLeadDetail } from "@/components/owner/use-owner-lead-detail";
import { useOwnerLeadEdit } from "@/components/owner/use-owner-lead-edit";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";
import type { OwnerLeadEditFormValues } from "@/lib/owner/owner-lead-detail-contract";

const title = "Edit enquiry | MSM Owner Workspace";

export const Route = createFileRoute("/owner/leads/$leadId_/edit")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerLeadEditRouteComponent,
});

/**
 * Owner "Edit enquiry" — /owner/leads/:leadId/edit: a dedicated prefilled
 * correction screen for the same enquiry. Matches
 * routes/owner/leads/new.tsx's own routing shape (a thin route component
 * owning the OwnerShell guard, a *Body component owning the transport
 * deps/hooks so it stays testable with plain fake props) and
 * routes/owner/leads/$leadId.tsx's own use of useOwnerLeadDetail for the
 * prefill fetch — there is no second lead-detail fetch implementation here.
 */
function OwnerLeadEditRouteComponent() {
  const { leadId } = Route.useParams();
  const navigate = useNavigate();

  function goToLogin(reason: "unauthenticated" | "unauthorized") {
    navigate({
      to: "/owner/login",
      search: { redirect: `/owner/leads/${leadId}/edit`, reason: reason === "unauthorized" ? "unauthorized" : undefined },
    });
  }

  return (
    <OwnerShell onUnauthorized={goToLogin} hideAddEnquiryCta>
      {() => <OwnerLeadEditBody leadId={leadId} onUnauthorized={() => goToLogin("unauthorized")} />}
    </OwnerShell>
  );
}

export function OwnerLeadEditBody({ leadId, onUnauthorized }: { readonly leadId: string; readonly onUnauthorized: () => void }) {
  const navigate = useNavigate();
  // CHECKPOINT C2J-D1 precedent (see OwnerLeadDetailBody's own identical
  // comment) — a fresh `deps` object every render would give the hooks'
  // own callbacks a new identity every render.
  const deps = useMemo<OwnerLeadsTransportDeps>(() => ({ authClient: createOwnerAuthClient(), fetchImpl: fetch.bind(globalThis) }), []);
  const { state, refresh } = useOwnerLeadDetail(leadId, deps);
  const { state: editState, submit, clearError } = useOwnerLeadEdit(deps, leadId, onUnauthorized);

  function backToDetail() {
    void navigate({ to: "/owner/leads/$leadId", params: { leadId } });
  }

  async function handleSubmit(values: OwnerLeadEditFormValues): Promise<{ readonly ok: boolean }> {
    const lead = state.data?.lead;
    if (!lead) return { ok: false };
    const result = await submit({ ...values, expectedUpdatedAt: lead.updatedAt });
    if (result.ok) {
      void navigate({ to: "/owner/leads/$leadId", params: { leadId }, search: { saved: "1" } });
      return { ok: true };
    }
    // A stale expectedUpdatedAt or a lead that just became archived/trashed
    // — refetch in the background so the next Save attempt uses the lead's
    // real current state, exactly like use-owner-lead-mutations.ts's own
    // conflict handling. The owner's typed values are untouched: this
    // component's own field state lives entirely inside OwnerLeadEditForm,
    // which never resets on a prop change.
    if (result.conflict) refresh();
    return { ok: false };
  }

  if (state.isLoading && !state.data) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div aria-busy="true" aria-live="polite" className="mx-auto max-w-2xl space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (state.notFound || !state.data) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-navy-deep/95 px-4 py-16 text-center">
          <AlertCircle className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">This enquiry couldn&apos;t be found.</p>
          <Button type="button" variant="outline" onClick={backToDetail}>
            Back to enquiry
          </Button>
        </div>
      </div>
    );
  }

  const { lead } = state.data;
  const isTrashed = lead.deletedAt !== null;
  const isArchived = lead.status === "archived";

  // Defense in depth — the Actions menu on the detail screen already hides
  // "Edit enquiry" for a trashed/archived lead, but this route is directly
  // reachable by URL, so it re-checks the same rule before ever rendering
  // the form.
  if (isTrashed || isArchived) {
    return (
      <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 rounded-2xl border border-white/10 bg-navy-deep/95 px-4 py-16 text-center">
          <AlertCircle className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {isTrashed ? "This enquiry is in Trash and can't be edited." : "This enquiry is archived and can't be edited."}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {isTrashed ? "Restore it first to make changes." : "Reopen it first to make changes."}
          </p>
          <Button type="button" variant="outline" onClick={backToDetail}>
            Back to enquiry
          </Button>
        </div>
      </div>
    );
  }

  const initialFields = buildOwnerLeadEditFieldState({
    contactName: lead.contact.name,
    contactPhone: lead.contact.phone,
    material: lead.material,
    materialOtherText: lead.materialOtherText,
    quantityValue: lead.enquiry.quantityValue,
    quantityUnit: lead.enquiry.quantityUnit,
    quantityUnitOther: lead.enquiry.quantityUnitOther,
    emirate: lead.intent === "sell" ? lead.location.emirate : null,
    area: lead.intent === "sell" ? lead.location.area : null,
    notes: lead.enquiry.notes,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OwnerPageHeader title="Edit enquiry" description="Correct the customer's contact, material or location details." />
      <OwnerLeadEditForm
        intent={lead.intent}
        reference={lead.reference}
        initialFields={initialFields}
        isSubmitting={editState.isSubmitting}
        error={editState.error}
        onSubmit={handleSubmit}
        onClearError={clearError}
        onCancel={backToDetail}
      />
    </div>
  );
}
