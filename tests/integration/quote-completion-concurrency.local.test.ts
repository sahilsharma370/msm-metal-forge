/**
 * CHECKPOINT C2D-B — deterministic two-session local concurrency proof for
 * the C2D-A lead-completion trigger (quote_upload_slots_sync_lead_status /
 * complete_lead_if_ready). Proves, with two independent raw Postgres
 * connections and explicit transactions, that two different "last" slots of
 * the same lead can finalize concurrently without deadlock, missed
 * completion, or duplicate side effects — and that the specific blocking
 * relationship (T2 waiting on T1's parent-lead row lock) is real, not
 * assumed, via a bounded pg_blocking_pids() poll, never a bare sleep.
 *
 * Deliberately separate from quote-pipeline.local.test.ts: this file needs
 * genuine two-session transactional control (BEGIN on one connection while
 * a second, independent connection blocks), which a single supabase-js
 * client (one PostgREST request = one transaction, no cross-request control)
 * cannot provide — hence the new `pg` devDependency, used here only.
 *
 * Not part of `npm test` (see vitest.integration.config.ts's own comment) —
 * only reachable via `npm run test:integration:local`, and only after the
 * safety gate below passes. Runs with fileParallelism:false alongside
 * quote-pipeline.local.test.ts, since both reset the same local database.
 *
 * SAFETY GATE:
 *   1. getLocalSettingsOrThrow() is the only source of connection info —
 *      always from `npx supabase status -o json` (a local CLI command),
 *      never a checked-in .env file; none is created or modified here.
 *   2/3. Fails closed unless BOTH the API host and the Postgres DB host are
 *      exactly "localhost" or "127.0.0.1"; explicitly rejects any
 *      *.supabase.co hostname on either.
 *   4. The Postgres connection string (which embeds the local dev
 *      password) and the service-role key are held only in local variables
 *      for this process's lifetime — never logged, never included in any
 *      assertion message, error, or file. Every helper below that could
 *      plausibly stringify a value it touches is written to avoid ever
 *      doing so with the connection string or key.
 *   5. No .env/.env.local file is read, created, or modified anywhere in
 *      this file.
 *
 * This test never touches Storage — finalize_quote_upload_v2 itself never
 * reads or writes storage.objects (confirmed directly in its own SQL), so
 * there is nothing to upload or clean up here; only `npx supabase db reset`
 * is needed for full cleanup, in a top-level afterAll that always runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { Client as PgClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

interface LocalSettings {
  apiUrl: string;
  secretKey: string;
  /** Never logged, never embedded in any thrown/assertion message. */
  pgConnectionString: string;
}

function getLocalSettingsOrThrow(): LocalSettings {
  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  } catch {
    throw new Error(
      "Local concurrency safety gate: could not read `npx supabase status -o json`. " +
        "Is the local Supabase stack running (`npx supabase start`)?",
    );
  }

  const jsonStart = raw.indexOf("{");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(jsonStart)) as Record<string, unknown>;
  } catch {
    throw new Error("Local concurrency safety gate: `supabase status -o json` did not return valid JSON.");
  }

  const apiUrl = typeof parsed["API_URL"] === "string" ? parsed["API_URL"] : "";
  const secretKey = typeof parsed["SECRET_KEY"] === "string" ? parsed["SECRET_KEY"] : "";
  const dbUrl = typeof parsed["DB_URL"] === "string" ? parsed["DB_URL"] : "";

  if (!apiUrl || !secretKey || !dbUrl) {
    throw new Error(
      "Local concurrency safety gate: `supabase status -o json` did not report " +
        "API_URL / SECRET_KEY / DB_URL. Is the local stack fully started?",
    );
  }

  const apiHostname = safeHostname(apiUrl, "API_URL");
  const dbHostname = safeHostname(dbUrl, "DB_URL");

  for (const [label, hostname] of [
    ["API_URL", apiHostname],
    ["DB_URL", dbHostname],
  ] as const) {
    if (hostname.endsWith(".supabase.co")) {
      throw new Error(
        `Local concurrency safety gate: refusing to run — ${label}'s host is a hosted *.supabase.co URL.`,
      );
    }
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      throw new Error(
        `Local concurrency safety gate: ${label}'s host must be exactly 'localhost' or '127.0.0.1' — refusing to proceed.`,
      );
    }
  }

  return { apiUrl, secretKey, pgConnectionString: dbUrl };
}

/** Never returns or logs the full URL on failure — only the fact that parsing failed. */
function safeHostname(url: string, label: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(`Local concurrency safety gate: ${label} reported by the local CLI is not a valid URL.`);
  }
}

