import { useEffect, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OwnerShell, type RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";
import { OwnerLeadInbox } from "@/components/owner/OwnerLeadInbox";
import { useOwnerLeadList } from "@/components/owner/use-owner-lead-list";
import { useOwnerLeadExport } from "@/components/owner/use-owner-lead-export";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import type { OwnerLeadsTransportDeps } from "@/components/owner/owner-leads-transport";

const title = "Owner workspace | MSM Scrap";

export const Route = createFileRoute("/owner/")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerIndexRouteComponent,
});

function OwnerIndexRouteComponent() {
  const navigate = useNavigate();

  function goToLogin(reason: "unauthenticated" | "unauthorized") {
    navigate({ to: "/owner/login", search: { redirect: "/owner", reason: reason === "unauthorized" ? "unauthorized" : undefined } });
  }

  return (
    <OwnerShell onUnauthorized={goToLogin}>
      {(_owner, registerRefresh) => (
        <OwnerInboxBody onUnauthorized={() => goToLogin("unauthorized")} registerRefresh={registerRefresh} />
      )}
    </OwnerShell>
  );
}

export function OwnerInboxBody({
  onUnauthorized,
  registerRefresh,
}: {
  readonly onUnauthorized: () => void;
  readonly registerRefresh: RegisterOwnerShellRefresh;
}) {
  // CHECKPOINT C2J-D1 — created exactly once per mount, not on every
  // render: createOwnerAuthClient() itself is cheap (it just wraps the
  // already-memoized getSupabaseBrowserClient() singleton), but a fresh
  // object literal every render gives useOwnerLeadList's internal
  // useCallback([deps]) a new `runFetch`/`refresh` identity every render,
  // which fed straight into the registerRefresh effect below and caused an
  // unbroken render loop (OwnerShell state update -> re-render -> new deps
  // -> new refresh identity -> effect re-fires -> OwnerShell state update
  // -> ...). See use-owner-lead-list.test.ts's own stability regression
  // test for the empirical proof this fixes it.
  //
  // CHECKPOINT C2J-D2 — `fetch.bind(globalThis)`, not the bare `fetch`
  // reference: native `fetch` is a WebIDL-branded method that requires
  // `window` (or the correct global) as its `this` receiver. Storing the
  // bare function on `deps` and later invoking it as `deps.fetchImpl(...)`
  // (a method call on `deps`, not on `window`) makes `this` become `deps`
  // inside fetch's own implementation, which real Chrome rejects with
  // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
  // — confirmed empirically in a real browser session, reproducibly only
  // once an AbortSignal is present in the request options (which every
  // real call here always has). The exception was caught by
  // callOwnerApi's try/catch and silently downgraded to a generic
  // sanitized error, which is why the inbox showed "Something went wrong"
  // with zero matching network requests ever reaching Wrangler's request
  // log — the browser rejected the call before dispatching it at all.
  const deps = useMemo<OwnerLeadsTransportDeps>(() => ({ authClient: createOwnerAuthClient(), fetchImpl: fetch.bind(globalThis) }), []);
  const list = useOwnerLeadList(deps);
  const exportCsvHook = useOwnerLeadExport(deps, onUnauthorized);

  useEffect(() => {
    if (list.state.unauthorized) onUnauthorized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state.unauthorized]);

  useEffect(() => {
    registerRefresh(list.refresh, list.state.isRefreshing);
    return () => registerRefresh(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.refresh, list.state.isRefreshing]);

  return <OwnerLeadInbox {...list} exportState={exportCsvHook.state} onExportCsv={exportCsvHook.exportCsv} onClearExportError={exportCsvHook.clearError} />;
}
