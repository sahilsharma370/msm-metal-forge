import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { createProductionOwnerLeadEditServiceDeps, updateOwnerLeadDetails } from "@/server/owner-leads/owner-lead-edit.server";
import { isValidUuid } from "@/server/owner-leads/owner-lead-detail.server";
import { ownerLeadEditRequestSchema, type OwnerLeadMutationErrorCode } from "@/lib/owner/owner-lead-detail-contract";

/**
 * Owner "Edit enquiry" — POST /api/owner/leads/:leadId/details: corrects a
 * lead's editable business fields and creates exactly one corresponding
 * lead_activities row when something actually changed, atomically, via
 * update_lead_details_v1. Same security flow as every other owner route
 * (verifyOwnerSession — never a second token implementation).
 *
 * POST, not PATCH/PUT: matches this codebase's established reasoning in
 * $leadId.status.ts — a real edit always creates something new (an
 * activity row), not just replaces a field.
 *
 * A stale expectedUpdatedAt (the browser's last-known updatedAt no longer
 * matches the row) returns 409 CONFLICT, never silently overwritten — see
 * update_lead_details_v1's own header comment for the concurrency design.
 * A trashed or archived lead returns a distinguishable NOT_EDITABLE error —
 * both stay read-only until restored/reopened.
 */
interface OwnerLeadEditRouteResponseBody {
  readonly ok: boolean;
  readonly data?: {
    readonly updated: boolean;
    readonly updatedAt: string;
    readonly changedFields: readonly string[];
  };
  readonly error?: { readonly code: OwnerLeadMutationErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadEditRouteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const notFoundResponse = () => jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
const notEditableResponse = () =>
  jsonResponse(409, { ok: false, error: { code: "NOT_EDITABLE", message: "This enquiry is archived or in Trash and can't be edited." } });
const genericServerErrorResponse = () =>
  jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
const validationErrorResponse = () =>
  jsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "The request could not be validated." } });

export async function handleOwnerLeadEditRequest(request: Request, leadId: string): Promise<Response> {
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

  const parsedBody = ownerLeadEditRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadEditServiceDeps();
    const result = await updateOwnerLeadDetails(
      {
        leadId,
        ownerUserId: session.owner.userId,
        expectedUpdatedAt: parsedBody.data.expectedUpdatedAt,
        request: parsedBody.data,
      },
      deps,
    );
    if (!result.ok) {
      if (result.reason === "unauthorized") return unauthorizedResponse();
      if (result.reason === "not_found") return notFoundResponse();
      if (result.reason === "not_editable") return notEditableResponse();
      if (result.reason === "validation") return validationErrorResponse();
      if (result.reason === "conflict")
        return jsonResponse(409, { ok: false, error: { code: "CONFLICT", message: "This enquiry was already updated. Please refresh and try again." } });
      return genericServerErrorResponse();
    }
    return jsonResponse(200, {
      ok: true,
      data: { updated: result.updated, updatedAt: result.updatedAt, changedFields: result.changedFields },
    });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId/details")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleOwnerLeadEditRequest(request, params.leadId),
    },
  },
});
