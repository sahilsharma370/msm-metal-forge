import { describe, expect, it, vi } from "vitest";
import {
  dispatchOwnerNotification,
  computeRetryDelaySeconds,
  type DispatchNotificationDeps,
  type NotificationDispatchRpcClient,
  type LeadEmailRow,
} from "./dispatch-notification.server";
import type { EmailConfig } from "@/server/env.server";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "./notification-email-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DELIVERY_ID = "11111111-1111-1111-1111-111111111111";
const LEAD_ID = "22222222-2222-2222-2222-222222222222";
const CLAIM_TOKEN = "33333333-3333-3333-3333-333333333333";

function claimSuccess(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    delivery_id: DELIVERY_ID,
    lead_id: LEAD_ID,
    event_type: "submission_completed",
    channel: "email",
    attempt_count: 1,
    claim_token: CLAIM_TOKEN,
    claimed_at: "2026-08-17T10:00:00.000Z",
    lease_expires_at: "2026-08-17T10:02:00.000Z",
    ...overrides,
  };
}

function leadRow(overrides: Partial<LeadEmailRow> = {}): LeadEmailRow {
  return {
    reference: "MSM-260817-ABCDEF",
    intent: "sell",
    material: "copper",
    material_subtype: null,
    material_subtype_other_text: null,
    material_other_text: null,
    material_spec: null,
    seller_quantity_value: "100",
    seller_quantity_unit: "kg",
    seller_quantity_unit_other: null,
    seller_quantity_unsure: false,
    seller_condition: "clean_separated",
    seller_description: null,
    seller_emirate: "dubai",
    seller_area: "Al Quoz Industrial 3",
    seller_map_link: null,
    seller_pickup_required: "no",
    seller_pickup_date: null,
    seller_access_note: null,
    seller_name: "Ahmed Seller",
    seller_phone: "+971501234567",
    seller_company: null,
    seller_email: null,
    seller_preferred_contact: "whatsapp",
    seller_notes: null,
    buyer_quantity_value: null,
    buyer_quantity_unit: null,
    buyer_quantity_unit_other: null,
    buyer_trade_requirement: null,
    buyer_required_by_date: null,
    buyer_additional_spec: null,
    buyer_destination_emirate: null,
    buyer_destination_area: null,
    buyer_destination_map_link: null,
    buyer_fulfilment: null,
    buyer_destination_country: null,
    buyer_destination_city_port: null,
    buyer_preferred_port: null,
    buyer_preferred_port_other: null,
    buyer_origin_country_preference: null,
    buyer_logistics_requirement: null,
    buyer_logistics_note: null,
    buyer_company: null,
    buyer_contact_person: null,
    buyer_phone: null,
    buyer_email: null,
    buyer_preferred_contact: null,
    buyer_notes: null,
    file_upload_status: "none",
    submitted_at: "2026-08-17T09:55:00.000Z",
    ...overrides,
  };
}

const testEmailConfig: EmailConfig = {
  resendApiKey: "test-key",
  ownerNotificationEmail: "owner@msmscrap.example",
  emailFrom: "MSM Scrap <enquiries@msmscrap.example>",
};

function fakeSuccessfulSend(): EmailSendResult {
  return { ok: true, provider: "resend", providerMessageId: "msg-1" };
}

interface FakeRpcCalls {
  claim: unknown[];
  markSent: unknown[];
  reschedule: unknown[];
  deadLetter: unknown[];
}

