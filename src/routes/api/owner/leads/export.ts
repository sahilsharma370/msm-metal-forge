import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { parseOwnerLeadListQuery } from "@/server/owner-leads/owner-leads.server";
import { createProductionOwnerLeadExportServiceDeps, exportOwnerLeadsCsv } from "@/server/owner-leads/owner-lead-export.server";
import type { OwnerLeadListErrorCode } from "@/lib/owner/owner-leads-contract";

/**
 * CHECKPOINT C2M-A — GET /api/owner/leads/export: owner-authorized CSV
 * download of the Inbox or Archived view under the caller's current
 * filters. Same session verification as every other owner route; reuses
 * parseOwnerLeadListQuery (the same validated query shape/allowlist the
 * list endpoint already uses) so no new filter-parsing surface is
 * introduced. Trash is rejected by exportOwnerLeadsCsv itself regardless
 * of what `view` the request carries.
 *
 * Returns a real `text/csv` attachment on success (never JSON wrapping the
 * CSV text) and the same sanitized JSON error envelope every other owner
 * route uses on failure, so the browser can distinguish a completed
 * download from an error purely by content-type/status.
 */
function jsonErrorResponse(status: number, code: OwnerLeadListErrorCode, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

const unauthorizedResponse = () => jsonErrorResponse(401, "UNAUTHORIZED", "Your session has expired. Please sign in again.");
const genericServerErrorResponse = () => jsonErrorResponse(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
const validationErrorResponse = () => jsonErrorResponse(400, "VALIDATION_ERROR", "The request could not be validated.");

export async function handleOwnerLeadExportRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
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

  const url = new URL(request.url);
  const parsedQuery = parseOwnerLeadListQuery(url.searchParams);
  if (!parsedQuery.ok) {
    return validationErrorResponse();
  }

  if (parsedQuery.query.view === "trash") {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadExportServiceDeps();
    const result = await exportOwnerLeadsCsv(parsedQuery.query, deps);
    if (!result.ok) {
      return result.reason === "invalid_view" ? validationErrorResponse() : genericServerErrorResponse();
    }
    return new Response(result.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/export")({
  server: {
    handlers: {
      GET: async ({ request }) => handleOwnerLeadExportRequest(request),
    },
  },
});
