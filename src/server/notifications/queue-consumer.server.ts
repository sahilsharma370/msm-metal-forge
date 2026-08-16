/**
 * CHECKPOINT C2H-B2 — Cloudflare Queue consumer for owner-notification
 * wake-up messages. `.server.ts` suffix — see env.server.ts for why that's
 * sufficient import protection on its own.
 *
 * Every message is strictly validated (version/kind) before anything else
 * happens — an unknown version/kind or malformed payload is a poison
 * message and is acknowledged without ever calling the dispatcher, exactly
 * once, never retried (retrying a message that can never become valid
 * would loop forever for no benefit).
 *
 * A valid message never carries a delivery ID — it calls
 * dispatchOwnerNotification({}) so the database's own fallback claim (the
 * oldest eligible due row) decides what to process, matching this
 * checkpoint's "the database remains the permanent source of truth"
 * principle: the message is a wake-up hint, not an instruction naming a
 * specific row.
 *
 * Cloudflare's own Queue retry count is never read or used as a business
 * retry counter anywhere in this file — public.notification_deliveries'
 * own attempt_count and the existing claim/reschedule/dead-letter RPCs
 * remain the sole authority (see dispatch-notification.server.ts).
 */
import { z } from "zod";
import {
  dispatchOwnerNotification,
  createDispatchNotificationDeps,
  type DispatchNotificationDeps,
  type DispatchResult,
} from "./dispatch-notification.server";
import { createConsoleNotificationLogger, type NotificationLogger } from "./notification-logger";

const wakeupMessageSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("owner_notification_due"),
  })
  .strict();

/** A minimal structural shape — deliberately NOT importing @cloudflare/workers-types' Message<T> here, so a test can construct a plain fake without needing real Cloudflare types. The real Message<unknown> satisfies this structurally. */
export interface WakeupQueueMessage {
  readonly body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/** Same reasoning as WakeupQueueMessage — MessageBatch<unknown> satisfies this structurally. */
export interface WakeupMessageBatch {
  readonly messages: readonly WakeupQueueMessage[];
}

export type MessageAction = { readonly action: "ack" } | { readonly action: "retry"; readonly delaySeconds: number };

/** Bounded retry delay for a genuinely unexpected (internal_error/thrown) failure — see the C2H-A migration's own [1, 86400]-second bound; 60s matches the spec's own suggestion and dispatch-notification.server.ts's first retry_wait tier. */
const INTERNAL_ERROR_RETRY_DELAY_SECONDS = 60;

export interface ProcessWakeupMessageDeps {
  readonly dispatch: () => Promise<DispatchResult>;
  readonly logger: NotificationLogger;
}

/**
 * Core per-message decision, independent of the real Cloudflare Message
 * type so it can be unit tested directly. Never throws — every branch
 * (including an unexpected thrown error from dispatch()) resolves to a
 * safe ack/retry decision the caller applies to the real message.
 */
export async function processWakeupMessage(
  rawBody: unknown,
  deps: ProcessWakeupMessageDeps,
): Promise<MessageAction> {
  const parsed = wakeupMessageSchema.safeParse(rawBody);
  if (!parsed.success) {
    deps.logger.log("queue_message_invalid");
    return { action: "ack" };
  }

  let result: DispatchResult;
  try {
    result = await deps.dispatch();
  } catch {
    deps.logger.log("queue_dispatch_unexpected_error");
    return { action: "retry", delaySeconds: INTERNAL_ERROR_RETRY_DELAY_SECONDS };
  }

  switch (result.kind) {
    case "sent":
      deps.logger.log("queue_dispatch_sent");
      return { action: "ack" };
    case "no_work":
      deps.logger.log("queue_dispatch_no_work");
      return { action: "ack" };
    case "retry_scheduled":
      // Acknowledged, not retried at the Queue layer — the retry timing is
      // durably owned by next_attempt_at in Postgres; a Queue-level retry
      // here would be redundant and would let Cloudflare's own retry
      // count silently become a second, uncoordinated attempt counter.
      deps.logger.log("queue_dispatch_retry_scheduled");
      return { action: "ack" };
    case "dead_lettered":
      deps.logger.log("queue_dispatch_dead_lettered");
      return { action: "ack" };
    case "claim_lost":
      // Another worker already owns or resolved this row — nothing left
      // for this message to do.
      deps.logger.log("queue_dispatch_claim_lost");
      return { action: "ack" };
    case "internal_error":
      deps.logger.log("queue_dispatch_internal_error");
      return { action: "retry", delaySeconds: INTERNAL_ERROR_RETRY_DELAY_SECONDS };
  }
}

/**
 * Real batch handler — processes every message independently so one bad
 * message can never fail/skip the rest of the batch. Never throws itself;
 * even an ack()/retry() call throwing is caught defensively.
 */
export async function handleOwnerNotificationQueueBatch(
  batch: WakeupMessageBatch,
  deps: ProcessWakeupMessageDeps,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const outcome = await processWakeupMessage(message.body, deps);
      if (outcome.action === "ack") {
        message.ack();
      } else {
        message.retry({ delaySeconds: outcome.delaySeconds });
      }
    } catch {
      try {
        message.retry({ delaySeconds: INTERNAL_ERROR_RETRY_DELAY_SECONDS });
      } catch {
        // Nothing further can be done for this one message — the batch
        // loop continues regardless.
      }
    }
  }
}

/** Production wiring — never called from a unit test, which always injects its own fake dispatch/logger. */
export function createProductionQueueConsumerDeps(): ProcessWakeupMessageDeps {
  const dispatchDeps: DispatchNotificationDeps = createDispatchNotificationDeps();
  return {
    dispatch: () => dispatchOwnerNotification({}, dispatchDeps),
    logger: createConsoleNotificationLogger(),
  };
}
