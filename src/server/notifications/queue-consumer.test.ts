import { describe, expect, it, vi } from "vitest";
import {
  processWakeupMessage,
  handleOwnerNotificationQueueBatch,
  type WakeupQueueMessage,
  type WakeupMessageBatch,
} from "./queue-consumer.server";
import { createNoopNotificationLogger, type NotificationLogEvent, type NotificationLogger } from "./notification-logger";
import type { DispatchResult } from "./dispatch-notification.server";

function fakeLogger(): { logger: NotificationLogger; events: NotificationLogEvent[] } {
  const events: NotificationLogEvent[] = [];
  return { logger: { log: (event) => events.push(event) }, events };
}

function fakeMessage(body: unknown): WakeupQueueMessage & { ackCalls: number; retryCalls: { delaySeconds?: number }[] } {
  const msg = {
    body,
    ackCalls: 0,
    retryCalls: [] as { delaySeconds?: number }[],
    ack() {
      msg.ackCalls += 1;
    },
    retry(options?: { delaySeconds?: number }) {
      msg.retryCalls.push(options ?? {});
    },
  };
  return msg;
}

const VALID_MESSAGE = { version: 1, kind: "owner_notification_due" };

describe("processWakeupMessage — validation", () => {
  it("dispatches for a valid payload", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "no_work" }));
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ action: "ack" });
  });

  it("acknowledges without dispatching for a malformed payload", async () => {
    const dispatch = vi.fn();
    const { logger, events } = fakeLogger();
    const outcome = await processWakeupMessage({ garbage: true }, { dispatch, logger });
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ action: "ack" });
    expect(events).toEqual(["queue_message_invalid"]);
  });

  it("acknowledges without dispatching for an unknown version", async () => {
    const dispatch = vi.fn();
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage({ version: 2, kind: "owner_notification_due" }, { dispatch, logger });
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ action: "ack" });
  });

  it("acknowledges without dispatching for an unknown kind", async () => {
    const dispatch = vi.fn();
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage({ version: 1, kind: "something_else" }, { dispatch, logger });
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ action: "ack" });
  });

  it("acknowledges without dispatching for a non-object payload", async () => {
    const dispatch = vi.fn();
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage("not an object", { dispatch, logger });
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ action: "ack" });
  });

  it("acknowledges without dispatching for a payload with extra unknown keys (strict schema)", async () => {
    const dispatch = vi.fn();
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage({ version: 1, kind: "owner_notification_due", extra: "field" }, { dispatch, logger });
    expect(dispatch).not.toHaveBeenCalled();
    expect(outcome).toEqual({ action: "ack" });
  });
});

describe("processWakeupMessage — dispatch result mapping", () => {
  it.each([
    ["sent", { kind: "sent", deliveryId: "d1", providerMessageId: "m1" }],
    ["no_work", { kind: "no_work" }],
    ["retry_scheduled", { kind: "retry_scheduled", deliveryId: "d1", nextAttemptAt: "2026-01-01T00:00:00.000Z" }],
    ["dead_lettered", { kind: "dead_lettered", deliveryId: "d1", errorCode: "INVALID_RECIPIENT" }],
    ["claim_lost", { kind: "claim_lost", deliveryId: "d1" }],
  ] as const)("acknowledges on a %s dispatch result", async (_label, result) => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => result);
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(outcome).toEqual({ action: "ack" });
  });

  it("retries with a bounded delay on internal_error", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "internal_error" }));
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(outcome).toEqual({ action: "retry", delaySeconds: 60 });
  });

  it("retries safely (bounded delay) when the dispatcher throws unexpectedly", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(outcome).toEqual({ action: "retry", delaySeconds: 60 });
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT (customer-receipt latency fix) — bounded in-message drain.
// One wake-up message now claims up to QUEUE_DRAIN_MAX_JOBS due rows
// (default 3 — the owner + customer_receipt sibling pair, plus one unit of
// headroom) before acknowledging, instead of exactly one.
// ---------------------------------------------------------------------------

describe("processWakeupMessage — bounded in-message drain (latency fix)", () => {
  it("drains both sibling rows (owner + customer_receipt) from a single wake-up message, not just one", async () => {
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "owner-row", providerMessageId: "m-owner" },
      { kind: "sent", deliveryId: "customer-row", providerMessageId: "m-customer" },
      { kind: "no_work" },
    ];
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[call++]!);
    const { logger, events } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ action: "ack" });
    expect(events).toEqual(["queue_dispatch_sent", "queue_dispatch_sent", "queue_drain_complete"]);
  });

  it("stops as soon as no_work is reached — never calls dispatch more times than there is real work", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "no_work" }));
    const { logger } = fakeLogger();
    await processWakeupMessage(VALID_MESSAGE, { dispatch, logger: logger });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("respects the configured bound (maxJobs) and acks rather than looping forever when more work keeps being reported", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "sent", deliveryId: "d", providerMessageId: "m" }));
    const { logger, events } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger, maxJobs: 2 });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ action: "ack" });
    expect(events).toEqual(["queue_dispatch_sent", "queue_dispatch_sent", "queue_drain_max_reached"]);
  });

  it("continues draining through retry_scheduled, dead_lettered, and claim_lost — none of them stop the loop early", async () => {
    const results: DispatchResult[] = [
      { kind: "retry_scheduled", deliveryId: "d1", nextAttemptAt: null },
      { kind: "dead_lettered", deliveryId: "d2", errorCode: "AUTH_ERROR" },
      { kind: "claim_lost", deliveryId: "d3" },
    ];
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[call++]!);
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger, maxJobs: 3 });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({ action: "ack" });
  });

  it("an internal_error partway through a drain stops immediately (never spends remaining budget on a possibly-unhealthy dependency) and retries the whole message", async () => {
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "d1", providerMessageId: "m1" },
      { kind: "internal_error" },
    ];
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[call++]!);
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger, maxJobs: 5 });
    // Stopped at the internal_error — never reached a 3rd call even though maxJobs allowed it.
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ action: "retry", delaySeconds: 60 });
  });

  it("a partial-drain success (first row sent, then the Queue message itself effectively 'fails' via internal_error) never un-sends the first row — the message retry is safe because Postgres already durably recorded the first send", async () => {
    // This test documents the safety property rather than re-proving
    // dispatch-notification.server.ts's own already-tested durability —
    // the point here is purely that this file's loop does not attempt any
    // compensating/undo action on a later failure.
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "owner-row", providerMessageId: "m-owner" },
      { kind: "internal_error" },
    ];
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[call++]!);
    const { logger } = fakeLogger();
    const outcome = await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    expect(outcome).toEqual({ action: "retry", delaySeconds: 60 });
    // No call ever attempts to reverse/compensate the first "sent" result —
    // dispatch is only ever called forward (claim-and-resolve), never with
    // an undo-shaped argument.
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

