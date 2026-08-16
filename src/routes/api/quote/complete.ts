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
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "@/server/rate-limit.server";
import { getOwnerNotificationQueueBinding, publishOwnerNotificationWakeup } from "@/server/notifications/queue-producer.server";

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

function rateLimitedResponse(): Response {
  const body: CompleteQuoteResponseBody = {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
      retryable: true,
    },
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

  // CHECKPOINT C2G: same fail-closed-on-missing-binding and Cloudflare-
  // verified-IP-only posture as initiate.ts/upload.ts — see initiate.ts's
  // own comment for the full reasoning, identical here.
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    const clientIp = getCloudflareClientIp(request);
    if (!clientIp) return jsonResponse(500, genericServerErrorBody);

    const limiter = getRateLimiterBinding("complete");
    const { allowed } = await checkRateLimit(limiter, clientIp);
    if (!allowed) return rateLimitedResponse();

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

  // CHECKPOINT C2H-B2: best-effort wake-up only — never allowed to alter
  // this already-decided response. Fires for every successful completion,
  // including an idempotent replay (already_completed:true) — a duplicate
  // wake-up is harmless (see queue-producer.server.ts's own doc comment:
  // the durable database claim and email idempotency key are what actually
  // prevent a duplicate send, not this publish). An unsuccessful/incomplete
  // completion (any non-2xx result) never publishes — there is nothing to
  // notify the owner about yet.
  if (result.body.ok) {
    await publishOwnerNotificationWakeup(getOwnerNotificationQueueBinding());
  }

  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteCompleteRequest(request),
    },
  },
});
