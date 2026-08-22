import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import { createProductionOwnerLeadNoteServiceDeps, addOwnerLeadNote } from "@/server/owner-leads/owner-lead-note.server";
import { isValidUuid } from "@/server/owner-leads/owner-lead-detail.server";
import { ownerLeadNoteCreateRequestSchema, type OwnerLeadMutationErrorCode } from "@/lib/owner/owner-lead-detail-contract";

/**
 * CHECKPOINT C2J-E — POST /api/owner/leads/:leadId/notes: adds a private
 * internal note to a lead and creates exactly one corresponding
 * lead_activities row, atomically, via add_lead_note_v1. Same security
 * flow as every other owner route (verifyOwnerSession — never a second
 * token implementation).
 *
 * The note body is never logged by this route (see add_lead_note_v1's own
 * header comment) and never appears in any error response — a validation
 * failure returns only the generic VALIDATION_ERROR envelope, not the
 * rejected text.
 */
interface OwnerLeadNoteCreateRouteResponseBody {
  readonly ok: boolean;
  readonly data?: { readonly activityId: string; readonly note: string; readonly createdAt: string };
  readonly error?: { readonly code: OwnerLeadMutationErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadNoteCreateRouteResponseBody): Response {
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

export async function handleOwnerLeadNoteCreateRequest(request: Request, leadId: string): Promise<Response> {
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

  const parsedBody = ownerLeadNoteCreateRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadNoteServiceDeps();
    const result = await addOwnerLeadNote(
      { leadId, ownerUserId: session.owner.userId, body: parsedBody.data.body, requestId: parsedBody.data.requestId },
      deps,
    );
    if (!result.ok) {
      if (result.reason === "unauthorized") return unauthorizedResponse();
      if (result.reason === "not_found") return notFoundResponse();
      if (result.reason === "not_editable") return notEditableResponse();
      if (result.reason === "validation") return validationErrorResponse();
      return genericServerErrorResponse();
    }
    return jsonResponse(200, { ok: true, data: { activityId: result.activityId, note: result.note, createdAt: result.createdAt } });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId/notes")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleOwnerLeadNoteCreateRequest(request, params.leadId),
    },
  },
});
