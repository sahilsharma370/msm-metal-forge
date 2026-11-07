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
 *
 * CHECKPOINT (customer-receipt latency fix) — complete_lead_if_ready now
 * creates TWO sibling outbox rows per completion (owner submission_completed
 * + customer_receipt), but /api/quote/complete still publishes exactly ONE
 * wake-up message. A single dispatch() call only ever claims ONE due row
 * (claim_notification_delivery_v1's fallback scan is `limit 1`), so without
 * this change the second sibling always fell through to the next Cron tick
 * (measured: ~18-58s later, see the read-only trace for
 * MSM-261105-B1E322/MSM-261105-4C7F81). Fixed here, not by publishing a
 * second wake-up message: a second publish depends on a second network call
 * to the Queue succeeding (CHECKPOINT (safety analysis) below) — one
 * message already in hand is more robust. Instead, one message now drains a
 * small, bounded number of due rows (QUEUE_DRAIN_MAX_JOBS) in a loop before
 * acknowledging, reusing cron-sweep.server.ts's own proven bounded-drain
 * shape (a deliberate, small, duplicated loop — not an imported shared
 * function — matching this codebase's own established precedent of
 * duplicating a small loop across two genuinely different operational
 * contexts, here a Queue message vs. a Cron tick, rather than forcing one
 * shared abstraction to serve both and log identically for either).
 *
 * CHECKPOINT (safety analysis) — two-wake-up vs. bounded-drain, assessed
 * against every risk this change could introduce:
 *   - Partial publish failure: a second `queue.send()` call can itself fail
 *     (network blip, Queue unavailable) independently of the first, which
 *     already succeeded — the two-wake-up approach would then silently fall
 *     back to exactly today's behavior (cron picks up the second row), with
 *     no proof at the point of failure of which case occurred. Bounded-drain
 *     has no second publish to fail — this failure mode does not exist for
 *     it at all.
 *   - Concurrent claims: claim_notification_delivery_v1 uses
 *     `FOR UPDATE SKIP LOCKED` — two dispatch() calls (from one message's
 *     drain loop, two messages, or a message racing a Cron tick) can never
 *     claim the same row twice; a second concurrent attempt on an
 *     already-locked row simply moves on to the next eligible row (or finds
 *     none). Identical guarantee under both approaches — already proven
 *     directly by the "two concurrent claim attempts" integration test.
 *   - Retries: unchanged either way — retry_wait/attempt_count/
 *     next_attempt_at remain entirely Postgres-owned; this file's loop only
 *     ever asks "is there more due work right now", never invents its own
 *     retry policy.
 *   - Duplicate sends: unchanged — Resend's own idempotency-key (per
 *     delivery row, stable across any number of claim/dispatch attempts)
 *     is still the sole duplicate-send guard; looping dispatch() more times
 *     per message cannot by itself cause a second send of an
 *     already-`sent` row, since claim_notification_delivery_v1's own
 *     eligibility predicate never reselects one.
 *   - Resulting choice: bounded-drain. Strictly fewer failure modes than
 *     two-wake-up, reuses an already-tested loop shape, and needs no new
 *     Queue-side provisioning.
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

/**
 * One completion produces exactly 2 sibling outbox rows today (owner +
 * customer_receipt) — 3 gives one spare unit of headroom (e.g. a due
 * retry_wait row from elsewhere happening to also be claimable right now)
 * without turning a single wake-up into an unbounded sweep. Small and
 * human-reasoned, matching this schema's own established bound-sizing
 * convention (see cron-sweep.server.ts's CRON_SWEEP_MAX_JOBS).
 */
export const QUEUE_DRAIN_MAX_JOBS = 3;

export interface ProcessWakeupMessageDeps {
  readonly dispatch: () => Promise<DispatchResult>;
  readonly logger: NotificationLogger;
  /** Defaults to QUEUE_DRAIN_MAX_JOBS; injectable so tests can prove the bound without looping 3 times for every case. */
  readonly maxJobs?: number;
}

/**
 * Core per-message decision, independent of the real Cloudflare Message
 * type so it can be unit tested directly. Never throws — every branch
 * (including an unexpected thrown error from dispatch()) resolves to a
 * safe ack/retry decision the caller applies to the real message.
 *
 * Drains up to `maxJobs` due rows in one pass (see this file's own
 * CHECKPOINT (customer-receipt latency fix) comment above) — a `sent`,
 * `retry_scheduled`, `dead_lettered`, or `claim_lost` result is a durable,
 * resolved outcome either way, so the loop continues to check for more due
 * work; only `no_work` (genuinely nothing left) or `internal_error`
 * (something is wrong talking to the dependency — stop rather than hammer
 * it) end the loop early.
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

  const maxJobs = deps.maxJobs ?? QUEUE_DRAIN_MAX_JOBS;
  let processedAny = false;

  for (let i = 0; i < maxJobs; i += 1) {
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
        processedAny = true;
        continue;
      case "no_work":
        deps.logger.log(processedAny ? "queue_drain_complete" : "queue_dispatch_no_work");
        return { action: "ack" };
      case "retry_scheduled":
        // Acknowledged, not retried at the Queue layer — the retry timing is
        // durably owned by next_attempt_at in Postgres; a Queue-level retry
        // here would be redundant and would let Cloudflare's own retry
        // count silently become a second, uncoordinated attempt counter.
        deps.logger.log("queue_dispatch_retry_scheduled");
        processedAny = true;
        continue;
      case "dead_lettered":
        deps.logger.log("queue_dispatch_dead_lettered");
        processedAny = true;
        continue;
      case "claim_lost":
        // Another worker already owns or resolved this row — nothing left
        // for THIS attempt to do; a sibling row may still be due, so the
        // loop continues rather than stopping here.
        deps.logger.log("queue_dispatch_claim_lost");
        processedAny = true;
        continue;
      case "internal_error":
        deps.logger.log("queue_dispatch_internal_error");
        return { action: "retry", delaySeconds: INTERNAL_ERROR_RETRY_DELAY_SECONDS };
    }
  }

  // Bound reached with work still potentially due — acknowledge anyway
  // (the next wake-up, or the Cron sweep, picks up whatever remains); never
  // let a single message loop beyond its small, fixed budget.
  deps.logger.log("queue_drain_max_reached");
  return { action: "ack" };
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
