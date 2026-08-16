/**
 * CHECKPOINT C2H-B1 — server-only Resend HTTP adapter. `.server.ts` suffix
 * — see env.server.ts for why that's sufficient import protection on its
 * own. RESEND_API_KEY is read only inside createResendEmailProvider's
 * caller (getEmailConfig(), see dispatch-notification.server.ts), never at
 * module scope here — this file receives the key as a plain config value,
 * never reads process.env itself.
 *
 * Uses the global fetch directly against Resend's official HTTP API — no
 * SDK dependency. The production dependency surface for this checkpoint is
 * one HTTP call with three headers and a JSON body; a full SDK would add
 * more surface than that warrants.
 *
 * This module NEVER sends a real request during this checkpoint (no real
 * RESEND_API_KEY is configured anywhere in this repo, and every test here
 * injects a fake `fetchImpl` — see resend-email-provider.test.ts).
 *
 * Resend 409 classification (flagged for verification before C2H-B2's real
 * integration): Resend's documented idempotency contract distinguishes a
 * "concurrent identical request already in flight" (safe to retry) from
 * "the same Idempotency-Key was reused with a different request body"
 * (never safe to retry — retrying would either replay the wrong content or
 * loop forever against the same conflict). This adapter classifies a 409
 * as retryable ONLY when the response body's own `name` field identifies
 * the concurrent-request case; every other 409 (including a body this
 * adapter cannot parse) is treated as the permanent conflicting-payload
 * case, since defaulting an ambiguous 409 to "keep retrying forever" is the
 * unsafe direction. This exact body shape has not been verified against a
 * real Resend response in this checkpoint (no network access) — recorded
 * here as a named risk for C2H-B2 rather than asserted as verified fact.
 */
import { z } from "zod";
import type { EmailProvider, EmailSendErrorCode, EmailSendInput, EmailSendResult } from "./notification-email-types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;
const PROVIDER_ID = "resend";

const HEADER_INJECTION_PATTERN = /[\r\n]/;

function failure(code: EmailSendErrorCode, retryable: boolean): EmailSendResult {
  return { ok: false, code, retryable };
}

const resendSuccessSchema = z.object({
  id: z.string().min(1),
});

/** Only the one field this adapter needs to classify a 409 — every other field of Resend's error body is deliberately left unparsed and never logged. */
const resendConcurrentConflictSchema = z.object({
  name: z.literal("concurrent_idempotent_requests"),
});

export interface CreateResendEmailProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

export function createResendEmailProvider(
  config: CreateResendEmailProviderConfig,
  fetchImpl: typeof fetch = fetch,
): EmailProvider {
  return {
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      if (!config.apiKey) {
        return failure("CONFIGURATION_ERROR", false);
      }

      // Defense-in-depth header-injection guard — the dispatcher's own
      // sanitizeHeaderValue already bounds the subject it builds, but this
      // adapter never trusts an upstream caller's discipline for values
      // that end up as literal HTTP-adjacent header-shaped JSON fields.
      const headerFields = [input.from, input.to, input.subject, ...(input.replyTo ? [input.replyTo] : [])];
      if (headerFields.some((field) => HEADER_INJECTION_PATTERN.test(field))) {
        return failure("INVALID_REQUEST", false);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({
            from: input.from,
            to: [input.to],
            ...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
            subject: input.subject,
            text: input.text,
            html: input.html,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return failure("TIMEOUT", true);
        }
        return failure("NETWORK_ERROR", true);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 200 || response.status === 201) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          return failure("MALFORMED_RESPONSE", false);
        }
        const parsed = resendSuccessSchema.safeParse(json);
        if (!parsed.success) {
          return failure("MALFORMED_RESPONSE", false);
        }
        return { ok: true, provider: PROVIDER_ID, providerMessageId: parsed.data.id };
      }

      if (response.status === 409) {
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          return failure("IDEMPOTENCY_CONFLICT_PERMANENT", false);
        }
        const isConcurrent = resendConcurrentConflictSchema.safeParse(json).success;
        return isConcurrent ? failure("IDEMPOTENCY_CONFLICT_RETRY", true) : failure("IDEMPOTENCY_CONFLICT_PERMANENT", false);
      }

      switch (response.status) {
        case 400:
          return failure("INVALID_REQUEST", false);
        case 401:
        case 403:
          return failure("AUTH_ERROR", false);
        case 404:
        case 405:
          return failure("ENDPOINT_ERROR", false);
        case 408:
          return failure("TIMEOUT", true);
        case 422:
          return failure("INVALID_RECIPIENT", false);
        case 425:
        case 429:
          return failure("RATE_LIMITED", true);
        default:
          if (response.status >= 500) {
            return failure("SERVER_ERROR", true);
          }
          return failure("UNKNOWN_ERROR", false);
      }
    },
  };
}