function resetLocalDatabase(): void {
  execFileSync("npx", ["supabase", "db", "reset"], { cwd: process.cwd(), stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Deterministic fixtures — no binary fixture files, no customer data
// ---------------------------------------------------------------------------

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const DECLARED_BYTE_SIZE = 64;

function buildJpegFixture(pattern: number): Uint8Array {
  const bytes = new Uint8Array(DECLARED_BYTE_SIZE);
  bytes.set(JPEG_SIGNATURE, 0);
  for (let i = JPEG_SIGNATURE.length; i < DECLARED_BYTE_SIZE; i += 1) {
    bytes[i] = (i + pattern) % 256;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validSellerSubmission() {
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
    sellerName: "Concurrency Test Seller",
    sellerPhone: "+971501234567",
    sellerPreferredContact: "whatsapp",
  };
}

// ---------------------------------------------------------------------------
// Timeout / synchronization helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Deterministic proof, not a sleep: polls a real Postgres fact
 * (pg_blocking_pids) until `waitingPid` is genuinely reported as blocked by
 * `blockingPid`, or throws once the bounded timeout elapses. The interval
 * between polls is not itself the proof — the observed database fact is.
 */
async function waitUntilBlockedBy(
  observer: PgClient,
  waitingPid: number,
  blockingPid: number,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const result = await observer.query<{ blockers: number[] }>(
      "select pg_blocking_pids($1::int) as blockers",
      [waitingPid],
    );
    const blockers = result.rows[0]?.blockers ?? [];
    if (blockers.includes(blockingPid)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitUntilBlockedBy: timed out after ${options.timeoutMs}ms — pid ${waitingPid} was never ` +
          `reported blocked by pid ${blockingPid} (last observed blockers: ${JSON.stringify(blockers)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSettings;
let admin: SupabaseClient;

beforeAll(() => {
  settings = getLocalSettingsOrThrow();
  admin = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  resetLocalDatabase();
}, 120_000);

afterAll(() => {
  // Always runs, even if a test above failed or left something behind —
  // no local test rows may remain afterward. Nothing in this file ever
  // writes to Storage, so no Storage cleanup step is needed here.
  resetLocalDatabase();
}, 120_000);

// ---------------------------------------------------------------------------
// Arrange: one lead, two declared slots, both actively claimed (uploading)
// ---------------------------------------------------------------------------

interface ClaimedSlot {
  slotId: string;
  attemptId: string;
}

async function arrangeLeadWithTwoClaimedSlots(idempotencyKey: string): Promise<{
  leadId: string;
  slots: [ClaimedSlot, ClaimedSlot];
}> {
  const initiate = await admin.rpc("create_website_quote_v1", {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: await sha256Hex(new TextEncoder().encode(idempotencyKey)),
    p_submission: validSellerSubmission(),
    p_files: [
      { original_filename: "a.jpg", declared_mime_type: "image/jpeg", declared_byte_size: DECLARED_BYTE_SIZE },
      { original_filename: "b.jpg", declared_mime_type: "image/jpeg", declared_byte_size: DECLARED_BYTE_SIZE },
    ],
  });
  if (initiate.error) throw new Error(`create_website_quote_v1 failed: ${initiate.error.message}`);
  const leadId = (initiate.data as { lead_id: string }).lead_id;
  const uploadSlots = (initiate.data as { upload_slots: { slot_id: string; slot_index: number }[] }).upload_slots;
  const slotIdByIndex = new Map(uploadSlots.map((s) => [s.slot_index, s.slot_id]));

  const claimed: ClaimedSlot[] = [];
  for (const index of [0, 1] as const) {
    const slotId = slotIdByIndex.get(index);
    if (!slotId) throw new Error(`arrangeLeadWithTwoClaimedSlots: missing slot at index ${index}`);
    const claim = await admin.rpc("claim_quote_upload_v1", {
      p_slot_id: slotId,
      p_idempotency_key: idempotencyKey,
    });
    if (claim.error) throw new Error(`claim_quote_upload_v1 failed: ${claim.error.message}`);
    const attemptId = (claim.data as { attempt_id: string }).attempt_id;
    claimed.push({ slotId, attemptId });
  }

  return { leadId, slots: [claimed[0]!, claimed[1]!] };
}

// ---------------------------------------------------------------------------
// The two-session scenario itself
// ---------------------------------------------------------------------------

interface ScenarioResult {
  leadId: string;
  idempotencyKey: string;
}

/**
 * `holderFirstIndex` selects which of the two slots' finalize call goes
 * FIRST (opens its transaction, finalizes, then holds the parent-lead lock
 * without committing) versus SECOND (opens its own transaction and blocks
 * on the first). Running this once with each value proves the outcome is
 * correct regardless of which physical transaction "wins" the race.
 */
async function runLastSlotConcurrencyScenario(holderFirstIndex: 0 | 1): Promise<ScenarioResult> {
  const idempotencyKey = crypto.randomUUID();
  const { leadId, slots } = await arrangeLeadWithTwoClaimedSlots(idempotencyKey);
  const holderSlot = slots[holderFirstIndex];
  const blockedSlot = slots[holderFirstIndex === 0 ? 1 : 0];

  const holderChecksum = await sha256Hex(buildJpegFixture(holderFirstIndex));
  const blockedChecksum = await sha256Hex(buildJpegFixture(holderFirstIndex === 0 ? 1 : 0));

  const holderClient = new PgClient({ connectionString: settings.pgConnectionString });
  const blockedClient = new PgClient({ connectionString: settings.pgConnectionString });
  const observerClient = new PgClient({ connectionString: settings.pgConnectionString });

  let holderInTransaction = false;
  let blockedInTransaction = false;

  try {
    await holderClient.connect();
    await blockedClient.connect();
    await observerClient.connect();

    const holderPid = holderClient.processID;
    const blockedPid = blockedClient.processID;
    if (!holderPid || !blockedPid) {
      throw new Error("runLastSlotConcurrencyScenario: could not determine backend PIDs");
    }

    // T1 (holder): finalize its slot and deliberately do not commit yet —
    // it still holds the parent-lead row lock the completion trigger
    // acquired inside this same, still-open transaction.
    await holderClient.query("begin");
    holderInTransaction = true;
    await withTimeout(
      holderClient.query(
        "select public.finalize_quote_upload_v2($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::text)",
        [holderSlot.slotId, idempotencyKey, holderSlot.attemptId, "image/jpeg", DECLARED_BYTE_SIZE, holderChecksum],
      ),
      10_000,
      "holder transaction's finalize_quote_upload_v2 call",
    );

    // T2 (blocked): starts its own transaction and issues its finalize call
    // WITHOUT awaiting it yet — this call's own UPDATE fires the
    // quote_upload_slots_sync_lead_status trigger, which locks the SAME
    // parent lead row T1 is still holding, so this query will not resolve
    // until T1 commits.
    await blockedClient.query("begin");
    blockedInTransaction = true;
    const blockedQueryPromise = blockedClient.query(
      "select public.finalize_quote_upload_v2($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bigint, $6::text)",
      [blockedSlot.slotId, idempotencyKey, blockedSlot.attemptId, "image/jpeg", DECLARED_BYTE_SIZE, blockedChecksum],
    );

    // Deterministic proof T2 is genuinely blocked BY T1 specifically — not
    // merely "still running" for some unrelated reason.
    await waitUntilBlockedBy(observerClient, blockedPid, holderPid, { timeoutMs: 8_000, intervalMs: 25 });

    // Now release T1 — this is what should unblock T2.
    await holderClient.query("commit");
    holderInTransaction = false;

    // T2 must now complete within a bounded timeout.
    await withTimeout(blockedQueryPromise, 10_000, "blocked transaction's finalize_quote_upload_v2 to unblock and succeed");
    await blockedClient.query("commit");
    blockedInTransaction = false;
  } finally {
    if (holderInTransaction) {
      await holderClient.query("rollback").catch(() => undefined);
    }
    if (blockedInTransaction) {
      await blockedClient.query("rollback").catch(() => undefined);
    }
    await holderClient.end().catch(() => undefined);
    await blockedClient.end().catch(() => undefined);
    await observerClient.end().catch(() => undefined);
  }

  return { leadId, idempotencyKey };
}

async function assertLeadFullyCompleted(leadId: string): Promise<void> {
  const slots = await admin
    .from("quote_upload_slots")
    .select("status")
    .eq("lead_id", leadId);
  expect(slots.data).toHaveLength(2);
  expect(slots.data?.every((s) => s.status === "verified")).toBe(true);

  const files = await admin.from("lead_files").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
  expect(files.count).toBe(2);

  const lead = await admin
    .from("leads")
    .select("file_upload_status, submission_completed_at, status")
    .eq("id", leadId)
    .single();
  expect(lead.data?.file_upload_status).toBe("complete");
  expect(lead.data?.submission_completed_at).not.toBeNull();
  expect(lead.data?.status).toBe("new");

  const activities = await admin
    .from("lead_activities")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("event_type", "submission_completed");
  expect(activities.count).toBe(1);

  const notifications = await admin
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("event_type", "submission_completed")
    .eq("channel", "email");
  expect(notifications.count).toBe(1);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CHECKPOINT C2D-B — two-session concurrent finalization of the last two slots", () => {
  it("T1 holds the lock first, T2 blocks and then wins the completion race after T1 commits", async () => {
    const { leadId } = await runLastSlotConcurrencyScenario(0);
    await assertLeadFullyCompleted(leadId);
  }, 30_000);

  it("roles reversed — T2 (now first) holds the lock, T1 (now second) blocks and wins — either transaction may complete the lead", async () => {
    const { leadId } = await runLastSlotConcurrencyScenario(1);
    await assertLeadFullyCompleted(leadId);
  }, 30_000);

  it("complete_website_quote_v1 reconciliation replay after a concurrency-driven completion reports already_completed=true with no new side effects", async () => {
    const { leadId, idempotencyKey } = await runLastSlotConcurrencyScenario(0);
    await assertLeadFullyCompleted(leadId);

    const before = await Promise.all([
      admin.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
      admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    ]);

    const reconciliation = await admin.rpc("complete_website_quote_v1", {
      p_lead_id: leadId,
      p_idempotency_key: idempotencyKey,
    });
    expect(reconciliation.error).toBeNull();
    expect((reconciliation.data as { already_completed: boolean }).already_completed).toBe(true);

    const after = await Promise.all([
      admin.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
      admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("lead_id", leadId),
    ]);
    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
  }, 30_000);
});
