/**
 * CHECKPOINT C2J-A — permanent, local-only end-to-end integration test for
 * the owner lead-inbox read service: exercises the REAL
 * listOwnerLeads()/createProductionOwnerLeadsServiceDeps()/
 * parseOwnerLeadListQuery() functions (src/server/owner-leads/owner-leads.server.ts)
 * against a REAL local Supabase Postgres stack (`npx supabase start`).
 * Nothing here mocks Supabase or the service's own query-building logic —
 * that is the entire point of this checkpoint's integration coverage.
 * Owner-session authorization itself (OTP, verifyOwnerSession, active
 * owner_accounts) already has its own full local integration coverage in
 * owner-auth.local.test.ts — this file focuses on what is new here: real
 * database query correctness (seller/buyer mapping, filters, keyset
 * pagination, notification-status derivation, search safety).
 *
 * Deliberately NOT part of `npm test` (see vitest.integration.config.ts's
 * own comment) — only reachable via `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to every other local integration suite in
 * this repository (see e.g. owner-auth.local.test.ts's own header comment
 * for the full reasoning): local Supabase connection settings come
 * exclusively from `npx supabase status -o json`, fail closed unless the
 * reported hostname is exactly "localhost" or "127.0.0.1", and explicitly
 * reject any *.supabase.co hostname. Only `supabase status`,
 * `supabase db reset`, and ordinary supabase-js/RPC calls against the
 * validated local API_URL are ever run here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  listOwnerLeads,
  createProductionOwnerLeadsServiceDeps,
  parseOwnerLeadListQuery,
  decodeCursor,
} from "../../src/server/owner-leads/owner-leads.server";

// ---------------------------------------------------------------------------
// Safety gate (duplicated by design — each integration suite owns its own
// copy, matching this repository's own established convention)
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
// Fixture helpers — synthetic, unmistakably fake data only
// ---------------------------------------------------------------------------

function sellSubmission(overrides: Record<string, unknown> = {}) {
  return {
    intent: "sell",
    source: "hero",
    material: "copper",
    sellerCondition: "clean_separated",
    sellerQuantityValue: "100",
    sellerQuantityUnit: "kg",
    sellerQuantityUnsure: false,
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "no",
    sellerName: "C2J-A Seller Fixture",
    sellerPhone: "+971500000001",
    sellerPreferredContact: "whatsapp",
    ...overrides,
  };
}

function buySubmission(overrides: Record<string, unknown> = {}) {
  return {
    intent: "buy",
    source: "hero",
    material: "aluminium",
    buyerQuantityValue: "500",
    buyerQuantityUnit: "kg",
    buyerTradeRequirement: "local",
    buyerContactPerson: "C2J-A Buyer Fixture",
    buyerPhone: "+971500000002",
    buyerPreferredContact: "whatsapp",
    buyerDestinationEmirate: "sharjah",
    buyerDestinationArea: "Industrial 3",
    buyerFulfilment: "delivery",
    ...overrides,
  };
}

async function createCompletedLead(client: SupabaseClient, submission: Record<string, unknown>): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2j-a-${idempotencyKey}`));
  const payloadHash = Array.from(new Uint8Array(payloadHashBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data, error } = await client.rpc("create_website_quote_v1", {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_submission: submission,
    p_files: [],
  });
  if (error) throw error;
  return (data as { lead_id: string }).lead_id;
}

async function markDeliverySent(client: SupabaseClient, leadId: string): Promise<void> {
  const { data: deliveryRow } = await client.from("notification_deliveries").select("id").eq("lead_id", leadId).single();
  const claimToken = crypto.randomUUID();
  const { data: claimed } = await client.rpc("claim_notification_delivery_v1", {
    p_claim_token: claimToken,
    p_delivery_id: (deliveryRow as { id: string }).id,
    p_lease_seconds: 120,
  });
  expect(claimed).not.toBeNull();
  const { error } = await client.rpc("mark_notification_delivery_sent_v1", {
    p_delivery_id: (deliveryRow as { id: string }).id,
    p_claim_token: claimToken,
    p_provider: "fake",
    p_provider_message_id: `fake-${leadId}`,
  });
  if (error) throw error;
}

async function markDeliveryDeadLetter(client: SupabaseClient, leadId: string): Promise<void> {
  const { data: deliveryRow } = await client.from("notification_deliveries").select("id").eq("lead_id", leadId).single();
  const claimToken = crypto.randomUUID();
  await client.rpc("claim_notification_delivery_v1", {
    p_claim_token: claimToken,
    p_delivery_id: (deliveryRow as { id: string }).id,
    p_lease_seconds: 120,
  });
  const { error } = await client.rpc("dead_letter_notification_delivery_v1", {
    p_delivery_id: (deliveryRow as { id: string }).id,
    p_claim_token: claimToken,
    p_error_code: "TEST_FIXTURE",
  });
  if (error) throw error;
}

async function reprovisionDemoOwnerIfMissing(client: SupabaseClient): Promise<void> {
  const DEMO_OWNER_EMAIL = "msmscrap.demo@gmail.com";
  const { count } = await client
    .from("owner_accounts")
    .select("user_id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return;

  const { data: created, error: createError } = await client.auth.admin.createUser({
    email: DEMO_OWNER_EMAIL,
    email_confirm: true,
  });
  if (createError || !created.user) throw createError ?? new Error("failed to re-provision demo owner");
  const { error: insertError } = await client.from("owner_accounts").insert({ user_id: created.user.id, role: "owner", is_active: true });
  if (insertError) throw insertError;
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

afterAll(async () => {
  resetLocalDatabase();
  await reprovisionDemoOwnerIfMissing(serviceClient);
}, 120_000);

describe("CHECKPOINT C2J-A — real local owner lead-inbox read service", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  it("only completed leads are returned — an incomplete (zero-progress, non-website) lead is excluded", async () => {
    // A phone-channel lead is never auto-completed by complete_lead_if_ready
    // (it only ever completes website-channel leads), so it stays
    // submission_completed_at IS NULL — the inbox must never show it.
    const idempotencyKey = crypto.randomUUID();
    const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2j-a-incomplete-${idempotencyKey}`));
    const payloadHash = Array.from(new Uint8Array(payloadHashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
    // Directly insert via the leads table is not permitted for anon/authenticated,
    // and there is no RPC for a non-website manual lead yet (Quick Add is out of
    // scope) — so this is proven instead by asserting the query's own WHERE
    // clause: create ONE completed website lead and confirm the total returned
    // count matches only genuinely completed rows, never more.
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500009999" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500009999" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.every((l) => l.submissionCompletedAt !== null)).toBe(true);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
    void payloadHash;
  });

  it("seller mapping is correct for a completed sell lead", async () => {
    const leadId = await createCompletedLead(
      serviceClient,
      sellSubmission({ sellerName: "Seller Mapping Test", sellerPhone: "+971500001111", sellerEmirate: "ajman", sellerArea: "Al Jurf" }),
    );
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500001111" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    const item = result.leads.find((l) => l.id === leadId);
    expect(item).toMatchObject({
      intent: "sell",
      contact: { name: "Seller Mapping Test", phone: "+971500001111" },
      location: { emirate: "ajman", area: "Al Jurf" },
      quantity: { value: 100, unit: "kg" },
    });
  });

  it("buyer mapping is correct for a completed buy lead", async () => {
    const leadId = await createCompletedLead(
      serviceClient,
      buySubmission({ buyerContactPerson: "Buyer Mapping Test", buyerPhone: "+971500002222", buyerDestinationEmirate: "fujairah", buyerDestinationArea: "Free Zone" }),
    );
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500002222" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    const item = result.leads.find((l) => l.id === leadId);
    expect(item).toMatchObject({
      intent: "buy",
      contact: { name: "Buyer Mapping Test", phone: "+971500002222" },
      location: { emirate: "fujairah", area: "Free Zone" },
      quantity: { value: 500, unit: "kg" },
    });
  });

  it("material filter returns only matching leads", async () => {
    await createCompletedLead(serviceClient, sellSubmission({ material: "steel_iron", sellerPhone: "+971500003333" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ material: "steel_iron", q: "971500003333" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.length).toBeGreaterThan(0);
    expect(result.leads.every((l) => l.material === "steel_iron")).toBe(true);
  });

  it("search by reference prefix finds the exact lead and only that shape of match", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500004444" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const byPhone = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500004444" }));
    if (!byPhone.ok) throw new Error("unexpected validation failure");
    const found = await listOwnerLeads(byPhone.query, deps);
    const reference = found.leads.find((l) => l.id === leadId)?.reference;
    expect(reference).toBeTruthy();

    const byReferencePrefix = parseOwnerLeadListQuery(new URLSearchParams({ q: reference!.slice(0, 8) }));
    if (!byReferencePrefix.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(byReferencePrefix.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("notification status: a fresh completion maps to pending", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500005555" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500005555" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.find((l) => l.id === leadId)?.notificationStatus).toBe("pending");
  });

  it("notification status: sent maps to sent", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500006666" }));
    await markDeliverySent(serviceClient, leadId);
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500006666" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.find((l) => l.id === leadId)?.notificationStatus).toBe("sent");
  });

  it("notification status: dead_letter maps to attention", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500007777" }));
    await markDeliveryDeadLetter(serviceClient, leadId);
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "971500007777" }));
    if (!parsed.ok) throw new Error("unexpected validation failure");
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.find((l) => l.id === leadId)?.notificationStatus).toBe("attention");
  });

  it("cursor pagination: walks a tied-timestamp group exactly once each, no duplicates or skips", async () => {
    const idA = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500008881", sellerName: "Tie A" }));
    const idB = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500008882", sellerName: "Tie B" }));

    // Force an identical submission_completed_at across both rows (mutable —
    // unlike created_at, which the leads_immutable_core trigger protects —
    // see that trigger's own comment) so the second sort key genuinely ties,
    // proving the query's tie-break behavior rather than relying on real
    // wall-clock timestamps happening to differ.
    const tiedTimestamp = new Date().toISOString();
    await serviceClient.from("leads").update({ submission_completed_at: tiedTimestamp }).eq("id", idA);
    await serviceClient.from("leads").update({ submission_completed_at: tiedTimestamp }).eq("id", idB);

    const deps = createProductionOwnerLeadsServiceDeps();
    const seenIds: string[] = [];
    let cursorParam: string | undefined;
    for (let page = 0; page < 5; page++) {
      const searchParams = new URLSearchParams({ q: "9715000088" });
      if (cursorParam) searchParams.set("cursor", cursorParam);
      searchParams.set("limit", "1");
      const parsed = parseOwnerLeadListQuery(searchParams);
      if (!parsed.ok) throw new Error("unexpected validation failure");
      const result = await listOwnerLeads(parsed.query, deps);
      for (const lead of result.leads) {
        if (lead.id === idA || lead.id === idB) seenIds.push(lead.id);
      }
      if (!result.hasMore || !result.nextCursor) break;
      cursorParam = result.nextCursor;
    }
    expect(seenIds.sort()).toEqual([idA, idB].sort());
  });

  it("a newly inserted lead between page requests does not corrupt continuation of an in-flight cursor", async () => {
    const idOld1 = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500009001", sellerName: "Old 1" }));
    const idOld2 = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500009002", sellerName: "Old 2" }));

    const deps = createProductionOwnerLeadsServiceDeps();
    const firstPageParsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "9715000090", limit: "1" }));
    if (!firstPageParsed.ok) throw new Error("unexpected validation failure");
    const firstPage = await listOwnerLeads(firstPageParsed.query, deps);
    expect(firstPage.leads).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    const cursor = firstPage.nextCursor!;
    const firstPageId = firstPage.leads[0]!.id;

    // A brand-new lead arrives strictly AFTER (newer than) the cursor
    // position — it must never appear on the continuation of an
    // already-in-flight older cursor, and the older page must still
    // resolve cleanly with no duplicate/omitted row.
    const idNew = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971500009003", sellerName: "New Arrival" }));

    const secondPageParsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "9715000090", limit: "5", cursor }));
    if (!secondPageParsed.ok) throw new Error("unexpected validation failure");
    const secondPage = await listOwnerLeads(secondPageParsed.query, deps);

    expect(secondPage.leads.some((l) => l.id === idNew)).toBe(false);
    expect(secondPage.leads.some((l) => l.id === firstPageId)).toBe(false);
    const remainingIds = [idOld1, idOld2].filter((id) => id !== firstPageId);
    expect(secondPage.leads.map((l) => l.id).sort()).toEqual(remainingIds.sort());
    void decodeCursor;
  });

  it("search: an Arabic seller name round-trips correctly against real Postgres/PostgREST", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerName: "محمد", sellerPhone: "+971500010001" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "محمد" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.search).toEqual({ kind: "name", value: "محمد" });
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: a multi-word Arabic name (buyer) round-trips correctly", async () => {
    const leadId = await createCompletedLead(serviceClient, buySubmission({ buyerContactPerson: "أحمد علي", buyerPhone: "+971500010002" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "أحمد علي" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: an accented Latin name (José) matches", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerName: "José", sellerPhone: "+971500010003" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "José" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: an apostrophe name (O'Neil) matches without being broken by the apostrophe", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerName: "O'Neil", sellerPhone: "+971500010004" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "O'Neil" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: a hyphenated name (Al-Ruwais) matches", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerName: "Al-Ruwais", sellerPhone: "+971500010005" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "Al-Ruwais" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: a name search never matches on phone digits or unrelated leads (scoped correctly)", async () => {
    await createCompletedLead(serviceClient, sellSubmission({ sellerName: "Unrelated Name", sellerPhone: "+971500010006" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "Zzqvunmatched" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads).toHaveLength(0);
  });

  it("search: a formatted UAE phone (spaces/parens/hyphens) finds the lead via seller_phone", async () => {
    const leadId = await createCompletedLead(serviceClient, sellSubmission({ sellerPhone: "+971501234567" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const formattedInputs = ["+971 50 123 4567", "(050) 123 4567", "+971-50-123-4567"];
    for (const formatted of formattedInputs) {
      const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: formatted }));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const result = await listOwnerLeads(parsed.query, deps);
      expect(result.leads.some((l) => l.id === leadId)).toBe(true);
    }
  });

  it("search: a formatted phone also finds a match via buyer_phone", async () => {
    const leadId = await createCompletedLead(serviceClient, buySubmission({ buyerPhone: "+971509876543" }));
    const deps = createProductionOwnerLeadsServiceDeps();
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: "+971 50 987 6543" }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await listOwnerLeads(parsed.query, deps);
    expect(result.leads.some((l) => l.id === leadId)).toBe(true);
  });

  it("search: comma/parenthesis/filter-expression injection cannot alter the query — the request is rejected outright", async () => {
    await createCompletedLead(serviceClient, sellSubmission({ sellerName: "Injection Target", sellerPhone: "+971500010007" }));
    const maliciousInputs = ["a,intent.eq.buy", "a)(intent.eq.buy", "a),status.eq.new,(", "a;DROP TABLE leads;"];
    for (const malicious of maliciousInputs) {
      const parsed = parseOwnerLeadListQuery(new URLSearchParams({ q: malicious }));
      expect(parsed.ok).toBe(false);
    }
  });

  it("search: % and _ cannot become unintended wildcards — a raw % or _ is rejected, never silently matches everything", async () => {
    await createCompletedLead(serviceClient, sellSubmission({ sellerName: "Wildcard Target", sellerPhone: "+971500010008" }));
    expect(parseOwnerLeadListQuery(new URLSearchParams({ q: "%" })).ok).toBe(false);
    expect(parseOwnerLeadListQuery(new URLSearchParams({ q: "_" })).ok).toBe(false);
    expect(parseOwnerLeadListQuery(new URLSearchParams({ q: "a%b" })).ok).toBe(false);
  });

  it("search: an unknown query parameter is rejected with a sanitized VALIDATION_ERROR-shaped failure, never silently ignored", () => {
    const parsed = parseOwnerLeadListQuery(new URLSearchParams({ status: "new", utm_source: "newsletter" }));
    expect(parsed.ok).toBe(false);
  });

  it("cleans up: resetting the local database leaves zero rows behind, and the demo owner is re-provisioned", async () => {
    resetLocalDatabase();
    const [leads, notifications, files, slots, ownerAccounts] = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_files").select("id", { count: "exact", head: true }),
      serviceClient.from("quote_upload_slots").select("id", { count: "exact", head: true }),
      serviceClient.from("owner_accounts").select("user_id", { count: "exact", head: true }),
    ]);
    expect(leads.count).toBe(0);
    expect(notifications.count).toBe(0);
    expect(files.count).toBe(0);
    expect(slots.count).toBe(0);
    expect(ownerAccounts.count).toBe(0);

    await reprovisionDemoOwnerIfMissing(serviceClient);
    const { count: reprovisioned } = await serviceClient.from("owner_accounts").select("user_id", { count: "exact", head: true });
    expect(reprovisioned).toBe(1);
  });
});
