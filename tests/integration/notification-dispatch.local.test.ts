/**
 * CHECKPOINT C2H-B2 — permanent, local-only end-to-end integration test for
 * the owner-notification outbox + dispatcher + Queue-consumer orchestration,
 * exercised through the REAL dispatchOwnerNotification()/
 * handleOwnerNotificationQueueBatch() functions against a REAL local
 * Supabase Postgres stack (`npx supabase start`). Only the EmailProvider
 * and the email config are faked — never a real Resend call, never a real
 * network request. Nothing here mocks Supabase, the RPC client, or the
 * dispatcher/queue-consumer logic itself — that is the entire point of
 * this checkpoint's integration coverage.
 *
 * Deliberately NOT part of `npm test` (see vitest.integration.config.ts's
 * own comment) — only reachable via `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to quote-pipeline.local.test.ts (see that
 * file's own header comment for the full reasoning): local Supabase
 * connection settings come exclusively from `npx supabase status -o json`,
 * fail closed unless the reported hostname is exactly "localhost" or
 * "127.0.0.1", and explicitly reject any *.supabase.co hostname. Only
 * `supabase status`, `supabase db reset`, and ordinary supabase-js calls
 * against the validated local API_URL are ever run here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchOwnerNotification,
  toNotificationDispatchRpcClient,
  createDispatchNotificationDeps,
  LEAD_EMAIL_COLUMNS,
  type DispatchNotificationDeps,
  type LeadEmailRow,
} from "../../src/server/notifications/dispatch-notification.server";
import { handleOwnerNotificationQueueBatch, type WakeupQueueMessage } from "../../src/server/notifications/queue-consumer.server";
import { runNotificationCronSweep } from "../../src/server/notifications/cron-sweep.server";
import { createNoopNotificationLogger } from "../../src/server/notifications/notification-logger";
import type { EmailConfig } from "../../src/server/env.server";
import type { EmailProvider, EmailSendInput } from "../../src/server/notifications/notification-email-types";

// ---------------------------------------------------------------------------
// CHECKPOINT C2H-B2 (BATCH 4) — same rate-limit-mocking posture as
// quote-pipeline.local.test.ts / quote-to-owner-workflow.local.test.ts: this
// file's point is Postgres/dispatcher correctness through the REAL route
// handlers where needed (Queue-dispatch-failure isolation below), not
// abuse-protection behavior (that has its own exhaustive DI-based coverage
// in initiate.test.ts/complete.test.ts). Turnstile is not mocked here since
// no test in this file calls /api/quote/initiate with a real Turnstile
// token requirement — every new lead below is seeded directly via the
// create_website_quote_v1 RPC, matching this file's own existing
// convention; only the one Queue-dispatch-isolation test below calls the
// real /api/quote/complete route, which never checks Turnstile itself.
vi.mock("../../src/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => ({ limit: async () => ({ success: true }) }),
  };
});

// ---------------------------------------------------------------------------
// Safety gate (duplicated from quote-pipeline.local.test.ts by design — see
// that file's own comment on why each integration suite owns its own copy)
// ---------------------------------------------------------------------------

interface LocalSupabaseSettings {
  apiUrl: string;
  anonKey: string;
  secretKey: string;
}

function getLocalSupabaseSettingsOrThrow(): LocalSupabaseSettings {
  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } catch {
    throw new Error(
      "Local integration safety gate: could not read `npx supabase status -o json`. " +
        "Is the local Supabase stack running (`npx supabase start`)?",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Local integration safety gate: `supabase status -o json` did not return valid JSON.");
  }

  const apiUrl = typeof parsed["API_URL"] === "string" ? parsed["API_URL"] : "";
  const anonKey = typeof parsed["PUBLISHABLE_KEY"] === "string" ? parsed["PUBLISHABLE_KEY"] : "";
  const secretKey = typeof parsed["SECRET_KEY"] === "string" ? parsed["SECRET_KEY"] : "";

  if (!apiUrl || !anonKey || !secretKey) {
    throw new Error(
      "Local integration safety gate: `supabase status -o json` did not report " +
        "API_URL / PUBLISHABLE_KEY / SECRET_KEY. Is the local stack fully started?",
    );
  }

  let hostname: string;
  try {
    hostname = new URL(apiUrl).hostname;
  } catch {
    throw new Error("Local integration safety gate: API_URL reported by the local CLI is not a valid URL.");
  }

  if (hostname.endsWith(".supabase.co")) {
    throw new Error(
      "Local integration safety gate: refusing to run against a hosted *.supabase.co URL. " +
        "This test suite only ever runs against a local Supabase stack.",
    );
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      "Local integration safety gate: SUPABASE_URL hostname must be exactly " +
        "'localhost' or '127.0.0.1' — refusing to proceed.",
    );
  }

  return { apiUrl, anonKey, secretKey };
}

function resetLocalDatabase(): void {
  execFileSync("npx", ["supabase", "db", "reset"], { cwd: process.cwd(), stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Fake message (structurally satisfies WakeupQueueMessage — no real
// Cloudflare types needed, see queue-consumer.server.ts's own comment)
// ---------------------------------------------------------------------------

function fakeWakeupMessage(): WakeupQueueMessage & { acked: boolean; retried: { delaySeconds?: number }[] } {
  const message = {
    body: { version: 1 as const, kind: "owner_notification_due" as const },
    acked: false,
    retried: [] as { delaySeconds?: number }[],
    ack() {
      message.acked = true;
    },
    retry(options?: { delaySeconds?: number }) {
      message.retried.push(options ?? {});
    },
  };
  return message;
}

const testEmailConfig: EmailConfig = {
  resendApiKey: "unused-in-this-test",
  ownerNotificationEmail: "owner@msmscrap.example",
  emailFrom: "MSM Scrap <enquiries@msmscrap.example>",
};

// ---------------------------------------------------------------------------
// BATCH 4 — shared fixtures/helpers for the new reliability tests below.
// Reuses the exact same real-deps wiring the original C2H-B2 test built
// inline (real RPC client + real lead lookup, fake EmailProvider only).
// ---------------------------------------------------------------------------

function sellSubmission(overrides: Record<string, unknown> = {}) {
  return {
    intent: "sell",
    source: "hero",
    material: "copper",
    sellerCondition: "clean_separated",
    sellerQuantityValue: "10",
    sellerQuantityUnit: "kg",
    sellerQuantityUnsure: false,
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "no",
    sellerName: "Batch4 Integration Seller",
    sellerPhone: "+971501234567",
    sellerPreferredContact: "whatsapp",
    ...overrides,
  };
}

function buySubmission(overrides: Record<string, unknown> = {}) {
  return {
    intent: "buy",
    source: "materials",
    material: "aluminium",
    buyerQuantityValue: "500",
    buyerQuantityUnit: "kg",
    buyerTradeRequirement: "local",
    buyerDestinationEmirate: "sharjah",
    buyerDestinationArea: "Industrial 3",
    buyerFulfilment: "delivery",
    buyerContactPerson: "Batch4 Integration Buyer",
    buyerPhone: "+971502345678",
    buyerPreferredContact: "whatsapp",
    ...overrides,
  };
}

/** Zero-file website submission — auto-completes synchronously inside create_website_quote_v1, which is also what creates the one pending notification_deliveries row (see complete_lead_if_ready's own INSERT ... ON CONFLICT DO NOTHING). */
async function createCompletedLead(submission: Record<string, unknown>): Promise<{ leadId: string; idempotencyKey: string }> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2h-b2-batch4-${idempotencyKey}`));
  const payloadHash = Array.from(new Uint8Array(payloadHashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await serviceClient.rpc("create_website_quote_v1", {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_submission: submission,
    p_files: [],
  });
  if (error) throw error;
  return { leadId: (data as { lead_id: string }).lead_id, idempotencyKey };
}

function buildRealDeps(provider: EmailProvider, config: EmailConfig = testEmailConfig): DispatchNotificationDeps {
  return {
    rpc: toNotificationDispatchRpcClient(serviceClient),
    async loadLead(id) {
      const { data } = await serviceClient.from("leads").select(LEAD_EMAIL_COLUMNS).eq("id", id).maybeSingle();
      return data as LeadEmailRow | null;
    },
    async countLeadFiles(id) {
      const { count } = await serviceClient.from("quote_upload_slots").select("id", { count: "exact", head: true }).eq("lead_id", id);
      return count ?? 0;
    },
    getEmailConfig: () => config,
    createEmailProvider: () => provider,
  };
}

function fakeSendingProvider(): EmailProvider & { calls: EmailSendInput[] } {
  const calls: EmailSendInput[] = [];
  return {
    calls,
    async send(input) {
      calls.push(input);
      return { ok: true, provider: "fake", providerMessageId: `fake-msg-${calls.length}` };
    },
  };
}

async function fetchDelivery(leadId: string) {
  const { data } = await serviceClient
    .from("notification_deliveries")
    .select("id, status, attempt_count, next_attempt_at, claim_token, claimed_at, lease_expires_at, last_error_code, manual_requeue_count")
    .eq("lead_id", leadId)
    .single();
  return data!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSupabaseSettings;
let serviceClient: SupabaseClient;

beforeAll(() => {
  settings = getLocalSupabaseSettingsOrThrow();
  process.env["SUPABASE_URL"] = settings.apiUrl;
  process.env["SUPABASE_SECRET_KEY"] = settings.secretKey;

  serviceClient = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  resetLocalDatabase();
}, 120_000);

afterAll(() => {
  resetLocalDatabase();
}, 120_000);

describe("CHECKPOINT C2H-B2 — real local outbox + dispatcher + Queue-consumer orchestration", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // BATCH 5C — real Postgres numeric quantity columns, through the REAL
  // production loadLead (createDispatchNotificationDeps, not the
  // buildRealDeps test helper above, which hand-casts and so never
  // exercised leadRowSchema's own parsing at all). seller_quantity_value/
  // buyer_quantity_value are `numeric(12,3)` columns — PostgREST returns
  // them as JSON numbers, which previously failed leadRowSchema's old
  // `z.string()` check and silently dead-lettered every quantity-bearing
  // lead as a false LEAD_NOT_FOUND. Only createEmailProvider/getEmailConfig
  // are swapped for the injected fake provider/test config; rpc/loadLead/
  // countLeadFiles are the real production implementation.
  // ---------------------------------------------------------------------------

  // Each test below builds its OWN provider with a globally-unique
  // providerMessageId (crypto.randomUUID(), not the shared
  // fakeSendingProvider()'s fixed "fake-msg-1" scheme) — provider_message_id
  // carries a real unique index (notification_deliveries_provider_message_id_key),
  // and a fixed literal id would collide with any other successful "sent"
  // row already in the table from another test in this same un-reset file
  // run. fakeSendingProvider() itself is left untouched, since another
  // existing test in this file asserts its exact "fake-msg-1" literal.
  function uniqueFakeSendingProvider(): EmailProvider & { calls: EmailSendInput[] } {
    const calls: EmailSendInput[] = [];
    return {
      calls,
      async send(input) {
        calls.push(input);
        return { ok: true, provider: "fake", providerMessageId: `fake-msg-${crypto.randomUUID()}` };
      },
    };
  }

  it("a Seller lead with a real numeric quantity value dispatches successfully (not a false LEAD_NOT_FOUND)", async () => {
    const { leadId } = await createCompletedLead(sellSubmission({ sellerQuantityValue: "50" }));
    const delivery = await fetchDelivery(leadId);
    const provider = uniqueFakeSendingProvider();
    const result = await dispatchOwnerNotification(
      { deliveryId: delivery.id },
      { ...createDispatchNotificationDeps(), createEmailProvider: () => provider, getEmailConfig: () => testEmailConfig },
    );
    expect(result.kind).toBe("sent");
    expect(provider.calls).toHaveLength(1);
  });

  it("a Buyer lead with a real numeric quantity value dispatches successfully (not a false LEAD_NOT_FOUND)", async () => {
    const { leadId } = await createCompletedLead(buySubmission({ buyerQuantityValue: "500" }));
    const delivery = await fetchDelivery(leadId);
    const provider = uniqueFakeSendingProvider();
    const result = await dispatchOwnerNotification(
      { deliveryId: delivery.id },
      { ...createDispatchNotificationDeps(), createEmailProvider: () => provider, getEmailConfig: () => testEmailConfig },
    );
    expect(result.kind).toBe("sent");
    expect(provider.calls).toHaveLength(1);
  });

  it("creates a real zero-file website enquiry with a pending notification row, then the Queue consumer sends it exactly once, and a replayed wake-up never sends a duplicate", async () => {
    const idempotencyKey = crypto.randomUUID();
    const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2h-b2-integration-${idempotencyKey}`));
    const payloadHash = Array.from(new Uint8Array(payloadHashBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: createResult, error: createError } = await serviceClient.rpc("create_website_quote_v1", {
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash,
      p_submission: {
        intent: "sell",
        source: "hero",
        material: "copper",
        sellerCondition: "clean_separated",
        sellerQuantityValue: "10",
        sellerQuantityUnit: "kg",
        sellerQuantityUnsure: false,
        sellerEmirate: "dubai",
        sellerArea: "Al Quoz Industrial 3",
        sellerPickupRequired: "no",
        sellerName: "C2H-B2 Integration Seller",
        sellerPhone: "+971501234567",
        sellerPreferredContact: "whatsapp",
      },
      p_files: [],
    });
    expect(createError).toBeNull();
    const leadId = (createResult as { lead_id: string }).lead_id;
    expect(leadId).toBeTruthy();

    // Confirm the pending notification row exists (CHECKPOINT C2H-A's own
    // completion side effect, unmodified by this checkpoint).
    const { data: pendingRow } = await serviceClient
      .from("notification_deliveries")
      .select("id, status, attempt_count")
      .eq("lead_id", leadId)
      .single();
    expect(pendingRow?.status).toBe("pending");

    // Real RPC client + real lead lookup, wired to the local Supabase
    // stack; only the EmailProvider and its config are faked — never a
    // real Resend call.
    const sendCalls: EmailSendInput[] = [];
    const fakeProvider: EmailProvider = {
      async send(input) {
        sendCalls.push(input);
        return { ok: true, provider: "fake", providerMessageId: `fake-msg-${sendCalls.length}` };
      },
    };
    const deps: DispatchNotificationDeps = {
      rpc: toNotificationDispatchRpcClient(serviceClient),
      async loadLead(id) {
        const { data } = await serviceClient.from("leads").select(LEAD_EMAIL_COLUMNS).eq("id", id).maybeSingle();
        return data as LeadEmailRow | null;
      },
      async countLeadFiles(id) {
        const { count } = await serviceClient
          .from("quote_upload_slots")
          .select("id", { count: "exact", head: true })
          .eq("lead_id", id);
        return count ?? 0;
      },
      getEmailConfig: () => testEmailConfig,
      createEmailProvider: () => fakeProvider,
    };

    // First wake-up (as the real Queue consumer would process it).
    const firstMessage = fakeWakeupMessage();
    await handleOwnerNotificationQueueBatch(
      { messages: [firstMessage] },
      { dispatch: () => dispatchOwnerNotification({}, deps), logger: createNoopNotificationLogger() },
    );
    expect(firstMessage.acked).toBe(true);
    expect(sendCalls).toHaveLength(1);

    const { data: sentRow } = await serviceClient
      .from("notification_deliveries")
      .select("status, provider, provider_message_id, sent_at")
      .eq("lead_id", leadId)
      .single();
    expect(sentRow?.status).toBe("sent");
    expect(sentRow?.provider).toBe("fake");
    expect(sentRow?.provider_message_id).toBe("fake-msg-1");

    // Replayed/duplicate wake-up (Cloudflare Queue may deliver more than
    // once) — must be acknowledged, and must NOT send a second email.
    const replayMessage = fakeWakeupMessage();
    await handleOwnerNotificationQueueBatch(
      { messages: [replayMessage] },
      { dispatch: () => dispatchOwnerNotification({}, deps), logger: createNoopNotificationLogger() },
    );
    expect(replayMessage.acked).toBe(true);
    expect(sendCalls).toHaveLength(1); // still exactly one — no duplicate send

    const { data: finalRow } = await serviceClient
      .from("notification_deliveries")
      .select("status")
      .eq("lead_id", leadId)
      .single();
    expect(finalRow?.status).toBe("sent");
  });

  // -------------------------------------------------------------------------
  // A — Durable creation (Buyer + replay-safety)
  // -------------------------------------------------------------------------

  it("a completed Buyer quote creates exactly one pending notification row, correctly linked to that lead", async () => {
    const { leadId } = await createCompletedLead(buySubmission());
    const { data: rows } = await serviceClient.from("notification_deliveries").select("id, lead_id, event_type, channel, status").eq("lead_id", leadId);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.event_type).toBe("submission_completed");
    expect(rows![0]!.channel).toBe("email");
    expect(rows![0]!.status).toBe("pending");
  });

  it("replaying an already-completed quote (complete_website_quote_v1 reconciliation) does not create a second notification row", async () => {
    const { leadId, idempotencyKey } = await createCompletedLead(sellSubmission());
    const before = await serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
    expect(before.count).toBe(1);

    const replay = await serviceClient.rpc("complete_website_quote_v1", { p_lead_id: leadId, p_idempotency_key: idempotencyKey });
    expect(replay.error).toBeNull();
    expect((replay.data as { already_completed: boolean }).already_completed).toBe(true);

    const after = await serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
    expect(after.count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // B — Queue-dispatch failure boundary: quote success is isolated from an
  // immediate Queue publish failure, through the REAL /api/quote/complete
  // route (not a direct RPC call), with a Queue binding attached to the
  // Request that actively rejects every send() call.
  // -------------------------------------------------------------------------

  it("a rejecting/unavailable Queue binding on /api/quote/complete never affects the completed enquiry — the response stays 200 and the notification row remains durable and pending", async () => {
    const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");

    // Seeded directly (zero files, auto-completed inside create_website_quote_v1
    // — same fixture pattern every other test in this file already uses).
    // This test's own point is the real /api/quote/complete route's
    // reconciliation path — exactly where publishOwnerNotificationWakeup is
    // actually called — not the public Turnstile boundary (already proven
    // in Batch 2), so no real Turnstile token is needed here.
    const { leadId, idempotencyKey } = await createCompletedLead(sellSubmission());

    const rejectingBinding = { send: async () => { throw new Error("Queue unavailable (simulated)"); } };
    const completeRequest = new Request("https://example.test/api/quote/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.40" },
      body: JSON.stringify({ leadId, idempotencyKey }),
    });
    Object.assign(completeRequest, { runtime: { cloudflare: { env: { OWNER_NOTIFICATION_QUEUE: rejectingBinding } } } });

    const completeResponse = await handleQuoteCompleteRequest(completeRequest);
    expect(completeResponse.status).toBe(200);
    const completeBody = await completeResponse.json();
    expect(completeBody.ok).toBe(true);

    const lead = await serviceClient.from("leads").select("submission_completed_at").eq("id", leadId).single();
    expect(lead.data?.submission_completed_at).not.toBeNull();

    const delivery = await fetchDelivery(leadId);
    expect(delivery.status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // C — Concurrent claim safety: two simultaneous claimants for the same
  // due row can never both win it (FOR UPDATE SKIP LOCKED, proven against
  // real Postgres, not simulated).
  // -------------------------------------------------------------------------

  it("two concurrent claim attempts for the same due row: exactly one wins, the other finds no eligible work", async () => {
    const { leadId } = await createCompletedLead(sellSubmission());
    const before = await fetchDelivery(leadId);
    expect(before.status).toBe("pending");

    const [first, second] = await Promise.all([
      serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: before.id, p_lease_seconds: 60 }),
      serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: before.id, p_lease_seconds: 60 }),
    ]);
    const results = [first, second];
    const winners = results.filter((r) => r.data !== null);
    const losers = results.filter((r) => r.data === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    for (const r of results) expect(r.error).toBeNull();

    const after = await fetchDelivery(leadId);
    expect(after.status).toBe("processing");
    expect(after.attempt_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // D — Retry, backoff, and terminal failure — driven directly against the
  // real RPCs for precise control over timing/attempt counts.
  // -------------------------------------------------------------------------

  it("a retryable failure sets retry_wait with a future next_attempt_at; the row cannot be claimed before it is due, and becomes claimable once due", async () => {
    const { leadId } = await createCompletedLead(sellSubmission());
    const row = await fetchDelivery(leadId);

    const claim = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    expect(claim.error).toBeNull();
    const claimToken = (claim.data as { claim_token: string }).claim_token;

    const reschedule = await serviceClient.rpc("reschedule_notification_delivery_v1", {
      p_delivery_id: row.id,
      p_claim_token: claimToken,
      p_error_code: "SERVER_ERROR",
      p_retry_after_seconds: 2,
    });
    expect(reschedule.error).toBeNull();
    const rescheduleData = reschedule.data as { status: string; attempt_count: number; next_attempt_at: string | null };
    expect(rescheduleData.status).toBe("retry_wait");
    expect(rescheduleData.attempt_count).toBe(1);
    expect(rescheduleData.next_attempt_at).not.toBeNull();

    // Not yet due — a claim attempt right now must find nothing eligible.
    const tooEarly = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    expect(tooEarly.error).toBeNull();
    expect(tooEarly.data).toBeNull();

    await sleep(2200);

    // Now due — a targeted claim must succeed (this file's other tests each
    // create their own leads/rows in the same shared local database without
    // resetting between tests, so a fallback/untargeted claim here could
    // legitimately pick up a different, older, also-eligible row from an
    // earlier test rather than proving anything about THIS row specifically
    // — a targeted claim isolates the exact same due-time gating behavior
    // this test is about, unambiguously).
    const nowDue = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    expect(nowDue.error).toBeNull();
    expect(nowDue.data).not.toBeNull();
    expect((nowDue.data as { delivery_id: string; attempt_count: number }).delivery_id).toBe(row.id);
    expect((nowDue.data as { attempt_count: number }).attempt_count).toBe(2);
  }, 15_000);

  it("reaching the max-attempt budget deterministically dead-letters the row via real reschedule calls, and a dead_letter row is never claimable", async () => {
    const { leadId } = await createCompletedLead(sellSubmission());
    const row = await fetchDelivery(leadId);

    let finalStatus = "";
    let finalAttemptCount = 0;
    for (let i = 0; i < 6; i++) {
      const claim = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
      expect(claim.error).toBeNull();
      if (!claim.data) throw new Error(`unexpectedly not claimable at iteration ${i}`);
      const claimData = claim.data as { claim_token: string; attempt_count: number };

      const reschedule = await serviceClient.rpc("reschedule_notification_delivery_v1", {
        p_delivery_id: row.id,
        p_claim_token: claimData.claim_token,
        p_error_code: "SERVER_ERROR",
        p_retry_after_seconds: 1,
      });
      expect(reschedule.error).toBeNull();
      const rescheduleData = reschedule.data as { status: string; attempt_count: number };
      finalStatus = rescheduleData.status;
      finalAttemptCount = rescheduleData.attempt_count;
      if (finalStatus === "dead_letter") break;
      await sleep(1200);
    }

    expect(finalAttemptCount).toBe(5);
    expect(finalStatus).toBe("dead_letter");

    const deadLetterAttempt = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    expect(deadLetterAttempt.error).toBeNull();
    expect(deadLetterAttempt.data).toBeNull();
  }, 20_000);

  it("a permanent (non-retryable) failure dead-letters immediately, without spending the five-attempt retry budget", async () => {
    const { leadId } = await createCompletedLead(sellSubmission());
    const row = await fetchDelivery(leadId);

    const claim = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    const claimData = claim.data as { claim_token: string };

    const deadLetter = await serviceClient.rpc("dead_letter_notification_delivery_v1", {
      p_delivery_id: row.id,
      p_claim_token: claimData.claim_token,
      p_error_code: "CONFIGURATION_ERROR",
    });
    expect(deadLetter.error).toBeNull();
    const deadLetterData = deadLetter.data as { status: string; attempt_count: number; last_error_code: string };
    expect(deadLetterData.status).toBe("dead_letter");
    expect(deadLetterData.attempt_count).toBe(1);
    expect(deadLetterData.last_error_code).toBe("CONFIGURATION_ERROR");
  });

  it("requeue makes a dead_letter row pending again with a reset attempt budget; requeuing an already-pending row is a safe no-op", async () => {
    const { leadId } = await createCompletedLead(sellSubmission());
    const row = await fetchDelivery(leadId);
    const claim = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: row.id, p_lease_seconds: 60 });
    const claimData = claim.data as { claim_token: string };
    await serviceClient.rpc("dead_letter_notification_delivery_v1", { p_delivery_id: row.id, p_claim_token: claimData.claim_token, p_error_code: "AUTH_ERROR" });

    const requeue = await serviceClient.rpc("requeue_notification_delivery_v1", { p_delivery_id: row.id });
    expect(requeue.error).toBeNull();
    const requeueData = requeue.data as { status: string; attempt_count: number; manual_requeue_count: number };
    expect(requeueData.status).toBe("pending");
    expect(requeueData.attempt_count).toBe(0);
    expect(requeueData.manual_requeue_count).toBe(1);

    // Idempotent no-op: requeuing an already-pending row does not increment manual_requeue_count again.
    const secondRequeue = await serviceClient.rpc("requeue_notification_delivery_v1", { p_delivery_id: row.id });
    expect(secondRequeue.error).toBeNull();
    const secondData = secondRequeue.data as { status: string; manual_requeue_count: number };
    expect(secondData.status).toBe("pending");
    expect(secondData.manual_requeue_count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // E — Cron recovery: eligibility selection and stranded-lease recovery,
  // against real Postgres, via the real runNotificationCronSweep function.
  // -------------------------------------------------------------------------

  it("cron sweep claims only eligible rows (pending + due retry_wait + a stranded expired-lease row), never a sent/dead_letter/actively-leased/not-yet-due row", async () => {
    // Isolated from every other test's rows in this file — this test's own
    // eligibility count (exactly 3 sent) would otherwise be polluted by
    // pending/retry_wait rows other tests above already left behind in
    // this same shared local database. A full reset is safe mid-suite
    // (`supabase db reset`, unconditionally); no other test's data is
    // needed after this point in the file.
    resetLocalDatabase();

    const pending = await createCompletedLead(sellSubmission({ sellerName: "Cron Pending Fixture" }));
    const dueRetry = await createCompletedLead(sellSubmission({ sellerName: "Cron Due-Retry Fixture" }));
    const notYetDue = await createCompletedLead(sellSubmission({ sellerName: "Cron Not-Yet-Due Fixture" }));
    const stranded = await createCompletedLead(sellSubmission({ sellerName: "Cron Stranded Fixture" }));
    const activelyLeased = await createCompletedLead(sellSubmission({ sellerName: "Cron Actively-Leased Fixture" }));
    const alreadySent = await createCompletedLead(sellSubmission({ sellerName: "Cron Already-Sent Fixture" }));
    const deadLettered = await createCompletedLead(sellSubmission({ sellerName: "Cron Dead-Lettered Fixture" }));

    // Set up each fixture's real starting state via the real RPCs.
    const dueRetryRow = await fetchDelivery(dueRetry.leadId);
    const claimDueRetry = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: dueRetryRow.id, p_lease_seconds: 60 });
    await serviceClient.rpc("reschedule_notification_delivery_v1", {
      p_delivery_id: dueRetryRow.id,
      p_claim_token: (claimDueRetry.data as { claim_token: string }).claim_token,
      p_error_code: "SERVER_ERROR",
      p_retry_after_seconds: 1,
    });

    const notYetDueRow = await fetchDelivery(notYetDue.leadId);
    const claimNotYetDue = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: notYetDueRow.id, p_lease_seconds: 60 });
    await serviceClient.rpc("reschedule_notification_delivery_v1", {
      p_delivery_id: notYetDueRow.id,
      p_claim_token: (claimNotYetDue.data as { claim_token: string }).claim_token,
      p_error_code: "SERVER_ERROR",
      p_retry_after_seconds: 3600,
    });

    const strandedRow = await fetchDelivery(stranded.leadId);
    const claimStranded = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: strandedRow.id, p_lease_seconds: 30 });
    expect(claimStranded.data).not.toBeNull();
    // Simulate a crashed worker: directly age the claim's timestamps into
    // the past (still a valid claimed_at < lease_expires_at pair per
    // notification_deliveries_lease_after_claim, just both already in the
    // past) — a real 30s+ wait is not needed to prove reclaim eligibility.
    const strandedUpdate = await serviceClient
      .from("notification_deliveries")
      .update({ claimed_at: new Date(Date.now() - 3600_000).toISOString(), lease_expires_at: new Date(Date.now() - 1800_000).toISOString() })
      .eq("id", strandedRow.id);
    expect(strandedUpdate.error).toBeNull();

    const activelyLeasedRow = await fetchDelivery(activelyLeased.leadId);
    await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: activelyLeasedRow.id, p_lease_seconds: 300 });

    const sentRow = await fetchDelivery(alreadySent.leadId);
    const claimSent = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: sentRow.id, p_lease_seconds: 60 });
    await serviceClient.rpc("mark_notification_delivery_sent_v1", {
      p_delivery_id: sentRow.id,
      p_claim_token: (claimSent.data as { claim_token: string }).claim_token,
      p_provider: "fake",
      p_provider_message_id: "cron-fixture-already-sent",
    });

    const deadLetterRow = await fetchDelivery(deadLettered.leadId);
    const claimDeadLetter = await serviceClient.rpc("claim_notification_delivery_v1", { p_claim_token: crypto.randomUUID(), p_delivery_id: deadLetterRow.id, p_lease_seconds: 60 });
    await serviceClient.rpc("dead_letter_notification_delivery_v1", {
      p_delivery_id: deadLetterRow.id,
      p_claim_token: (claimDeadLetter.data as { claim_token: string }).claim_token,
      p_error_code: "AUTH_ERROR",
    });

    await sleep(1200); // let dueRetry's 1s retry_after_seconds genuinely elapse

    const provider = fakeSendingProvider();
    const deps = buildRealDeps(provider);

    const sweep = await runNotificationCronSweep({ dispatch: () => dispatchOwnerNotification({}, deps), logger: createNoopNotificationLogger(), maxJobs: 10 });
    expect(sweep.stopReason).toBe("no_work");
    expect(sweep.processed).toBe(3);
    expect(provider.calls).toHaveLength(3);

    expect((await fetchDelivery(pending.leadId)).status).toBe("sent");
    expect((await fetchDelivery(dueRetry.leadId)).status).toBe("sent");
    expect((await fetchDelivery(stranded.leadId)).status).toBe("sent");
    expect((await fetchDelivery(stranded.leadId)).attempt_count).toBe(2); // original claim + the sweep's reclaim

    // Untouched — never claimed, never sent, never dead-lettered, never re-scheduled by the sweep.
    expect((await fetchDelivery(notYetDue.leadId)).status).toBe("retry_wait");
    expect((await fetchDelivery(activelyLeased.leadId)).status).toBe("processing");
    expect((await fetchDelivery(alreadySent.leadId)).status).toBe("sent");
    expect((await fetchDelivery(alreadySent.leadId)).claimed_at).toBeNull();
    expect((await fetchDelivery(deadLettered.leadId)).status).toBe("dead_letter");
  }, 120_000);

  it("concurrent sweep-style dispatch calls against the same due work are duplicate-safe — every row is sent exactly once, never twice, regardless of which concurrent call wins it", async () => {
    // Full isolation from every other test's rows in this file (same
    // reasoning as the eligibility test immediately above) — this test's
    // own exact-count assertions (2 processed, 2 sent) require a clean
    // slate, not just "no OTHER eligible row happens to exist right now".
    resetLocalDatabase();

    const first = await createCompletedLead(sellSubmission({ sellerName: "Concurrent Sweep Fixture One" }));
    const second = await createCompletedLead(sellSubmission({ sellerName: "Concurrent Sweep Fixture Two" }));

    const provider = fakeSendingProvider();
    const deps = buildRealDeps(provider);

    // Two concurrent sweep-style loops (mirrors what two overlapping Cron
    // ticks, or a Cron tick racing a Queue consumer, would each do) draining
    // the same due work — FOR UPDATE SKIP LOCKED (already proven directly
    // in the "two concurrent claim attempts" test above) is what guarantees
    // no row is ever claimed, and therefore never sent, twice.
    const [sweepA, sweepB] = await Promise.all([
      runNotificationCronSweep({ dispatch: () => dispatchOwnerNotification({}, deps), logger: createNoopNotificationLogger(), maxJobs: 5 }),
      runNotificationCronSweep({ dispatch: () => dispatchOwnerNotification({}, deps), logger: createNoopNotificationLogger(), maxJobs: 5 }),
    ]);
    expect(sweepA.stopReason).toBe("no_work");
    expect(sweepB.stopReason).toBe("no_work");
    expect(sweepA.processed + sweepB.processed).toBe(2);
    expect(provider.calls).toHaveLength(2);
    expect((await fetchDelivery(first.leadId)).status).toBe("sent");
    expect((await fetchDelivery(second.leadId)).status).toBe("sent");
  }, 120_000);

  // -------------------------------------------------------------------------
  // F — Content safety with real data: HTML-injection-shaped customer input,
  // rendered end-to-end through the real dispatcher against a real
  // completed lead — not just the synthetic fixtures already exhaustively
  // proven in owner-notification-email.test.ts.
  // -------------------------------------------------------------------------

  it("a real completed lead with HTML/script-injection-shaped fields renders safely escaped end-to-end, with no cross-branch leakage", async () => {
    // Same isolation reasoning as the two tests immediately above — running
    // directly after another mid-file reset has shown transient RPC
    // failures for the very next request otherwise (a stale pooled
    // connection surviving the previous reset, not a dispatcher defect —
    // dispatchOwnerNotification's own internal_error handling is exactly
    // what correctly reports a genuine transient RPC failure rather than
    // crashing; this reset removes that transient from the equation so
    // this test's own content-safety assertions stay deterministic).
    resetLocalDatabase();

    const maliciousArea = '<img src=x onerror="alert(1)"> Al Quoz';
    const maliciousNotes = "Line one\n<script>alert('xss')</script>\nLine two";
    const { leadId } = await createCompletedLead(
      sellSubmission({ sellerArea: maliciousArea, sellerNotes: maliciousNotes, sellerName: "Real <b>Bold</b> Name" }),
    );
    const row = await fetchDelivery(leadId);
    const provider = fakeSendingProvider();
    const deps = buildRealDeps(provider);

    const result = await dispatchOwnerNotification({ deliveryId: row.id }, deps);
    expect(result.kind).toBe("sent");
    expect(provider.calls).toHaveLength(1);

    const html = provider.calls[0]!.html;
    // The dangerous part is the live, parseable markup — a raw unescaped
    // `<script>`/`<img` tag. The word "onerror=" surviving as INERT escaped
    // text (inside `&lt;img ... onerror=&quot;alert(1)&quot;&gt;`) is safe
    // and expected — it can never become a real attribute once its
    // surrounding `<`/`>`/`"` are entity-escaped, so this only checks for
    // an actual live tag, not the substring "onerror=" in isolation.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    // Seller content only — no buyer-branch field label ever appears for a sell-intent lead.
    expect(html).not.toContain("Trade route");
    expect(html).not.toContain("Destination emirate");
  }, 120_000);

  it("cleans up: resetting the local database leaves zero rows behind", async () => {
    resetLocalDatabase();
    const [leads, notifications] = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }),
    ]);
    expect(leads.count).toBe(0);
    expect(notifications.count).toBe(0);
  });
});
