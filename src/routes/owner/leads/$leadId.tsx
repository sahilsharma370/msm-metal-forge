import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OwnerShell, type RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";
import { OwnerLeadDetailPage } from "@/components/owner/OwnerLeadDetailPage";
import { useOwnerLeadDetail } from "@/components/owner/use-owner-lead-detail";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";

const title = "Enquiry | MSM Owner Workspace";

export const Route = createFileRoute("/owner/leads/$leadId")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerLeadDetailRouteComponent,
});

function OwnerLeadDetailRouteComponent() {
  const { leadId } = Route.useParams();
  const navigate = useNavigate();

  function goToLogin(reason: "unauthenticated" | "unauthorized") {
    navigate({
      to: "/owner/login",
      search: { redirect: `/owner/leads/${leadId}`, reason: reason === "unauthorized" ? "unauthorized" : undefined },
    });
  }

  return (
    <OwnerShell onUnauthorized={goToLogin}>
      {(_owner, registerRefresh) => (
        <OwnerLeadDetailBody leadId={leadId} onUnauthorized={() => goToLogin("unauthorized")} registerRefresh={registerRefresh} />
      )}
    </OwnerShell>
  );
}

export function OwnerLeadDetailBody({
  leadId,
  onUnauthorized,
  registerRefresh,
}: {
  readonly leadId: string;
  readonly onUnauthorized: () => void;
  readonly registerRefresh: RegisterOwnerShellRefresh;
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

  return <OwnerLeadDetailPage leadId={leadId} state={state} retry={refresh} deps={deps} onUnauthorized={onUnauthorized} />;
}
