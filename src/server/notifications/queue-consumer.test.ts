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
    let call = 0;
    const dispatch = vi.fn(async (): Promise<DispatchResult> => {
      call += 1;
      return call === 1 ? { kind: "sent", deliveryId: "d1", providerMessageId: "m1" } : { kind: "internal_error" };
    });
    const { logger } = fakeLogger();
    const messageA = fakeMessage(VALID_MESSAGE);
    const messageB = fakeMessage(VALID_MESSAGE);
    const batch: WakeupMessageBatch = { messages: [messageA, messageB] };

    await handleOwnerNotificationQueueBatch(batch, { dispatch, logger });

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
