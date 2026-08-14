import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  processQuoteUpload,
  parseQuoteUploadMultipart,
  readBoundedBytes,
  toUploadQuoteRpcClient,
  toUploadQuoteStorageClient,
  MultipartValidationError,
  RequestTooLargeError,
  MAX_UPLOAD_REQUEST_BYTES,
  type UploadQuoteResponseBody,
} from "@/server/quote/upload-quote";
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "@/server/rate-limit.server";

function jsonResponse(status: number, body: UploadQuoteResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const genericServerErrorBody: UploadQuoteResponseBody = {
  ok: false,
  error: {
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
    retryable: false,
  },
};

const validationErrorBody = (message: string): UploadQuoteResponseBody => ({
  ok: false,
  error: { code: "VALIDATION_ERROR", message, retryable: false },
});

function rateLimitedResponse(): Response {
  const body: UploadQuoteResponseBody = {
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
 * Exact media-type match against "multipart/form-data" — the same
 * substring-avoidance rationale as initiate.ts's isJsonContentType. The
 * boundary parameter (and anything else after the first `;`) is left for
 * the platform multipart parser to validate.
 */
function isMultipartContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "multipart/form-data";
}

/**
 * Exported standalone so tests can call it directly with a plain Request —
 * no need to reach into createFileRoute's internal handler storage. The
 * Route below is a thin registration of this function; all behavior lives
 * here or in src/server/quote/upload-quote.ts.
 */
export async function handleQuoteUploadRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Method not allowed.", retryable: false },
    });
  }

  if (!isMultipartContentType(request.headers.get("content-type"))) {
    return jsonResponse(400, validationErrorBody("Content-Type must be multipart/form-data."));
  }

  // CHECKPOINT C2G: rate-limited before this route ever reads a single byte
  // of the (potentially large, up to 8 MiB) multipart body — the earliest
  // point the framework allows, deliberately ahead of readBoundedBytes
  // below. Same fail-closed-on-missing-binding and Cloudflare-verified-IP-
  // only posture as initiate.ts — see that file's own comment for the full
  // reasoning, identical here.
  let supabase: ReturnType<typeof createSupabaseAdminClient>;
  try {
    const clientIp = getCloudflareClientIp(request);
    if (!clientIp) return jsonResponse(500, genericServerErrorBody);

    const limiter = getRateLimiterBinding("upload");
    const { allowed } = await checkRateLimit(limiter, clientIp);
    if (!allowed) return rateLimitedResponse();

    supabase = createSupabaseAdminClient();
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  let rawBytes: Uint8Array;
  try {
    rawBytes = await readBoundedBytes(request, MAX_UPLOAD_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse(413, validationErrorBody("Request body is too large."));
    }
    return jsonResponse(400, validationErrorBody("Unable to read the request body."));
  }

  let parsed: Awaited<ReturnType<typeof parseQuoteUploadMultipart>>;
  try {
    parsed = await parseQuoteUploadMultipart(rawBytes, request.headers.get("content-type") ?? "");
  } catch (error) {
    if (error instanceof MultipartValidationError) {
      return jsonResponse(400, validationErrorBody(error.message));
    }
    return jsonResponse(400, validationErrorBody("The request could not be validated."));
  }

  const result = await processQuoteUpload(
    { slotId: parsed.slotId, idempotencyKey: parsed.idempotencyKey, fileBytes: parsed.fileBytes },
    { rpc: toUploadQuoteRpcClient(supabase), storage: toUploadQuoteStorageClient(supabase) },
  );
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/quote/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => handleQuoteUploadRequest(request),
    },
  },
});
