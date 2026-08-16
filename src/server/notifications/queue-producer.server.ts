/**
 * CHECKPOINT C2H-B2 — server-only Cloudflare Queue wake-up publisher.
 * `.server.ts` suffix — see env.server.ts for why that's sufficient import
 * protection on its own.
 *
 * The Queue is a wake-up HINT only, never the source of truth — the
 * durable public.notification_deliveries row (see
 * supabase/migrations/20260816170000_notification_delivery_outbox_lifecycle.sql)
 * is. Losing, duplicating, delaying, retrying, or discarding a wake-up
 * message must never lose a notification job, because Cron (see
 * cron-sweep.server.ts) periodically re-discovers any due row regardless of
 * whether a wake-up message ever arrived. This module's only job is to make
 * the common case fast (near-immediate dispatch after completion) — it is
 * never load-bearing for correctness.
 *
 * Runtime mechanism (verified by reading Nitro's cloudflare-module preset
 * source, not assumed — see rate-limit.server.ts's own doc comment for the
 * exact same underlying process.env/globalThis.__env__ mechanism this
 * module relies on): `env.OWNER_NOTIFICATION_QUEUE` is a real Cloudflare
 * Queue producer binding (`send(message, options?): Promise<QueueSendResponse>`,
 * per @cloudflare/workers-types) reachable via `process.env["OWNER_NOTIFICATION_QUEUE"]`
 * inside a request — the same binding-via-process.env mechanism already
 * used for the Rate Limiting bindings. Locally (`vite dev`, vitest) there is
 * no such binding — getOwnerNotificationQueueBinding() returns null rather
 * than throwing, since a missing Queue binding must never break ordinary
 * Quote completion (unlike the Rate Limiting bindings, which fail closed —
 * a wake-up publish is a pure optimization, not an abuse-protection control).
 */

/** The exact shape of Cloudflare's Queue producer binding this module needs — nothing else. */
export interface QueueProducerBinding {
  send(message: unknown): Promise<unknown>;
}

function isQueueProducerBinding(value: unknown): value is QueueProducerBinding {
  return typeof value === "object" && value !== null && typeof (value as { send?: unknown }).send === "function";
}

export const OWNER_NOTIFICATION_QUEUE_BINDING_NAME = "OWNER_NOTIFICATION_QUEUE";

/**
 * Minimal, versioned, customer-PII-free wake-up message. No name, phone,
 * email, address, notes, material details, submission snapshot, Storage
 * path/URL, or secret ever belongs in this object — the consumer's own
 * database fallback claim (dispatchOwnerNotification with no delivery ID)
 * is what actually identifies which row to process, not this message.
 */
export interface OwnerNotificationWakeupMessage {
  readonly version: 1;
  readonly kind: "owner_notification_due";
}

export const OWNER_NOTIFICATION_WAKEUP_MESSAGE: OwnerNotificationWakeupMessage = {
  version: 1,
  kind: "owner_notification_due",
};

/** Returns null (never throws) when the binding is missing or malformed — see this module's own header comment for why a missing Queue binding must fail safely, not closed. */
export function getOwnerNotificationQueueBinding(): QueueProducerBinding | null {
  const binding = process.env[OWNER_NOTIFICATION_QUEUE_BINDING_NAME];
  return isQueueProducerBinding(binding) ? binding : null;
}

export interface PublishWakeupResult {
  readonly published: boolean;
}

/**
 * Best-effort only — never throws, regardless of what `binding` does. A
 * null binding (missing/malformed, e.g. running under plain `vite dev`) or
 * a rejected send() both simply report `published: false`; the caller
 * (the /api/quote/complete route) must never let either change an already-
 * successful customer response. Safe to call again on an idempotent replay
 * of the same completion — the database claim and email idempotency key
 * (see dispatch-notification.server.ts) are what actually prevent a
 * duplicate send, not anything here.
 */
export async function publishOwnerNotificationWakeup(
  binding: QueueProducerBinding | null,
): Promise<PublishWakeupResult> {
  if (!binding) {
    return { published: false };
  }
  try {
    await binding.send(OWNER_NOTIFICATION_WAKEUP_MESSAGE);
    return { published: true };
  } catch {
    return { published: false };
  }
}
