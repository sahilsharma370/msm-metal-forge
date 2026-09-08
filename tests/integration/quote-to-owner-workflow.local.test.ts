/**
 * CHECKPOINT C2N — real local end-to-end integration coverage for the gap
 * between two already-proven halves of the Quote workflow:
 *   - quote-pipeline.local.test.ts proves public submission through Storage
 *     upload/finalize (seller + one photo, real handlers, real Postgres).
 *   - owner-lead-list.local.test.ts / owner-lead-detail.local.test.ts prove
 *     the owner read services against leads seeded directly via
 *     create_website_quote_v1 (not the full public HTTP request chain).
 * Neither proves: a Buyer submission through the real public HTTP handlers;
 * field-level correctness (material/quantity/condition/logistics/contact)
 * read back through the real Owner detail route; initiate-layer idempotent
 * replay/conflict against real Postgres; the Turnstile/malformed-payload
 * public boundary creating zero rows through the real handler; or the Owner
 * Overview aggregate against any real data at all (zero prior coverage).
 * This file adds exactly those, and nothing already proven elsewhere.
 *
 * Deliberately NOT part of `npm test` — only reachable via
 * `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to every other local integration suite in
 * this repository: local Supabase connection settings come exclusively from
 * `npx supabase status -o json`, fail closed unless the reported hostname is
 * exactly "localhost" or "127.0.0.1", and explicitly reject any
 * *.supabase.co hostname.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// CHECKPOINT C2G — same posture as quote-pipeline.local.test.ts's own
// comment: this file's point is Postgres correctness through the REAL
// route handlers, not abuse-protection behavior (that has its own
// exhaustive DI-based unit coverage). The real handlers unconditionally
// construct a real Cloudflare rate-limiter binding, which does not exist in
// this plain local Node process — always mocked to allow. Turnstile is
// mocked too, but via a mutable flag (turnstileState) so ONE test in this
// file can flip it to fail-closed and prove the real handler + real DB
// react correctly — every other test leaves it at its default true.
// ---------------------------------------------------------------------------
const turnstileState: { ok: boolean } = { ok: true };

vi.mock("../../src/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => ({ limit: async () => ({ success: true }) }),
  };
});

vi.mock("../../src/server/turnstile.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/turnstile.server")>();
  return {
    ...actual,
    getTurnstileVerifier: () => ({
      verify: async () => (turnstileState.ok ? { ok: true } : { ok: false, reason: "invalid_or_expired_token" }),
    }),
  };
});

const CF_CONNECTING_IP_HEADER = { "cf-connecting-ip": "203.0.113.20" };
const INTEGRATION_TURNSTILE_TOKEN = "integration-test-turnstile-token";

// ---------------------------------------------------------------------------
// Safety gate (duplicated by design — matches this repository's own
// established convention)
// ---------------------------------------------------------------------------

interface LocalSupabaseSettings {
  apiUrl: string;
  anonKey: string;
  secretKey: string;
}

function getLocalSupabaseSettingsOrThrow(): LocalSupabaseSettings {
  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: process.cwd(), encoding: "utf8" });
  } catch {
    throw new Error("Local integration safety gate: could not read `npx supabase status -o json`. Is the local Supabase stack running?");
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
    throw new Error("Local integration safety gate: `supabase status -o json` did not report API_URL/PUBLISHABLE_KEY/SECRET_KEY.");
  }
  let hostname: string;
  try {
    hostname = new URL(apiUrl).hostname;
  } catch {
    throw new Error("Local integration safety gate: API_URL reported by the local CLI is not a valid URL.");
  }
  if (hostname.endsWith(".supabase.co")) {
    throw new Error("Local integration safety gate: refusing to run against a hosted *.supabase.co URL.");
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error("Local integration safety gate: SUPABASE_URL hostname must be exactly 'localhost' or '127.0.0.1'.");
  }
  return { apiUrl, anonKey, secretKey };
}

function resetLocalDatabase(): void {
  execFileSync("npx", ["supabase", "db", "reset"], { cwd: process.cwd(), stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validSellerSubmission(overrides: Record<string, unknown> = {}) {
  return {
    intent: "sell",
    source: "hero",
    material: "copper",
    sellerCondition: "clean_separated",
    sellerQuantityValue: "120",
    sellerQuantityUnit: "kg",
    sellerQuantityUnsure: false,
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "yes",
    sellerName: "C2N Seller Fixture",
    sellerPhone: "+971501234567",
    sellerPreferredContact: "whatsapp",
    ...overrides,
  };
}

function validBuyerSubmission(overrides: Record<string, unknown> = {}) {
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
    buyerContactPerson: "C2N Buyer Fixture",
    buyerPhone: "+971502345678",
    buyerPreferredContact: "whatsapp",
    ...overrides,
  };
}

function initiateRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.test/api/quote/initiate", {
    method: "POST",
    headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
    body: JSON.stringify(body),
  });
}

async function mintOwner(serviceClient: SupabaseClient): Promise<{ accessToken: string }> {
  const { handleOwnerLoginVerifyCodeBody, getOwnerLoginAuthClient } = await import("../../src/server/owner-auth/owner-login.server");
  const email = `owner-c2n-${crypto.randomUUID()}@example.test`;
  const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !createdUser.user) throw createError ?? new Error("failed to create synthetic owner user");
  const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: createdUser.user.id });
  if (insertError) throw insertError;
  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;
  const otp = (linkData.properties as { email_otp?: string } | undefined)?.email_otp;
  if (!otp) throw new Error("Local integration test: generateLink did not return an email_otp.");
  const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email, code: otp }), { auth: getOwnerLoginAuthClient() });
  if (result.status !== 200 || !result.body.ok) throw new Error(`verify-code did not succeed (status ${result.status})`);
  return { accessToken: result.body.session.accessToken };
}

async function reprovisionDemoOwnerIfMissing(client: SupabaseClient): Promise<void> {
  const DEMO_OWNER_EMAIL = "msmscrap.demo@gmail.com";
  const { count } = await client.from("owner_accounts").select("user_id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return;
  const { data: created, error: createError } = await client.auth.admin.createUser({ email: DEMO_OWNER_EMAIL, email_confirm: true });
  if (createError || !created.user) throw createError ?? new Error("failed to re-provision demo owner");
  const { error: insertError } = await client.from("owner_accounts").insert({ user_id: created.user.id, role: "owner", is_active: true });
  if (insertError) throw insertError;
}

function ownerGetRequest(path: string, accessToken: string): Request {
  return new Request(`https://example.test${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSupabaseSettings;
let serviceClient: SupabaseClient;
let ownerAccessToken: string;

let sellerLeadId: string;
let sellerReference: string;
let buyerLeadId: string;
let buyerReference: string;

beforeAll(async () => {
  settings = getLocalSupabaseSettingsOrThrow();
  process.env["SUPABASE_URL"] = settings.apiUrl;
  process.env["SUPABASE_SECRET_KEY"] = settings.secretKey;

  serviceClient = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  resetLocalDatabase();
  ownerAccessToken = (await mintOwner(serviceClient)).accessToken;
}, 120_000);

afterAll(async () => {
  resetLocalDatabase();
  await reprovisionDemoOwnerIfMissing(serviceClient);
}, 120_000);

describe("CHECKPOINT C2N — public Quote -> Owner visibility, real Postgres + real HTTP handlers", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A — Seller, no photo: field correctness + exactly one initial activity
  // -------------------------------------------------------------------------

  it("a valid no-photo Seller submission creates exactly one durable lead with correct fields, a reference, and exactly one initial activity", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const idempotencyKey = crypto.randomUUID();
    const response = await handleQuoteInitiateRequest(
      initiateRequest({
        idempotencyKey,
        submission: validSellerSubmission(),
        files: [],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);
    expect(body.data.idempotentReplay).toBe(false);
    expect(body.data.uploadSlots).toHaveLength(0);

    sellerLeadId = body.data.leadId;
    sellerReference = body.data.reference;

    // Exactly one initial activity (lead_created); the zero-file path also
    // auto-completes (submission_completed), which is a separate, expected
    // second activity — not part of "initial".
    const initialActivityCount = await serviceClient
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", sellerLeadId)
      .eq("event_type", "lead_created");
    expect(initialActivityCount.count).toBe(1);

    // Raw-column proof of no buyer-branch leakage into a seller submission.
    const row = await serviceClient
      .from("leads")
      .select(
        "intent, capture_channel, source, material, seller_condition, seller_quantity_value, seller_quantity_unit, seller_pickup_required, seller_name, seller_phone, buyer_quantity_value, buyer_trade_requirement, buyer_contact_person, buyer_phone",
      )
      .eq("id", sellerLeadId)
      .single();
    expect(row.data?.intent).toBe("sell");
    expect(row.data?.capture_channel).toBe("website");
    expect(row.data?.source).toBe("hero");
    expect(row.data?.material).toBe("copper");
    expect(row.data?.seller_condition).toBe("clean_separated");
    expect(Number(row.data?.seller_quantity_value)).toBe(120);
    expect(row.data?.seller_quantity_unit).toBe("kg");
    expect(row.data?.seller_pickup_required).toBe("yes");
    expect(row.data?.seller_name).toBe("C2N Seller Fixture");
    expect(row.data?.seller_phone).toBe("+971501234567");
    expect(row.data?.buyer_quantity_value).toBeNull();
    expect(row.data?.buyer_trade_requirement).toBeNull();
    expect(row.data?.buyer_contact_person).toBeNull();
    expect(row.data?.buyer_phone).toBeNull();
  });

  // -------------------------------------------------------------------------
  // B — Buyer, no photo: field correctness + no seller leakage
  // -------------------------------------------------------------------------

  it("a valid Buyer submission creates exactly one durable lead with correct buyer fields, a reference, no seller-branch leakage, and exactly one initial activity", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const idempotencyKey = crypto.randomUUID();
    const response = await handleQuoteInitiateRequest(
      initiateRequest({
        idempotencyKey,
        submission: validBuyerSubmission(),
        files: [],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);
    expect(body.data.uploadSlots).toHaveLength(0);

    buyerLeadId = body.data.leadId;
    buyerReference = body.data.reference;

    const initialActivityCount = await serviceClient
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", buyerLeadId)
      .eq("event_type", "lead_created");
    expect(initialActivityCount.count).toBe(1);

    const row = await serviceClient
      .from("leads")
      .select(
        "intent, capture_channel, source, material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement, buyer_destination_emirate, buyer_fulfilment, buyer_contact_person, buyer_phone, seller_condition, seller_quantity_value, seller_name, seller_phone",
      )
      .eq("id", buyerLeadId)
      .single();
    expect(row.data?.intent).toBe("buy");
    expect(row.data?.capture_channel).toBe("website");
    expect(row.data?.source).toBe("materials");
    expect(row.data?.material).toBe("aluminium");
    expect(Number(row.data?.buyer_quantity_value)).toBe(500);
    expect(row.data?.buyer_quantity_unit).toBe("kg");
    expect(row.data?.buyer_trade_requirement).toBe("local");
    expect(row.data?.buyer_destination_emirate).toBe("sharjah");
    expect(row.data?.buyer_fulfilment).toBe("delivery");
    expect(row.data?.buyer_contact_person).toBe("C2N Buyer Fixture");
    expect(row.data?.buyer_phone).toBe("+971502345678");
    expect(row.data?.seller_condition).toBeNull();
    expect(row.data?.seller_quantity_value).toBeNull();
    expect(row.data?.seller_name).toBeNull();
    expect(row.data?.seller_phone).toBeNull();
  });

  // -------------------------------------------------------------------------
  // C — Idempotency and consistency at the initiate layer (real Postgres)
  // -------------------------------------------------------------------------

  it("replays an exact retry of the Seller's completed request idempotently — no duplicate lead or activity, same reference", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const before = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", sellerLeadId),
    ]);

    // The exact same idempotencyKey used to create sellerLeadId above — this
    // requires threading it back through, so retrieve it via a second local
    // variable captured at creation time instead of a fresh randomUUID().
    const row = await serviceClient.from("leads").select("idempotency_key").eq("id", sellerLeadId).single();
    const idempotencyKey = row.data!.idempotency_key as string;

    const response = await handleQuoteInitiateRequest(
      initiateRequest({
        idempotencyKey,
        submission: validSellerSubmission(),
        files: [],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.idempotentReplay).toBe(true);
    expect(body.data.leadId).toBe(sellerLeadId);
    expect(body.data.reference).toBe(sellerReference);

    const after = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", sellerLeadId),
    ]);
    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
  });

  it("rejects reuse of the same idempotency key with a materially different payload, leaving the original lead untouched — no second lead created", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const row = await serviceClient.from("leads").select("idempotency_key").eq("id", sellerLeadId).single();
    const idempotencyKey = row.data!.idempotency_key as string;

    const leadCountBefore = await serviceClient.from("leads").select("id", { count: "exact", head: true });

    const response = await handleQuoteInitiateRequest(
      initiateRequest({
        idempotencyKey,
        submission: validSellerSubmission({ sellerQuantityValue: "999" }),
        files: [],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const leadCountAfter = await serviceClient.from("leads").select("id", { count: "exact", head: true });
    expect(leadCountAfter.count).toBe(leadCountBefore.count);

    const original = await serviceClient.from("leads").select("seller_quantity_value").eq("id", sellerLeadId).single();
    expect(Number(original.data?.seller_quantity_value)).toBe(120);
  });

  // -------------------------------------------------------------------------
  // D — Failure boundaries through the real handler + real Postgres
  // -------------------------------------------------------------------------

  it("fails closed with no partial lead when the Turnstile token is invalid, through the real handler and real database", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const leadCountBefore = await serviceClient.from("leads").select("id", { count: "exact", head: true });

    turnstileState.ok = false;
    try {
      const response = await handleQuoteInitiateRequest(
        initiateRequest({
          idempotencyKey: crypto.randomUUID(),
          submission: validSellerSubmission(),
          files: [],
          turnstileToken: "an-invalid-token",
        }),
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("VERIFICATION_REQUIRED");
    } finally {
      turnstileState.ok = true;
    }

    const leadCountAfter = await serviceClient.from("leads").select("id", { count: "exact", head: true });
    expect(leadCountAfter.count).toBe(leadCountBefore.count);
  });

  it("fails closed with no partial lead when a required field is missing, through the real handler and real database", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    const leadCountBefore = await serviceClient.from("leads").select("id", { count: "exact", head: true });

    const malformedSubmission = validSellerSubmission();
    delete (malformedSubmission as Record<string, unknown>)["sellerCondition"];

    const response = await handleQuoteInitiateRequest(
      initiateRequest({
        idempotencyKey: crypto.randomUUID(),
        submission: malformedSubmission,
        files: [],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const leadCountAfter = await serviceClient.from("leads").select("id", { count: "exact", head: true });
    expect(leadCountAfter.count).toBe(leadCountBefore.count);
  });

  // -------------------------------------------------------------------------
  // E — Owner visibility: real list/detail/Overview routes, real bearer auth
  // -------------------------------------------------------------------------

  it("both the Seller and Buyer leads appear in the real Owner list route with correct intent/material/captureChannel/status/reference", async () => {
    const { handleOwnerLeadListRequest } = await import("../../src/routes/api/owner/leads");
    const response = await handleOwnerLeadListRequest(ownerGetRequest("/api/owner/leads", ownerAccessToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const bySellerId = body.data.leads.find((l: { id: string }) => l.id === sellerLeadId);
    expect(bySellerId).toBeDefined();
    expect(bySellerId.intent).toBe("sell");
    expect(bySellerId.material).toBe("copper");
    expect(bySellerId.captureChannel).toBe("website");
    expect(bySellerId.status).toBe("new");
    expect(bySellerId.reference).toBe(sellerReference);

    const byBuyerId = body.data.leads.find((l: { id: string }) => l.id === buyerLeadId);
    expect(byBuyerId).toBeDefined();
    expect(byBuyerId.intent).toBe("buy");
    expect(byBuyerId.material).toBe("aluminium");
    expect(byBuyerId.captureChannel).toBe("website");
    expect(byBuyerId.status).toBe("new");
    expect(byBuyerId.reference).toBe(buyerReference);
  });

  it("the Seller lead's real Owner detail matches exactly what was submitted, and persists across a refresh (re-fetch)", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");

    const first = await handleOwnerLeadDetailRequest(ownerGetRequest(`/api/owner/leads/${sellerLeadId}`, ownerAccessToken), sellerLeadId);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.lead.intent).toBe("sell");
    expect(firstBody.data.lead.material).toBe("copper");
    expect(firstBody.data.lead.reference).toBe(sellerReference);
    expect(firstBody.data.lead.contact).toEqual({ name: "C2N Seller Fixture", phone: "+971501234567", email: null, company: null });
    expect(firstBody.data.lead.enquiry.condition).toBe("clean_separated");
    expect(firstBody.data.lead.enquiry.quantityValue).toBe(120);
    expect(firstBody.data.lead.enquiry.quantityUnit).toBe("kg");
    expect(firstBody.data.lead.enquiry.pickupRequired).toBe("yes");
    expect(firstBody.data.files).toHaveLength(0);

    // Refresh: an independent second fetch (a fresh Request, matching a
    // real browser reload) must return byte-identical committed values.
    const second = await handleOwnerLeadDetailRequest(ownerGetRequest(`/api/owner/leads/${sellerLeadId}`, ownerAccessToken), sellerLeadId);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
  });

  it("the Buyer lead's real Owner detail matches exactly what was submitted, and persists across a refresh (re-fetch)", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");

    const first = await handleOwnerLeadDetailRequest(ownerGetRequest(`/api/owner/leads/${buyerLeadId}`, ownerAccessToken), buyerLeadId);
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.lead.intent).toBe("buy");
    expect(firstBody.data.lead.material).toBe("aluminium");
    expect(firstBody.data.lead.reference).toBe(buyerReference);
    expect(firstBody.data.lead.contact).toEqual({ name: "C2N Buyer Fixture", phone: "+971502345678", email: null, company: null });
    expect(firstBody.data.lead.enquiry.tradeRequirement).toBe("local");
    expect(firstBody.data.lead.enquiry.fulfilment).toBe("delivery");
    expect(firstBody.data.lead.location.emirate).toBe("sharjah");
    expect(firstBody.data.files).toHaveLength(0);

    const second = await handleOwnerLeadDetailRequest(ownerGetRequest(`/api/owner/leads/${buyerLeadId}`, ownerAccessToken), buyerLeadId);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);
  });

  it("the real Owner Overview route's aggregates include both the Seller and Buyer leads correctly (first-ever real-Postgres proof of this route)", async () => {
    const { handleOwnerLeadOverviewRequest } = await import("../../src/routes/api/owner/leads/overview");
    const response = await handleOwnerLeadOverviewRequest(ownerGetRequest("/api/owner/leads/overview", ownerAccessToken));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    // This suite's own beforeAll resets the database, and every prior test
    // in this file creates exactly the two completed leads under test (the
    // idempotency-conflict/Turnstile/malformed tests above all provably
    // created zero additional rows) — so these are exact counts, not just
    // lower bounds.
    expect(body.data.totals.total).toBe(2);
    expect(body.data.totals.new).toBe(2);
    expect(body.data.totals.completed).toBe(0);
    expect(body.data.byIntent.sell).toBe(1);
    expect(body.data.byIntent.buy).toBe(1);
    expect(body.data.byMaterial.copper).toBe(1);
    expect(body.data.byMaterial.aluminium).toBe(1);
    expect(body.data.byCaptureChannel.website).toBe(2);
  });
});
