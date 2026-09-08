import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { OwnerShell, type RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";
import { OwnerLeadDetailPage } from "@/components/owner/OwnerLeadDetailPage";
import { useOwnerLeadDetail } from "@/components/owner/use-owner-lead-detail";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";

const title = "Enquiry | MSM Owner Workspace";

/** Owner "Edit enquiry" — a transient success indicator only, set by a `replace` navigation from the edit form's own successful save (see $leadId.edit.tsx). Never a durable link parameter; the route component strips it from the URL the moment it's read (see the effect below), so reloading or sharing this URL never re-shows the banner. */
const ownerLeadDetailSearchSchema = z.object({
  saved: z.literal("1").optional(),
});

export const Route = createFileRoute("/owner/leads/$leadId")({
  validateSearch: (search) => ownerLeadDetailSearchSchema.parse(search),
  head: () => ({ meta: [{ title }] }),
  component: OwnerLeadDetailRouteComponent,
});

function OwnerLeadDetailRouteComponent() {
  const { leadId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [showSavedBanner, setShowSavedBanner] = useState(search.saved === "1");

  useEffect(() => {
    if (search.saved === "1") {
      setShowSavedBanner(true);
      void navigate({ to: "/owner/leads/$leadId", params: { leadId }, search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.saved]);

  function goToLogin(reason: "unauthenticated" | "unauthorized") {
    navigate({
      to: "/owner/login",
      search: { redirect: `/owner/leads/${leadId}`, reason: reason === "unauthorized" ? "unauthorized" : undefined },
    });
  }

  return (
    <OwnerShell onUnauthorized={goToLogin}>
      {(_owner, registerRefresh) => (
        <OwnerLeadDetailBody
          leadId={leadId}
          onUnauthorized={() => goToLogin("unauthorized")}
          registerRefresh={registerRefresh}
          showSavedBanner={showSavedBanner}
          onDismissSavedBanner={() => setShowSavedBanner(false)}
        />
      )}
    </OwnerShell>
  );
}

export function OwnerLeadDetailBody({
  leadId,
  onUnauthorized,
  registerRefresh,
  showSavedBanner = false,
  onDismissSavedBanner,
}: {
  readonly leadId: string;
  readonly onUnauthorized: () => void;
  readonly registerRefresh: RegisterOwnerShellRefresh;
  readonly showSavedBanner?: boolean;
  readonly onDismissSavedBanner?: () => void;
}) {
  // CHECKPOINT C2J-D1 — see OwnerInboxBody's identical comment in
  // routes/owner/index.tsx: without this useMemo, a fresh `deps` object on
  // every render gave useOwnerLeadDetail's `refresh` a new identity every
  // render, which the registerRefresh effect below depended on directly —
  // an unbroken render loop through OwnerShell's own state.
  //
  // CHECKPOINT C2J-D2 — `fetch.bind(globalThis)`, not the bare `fetch`
  // reference: see OwnerInboxBody's identical comment in
  // routes/owner/index.tsx for the full "Illegal invocation" mechanism,
  // confirmed empirically in a real browser. This `deps` object is also
  // what OwnerLeadDetailPage -> OwnerLeadDetailView -> OwnerLeadFileViewer
  // use for the private signed-file access call, so this one fix covers
  // both lead detail and file access — both used the identical broken
  // construction and are fixed identically here.
  const deps = useMemo<OwnerLeadsTransportDeps>(() => ({ authClient: createOwnerAuthClient(), fetchImpl: fetch.bind(globalThis) }), []);
  const { state, refresh } = useOwnerLeadDetail(leadId, deps);

  useEffect(() => {
    if (state.unauthorized) onUnauthorized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.unauthorized]);

  useEffect(() => {
    registerRefresh(refresh, state.isLoading);
    return () => registerRefresh(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, state.isLoading]);

  return (
    <OwnerLeadDetailPage
      leadId={leadId}
      state={state}
      retry={refresh}
      deps={deps}
      onUnauthorized={onUnauthorized}
      showSavedBanner={showSavedBanner}
      onDismissSavedBanner={onDismissSavedBanner}
    />
  );
}
