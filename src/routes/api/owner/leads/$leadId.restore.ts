import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { createProductionOwnerLeadRestoreServiceDeps, restoreOwnerLead } from "@/server/owner-leads/owner-lead-restore.server";
import { isValidUuid } from "@/server/owner-leads/owner-lead-detail.server";
import type { OwnerLeadMutationErrorCode } from "@/lib/owner/owner-lead-detail-contract";
import type { OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";

/**
 * CHECKPOINT C2M-A — POST /api/owner/leads/:leadId/restore: reverses a
 * Trash action via restore_lead_v1. Same security flow as every other
 * owner route. No request body needed.
 */
interface OwnerLeadRestoreRouteResponseBody {
  readonly ok: boolean;
  readonly data?: { readonly restored: boolean; readonly status: OwnerLeadStatus };
  readonly error?: { readonly code: OwnerLeadMutationErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadRestoreRouteResponseBody): Response {
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

export async function handleOwnerLeadRestoreRequest(request: Request, leadId: string): Promise<Response> {
  if (request.method !== "POST") {
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
    const deps = createProductionOwnerLeadRestoreServiceDeps();
    const result = await restoreOwnerLead({ leadId, ownerUserId: session.owner.userId }, deps);
    if (!result.ok) {
      if (result.reason === "unauthorized") return unauthorizedResponse();
      if (result.reason === "not_found") return notFoundResponse();
      return genericServerErrorResponse();
    }
    return jsonResponse(200, { ok: true, data: { restored: result.restored, status: result.status } });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId/restore")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleOwnerLeadRestoreRequest(request, params.leadId),
    },
  },
});
