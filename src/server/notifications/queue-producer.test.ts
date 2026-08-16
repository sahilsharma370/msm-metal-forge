import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOwnerNotificationQueueBinding,
  publishOwnerNotificationWakeup,
  OWNER_NOTIFICATION_WAKEUP_MESSAGE,
  OWNER_NOTIFICATION_QUEUE_BINDING_NAME,
  type QueueProducerBinding,
} from "./queue-producer.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OWNER_NOTIFICATION_WAKEUP_MESSAGE", () => {
  it("is the exact minimal versioned payload with no customer information", () => {
    expect(OWNER_NOTIFICATION_WAKEUP_MESSAGE).toEqual({ version: 1, kind: "owner_notification_due" });
    expect(Object.keys(OWNER_NOTIFICATION_WAKEUP_MESSAGE).sort()).toEqual(["kind", "version"]);
  });
});

describe("getOwnerNotificationQueueBinding", () => {
  it("returns null (never throws) when the binding is missing", () => {
    vi.stubGlobal("process", { env: { ...process.env, [OWNER_NOTIFICATION_QUEUE_BINDING_NAME]: undefined } });
    expect(() => getOwnerNotificationQueueBinding()).not.toThrow();
    expect(getOwnerNotificationQueueBinding()).toBeNull();
  });

  it("returns null when the binding is present but shaped wrong (no send method)", () => {
    vi.stubGlobal("process", { env: { ...process.env, [OWNER_NOTIFICATION_QUEUE_BINDING_NAME]: { notSend: true } } });
    expect(getOwnerNotificationQueueBinding()).toBeNull();
  });

  it("returns the binding when it is a real object with a send() method", () => {
    const fakeBinding: QueueProducerBinding = { send: async () => undefined };
    vi.stubGlobal("process", { env: { ...process.env, [OWNER_NOTIFICATION_QUEUE_BINDING_NAME]: fakeBinding } });
    expect(getOwnerNotificationQueueBinding()).toBe(fakeBinding);
  });
});

describe("publishOwnerNotificationWakeup", () => {
  it("sends the exact minimal versioned payload", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await publishOwnerNotificationWakeup({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ version: 1, kind: "owner_notification_due" });
    expect(result).toEqual({ published: true });
  });

  it("reports published:false (never throws) when the binding is null (missing)", async () => {
    await expect(publishOwnerNotificationWakeup(null)).resolves.toEqual({ published: false });
  });

  it("reports published:false (never throws) when send() rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    await expect(publishOwnerNotificationWakeup({ send })).resolves.toEqual({ published: false });
  });

  it("a replay/duplicate wake-up call is harmless — send() can be called again with no special handling", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const binding: QueueProducerBinding = { send };
    const first = await publishOwnerNotificationWakeup(binding);
    const second = await publishOwnerNotificationWakeup(binding);
    expect(first).toEqual({ published: true });
    expect(second).toEqual({ published: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never includes any PII in the message it sends, regardless of caller intent", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await publishOwnerNotificationWakeup({ send });
    const sentMessage = send.mock.calls[0]?.[0];
    const serialized = JSON.stringify(sentMessage);
    expect(serialized).not.toMatch(/name|phone|email|address|note|material|snapshot|path|url|secret/i);
  });
});
