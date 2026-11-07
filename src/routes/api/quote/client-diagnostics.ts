import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  handleClientDiagnosticsBody,
  readBoundedBody,
  toClientDiagnosticsRpcClient,
  BodyTooLargeError,
  MAX_CLIENT_DIAGNOSTICS_BODY_BYTES,
  type ClientDiagnosticsResponseBody,
} from "@/server/quote/quote-client-diagnostics";
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "@/server/rate-limit.server";

/**
 * QT-CLI audit — server-visible counterpart to the console-only
 * quote_submit_client_exception logging in src/lib/error-capture.ts. The
 * caller (QuoteExperience.tsx) treats this entire endpoint as best-effort/
 * fire-and-forget: it never awaits this in a way that could delay or block
 * the customer-visible outcome, and never retries it. This route exists
 * purely to accept that one bounded beacon and persist it via
 * log_quote_client_diagnostic_v1 — no Turnstile/session gate (would defeat
 * the "never blocks submission" requirement on a diagnostic path), so the
 * rate limiter below is the ONLY abuse defense here, same posture as every
 * other public POST route in this file tree.
 */

function jsonResponse(status: number, body: ClientDiagnosticsResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const genericServerErrorBody: ClientDiagnosticsResponseBody = {
  ok: false,
  error: { code: "INTERNAL_ERROR", message: "Something went wrong.", retryable: false },
};

function rateLimitedResponse(): Response {
  const body: ClientDiagnosticsResponseBody = {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Too many requests.", retryable: true },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(RATE_LIMIT_RETRY_AFTER_SECONDS),
    },
  });
}

/** Exact media-type match, not a substring check — see initiate.ts's own isJsonContentType for the full rationale, identical here. */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Exported standalone so tests can call it directly with a plain Request —
 * same pattern as handleQuoteCompleteRequest/handleQuoteInitiateRequest.
 */
export async function handleQuoteClientDiagnosticsRequest(request: Request): Promise<Response> {
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

  // Same fail-closed-on-missing-binding and Cloudflare-verified-IP-only
  // posture as every other route here — see initiate.ts's own comment for
  // the full reasoning, identical here.
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    const clientIp = getCloudflareClientIp(request);
    if (!clientIp) return jsonResponse(500, genericServerErrorBody);

    const limiter = getRateLimiterBinding(request, "quoteClientDiagnostics");
    const { allowed } = await checkRateLimit(limiter, clientIp);
    if (!allowed) return rateLimitedResponse();

    supabase = createSupabaseAdminClient();
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(request, MAX_CLIENT_DIAGNOSTICS_BODY_BYTES);
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

  const result = await handleClientDiagnosticsBody(rawBody, { rpc: toClientDiagnosticsRpcClient(supabase) });
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/client-diagnostics")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteClientDiagnosticsRequest(request),
    },
  },
});
