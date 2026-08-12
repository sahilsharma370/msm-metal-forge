import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  handleQuoteInitiateBody,
  readBoundedBody,
  toQuoteRpcClient,
  BodyTooLargeError,
  MAX_BODY_BYTES,
  type InitiateQuoteResponseBody,
} from "@/server/quote/initiate-quote";

// TODO(rate-limiting): C1 intentionally ships with no request-rate limiting
// — see the CHECKPOINT audit's blocker list. Before this route is exposed
// to real traffic, add a Cloudflare-native rule for POST /api/quote/initiate
// (a Cloudflare Rate Limiting Rule or WAF custom rule configured in the
// dashboard / a checked-in wrangler.jsonc, keyed on the client IP), not a
// KV- or Durable-Object-backed limiter — those are explicitly out of scope
// for this checkpoint.

function jsonResponse(status: number, body: InitiateQuoteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const genericServerErrorBody: InitiateQuoteResponseBody = {
  ok: false,
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};

/**
 * Exact media-type match, not a substring check — `.includes("application/json")`
 * would wrongly accept "application/jsonp" and "text/application/json". Only
 * the media type before the first `;` is compared (case/whitespace
 * normalized); any parameters after it (e.g. `charset=utf-8`) are accepted
 * without being individually validated. Deliberately narrow: this checkpoint
 * does not accept the broader `application/*+json` family.
 */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Exported standalone so tests can call it directly with a plain Request —
 * no need to reach into createFileRoute's internal handler storage. The
 * Route below is a thin registration of this function; all behavior lives
 * here.
 */
export async function handleQuoteInitiateRequest(request: Request): Promise<Response> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Content-Type must be application/json." },
    });
  }

  // Built per-request, inside the handler — never at module scope (see
  // env.server.ts). Missing/invalid config fails closed with a generic
  // message; the specific missing variable is never exposed here or
  // anywhere in the response.
  let supabase: ReturnType<typeof toQuoteRpcClient>;
  try {
    supabase = toQuoteRpcClient(createSupabaseAdminClient());
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonResponse(413, {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Request body is too large." },
      });
    }
    return jsonResponse(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Unable to read the request body." },
    });
  }

  const result = await handleQuoteInitiateBody(rawBody, { supabase });
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/initiate")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteInitiateRequest(request),
    },
  },
});
