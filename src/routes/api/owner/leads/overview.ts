import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { createProductionOwnerLeadOverviewServiceDeps, getOwnerLeadOverview } from "@/server/owner-leads/owner-lead-overview.server";
import type { OwnerLeadOverviewData } from "@/lib/owner/owner-lead-overview-contract";

/**
 * CHECKPOINT C2K — GET /api/owner/leads/overview: secure, active-owner-only,
 * read-only aggregate snapshot for the owner overview UI. Same security flow
 * as every other owner route (verifyOwnerSession — never a second token
 * implementation), same generic-401/never-forward-raw-error convention as
 * GET /api/owner/leads.
 */
interface OwnerLeadOverviewResponseBody {
  readonly ok: boolean;
  readonly data?: OwnerLeadOverviewData;
  readonly error?: { readonly code: "INTERNAL_ERROR"; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadOverviewResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const genericServerErrorResponse = () =>
  jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });

export async function handleOwnerLeadOverviewRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse(405, { ok: false });
  }

  const token = extractBearerToken(request);

  let sessionDeps: ReturnType<typeof getOwnerSessionVerifierDeps>;
  try {
    sessionDeps = getOwnerSessionVerifierDeps();
  } catch {
    return genericServerErrorResponse();
  }

  const session = await verifyOwnerSession(token, sessionDeps);
  if (!session.ok) {
    return unauthorizedResponse();
  }

  try {
    const deps = createProductionOwnerLeadOverviewServiceDeps();
    const data = await getOwnerLeadOverview(deps);
    return jsonResponse(200, { ok: true, data });
  } catch {
    // Never forwards a raw Postgres/Supabase error, SQL text, or table
    // name — matches every other owner route's own convention.
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/overview")({
  server: {
    handlers: {
      GET: async ({ request }) => handleOwnerLeadOverviewRequest(request),
    },
  },
});
