import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { OwnerLoginFlow } from "@/components/owner/OwnerLoginFlow";
import { OwnerAuthBootstrapScreen } from "@/components/owner/OwnerAuthBootstrapScreen";
import { createOwnerAuthClient } from "@/components/owner/owner-auth-client";
import { createOwnerSessionChecker } from "@/components/owner/owner-session-checker";
import msmLogo from "@/assets/msm-logo.svg";

const SESSION_CHECK_ERROR_MESSAGE = "We couldn't verify your session. Please try again.";

/**
 * CHECKPOINT C2I-A — the only protected destination this checkpoint ships.
 * `resolveSafeRedirect` is an allowlist of exactly this one path, not a
 * generic same-origin/relative-path check — that closes the open-redirect
 * surface completely (an arbitrary `redirect` search value can never send a
 * signed-in owner anywhere but here) rather than relying on validation
 * logic that could have edge cases. If a second protected route is ever
 * added, this allowlist grows by one literal, deliberately, rather than
 * becoming a generic parser.
 */
const SAFE_REDIRECT_TARGET = "/owner" as const;

function resolveSafeRedirect(_candidate: string | undefined): typeof SAFE_REDIRECT_TARGET {
  return SAFE_REDIRECT_TARGET;
}

const ownerLoginSearchSchema = z.object({
  redirect: z.string().optional(),
  reason: z.enum(["unauthorized", "expired"]).optional(),
});

const title = "Owner sign-in | MSM Scrap";

export const Route = createFileRoute("/owner/login")({
  validateSearch: (search) => ownerLoginSearchSchema.parse(search),
  head: () => ({ meta: [{ title }] }),
  component: OwnerLoginRouteComponent,
});

function OwnerLoginRouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const target = resolveSafeRedirect(search.redirect);

  return (
    <OwnerLoginRouteBody
      {...(search.reason ? { reason: search.reason } : {})}
      onAuthenticated={() => navigate({ to: target, replace: true })}
      onAlreadySignedIn={() => navigate({ to: target, replace: true })}
    />
  );
}

export type OwnerLoginAuthClient = ReturnType<typeof createOwnerAuthClient>;
export type OwnerLoginSessionChecker = ReturnType<typeof createOwnerSessionChecker>;

export interface OwnerLoginRouteBodyProps {
  readonly reason?: "unauthorized" | "expired";
  readonly onAuthenticated: () => void;
  /** Called once, on mount, if a valid existing session is found — the login screen itself is never shown in that case. */
  readonly onAlreadySignedIn: () => void;
  readonly authClient?: OwnerLoginAuthClient;
  readonly sessionChecker?: OwnerLoginSessionChecker;
}

/** "error" — a thrown exception in the bootstrap sequence itself, never left as an indefinite "checking" spinner; see OwnerShell.tsx's own identical guard for the full reasoning. */
type GateState = "checking" | "form" | "error";

/**
 * A valid existing session bypasses this screen entirely and opens the
 * workspace directly — the exact same two-step check OwnerShell.tsx's own
 * guard uses (local token presence, then the real server-side
 * verifyOwnerSession via GET /api/owner/session), reused here rather than a
 * second implementation. `authClient`/`sessionChecker` are injectable only
 * for tests; production always uses the real Supabase-backed ones.
 */
export function OwnerLoginRouteBody({
  reason,
  onAuthenticated,
  onAlreadySignedIn,
  authClient,
  sessionChecker,
}: OwnerLoginRouteBodyProps) {
  const [ownerAuthClient] = useState<OwnerLoginAuthClient>(() => authClient ?? createOwnerAuthClient());
  const [ownerSessionChecker] = useState<OwnerLoginSessionChecker>(() => sessionChecker ?? createOwnerSessionChecker());
  const [gate, setGate] = useState<GateState>("checking");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const token = await ownerAuthClient.getAccessToken();
        if (!token) {
          if (!cancelled) setGate("form");
          return;
        }

        const result = await ownerSessionChecker.check(token);
        if (cancelled) return;

        if (result.ok && result.owner) {
          onAlreadySignedIn();
          return;
        }
        setGate("form");
      } catch {
        // getAccessToken()/check() are both documented to resolve rather
        // than throw, but a genuine exception anywhere in this sequence
        // must still land on a visible, retriable state — never leave
        // `gate` stuck at "checking" forever.
        if (!cancelled) setGate("error");
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  function retryBootstrap() {
    setGate("checking");
    setRetryToken((previous) => previous + 1);
  }

  if (gate === "error") {
    return <OwnerAuthBootstrapScreen status="error" message={SESSION_CHECK_ERROR_MESSAGE} onRetry={retryBootstrap} logoHeightPx={32} />;
  }

  if (gate === "checking") {
    return <OwnerAuthBootstrapScreen status="checking" message="Checking your session…" logoHeightPx={32} />;
  }

  return (
    // CHECKPOINT OWNER/QUOTE MATTE PASS — exact public/Quote foundation
    // (#080A1D) + the same matte navy floating-card treatment as the Get
    // Quote exit-confirmation modal (quote-modal-matte: layered navy, a
    // slim top highlight, restrained border, one restrained elevation
    // shadow) instead of glass-panel's glossy gradient/shine.
    // `owner-auth-card` is a plain marker class for the scoped autofill fix
    // below — no styling of its own.
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#080A1D] px-4">
      <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-8 w-auto" />
      <div className="owner-auth-card quote-modal-matte w-full max-w-sm rounded-2xl p-7">
        <h1 className="font-display mb-1.5 text-2xl font-bold text-foreground">Owner sign-in</h1>
        <p className="mb-6 text-sm text-foreground/70">
          {reason === "unauthorized" || reason === "expired"
            ? "Your session has ended or is not authorized. Please sign in again."
            : "Enter your email to receive a 6-digit sign-in code."}
        </p>
        <OwnerLoginFlow onAuthenticated={onAuthenticated} />
      </div>
    </div>
  );
}
