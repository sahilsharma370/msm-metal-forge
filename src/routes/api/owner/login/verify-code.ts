import { createFileRoute } from "@tanstack/react-router";
import {
  getOwnerLoginAuthClient,
  handleOwnerLoginVerifyCodeBody,
  type OwnerLoginVerifyCodeResponseBody,
} from "@/server/owner-auth/owner-login.server";
import { readOwnerLoginBody, OwnerLoginBodyTooLargeError } from "@/server/owner-auth/owner-http.server";
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  checkRateLimit,
  getCloudflareClientIp,
  getRateLimiterBinding,
} from "@/server/rate-limit.server";

function jsonResponse(status: number, body: OwnerLoginVerifyCodeResponseBody): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const genericServerErrorBody: OwnerLoginVerifyCodeResponseBody = {
  ok: false,
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};

function rateLimitedResponse(): Response {
  const body: OwnerLoginVerifyCodeResponseBody = {
    ok: false,
    error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a moment and try again." },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(RATE_LIMIT_RETRY_AFTER_SECONDS),
    },
  });
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Exported standalone so tests can call it directly with a plain Request.
 * All real behavior lives in owner-login.server.ts. CHECKPOINT C2I-A:
 * rate-limited via the SEPARATE ownerLoginVerifyCode binding — see
 * rate-limit.server.ts's own doc comment for why this is a distinct
 * binding from ownerLoginRequestCode.
 */
export async function handleOwnerLoginVerifyCodeRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: { code: "VALIDATION_ERROR", message: "Method not allowed." } });
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Content-Type must be application/json." },
    });
  }

  try {
    const clientIp = getCloudflareClientIp(request);
    if (!clientIp) return jsonResponse(500, genericServerErrorBody);

    const limiter = getRateLimiterBinding("ownerLoginVerifyCode");
    const { allowed } = await checkRateLimit(limiter, clientIp);
    if (!allowed) return rateLimitedResponse();
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  let rawBody: string;
  try {
    rawBody = await readOwnerLoginBody(request);
  } catch (error) {
    if (error instanceof OwnerLoginBodyTooLargeError) {
      return jsonResponse(413, { ok: false, error: { code: "VALIDATION_ERROR", message: "Request body is too large." } });
    }
    return jsonResponse(400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Unable to read the request body." } });
  }

  let auth: ReturnType<typeof getOwnerLoginAuthClient>;
  try {
    auth = getOwnerLoginAuthClient();
  } catch {
    return jsonResponse(500, genericServerErrorBody);
  }

  const result = await handleOwnerLoginVerifyCodeBody(rawBody, { auth });
  return jsonResponse(result.status, result.body);
}

export const Route = createFileRoute("/api/owner/login/verify-code")({
  server: {
    handlers: {
      POST: async ({ request }) => handleOwnerLoginVerifyCodeRequest(request),
    },
  },
});
