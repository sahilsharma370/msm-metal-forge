import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  handleCompleteQuoteBody,
  readBoundedBody,
  toCompleteQuoteRpcClient,
  BodyTooLargeError,
  MAX_COMPLETE_BODY_BYTES,
  type CompleteQuoteResponseBody,
} from "@/server/quote/complete-quote";

// TODO(rate-limiting): same intentionally-deferred gap as
// src/routes/api/quote/initiate.ts and src/routes/api/quote/upload.ts — see
// initiate.ts's own TODO for the full rationale.

function jsonResponse(status: number, body: CompleteQuoteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const genericServerErrorBody: CompleteQuoteResponseBody = {
  ok: false,
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", retryable: false },
};

/**
 * Exact media-type match, not a substring check — see initiate.ts's own
 * isJsonContentType for the full rationale (identical here).
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
 * here or in src/server/quote/complete-quote.ts.
 */
export async function handleQuoteCompleteRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Method not allowed.", retryable: false },
    });
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Content-Type must be application/json.", retryable: false },
    });
  }

  // Built per-request, inside the handler — never at module scope (see
  // env.server.ts). Missing/invalid config fails closed with a generic
  // message; the specific missing variable is never exposed here or
  // anywhere in the response.
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(request, MAX_COMPLETE_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonResponse(413, {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Request body is too large.", retryable: false },
      });
    }
    return jsonResponse(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Unable to read the request body.", retryable: false },
    });
  }

  const result = await handleCompleteQuoteBody(rawBody, { rpc: toCompleteQuoteRpcClient(supabase) });
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteCompleteRequest(request),
    },
  },
});
