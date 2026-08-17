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
import { getTurnstileVerifier } from "@/server/turnstile.server";
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "@/server/rate-limit.server";

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

function rateLimitedResponse(): Response {
  const body: InitiateQuoteResponseBody = {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Too many requests. Please wait a moment and try again." },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(RATE_LIMIT_RETRY_AFTER_SECONDS),
    },
  });
}

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

  // CHECKPOINT C2G: rate-limited before any Supabase/database work — a
  // missing binding fails closed (500, via the same try/catch as the
  // Supabase client below), never silently skipping the check. The
  // Cloudflare-verified client IP (never X-Forwarded-For) is the only
  // identity this is keyed on; a request Cloudflare's edge did not attach
  // one to cannot be identified and is rejected the same way a missing
  // binding is.
  let supabase: ReturnType<typeof toQuoteRpcClient>;
  let turnstile: ReturnType<typeof getTurnstileVerifier>;
  try {
    const clientIp = getCloudflareClientIp(request);
    if (!clientIp) return jsonResponse(500, genericServerErrorBody);

    const limiter = getRateLimiterBinding(request, "initiate");
    const { allowed } = await checkRateLimit(limiter, clientIp);
    if (!allowed) return rateLimitedResponse();

    supabase = toQuoteRpcClient(createSupabaseAdminClient());
    turnstile = getTurnstileVerifier();
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

  const result = await handleQuoteInitiateBody(rawBody, { supabase, turnstile });
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/initiate")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteInitiateRequest(request),
    },
  },
});
