import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { OwnerShellReactContext } from "@/components/owner/owner-shell-context";

/**
 * PERF — the persistent /owner layout. Every child route (Enquiries,
 * Overview, a lead's detail, Add enquiry, Edit enquiry) previously wrapped
 * itself in its own <OwnerShell>, so TanStack Router unmounted/remounted
 * the whole shell (header/nav chrome included) on every owner-to-owner
 * navigation — see OwnerShell.tsx's own PERF comment for the measured cost
 * this caused before its session-check cache. Moving <OwnerShell> up to this
 * one pathless layout route (sibling to the owner/ directory, matching this
 * codebase's own file-route convention) means it mounts exactly once per
 * owner session: in-app navigation between child routes only ever swaps
 * what <Outlet/> renders, never the shell around it.
 *
 * Child routes read the verified owner identity, the shared header's
 * registerRefresh callback, and a single onUnauthorized callback (for a
 * page's own data call failing with 401 after the shell already confirmed
 * authorization at mount) via useOwnerShellContext() (from
 * @/components/owner/owner-shell-context — see that file's own comment for
 * why the Context lives there and not in this route file) instead of
 * receiving them as OwnerShell render-prop arguments directly — this is the
 * one new piece of plumbing this move needs; every *Body component's own
 * existing prop-based API (already covered by its own tests) is unchanged.
 *
 * /owner/login is a file-route child of this same owner/ directory (so
 * TanStack Router nests it under this layout too), but it is NOT an
 * authenticated page — it runs its own independent, self-contained
 * session bootstrap (see OwnerLoginRouteBody) and must render even for a
 * signed-out visitor. Wrapping it in <OwnerShell> as well would mean two
 * competing auth gates: OwnerShell's own would never resolve for a signed-
 * out visitor and would redirect to /owner/login from /owner/login itself
 * (an infinite self-redirect, reproduced live). So this layout renders a
 * bare <Outlet/> for exactly that one path, skipping <OwnerShell> entirely.
 */

export const Route = createFileRoute("/owner")({
  component: OwnerLayoutRouteComponent,
});

type NavigateFn = ReturnType<typeof useNavigate>;

/**
 * Isolation — the single choke point every unauthenticated/unauthorized
 * redirect goes through, whichever path triggered it: OwnerShell's own
 * bootstrap guard (no local token, or a rejected/expired session), its
 * handleLogout, AND a child route's own data call failing with 401 after
 * the shell already confirmed authorization at mount (via this context's
 * own `onUnauthorized` below). That last path previously redirected
 * WITHOUT clearing the cache — OwnerShell.tsx's internal clears only ever
 * covered its own two call sites, not this one — so a lead list/detail/
 * overview response that happened to come back 401 mid-session left this
 * owner's cached data sitting in the shared QueryClient for whichever
 * owner signs in next in this browser. Exported standalone (not inlined in
 * the component below) so the cache-clearing guarantee itself is directly
 * unit-testable without needing a full router/OwnerShell render.
 */
export function createGoToLogin(queryClient: QueryClient, navigate: NavigateFn) {
  return function goToLogin(reason: "unauthenticated" | "unauthorized") {
    queryClient.clear();
    // Computed fresh at call time (never a value captured at render time),
    // so this single shared function always redirects back to whichever
    // page the owner was actually on — matching every former per-route
    // goToLogin's own specific redirect target, without needing to know it
    // ahead of time.
    const redirect = window.location.pathname + window.location.search;
    navigate({ to: "/owner/login", search: { redirect, reason: reason === "unauthorized" ? "unauthorized" : undefined } });
  };
}

function OwnerLayoutRouteComponent() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Reactive to the current child route without needing this layout itself
  // to remount — only the Add Enquiry route's own header CTA should hide.
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const goToLogin = createGoToLogin(queryClient, navigate);

  if (pathname === "/owner/login") {
    return <Outlet />;
  }

  return (
    <OwnerShell onUnauthorized={goToLogin} hideAddEnquiryCta={pathname === "/owner/leads/new"}>
      {(owner, registerRefresh) => (
        <OwnerShellReactContext.Provider value={{ owner, registerRefresh, onUnauthorized: () => goToLogin("unauthorized") }}>
          <Outlet />
        </OwnerShellReactContext.Provider>
      )}
    </OwnerShell>
  );
}
