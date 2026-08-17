import { useMemo } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { OwnerShell } from "@/components/owner/OwnerShell";
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
    <OwnerShell onUnauthorized={goToLogin}>
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link
          to="/owner"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to enquiries
        </Link>
      </div>
      <h2 className="mb-1 text-lg font-semibold text-foreground">Add enquiry</h2>
      <p className="mb-5 text-sm text-muted-foreground">Record a phone, WhatsApp or walk-in enquiry directly into the enquiry list.</p>
      <OwnerLeadQuickAddForm
        isSubmitting={state.isSubmitting}
        error={state.error}
        onSubmit={submit}
        onClearError={clearError}
        onOpenLead={openLead}
      />
    </div>
  );
}
