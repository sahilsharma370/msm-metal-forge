import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { createProductionOwnerLeadStatusServiceDeps, changeOwnerLeadStatus } from "@/server/owner-leads/owner-lead-status.server";
import { isValidUuid } from "@/server/owner-leads/owner-lead-detail.server";
import { ownerLeadStatusChangeRequestSchema, type OwnerLeadMutationErrorCode } from "@/lib/owner/owner-lead-detail-contract";
import type { OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";

/**
 * CHECKPOINT C2J-E — POST /api/owner/leads/:leadId/status: changes a
 * lead's workflow status and creates exactly one corresponding
 * lead_activities row, atomically, via change_lead_status_v1. Same
 * security flow as every other owner route (verifyOwnerSession — never a
 * second token implementation).
 *
 * POST, not PATCH/PUT: matches this codebase's established reasoning in
 * $leadId.files.$fileId.access.ts — this call always causes something new
 * (an activity row) to be created, not just a field to be replaced.
 *
 * A stale expectedStatus (the browser's last-known status no longer
 * matches the row) returns 409 CONFLICT with the lead's actual current
 * state, never silently overwritten — see change_lead_status_v1's own
 * header comment for the concurrency design.
 */
interface OwnerLeadStatusChangeRouteResponseBody {
  readonly ok: boolean;
  readonly data?: {
    readonly changed: boolean;
    readonly status: OwnerLeadStatus;
    readonly lostReason: string | null;
    readonly closedAt: string | null;
    readonly updatedAt: string;
  };
  readonly error?: { readonly code: OwnerLeadMutationErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadStatusChangeRouteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const notFoundResponse = () => jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
const notEditableResponse = () =>
  jsonResponse(409, { ok: false, error: { code: "NOT_EDITABLE", message: "This enquiry is in Trash and can't be changed until it's restored." } });
const genericServerErrorResponse = () =>
  jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
const validationErrorResponse = () =>
  jsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "The request could not be validated." } });

export async function handleOwnerLeadStatusChangeRequest(request: Request, leadId: string): Promise<Response> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse();
  }

  const parsedBody = ownerLeadStatusChangeRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadStatusServiceDeps();
    const result = await changeOwnerLeadStatus(
      {
        leadId,
        ownerUserId: session.owner.userId,
        expectedStatus: parsedBody.data.expectedStatus,
        newStatus: parsedBody.data.newStatus,
        lostReason: parsedBody.data.lostReason ?? null,
      },
      deps,
    );
    if (!result.ok) {
      if (result.reason === "unauthorized") return unauthorizedResponse();
      if (result.reason === "not_found") return notFoundResponse();
      if (result.reason === "not_editable") return notEditableResponse();
      if (result.reason === "validation") return validationErrorResponse();
      if (result.reason === "conflict") return jsonResponse(409, { ok: false, error: { code: "CONFLICT", message: "This lead was already updated. Please refresh and try again." } });
      return genericServerErrorResponse();
    }
    return jsonResponse(200, {
      ok: true,
      data: { changed: result.changed, status: result.status, lostReason: result.lostReason, closedAt: result.closedAt, updatedAt: result.updatedAt },
    });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId/status")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleOwnerLeadStatusChangeRequest(request, params.leadId),
    },
  },
});
