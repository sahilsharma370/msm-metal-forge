/**
 * CHECKPOINT C2H-B2 — minimal, injectable, sanitized observability for the
 * Queue consumer/Cron sweep/completion wake-up paths. No I/O, no env
 * access — pure enough to not need a `.server.ts` suffix (mirrors
 * owner-notification-email.ts's own reasoning), though it is only ever
 * used from server-only code.
 *
 * Every event is a fixed, closed-set, pre-approved code string — never a
 * template containing a raw error, a Queue message body, a lead/customer
 * field, a Resend response body, or anything else the caller wants to
 * attach. There is no `meta`/`data` parameter on log() at all, by design:
 * that is what makes it structurally impossible to accidentally log PII or
 * a secret through this path, rather than merely a documented convention.
 */

export type NotificationLogEvent =
  | "queue_message_invalid"
  | "queue_dispatch_sent"
  | "queue_dispatch_no_work"
  | "queue_dispatch_retry_scheduled"
  | "queue_dispatch_dead_lettered"
  | "queue_dispatch_claim_lost"
  | "queue_dispatch_internal_error"
  | "queue_dispatch_unexpected_error"
  | "cron_sweep_complete"
  | "cron_sweep_internal_error"
  | "cron_sweep_max_reached"
  | "cron_sweep_unexpected_error"
  | "quote_completion_wakeup_published"
  | "quote_completion_wakeup_skipped";

export interface NotificationLogger {
  log(event: NotificationLogEvent): void;
}

/** Production logger — the only place any of this ever reaches console.log, and only ever a bare event code, matching complete-quote.ts's own established minimal-structured-logging convention. */
export function createConsoleNotificationLogger(): NotificationLogger {
  return {
    log(event) {
      console.log(JSON.stringify({ event: `notifications.${event}` }));
    },
  };
}

/** Test/no-op logger — used by default wherever a caller doesn't care about observability, and directly by tests proving sanitized behavior. */
export function createNoopNotificationLogger(): NotificationLogger {
  return { log() {} };
}
