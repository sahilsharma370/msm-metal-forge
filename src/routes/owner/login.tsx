import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { OwnerLoginFlow } from "@/components/owner/OwnerLoginFlow";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-foreground">Owner sign-in</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {search.reason === "unauthorized" || search.reason === "expired"
            ? "Your session has ended or is not authorized. Please sign in again."
            : "Enter your email to receive a 6-digit sign-in code."}
        </p>
        <OwnerLoginFlow onAuthenticated={() => navigate({ to: target })} />
      </div>
    </div>
  );
}
