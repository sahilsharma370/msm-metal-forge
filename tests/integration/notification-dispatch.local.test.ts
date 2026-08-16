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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  dispatchOwnerNotification,
  toNotificationDispatchRpcClient,
  LEAD_EMAIL_COLUMNS,
  type DispatchNotificationDeps,
  type LeadEmailRow,
} from "../../src/server/notifications/dispatch-notification.server";
import { handleOwnerNotificationQueueBatch, type WakeupQueueMessage } from "../../src/server/notifications/queue-consumer.server";
import { createNoopNotificationLogger } from "../../src/server/notifications/notification-logger";
import type { EmailConfig } from "../../src/server/env.server";
import type { EmailProvider, EmailSendInput } from "../../src/server/notifications/notification-email-types";

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
