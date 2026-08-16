import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createOwnerAuthClient, type OwnerAuthClient } from "./owner-auth-client";
import { createOwnerSessionChecker, type OwnerSessionChecker } from "./owner-session-checker";

/**
 * CHECKPOINT C2I-A — the protected /owner landing screen. Authentication
 * foundation only: a minimal, truthful placeholder ("Owner workspace" +
 * logout) — no fabricated dashboard metrics, no customer lead data. The
 * real lead dashboard, analytics, Quick Add and owner file viewer are
 * explicitly out of scope for this checkpoint.
 *
 * This component's own guard (checking local session presence, then
 * calling GET /api/owner/session) is a UX layer only, exactly as required:
 * it exists so an unauthorized visitor sees a redirect instead of a flash
 * of content, but the REAL authorization is the server-side
 * verifyOwnerSession check behind /api/owner/session — any future
 * sensitive owner API must call that same verifier itself, never rely on
 * this component having run.
 */
export interface OwnerShellProps {
  readonly authClient?: OwnerAuthClient;
  readonly sessionChecker?: OwnerSessionChecker;
  /** Called when the guard determines the visitor is not authorized (no local session, an expired/invalid one, or a signed-in-but-not-an-active-owner account) — the route wires this to a redirect to /owner/login. */
  readonly onUnauthorized: (reason: "unauthenticated" | "unauthorized") => void;
}

type GuardState = "checking" | "authorized";

export function OwnerShell({ authClient, sessionChecker, onUnauthorized }: OwnerShellProps) {
  const [ownerAuthClient] = useState<OwnerAuthClient>(() => authClient ?? createOwnerAuthClient());
  const [ownerSessionChecker] = useState<OwnerSessionChecker>(() => sessionChecker ?? createOwnerSessionChecker());
  const [state, setState] = useState<GuardState | null>(null);

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

      if (!result.ok) {
        // An expired/invalid/unauthorized session — clear it locally
        // before redirecting so a stale local session can never make the
        // guard appear to pass again without a fresh sign-in.
        await ownerAuthClient.signOut();
        onUnauthorized("unauthorized");
        return;
      }

      setState("authorized");
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

  if (state !== "authorized") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Checking your session…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Owner workspace</h1>
          <Button type="button" variant="outline" onClick={() => void handleLogout()}>
            Log out
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          You're signed in as the MSM owner. The lead dashboard, analytics and Quick Add tools are not built yet — this
          checkpoint only sets up sign-in and authorization.
        </p>
      </div>
    </div>
  );
}
