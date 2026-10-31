import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { OwnerPageHeader } from "@/components/owner/OwnerPageHeader";
import { OwnerLeadQuickAddForm } from "@/components/owner/OwnerLeadQuickAddForm";
import { useOwnerLeadQuickAdd } from "@/components/owner/use-owner-lead-quick-add";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";

const title = "Add enquiry | MSM Owner Workspace";

export const Route = createFileRoute("/owner/leads/new")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerLeadQuickAddRouteComponent,
});

/**
 * CHECKPOINT C2J-F — /owner/leads/new: the owner Quick Add page. Matches
 * routes/owner/leads/$leadId.tsx's own routing shape exactly (a thin route
 * component owning the OwnerShell guard, a *Body component owning the
 * transport deps/hook so it stays testable with plain fake props).
 */
function OwnerLeadQuickAddRouteComponent() {
  const navigate = useNavigate();

  function goToLogin(reason: "unauthenticated" | "unauthorized") {
    navigate({ to: "/owner/login", search: { redirect: "/owner/leads/new", reason: reason === "unauthorized" ? "unauthorized" : undefined } });
  }

  return (
    <OwnerShell onUnauthorized={goToLogin} hideAddEnquiryCta>
      {() => <OwnerLeadQuickAddBody onUnauthorized={() => goToLogin("unauthorized")} />}
    </OwnerShell>
  );
}

export function OwnerLeadQuickAddBody({ onUnauthorized }: { readonly onUnauthorized: () => void }) {
  const navigate = useNavigate();
  // Memoized for the same reason OwnerInboxBody/OwnerLeadDetailBody memoize
  // their own deps (see those files' own CHECKPOINT C2J-D1 comment): a
  // fresh object literal every render would give the hook's own callback a
  // new identity every render.
  const deps = useMemo<OwnerLeadsTransportDeps>(() => ({ authClient: createOwnerAuthClient(), fetchImpl: fetch.bind(globalThis) }), []);
  const { state, submit, clearError } = useOwnerLeadQuickAdd(deps, onUnauthorized);

  function openLead(leadId: string) {
    void navigate({ to: "/owner/leads/$leadId", params: { leadId } });
  }

  function cancel() {
    void navigate({ to: "/owner" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <OwnerPageHeader title="Add enquiry" description="Record a phone, WhatsApp or walk-in enquiry directly into the enquiry list." />
      {/* CHECKPOINT OWNER DESKTOP REFINEMENT — OwnerLeadQuickAddForm now owns
          its own internal shell (compact centred scrollable fields region +
          a static, never-sticky-inside-scroll action footer), the same
          "header auto / body scroll / footer static sibling" architecture
          used everywhere else in this workspace. */}
      <OwnerLeadQuickAddForm
        isSubmitting={state.isSubmitting}
        error={state.error}
        onSubmit={submit}
        onClearError={clearError}
        onOpenLead={openLead}
        onCancel={cancel}
      />
    </div>
  );
}
