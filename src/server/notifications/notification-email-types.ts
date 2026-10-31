/**
 * CHECKPOINT C2H-B1 — the narrow provider contract dispatch-notification.server.ts
 * depends on. Deliberately provider-agnostic: resend-email-provider.server.ts
 * is the only module that knows anything about Resend specifically, and the
 * dispatcher's own tests inject a fake implementation of this interface so
 * they never make a real network call.
 *
 * No customer PII, provider response bodies, or secrets are ever part of a
 * typed result here — only what the dispatcher needs to decide its next
 * database transition (sent vs. retry vs. dead-letter).
 */

/** Everything one call to send() needs — no attachments, no signed/public Storage URLs, never a raw provider payload. */
export interface EmailSendInput {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Stable across retries of the SAME notification_deliveries row — see dispatch-notification.server.ts for the exact value. */
  readonly idempotencyKey: string;
}

export interface EmailSendSuccess {
  readonly ok: true;
  readonly provider: string;
  readonly providerMessageId: string;
}

/**
 * Short, uppercase, machine-readable codes only — every value here must
 * satisfy the database's own last_error_code CHECK constraint
 * (`^[A-Z0-9_]{1,40}$`, see 20260816170000_notification_delivery_outbox_lifecycle.sql)
 * so the dispatcher can pass it straight through to
 * reschedule_notification_delivery_v1/dead_letter_notification_delivery_v1
 * with no further mapping. Never a raw provider exception message, HTTP
 * response body, or anything derived from customer input.
 */
export type EmailSendErrorCode =
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "IDEMPOTENCY_CONFLICT_RETRY"
  | "CONFIGURATION_ERROR"
  | "INVALID_REQUEST"
  | "AUTH_ERROR"
  | "ENDPOINT_ERROR"
  | "IDEMPOTENCY_CONFLICT_PERMANENT"
  | "INVALID_RECIPIENT"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN_ERROR";

export interface EmailSendFailure {
  readonly ok: false;
  readonly code: EmailSendErrorCode;
  /** The dispatcher's ONLY signal for retry_wait vs. immediate dead_letter — never re-derived from `code` elsewhere. */
  readonly retryable: boolean;
}

export type EmailSendResult = EmailSendSuccess | EmailSendFailure;

/** The one seam dispatch-notification.server.ts depends on — a production caller uses createResendEmailProvider(); a test implements this directly with canned results. */
export interface EmailProvider {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}
