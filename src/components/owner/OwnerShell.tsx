import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Plus, RefreshCw } from "lucide-react";
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

/**
 * PERF — every owner route wraps itself in its own OwnerShell (no shared
 * persistent layout route exists), so TanStack Router unmounts/remounts
 * this component on every owner-to-owner navigation (Enquiries -> a lead's
 * detail -> back, etc.), re-running the bootstrap effect below from
 * scratch each time: a real GET /api/owner/session network round trip,
 * with the entire shell (header/nav chrome included) replaced by the
 * full-screen "Checking your session…" gate until it resolves — measured
 * directly (real owner session, local Supabase + wrangler dev): ~90-450ms
 * network cost per repeat, plus a visually confirmed full-page blank-out,
 * on every single click between Enquiries/detail/back.
 *
 * This module-level cache keeps the shell visible across that in-app
 * navigation: a still-fresh, same-access-token verification from the
 * previous route's own OwnerShell instance is trusted immediately,
 * skipping both the redundant network call and the full-screen gate.
 * Never a substitute for real authorization — every actual data request
 * the destination page makes (lead list/detail, signed-file-url, status
 * update, …) still independently calls verifyOwnerSession server-side
 * exactly as before; a session revoked mid-window still fails closed the
 * moment any of those requests runs, via the existing unauthorized-redirect
 * effect every page already has. This cache only ever short-circuits the
 * client-side UX gate's own re-check, never a server-side authorization
 * decision.
 */
const OWNER_SESSION_CACHE_TTL_MS = 30_000;

interface CachedOwnerSessionCheck {
  readonly accessToken: string;
  readonly owner: OwnerIdentitySummary;
  readonly checkedAtMs: number;
}

let cachedOwnerSessionCheck: CachedOwnerSessionCheck | null = null;

/** Test-only — clears the module-level cache so each test starts from a clean slate. Never called from production code. */
export function __resetOwnerShellSessionCacheForTests(): void {
  cachedOwnerSessionCheck = null;
}

export function OwnerShell({ authClient, sessionChecker, onUnauthorized, children, hideAddEnquiryCta = false }: OwnerShellProps) {
  const queryClient = useQueryClient();
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
          // Isolation — no local session means a clean slate: nothing to
          // trust here, including any owner lead list/detail/overview data
          // a PREVIOUS owner's session may have cached (see the logout/
          // unauthorized branches below for the same guarantee).
          queryClient.clear();
          if (!cancelled) onUnauthorized("unauthenticated");
          return;
        }

        if (
          cachedOwnerSessionCheck &&
          cachedOwnerSessionCheck.accessToken === token &&
          Date.now() - cachedOwnerSessionCheck.checkedAtMs < OWNER_SESSION_CACHE_TTL_MS
        ) {
          if (!cancelled) setState({ phase: "authorized", owner: cachedOwnerSessionCheck.owner });
          return;
        }

        const result = await ownerSessionChecker.check(token);
        if (cancelled) return;

        if (!result.ok || !result.owner) {
          // An expired/invalid/unauthorized session — clear it locally
          // before redirecting so a stale local session can never make the
          // guard appear to pass again without a fresh sign-in. Also clear
          // the data cache (isolation — the next sign-in, possibly as a
          // different owner, must never see this session's cached leads).
          cachedOwnerSessionCheck = null;
          queryClient.clear();
          await ownerAuthClient.signOut();
          if (!cancelled) onUnauthorized("unauthorized");
          return;
        }

        cachedOwnerSessionCheck = { accessToken: token, owner: result.owner, checkedAtMs: Date.now() };
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
    // Isolation — the next sign-in in this browser (possibly as a
    // different owner) must never see this session's cached leads.
    cachedOwnerSessionCheck = null;
    queryClient.clear();
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
    // Base canvas is still the exact #080A1D literal; a very restrained
    // top-centre navy radial (not a bright/orange gradient) adds the
    // reference's subtle tonal depth on top of it.
    <div
      className="flex min-h-screen flex-col bg-[#080A1D]"
      style={{ backgroundImage: "radial-gradient(120% 55% at 50% -10%, oklch(0.27 0.05 265 / 0.35), transparent 60%)" }}
    >
      {/* h-[86px]/lg: only; 70px unchanged below lg. Subtle bottom border
          matches the reference's header-bottom line. */}
      <header className="sticky top-0 z-40 h-[70px] border-b border-white/10 bg-[#080A1D] lg:h-[86px]">
        {/* minmax(0,1fr) (not plain 1fr) on both outer columns so the
            centre nav stays visually centred even though the left (logo)
            and right (actions) content widths differ. */}
        <div className={`${OWNER_CONTAINER_CLASS} grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3`}>
          <div className="flex min-w-0 items-center">
            <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-7 w-auto shrink-0 lg:h-8" />
          </div>

          <OwnerNav />

          <div className="flex shrink-0 items-center justify-end gap-2 lg:gap-3">
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
            {/* Subtle vertical divider between Refresh and Log out, matching
                the reference — desktop only, purely decorative. CHECKPOINT
                OWNER ENQUIRIES SIX-CIRCLE PASS — now gated on refreshHandler
                existing at all: a page that never registers one (Add
                enquiry's own Body, for one) left Log out as the only
                right-side control with this divider still rendered right
                before it — an orphaned separator with nothing on its other
                side to separate from. */}
            {refreshHandler ? <span aria-hidden="true" className="hidden h-5 w-px bg-white/15 lg:block" /> : null}
            {/* Icon-only below `lg` — same treatment Refresh already uses
                above — so this header's right-side actions (Log out, + Add
                enquiry) stop colliding with the centre nav pill at phone
                widths; `aria-label` keeps the accessible name stable even
                though the visible text is gone on mobile. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleLogout()}
              aria-label="Log out"
              className="gap-1.5 text-foreground/70 hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden lg:inline">Log out</span>
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
              <Button
                asChild
                variant="brand"
                size="sm"
                className="ml-1 invisible gap-1.5 bg-copper pointer-events-none hover:bg-copper/90"
                aria-hidden="true"
              >
                <span tabIndex={-1}>
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="hidden lg:inline">Add enquiry</span>
                </span>
              </Button>
            ) : (
              <Button asChild variant="brand" size="sm" aria-label="Add enquiry" className="ml-1 gap-1.5 bg-copper hover:bg-copper/90">
                <Link to="/owner/leads/new">
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="hidden lg:inline">Add enquiry</span>
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