describe("processWakeupMessage — no raw error/body/PII logging", () => {
  it("logs only closed-set event codes, never the raw message body or error", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("secret-shaped failure containing owner@msmscrap.example");
    });
    const { logger, events } = fakeLogger();
    await processWakeupMessage(VALID_MESSAGE, { dispatch, logger });
    for (const event of events) {
      expect(event).not.toContain("@");
      expect(event).not.toContain("secret");
    }
    expect(events).toEqual(["queue_dispatch_unexpected_error"]);
  });
});

describe("handleOwnerNotificationQueueBatch", () => {
  it("acks a message whose outcome is ack, and retries one whose outcome is retry, independently", async () => {
    // Messages are processed strictly in order by this function's own
    // for-loop, so a single ordered call sequence correctly represents:
    // messageA's drain (one sent row, then genuinely no more work -> ack),
    // followed by messageB's drain (its very first call fails -> retry).
    // Under the bounded-drain change a single message's own processing can
    // call dispatch() more than once, which is exactly what call 1→2 below
    // exercises for messageA before messageB's call 3 ever happens.
    const results: DispatchResult[] = [
      { kind: "sent", deliveryId: "d1", providerMessageId: "m1" },
      { kind: "no_work" },
      { kind: "internal_error" },
    ];
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => results[call++]!);
    const { logger } = fakeLogger();
    const messageA = fakeMessage(VALID_MESSAGE);
    const messageB = fakeMessage(VALID_MESSAGE);
    const batch: WakeupMessageBatch = { messages: [messageA, messageB] };

    await handleOwnerNotificationQueueBatch(batch, { dispatch, logger });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(messageA.ackCalls).toBe(1);
    expect(messageA.retryCalls).toHaveLength(0);
    expect(messageB.ackCalls).toBe(0);
    expect(messageB.retryCalls).toEqual([{ delaySeconds: 60 }]);
  });

  it("one message throwing during ack()/retry() does not prevent other messages in the batch from being processed", async () => {
    const dispatch = vi.fn(async (): Promise<DispatchResult> => ({ kind: "sent", deliveryId: "d1", providerMessageId: "m1" }));
    const { logger } = fakeLogger();
    const poisonMessage: WakeupQueueMessage = {
      body: VALID_MESSAGE,
      ack() {
        throw new Error("ack failed");
      },
      retry() {},
    };
    const goodMessage = fakeMessage(VALID_MESSAGE);
    const batch: WakeupMessageBatch = { messages: [poisonMessage, goodMessage] };

    await expect(handleOwnerNotificationQueueBatch(batch, { dispatch, logger })).resolves.toBeUndefined();
    expect(goodMessage.ackCalls).toBe(1);
  });

  it("processes an empty batch as a clean no-op", async () => {
    const dispatch = vi.fn();
    const { logger } = fakeLogger();
    await expect(handleOwnerNotificationQueueBatch({ messages: [] }, { dispatch, logger })).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("noop logger", () => {
  it("never throws and records nothing observable", () => {
    const logger = createNoopNotificationLogger();
    expect(() => logger.log("queue_dispatch_sent")).not.toThrow();
  });
});