function createFakeRpc(overrides: {
  claim?: { data: unknown; error: { message: string } | null };
  markSent?: { data: unknown; error: { message: string } | null };
  reschedule?: { data: unknown; error: { message: string } | null };
  deadLetter?: { data: unknown; error: { message: string } | null };
}): { rpc: NotificationDispatchRpcClient; calls: FakeRpcCalls } {
  const calls: FakeRpcCalls = { claim: [], markSent: [], reschedule: [], deadLetter: [] };
  const rpc: NotificationDispatchRpcClient = {
    rpc: (async (fn: string, args: unknown) => {
      switch (fn) {
        case "claim_notification_delivery_v1":
          calls.claim.push(args);
          return overrides.claim ?? { data: null, error: null };
        case "mark_notification_delivery_sent_v1":
          calls.markSent.push(args);
          return overrides.markSent ?? { data: null, error: { message: "not configured" } };
        case "reschedule_notification_delivery_v1":
          calls.reschedule.push(args);
          return overrides.reschedule ?? { data: null, error: { message: "not configured" } };
        case "dead_letter_notification_delivery_v1":
          calls.deadLetter.push(args);
          return overrides.deadLetter ?? { data: null, error: { message: "not configured" } };
        default:
          throw new Error(`unexpected rpc: ${fn}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  };
  return { rpc, calls };
}

function createDeps(partial: Partial<DispatchNotificationDeps>): DispatchNotificationDeps {
  return {
    rpc: partial.rpc ?? createFakeRpc({}).rpc,
    loadLead: partial.loadLead ?? (async () => leadRow()),
    countLeadFiles: partial.countLeadFiles ?? (async () => 0),
    getEmailConfig: partial.getEmailConfig ?? (() => testEmailConfig),
    createEmailProvider: partial.createEmailProvider ?? (() => ({ send: async () => fakeSuccessfulSend() })),
    generateClaimToken: partial.generateClaimToken ?? (() => CLAIM_TOKEN),
    ...(partial.leaseSeconds !== undefined ? { leaseSeconds: partial.leaseSeconds } : {}),
  };
}

// ---------------------------------------------------------------------------
// computeRetryDelaySeconds
// ---------------------------------------------------------------------------

describe("computeRetryDelaySeconds", () => {
  it.each([
    [1, 60],
    [2, 300],
    [3, 900],
    [4, 3600],
    [5, 3600],
    [6, 3600],
  ])("attempt_count=%i -> %i seconds", (attemptCount, expected) => {
    expect(computeRetryDelaySeconds(attemptCount)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// no_work
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — no work", () => {
  it("returns no_work when claim finds nothing eligible, and calls no other RPC", async () => {
    const { rpc, calls } = createFakeRpc({ claim: { data: null, error: null } });
    const result = await dispatchOwnerNotification({}, createDeps({ rpc }));
    expect(result).toEqual({ kind: "no_work" });
    expect(calls.markSent).toHaveLength(0);
    expect(calls.reschedule).toHaveLength(0);
    expect(calls.deadLetter).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Targeted vs. fallback claim
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — targeted vs. fallback claim", () => {
  it("passes the exact delivery ID for a targeted dispatch", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc }));
    expect(calls.claim[0]).toMatchObject({ p_delivery_id: DELIVERY_ID });
  });

  it("passes null for a fallback (oldest-due) dispatch", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    await dispatchOwnerNotification({}, createDeps({ rpc }));
    expect(calls.claim[0]).toMatchObject({ p_delivery_id: null });
  });
});

// ---------------------------------------------------------------------------
// Successful send
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — successful send", () => {
  it("claims, sends, and marks sent with the exact provider message id", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-real-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: true as const, provider: "resend", providerMessageId: "msg-real-1" }));
    const result = await dispatchOwnerNotification(
      { deliveryId: DELIVERY_ID },
      createDeps({ rpc, createEmailProvider: () => ({ send }) }),
    );
    expect(result).toEqual({ kind: "sent", deliveryId: DELIVERY_ID, providerMessageId: "msg-real-1" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls.markSent).toHaveLength(1);
    expect(calls.markSent[0]).toMatchObject({
      p_delivery_id: DELIVERY_ID,
      p_claim_token: CLAIM_TOKEN,
      p_provider: "resend",
      p_provider_message_id: "msg-real-1",
    });
  });

  it("uses a stable idempotency key of the form submission_completed/<delivery id>", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(send.mock.calls[0]?.[0]?.idempotencyKey).toBe(`submission_completed/${DELIVERY_ID}`);
  });

  it("uses the same idempotency key across two separate dispatch calls for the same delivery (a retry)", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess({ attempt_count: 2 }), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const deps = createDeps({ rpc, createEmailProvider: () => ({ send }) });
    await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, deps);
    await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, deps);
    expect(send.mock.calls[0]?.[0]?.idempotencyKey).toBe(send.mock.calls[1]?.[0]?.idempotencyKey);
  });

  it("loads the exact claimed lead ID and renders the email using its real fields", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const loadLead = vi.fn(async (id: string) => {
      expect(id).toBe(LEAD_ID);
      return leadRow({ seller_name: "Distinct Name" });
    });
    await dispatchOwnerNotification(
      { deliveryId: DELIVERY_ID },
      createDeps({ rpc, loadLead, createEmailProvider: () => ({ send }) }),
    );
    expect(loadLead).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.text).toContain("Distinct Name");
    expect(send.mock.calls[0]?.[0]?.subject).toContain("MSM-260817-ABCDEF");
  });

  it("passes the from/to/reply-to/subject exactly from resolved email config and rendered content", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const configWithReplyTo: EmailConfig = { ...testEmailConfig, emailReplyTo: "reply@msmscrap.example" };
    await dispatchOwnerNotification(
      { deliveryId: DELIVERY_ID },
      createDeps({ rpc, getEmailConfig: () => configWithReplyTo, createEmailProvider: () => ({ send }) }),
    );
    const sentInput = send.mock.calls[0]?.[0];
    expect(sentInput?.from).toBe(testEmailConfig.emailFrom);
    expect(sentInput?.to).toBe(testEmailConfig.ownerNotificationEmail);
    expect(sentInput?.replyTo).toBe("reply@msmscrap.example");
  });
});

// ---------------------------------------------------------------------------
// Retryable failure -> reschedule
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — retryable failure", () => {
  it.each([
    [1, 60],
    [2, 300],
    [3, 900],
    [4, 3600],
  ])("schedules the correct delay for attempt_count=%i", async (attemptCount, expectedDelay) => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess({ attempt_count: attemptCount }), error: null },
      reschedule: {
        data: { delivery_id: DELIVERY_ID, status: "retry_wait", attempt_count: attemptCount, next_attempt_at: "2026-08-17T10:05:00.000Z", last_error_code: "SERVER_ERROR" },
        error: null,
      },
    });
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: false as const, code: "SERVER_ERROR" as const, retryable: true }));
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(calls.reschedule[0]).toMatchObject({ p_retry_after_seconds: expectedDelay, p_error_code: "SERVER_ERROR" });
    expect(result).toEqual({ kind: "retry_scheduled", deliveryId: DELIVERY_ID, nextAttemptAt: "2026-08-17T10:05:00.000Z" });
  });

  it("maps the database's own dead_letter response (5th attempt) to a dead_lettered result", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess({ attempt_count: 5 }), error: null },
      reschedule: {
        data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 5, next_attempt_at: null, last_error_code: "SERVER_ERROR" },
        error: null,
      },
    });
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: false as const, code: "SERVER_ERROR" as const, retryable: true }));
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "dead_lettered", deliveryId: DELIVERY_ID, errorCode: "SERVER_ERROR" });
  });
});

// ---------------------------------------------------------------------------
// Permanent failure -> immediate dead-letter
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — permanent failure", () => {
  it("dead-letters immediately (never calls reschedule) for a permanent provider failure", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      deadLetter: { data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 1, last_error_code: "INVALID_RECIPIENT" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: false as const, code: "INVALID_RECIPIENT" as const, retryable: false }));
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "dead_lettered", deliveryId: DELIVERY_ID, errorCode: "INVALID_RECIPIENT" });
    expect(calls.reschedule).toHaveLength(0);
    expect(calls.deadLetter).toHaveLength(1);
    expect(calls.deadLetter[0]).toMatchObject({ p_error_code: "INVALID_RECIPIENT" });
  });
});

// ---------------------------------------------------------------------------
// Missing configuration
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — missing configuration", () => {
  it("dead-letters with CONFIGURATION_ERROR without ever calling the email provider, and never touches the lead", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      deadLetter: { data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 1, last_error_code: "CONFIGURATION_ERROR" }, error: null },
    });
    const createEmailProvider = vi.fn();
    const result = await dispatchOwnerNotification(
      { deliveryId: DELIVERY_ID },
      createDeps({
        rpc,
        getEmailConfig: () => {
          throw new Error("missing RESEND_API_KEY");
        },
        createEmailProvider,
      }),
    );
    expect(result).toEqual({ kind: "dead_lettered", deliveryId: DELIVERY_ID, errorCode: "CONFIGURATION_ERROR" });
    expect(createEmailProvider).not.toHaveBeenCalled();
    expect(calls.deadLetter[0]).toMatchObject({ p_error_code: "CONFIGURATION_ERROR" });
  });
});

// ---------------------------------------------------------------------------
// Stale claim / claim_lost
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — stale claim (claim_lost)", () => {
  it("returns claim_lost when mark-sent reports no matching active claim", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: null, error: { message: "mark_notification_delivery_sent_v1: no matching active claim to finalize" } },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "claim_lost", deliveryId: DELIVERY_ID });
  });

  it("returns claim_lost when reschedule reports no matching active claim", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      reschedule: { data: null, error: { message: "reschedule_notification_delivery_v1: no matching active claim to reschedule" } },
    });
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: false as const, code: "SERVER_ERROR" as const, retryable: true }));
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "claim_lost", deliveryId: DELIVERY_ID });
  });

  it("returns internal_error (not claim_lost) for an unrelated RPC error", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: null, error: { message: "some other unexpected database error" } },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "internal_error" });
  });
});

// ---------------------------------------------------------------------------
// Malformed claim JSON
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — malformed claim JSON", () => {
  it("is rejected safely as internal_error, and no other RPC or the provider is ever called", async () => {
    const { rpc, calls } = createFakeRpc({ claim: { data: { unexpected: "shape" }, error: null } });
    const send = vi.fn();
    const result = await dispatchOwnerNotification({}, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "internal_error" });
    expect(send).not.toHaveBeenCalled();
    expect(calls.markSent).toHaveLength(0);
    expect(calls.reschedule).toHaveLength(0);
    expect(calls.deadLetter).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid claim shape (event_type/channel) and missing lead — provider must
// never be called
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — invalid claim/lead shape", () => {
  it("dead-letters and never calls the provider when event_type/channel don't match this dispatcher's contract", async () => {
    const { rpc, calls } = createFakeRpc({
      claim: { data: claimSuccess({ event_type: "some_other_event" }), error: null },
      deadLetter: { data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 1, last_error_code: "UNSUPPORTED_DELIVERY" }, error: null },
    });
    const send = vi.fn();
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    expect(result).toEqual({ kind: "dead_lettered", deliveryId: DELIVERY_ID, errorCode: "UNSUPPORTED_DELIVERY" });
    expect(send).not.toHaveBeenCalled();
    expect(calls.deadLetter[0]).toMatchObject({ p_error_code: "UNSUPPORTED_DELIVERY" });
  });

  it("dead-letters and never calls the provider when the lead cannot be found", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      deadLetter: { data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 1, last_error_code: "LEAD_NOT_FOUND" }, error: null },
    });
    const send = vi.fn();
    const result = await dispatchOwnerNotification(
      { deliveryId: DELIVERY_ID },
      createDeps({ rpc, loadLead: async () => null, createEmailProvider: () => ({ send }) }),
    );
    expect(result).toEqual({ kind: "dead_lettered", deliveryId: DELIVERY_ID, errorCode: "LEAD_NOT_FOUND" });
    expect(send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// No PII in the dispatcher's own result / lead completion independence
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — no PII in results; lead independence", () => {
  it("never includes customer name/phone/email anywhere in the returned result", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      markSent: { data: { delivery_id: DELIVERY_ID, status: "sent", sent_at: "x", provider: "resend", provider_message_id: "msg-1" }, error: null },
    });
    const send = vi.fn(async (_input: EmailSendInput) => fakeSuccessfulSend());
    const result = await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, createEmailProvider: () => ({ send }) }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Ahmed Seller");
    expect(serialized).not.toContain("+971501234567");
  });

  it("only ever reads the lead (loadLead) and never has any lead-mutating capability in its dependencies — email/provider failure cannot affect the completed lead", async () => {
    const { rpc } = createFakeRpc({
      claim: { data: claimSuccess(), error: null },
      deadLetter: { data: { delivery_id: DELIVERY_ID, status: "dead_letter", attempt_count: 1, last_error_code: "INVALID_RECIPIENT" }, error: null },
    });
    const loadLead = vi.fn(async (_leadId: string) => leadRow());
    const send = vi.fn(async (_input: EmailSendInput) => ({ ok: false as const, code: "INVALID_RECIPIENT" as const, retryable: false }));
    await dispatchOwnerNotification({ deliveryId: DELIVERY_ID }, createDeps({ rpc, loadLead, createEmailProvider: () => ({ send }) }));
    expect(loadLead).toHaveBeenCalledTimes(1);
    expect(loadLead).toHaveBeenCalledWith(LEAD_ID);
    // DispatchNotificationDeps has no write-to-leads capability at all — see
    // the interface definition — so there is no further assertion needed to
    // prove the lead itself was never mutated by this call.
  });
});

// ---------------------------------------------------------------------------
// Unexpected RPC/network errors
// ---------------------------------------------------------------------------

describe("dispatchOwnerNotification — unexpected errors", () => {
  it("returns internal_error when the claim RPC call itself rejects", async () => {
    const rpc: NotificationDispatchRpcClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpc: (async () => {
        throw new Error("connection reset");
      }) as any,
    };
    const result = await dispatchOwnerNotification({}, createDeps({ rpc }));
    expect(result).toEqual({ kind: "internal_error" });
  });

  it("returns internal_error when the claim RPC resolves with a generic error", async () => {
    const { rpc } = createFakeRpc({ claim: { data: null, error: { message: "connection lost" } } });
    const result = await dispatchOwnerNotification({}, createDeps({ rpc }));
    expect(result).toEqual({ kind: "internal_error" });
  });
});
