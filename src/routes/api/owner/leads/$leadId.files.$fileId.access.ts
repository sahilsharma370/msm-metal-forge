import { createFileRoute } from "@tanstack/react-router";
import { extractBearerToken, getOwnerSessionVerifierDeps, verifyOwnerSession } from "@/server/owner-auth/owner-session.server";
import {
  createProductionOwnerLeadFileAccessServiceDeps,
  getOwnerLeadFileAccess,
} from "@/server/owner-leads/owner-lead-file-access.server";
import { isValidUuid } from "@/server/owner-leads/owner-lead-detail.server";
import type { OwnerLeadFileAccessErrorCode } from "@/lib/owner/owner-lead-detail-contract";
import { OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS } from "@/lib/owner/owner-lead-detail-contract";

/**
 * CHECKPOINT C2J-C — POST /api/owner/leads/:leadId/files/:fileId/access:
 * mints one 60-second signed URL for a private lead_files Storage object.
 *
 * Method choice (POST, not GET), documented: minting a signed URL is not a
 * pure read — every call asks Supabase Storage to generate a brand-new,
 * independently-usable, secret-bearing token, which is exactly the kind of
 * "this call causes something new to be created" action this codebase
 * already reserves POST for elsewhere (see request-code.ts/verify-code.ts,
 * which POST because they cause an OTP to be sent/consumed, not because
 * they mutate a business row). GET here would also risk an intermediary
 * (proxy/browser history/prefetch) treating the URL as a cacheable,
 * safely-repeatable read — `Cache-Control: private, no-store` mitigates
 * that either way, but POST is the more honest method for a side-effecting
 * mint.
 *
 * Anyone holding the returned URL during its 60-second lifetime can use it
 * to fetch the file with no further authorization check — Supabase Storage
 * itself validates the signature/expiry, not this server on each fetch.
 * This is why the URL is never logged (see handleOwnerLeadFileAccessRequest
 * below — no console.log of the URL, token, or storage_path anywhere in
 * this path) and why its lifetime is kept to the minimum the product needs.
 */
interface OwnerLeadFileAccessRouteResponseBody {
  readonly ok: boolean;
  readonly data?: { readonly url: string; readonly expiresInSeconds: number };
  readonly error?: { readonly code: OwnerLeadFileAccessErrorCode; readonly message: string };
}

function jsonResponse(status: number, body: OwnerLeadFileAccessRouteResponseBody): Response {
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

export async function handleOwnerLeadFileAccessRequest(request: Request, leadId: string, fileId: string): Promise<Response> {
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

  if (!isValidUuid(leadId) || !isValidUuid(fileId)) {
    return validationErrorResponse();
  }

  try {
    const deps = createProductionOwnerLeadFileAccessServiceDeps();
    const result = await getOwnerLeadFileAccess(leadId, fileId, deps);
    if (!result.ok) {
      // Both "not_found" (missing/wrong-lead/incomplete-lead/unverified-file)
      // and "storage_error" (a real Storage/provider failure) are handled
      // separately below the discriminant, but neither branch ever logs
      // the file id, storage path, or any provider error text — see this
      // module's own header comment.
      if (result.reason === "storage_error") {
        return genericServerErrorResponse();
      }
      return notFoundResponse();
    }
    return jsonResponse(200, { ok: true, data: { url: result.url, expiresInSeconds: OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS } });
  } catch {
    return genericServerErrorResponse();
  }
}

export const Route = createFileRoute("/api/owner/leads/$leadId/files/$fileId/access")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleOwnerLeadFileAccessRequest(request, params.leadId, params.fileId),
    },
  },
});
