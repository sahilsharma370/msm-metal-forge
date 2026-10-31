import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import type { OwnerIdentity } from "@/server/owner-auth/owner-auth-types";

/**
 * CHECKPOINT C2I-A — the one protected read this checkpoint ships: "is the
 * bearer token's owner currently authorized". Used by the /owner shell's
 * client-side guard to decide whether to render the workspace or redirect
 * to /owner/login — that check is a UX layer only (see owner/index.tsx's
 * own comment); THIS route is the real server-side authorization, via
 * verifyOwnerSession, the one reusable verifier every current and future
 * protected owner route must use.
 *
 * Every failure reason (missing/malformed/invalid token, no owner row,
 * inactive owner) collapses to the exact same 401 + generic body — never
 * distinguished, so a caller cannot learn anything about account existence
 * or authorization state beyond "authorized" vs. "not authorized".
 */
export interface OwnerSessionResponseBody {
  readonly ok: boolean;
  readonly owner?: OwnerIdentity;
}

function jsonResponse(status: number, body: OwnerSessionResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const genericServerErrorResponse = () => jsonResponse(500, { ok: false });

export async function handleOwnerSessionRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse(405, { ok: false });
  }

  const token = extractBearerToken(request);

  let deps: ReturnType<typeof getOwnerSessionVerifierDeps>;
  try {
    deps = getOwnerSessionVerifierDeps();
  } catch {
    return genericServerErrorResponse();
  }

  const result = await verifyOwnerSession(token, deps);
  if (!result.ok) {
    return unauthorizedResponse();
  }

  return jsonResponse(200, { ok: true, owner: result.owner });
}

export const Route = createFileRoute("/api/owner/session")({
  server: {
    handlers: {
      GET: async ({ request }) => handleOwnerSessionRequest(request),
    },
  },
});
