import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createOwnerAuthClient, type OwnerAuthClient } from "./owner-auth-client";
import { createOwnerSessionChecker, type OwnerSessionChecker } from "./owner-session-checker";
import type { OwnerIdentitySummary } from "./owner-session-checker";

/** A page passes this to `children`'s second argument to install/replace/remove the header's own "Refresh" button — real, page-owned data reloading, never a decorative no-op. Passing `null` for `handler` removes the button. */
export type RegisterOwnerShellRefresh = (handler: (() => void) | null, isRefreshing: boolean) => void;

/**
 * CHECKPOINT C2I-A (auth guard) / C2J-D (real workspace shell) — the
 * protected /owner layout every Manage page renders inside. This
 * component's own guard (checking local session presence, then calling
 * GET /api/owner/session) is a UX layer only: it exists so an unauthorized
 * visitor sees a redirect instead of a flash of content, but the REAL
 * authorization is the server-side verifyOwnerSession check behind every
 * owner API — this component never substitutes for that.
 *
 * Owns exactly the persistent chrome every Manage page shares (title,
 * owner/session badge, an optional page-supplied refresh action, logout) —
 * page-specific content (the inbox, a lead's detail) is supplied as
 * `children`, so this file never needs to know what a lead is.
 */
export interface OwnerShellProps {
  readonly authClient?: OwnerAuthClient;
  readonly sessionChecker?: OwnerSessionChecker;
  /** Called when the guard determines the visitor is not authorized (no local session, an expired/invalid one, or a signed-in-but-not-an-active-owner account) — the route wires this to a redirect to /owner/login. */
  readonly onUnauthorized: (reason: "unauthenticated" | "unauthorized") => void;
  /** Real page content, rendered only once the guard has confirmed an active owner session. Receives the verified owner identity (so a page can use it without a second fetch) and a registerRefresh callback the page can call to install its own real refresh action into the shared header. */
  readonly children: (owner: OwnerIdentitySummary, registerRefresh: RegisterOwnerShellRefresh) => React.ReactNode;
}

type GuardState = { readonly phase: "checking" } | { readonly phase: "authorized"; readonly owner: OwnerIdentitySummary };

export function OwnerShell({ authClient, sessionChecker, onUnauthorized, children }: OwnerShellProps) {
  const [ownerAuthClient] = useState<OwnerAuthClient>(() => authClient ?? createOwnerAuthClient());
  const [ownerSessionChecker] = useState<OwnerSessionChecker>(() => sessionChecker ?? createOwnerSessionChecker());
  const [state, setState] = useState<GuardState>({ phase: "checking" });
  const [refreshHandler, setRefreshHandler] = useState<(() => void) | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const registerRefresh = useCallback<RegisterOwnerShellRefresh>((handler, refreshing) => {
    setRefreshHandler(() => handler);
    setIsRefreshing(refreshing);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const token = await ownerAuthClient.getAccessToken();
      if (!token) {
        if (!cancelled) onUnauthorized("unauthenticated");
        return;
      }

      const result = await ownerSessionChecker.check(token);
      if (cancelled) return;

      if (!result.ok || !result.owner) {
        // An expired/invalid/unauthorized session — clear it locally
        // before redirecting so a stale local session can never make the
        // guard appear to pass again without a fresh sign-in.
        await ownerAuthClient.signOut();
        onUnauthorized("unauthorized");
        return;
      }

      setState({ phase: "authorized", owner: result.owner });
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await ownerAuthClient.signOut();
    onUnauthorized("unauthenticated");
  }

  if (state.phase !== "authorized") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Checking your session…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-deep/95 backdrop-blur supports-[backdrop-filter]:bg-navy-deep/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">MSM Owner Workspace</h1>
            <Badge variant="outline" className="hidden shrink-0 border-copper/40 text-copper-bright sm:inline-flex">
              Owner
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {refreshHandler ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refreshHandler}
                disabled={isRefreshing}
                aria-label="Refresh"
                className="gap-1.5"
              >
                <RefreshCw className={isRefreshing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void handleLogout()}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children(state.owner, registerRefresh)}</main>
    </div>
  );
}
