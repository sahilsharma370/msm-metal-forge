import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import {
  createProductionOwnerLeadsServiceDeps,
  listOwnerLeads,
  parseOwnerLeadListQuery,
} from "@/server/owner-leads/owner-leads.server";
import { createProductionOwnerLeadQuickAddServiceDeps, createOwnerQuickAddLead } from "@/server/owner-leads/owner-lead-quick-add.server";
import type { OwnerLeadListItem, OwnerLeadListPage } from "@/lib/owner/owner-leads-contract";
import { ownerLeadQuickAddRequestSchema, type OwnerLeadQuickAddErrorCode } from "@/lib/owner/owner-lead-quick-add-contract";

/**
 * CHECKPOINT C2J-A — the first real owner Manage-dashboard data route: a
 * secure, read-only, cursor-paginated enquiry list.
 *
 * Security flow, identical in shape to /api/owner/session (the one
 * existing protected owner route this reuses rather than reimplementing):
 * browser bearer token -> extractBearerToken -> verifyOwnerSession
 * (server-side Supabase getUser() + active owner_accounts row) ->
 * server-only service-role query (listOwnerLeads) -> sanitized response.
 * Every failure reason verifyOwnerSession can return (missing/malformed/
 * invalid token, no owner row, inactive owner) collapses to the exact same
 * 401 generic body — never distinguished, matching /api/owner/session's
 * own established convention exactly.
 */
export interface OwnerLeadListResponseBody {
  readonly ok: boolean;
  readonly data?: {
    readonly leads: readonly OwnerLeadListItem[];
    readonly page: OwnerLeadListPage;
  };
  readonly error?: { readonly code: "VALIDATION_ERROR" | "INTERNAL_ERROR"; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadListResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const unauthorizedResponse = () => jsonResponse(401, { ok: false });
const genericServerErrorResponse = () =>
  jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
const validationErrorResponse = (message: string) =>
  jsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message } });

export async function handleOwnerLeadListRequest(request: Request): Promise<Response> {
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

  const url = new URL(request.url);
  const parsedQuery = parseOwnerLeadListQuery(url.searchParams);
  if (!parsedQuery.ok) {
    return validationErrorResponse(parsedQuery.message);
  }

  try {
    const leadsDeps = createProductionOwnerLeadsServiceDeps();
    const result = await listOwnerLeads(parsedQuery.query, leadsDeps);
    return jsonResponse(200, {
      ok: true,
      data: {
        leads: result.leads,
        page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
      },
    });
  } catch {
    // Never forwards a raw Postgres/Supabase error, SQL text, or table
    // name — every failure from here down collapses to the same generic
    // 500, matching every other server route in this codebase.
    return genericServerErrorResponse();
  }
}

// ---------------------------------------------------------------------------
// CHECKPOINT C2J-F — POST /api/owner/leads: owner Quick Add. Creates one new
// lead from a phone/WhatsApp/walk-in enquiry via create_owner_quick_add_lead_v1,
// atomically with its own audit-trail activity row. Same security flow as
// every other owner route (verifyOwnerSession — never a second token
// implementation) and the same generic-500/never-forward-raw-error
// convention GET above already establishes.
// ---------------------------------------------------------------------------

interface OwnerLeadQuickAddCreateResponseBody {
  readonly ok: boolean;
  readonly data?: { readonly leadId: string; readonly reference: string; readonly idempotentReplay: boolean };
  readonly error?: { readonly code: OwnerLeadQuickAddErrorCode; readonly message: string };
}

function quickAddJsonResponse(status: number, body: OwnerLeadQuickAddCreateResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

const quickAddUnauthorizedResponse = () => quickAddJsonResponse(401, { ok: false });
const quickAddConflictResponse = () =>
  quickAddJsonResponse(409, {
    ok: false,
    error: { code: "CONFLICT", message: "This request was already submitted with different details." },
  });
const quickAddGenericServerErrorResponse = () =>
  quickAddJsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
const quickAddValidationErrorResponse = () =>
  quickAddJsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "The request could not be validated." } });

export async function handleOwnerLeadQuickAddCreateRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return quickAddJsonResponse(405, { ok: false });
  }

  const token = extractBearerToken(request);

  let sessionDeps: ReturnType<typeof getOwnerSessionVerifierDeps>;
  try {
    sessionDeps = getOwnerSessionVerifierDeps();
  } catch {
    return quickAddGenericServerErrorResponse();
  }

  const session = await verifyOwnerSession(token, sessionDeps);
  if (!session.ok) {
    return quickAddUnauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return quickAddValidationErrorResponse();
  }

  const parsedBody = ownerLeadQuickAddRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return quickAddValidationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadQuickAddServiceDeps();
    const result = await createOwnerQuickAddLead({ ownerUserId: session.owner.userId, request: parsedBody.data }, deps);
    if (!result.ok) {
      if (result.reason === "unauthorized") return quickAddUnauthorizedResponse();
      if (result.reason === "conflict") return quickAddConflictResponse();
      return quickAddGenericServerErrorResponse();
    }
    return quickAddJsonResponse(200, {
      ok: true,
      data: { leadId: result.leadId, reference: result.reference, idempotentReplay: result.idempotentReplay },
    });
  } catch {
    return quickAddGenericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => handleOwnerLeadListRequest(request),
      POST: async ({ request }) => handleOwnerLeadQuickAddCreateRequest(request),
    },
  },
});
