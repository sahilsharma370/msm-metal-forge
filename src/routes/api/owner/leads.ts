import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import {
  createProductionOwnerLeadsServiceDeps,
  listOwnerLeads,
  parseOwnerLeadListQuery,
} from "@/server/owner-leads/owner-leads.server";
import type { OwnerLeadListItem, OwnerLeadListPage } from "@/lib/owner/owner-leads-contract";

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

export const Route = createFileRoute("/api/owner/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => handleOwnerLeadListRequest(request),
    },
  },
});
