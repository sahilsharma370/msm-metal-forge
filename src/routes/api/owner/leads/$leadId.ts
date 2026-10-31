import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import {
  createProductionOwnerLeadDetailServiceDeps,
  getOwnerLeadDetail,
  isValidUuid,
} from "@/server/owner-leads/owner-lead-detail.server";
import type {
  OwnerLeadDetail,
  OwnerLeadDetailFile,
  OwnerLeadDetailActivity,
  OwnerLeadDetailNotification,
  OwnerLeadDetailErrorCode,
} from "@/lib/owner/owner-lead-detail-contract";

/**
 * CHECKPOINT C2J-B — GET /api/owner/leads/:leadId: a secure, read-only
 * single-lead detail view. Same security flow as /api/owner/leads and
 * /api/owner/session (verifyOwnerSession — never a second token
 * implementation), plus a UUID-shaped path parameter and one additional
 * failure mode this checkpoint introduces: a nonexistent, incomplete, or
 * otherwise inaccessible lead all collapse to the exact same generic 404 —
 * never distinguished, for the same reason invalid/expired/no-owner/
 * inactive-owner all collapse to the same generic 401.
 *
 * This route's own response envelope is intentionally looser than the
 * canonical ownerLeadDetailResponseBodySchema union (imported field TYPES
 * only, not the strict envelope schema) — matching /api/owner/leads' own
 * established precedent — because the 401 body is deliberately bare
 * ({ ok: false }, no error object) to disclose nothing about *why* auth
 * failed, which the canonical error schema does not model.
 */
interface OwnerLeadDetailRouteResponseBody {
  readonly ok: boolean;
  readonly data?: {
    readonly lead: OwnerLeadDetail;
    readonly files: readonly OwnerLeadDetailFile[];
    readonly activities: readonly OwnerLeadDetailActivity[];
    readonly notification: OwnerLeadDetailNotification;
  };
  readonly error?: { readonly code: OwnerLeadDetailErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadDetailRouteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const notFoundResponse = () => jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
const genericServerErrorResponse = () =>
  jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
const validationErrorResponse = () =>
  jsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "The request could not be validated." } });

export async function handleOwnerLeadDetailRequest(request: Request, leadId: string): Promise<Response> {
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

  if (!isValidUuid(leadId)) {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadDetailServiceDeps();
    const result = await getOwnerLeadDetail(leadId, deps);
    if (!result.ok) {
      return notFoundResponse();
    }
    return jsonResponse(200, {
      ok: true,
      data: { lead: result.lead, files: result.files, activities: result.activities, notification: result.notification },
    });
  } catch {
    // Never forwards a raw Postgres/Supabase error, SQL text, or table
    // name — every failure from here down collapses to the same generic
    // 500, matching every other server route in this codebase.
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleOwnerLeadDetailRequest(request, params.leadId),
    },
  },
});
