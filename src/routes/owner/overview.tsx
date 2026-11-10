import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";
import { OwnerOverview } from "@/components/owner/OwnerOverview";
import { useOwnerLeadOverview } from "@/components/owner/use-owner-lead-overview";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";
import { useOwnerShellContext } from "@/components/owner/owner-shell-context";

const title = "Overview | MSM Owner Workspace";

export const Route = createFileRoute("/owner/overview")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerOverviewRouteComponent,
});

function OwnerOverviewRouteComponent() {
  const { registerRefresh, onUnauthorized } = useOwnerShellContext();
  return <OwnerOverviewBody onUnauthorized={onUnauthorized} registerRefresh={registerRefresh} />;
}

export function OwnerOverviewBody({
  onUnauthorized,
  registerRefresh,
}: {
  readonly onUnauthorized: () => void;
  readonly registerRefresh: RegisterOwnerShellRefresh;
}) {
  // Same fetch.bind(globalThis) + useMemo([]) shape as OwnerInboxBody/
  // OwnerLeadDetailBody — see those components' own comments for why both
  // are required (render-loop and "Illegal invocation" fixes respectively).
  const deps = useMemo<OwnerLeadsTransportDeps>(() => ({ authClient: createOwnerAuthClient(), fetchImpl: fetch.bind(globalThis) }), []);
  const overview = useOwnerLeadOverview(deps);

  useEffect(() => {
    if (overview.state.unauthorized) onUnauthorized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.state.unauthorized]);

  useEffect(() => {
    registerRefresh(overview.refresh, overview.state.isLoading);
    return () => registerRefresh(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.refresh, overview.state.isLoading]);

  return <OwnerOverview {...overview} />;
}
