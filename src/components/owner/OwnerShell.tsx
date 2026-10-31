import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import msmLogo from "@/assets/msm-logo.svg";
import { OwnerNav } from "./OwnerNav";
import { OwnerAuthBootstrapScreen } from "./OwnerAuthBootstrapScreen";
import { OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import { createOwnerAuthClient, type OwnerAuthClient } from "./owner-auth-client";
import { createOwnerSessionChecker, type OwnerSessionChecker } from "./owner-session-checker";
import type { OwnerIdentitySummary } from "./owner-session-checker";

const SESSION_CHECK_ERROR_MESSAGE = "We couldn't verify your session. Please try again.";

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
  /** CHECKPOINT OWNER DESKTOP CORRECTION — set by the Add Enquiry route only, so its own header CTA doesn't offer to navigate to the page already showing. A plain route-supplied flag, not a router-location hook, so this component never needs real router context to render (it currently only mocks `<Link>` in tests). */
  readonly hideAddEnquiryCta?: boolean;
}

type GuardState =
  | { readonly phase: "checking" }
  | { readonly phase: "authorized"; readonly owner: OwnerIdentitySummary }
  /** A thrown exception somewhere in the bootstrap sequence itself (e.g. signOut() failing against a flaky network) — never left as an indefinite "checking" spinner (see the required behaviour this guards against), and never silently redirected to login either, since a redirect on a transient failure would sign a genuinely valid owner out for no reason. */
  | { readonly phase: "error" };

export function OwnerShell({ authClient, sessionChecker, onUnauthorized, children, hideAddEnquiryCta = false }: OwnerShellProps) {
  const [ownerAuthClient] = useState<OwnerAuthClient>(() => authClient ?? createOwnerAuthClient());
  const [ownerSessionChecker] = useState<OwnerSessionChecker>(() => sessionChecker ?? createOwnerSessionChecker());
  const [state, setState] = useState<GuardState>({ phase: "checking" });
  const [retryToken, setRetryToken] = useState(0);
  const [refreshHandler, setRefreshHandler] = useState<(() => void) | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const registerRefresh = useCallback<RegisterOwnerShellRefresh>((handler, refreshing) => {
    setRefreshHandler(() => handler);
    setIsRefreshing(refreshing);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
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
          if (!cancelled) onUnauthorized("unauthorized");
          return;
        }

        setState({ phase: "authorized", owner: result.owner });
      } catch {
        // getAccessToken()/check() are both documented to resolve rather
        // than throw, but signOut() (and anything else in this sequence)
        // is not — a genuine exception here must still land on a visible,
        // retriable state, never leave `state` stuck at "checking" forever.
        if (!cancelled) setState({ phase: "error" });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  function retryBootstrap() {
    setState({ phase: "checking" });
    setRetryToken((previous) => previous + 1);
  }

  async function handleLogout() {
    await ownerAuthClient.signOut();
    onUnauthorized("unauthenticated");
  }

  if (state.phase === "error") {
    return <OwnerAuthBootstrapScreen status="error" message={SESSION_CHECK_ERROR_MESSAGE} onRetry={retryBootstrap} logoHeightPx={28} />;
  }

  if (state.phase !== "authorized") {
    return <OwnerAuthBootstrapScreen status="checking" message="Checking your session…" logoHeightPx={28} />;
  }

  return (
    // CHECKPOINT C2L-V3 — the exact public/Quote canvas (#080A1D, a
    // deliberate literal in this codebase — see QuoteExperience.tsx's own
    // identical bg-[#080A1D] — never any --background/--navy* token, which
    // render visibly lighter/bluer). Flat and uniform everywhere: elevation
    // comes entirely from the glass panels floating on top (this shell's
    // own precedent — QuoteExperience.tsx has no separate ambient/radial
    // treatment either), never from stepped background tones.
    <div className="flex min-h-screen flex-col bg-[#080A1D]">
      <header className="sticky top-0 z-40 h-[70px] bg-[#080A1D]">
        <div className={`${OWNER_CONTAINER_CLASS} grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3`}>
          <div className="flex min-w-0 items-center">
            <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-7 w-auto shrink-0" />
          </div>

          <OwnerNav />

          <div className="flex shrink-0 items-center justify-end gap-2">
            {/* Secondary to the primary action below: ghost/` ` text-only,
                smaller footprint, never competes with + Add enquiry. */}
            {refreshHandler ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={refreshHandler}
                disabled={isRefreshing}
                aria-label="Refresh"
                className="gap-1.5 text-foreground/70 hover:text-foreground"
              >
                <RefreshCw className={isRefreshing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden="true" />
                <span className="hidden lg:inline">Refresh</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
              className="text-foreground/70 hover:text-foreground"
            >
              Log out
            </Button>
            {/* CHECKPOINT OWNER DESKTOP REFINEMENT / C2M-A — the one
                persistent, copper primary action across Overview/
                Enquiries/Add Enquiry. Quick Add's old nav-tab entry point
                is gone; this is now the single, standardized way in. It is
                also the ONLY "+ Add enquiry" control now — the former
                page-level duplicate on Enquiries was removed.
                On the Add Enquiry route itself this renders as a purely
                visual, non-interactive, non-accessible layout spacer
                (same Button classes so the header's width never shifts
                between pages, but `invisible` + `pointer-events-none` +
                `aria-hidden` + a plain `<span>` via `asChild` — never a
                real, keyboard-reachable `<button>`) rather than a visible
                disabled button announcing an action the owner can't take
                on the page already showing it. */}
            {hideAddEnquiryCta ? (
              <Button asChild variant="brand" size="sm" className="ml-1 invisible gap-1.5 pointer-events-none" aria-hidden="true">
                <span tabIndex={-1}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add enquiry
                </span>
              </Button>
            ) : (
              <Button asChild variant="brand" size="sm" className="ml-1 gap-1.5">
                <Link to="/owner/leads/new">
                  <Plus className="size-4" aria-hidden="true" />
                  Add enquiry
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col bg-[#080A1D]">{children(state.owner, registerRefresh)}</main>
    </div>
  );
}
