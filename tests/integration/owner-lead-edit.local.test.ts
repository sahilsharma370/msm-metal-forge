/**
 * Permanent, local-only end-to-end integration test for Owner "Edit
 * enquiry": exercises the REAL route handler
 * (src/routes/api/owner/leads/$leadId.details.ts) against a REAL local
 * Supabase Postgres stack (`npx supabase start`), through the REAL
 * update_lead_details_v1 RPC — nothing here mocks createSupabaseAdminClient
 * or rpc().
 *
 * This suite exists specifically because two defects in update_lead_details_v1
 * were invisible to every mocked-RPC unit test in owner-lead-edit.server.test.ts
 * (those tests only prove the JS mapping layer is correct once given a
 * canned RPC response; they cannot prove the SQL itself runs):
 *
 *   1. A `text[] || 'literal'` array-concatenation ambiguity that Postgres
 *      resolves against the wrong `||` overload and rejects with "malformed
 *      array literal" on every real changed-field append.
 *   2. Clearing seller_emirate/seller_area/seller_quantity_unit to null (all
 *      plainly optional on this form) on a WEBSITE-sourced sell lead
 *      violates that lead's own leads_website_requiredness completeness
 *      constraint, surfacing as a raw constraint-violation 500 instead of a
 *      sanitized validation message.
 *
 * The primary fixture lead is seeded via create_owner_quick_add_lead_v1
 * (capture_channel = 'phone'), matching the exact real-world shape of the
 * originally reported defect (a phone-captured lead with quantity set but
 * no unit/emirate/area/notes) — leads_website_requiredness is a no-op for
 * any non-website capture_channel, so this is the correct fixture for
 * proving the core "Copper -> Aluminium, optional fields absent" save path.
 * A second, website-sourced fixture exists solely to prove defect #2's fix.
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
// Fixture helpers
// ---------------------------------------------------------------------------

async function obtainOtpForEmail(client: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const otp = (data.properties as { email_otp?: string } | undefined)?.email_otp;
  if (!otp) throw new Error("Local integration test: generateLink did not return an email_otp.");
  return otp;
}

async function mintOwner(serviceClient: SupabaseClient): Promise<{ accessToken: string; userId: string }> {
  const { handleOwnerLoginVerifyCodeBody, getOwnerLoginAuthClient } = await import("../../src/server/owner-auth/owner-login.server");
  const email = `owner-edit-${crypto.randomUUID()}@example.test`;
  const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !createdUser.user) throw createError ?? new Error("failed to create synthetic owner user");
  const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: createdUser.user.id });
  if (insertError) throw insertError;
  const otp = await obtainOtpForEmail(serviceClient, email);
  const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email, code: otp }), { auth: getOwnerLoginAuthClient() });
  if (result.status !== 200 || !result.body.ok) throw new Error(`verify-code did not succeed (status ${result.status})`);
  return { accessToken: result.body.session.accessToken, userId: createdUser.user.id };
}

/** Mirrors the real reported defect's own lead exactly: phone-captured, quantity set, no unit/emirate/area/notes. leads_website_requiredness is a no-op for any non-website capture_channel. */
async function createPhoneLead(client: SupabaseClient, ownerUserId: string): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`owner-edit-phone-${idempotencyKey}`));
  const payloadHash = Array.from(new Uint8Array(payloadHashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await client.rpc("create_owner_quick_add_lead_v1", {
    p_owner_user_id: ownerUserId,
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_submission: {
      intent: "sell",
      captureChannel: "phone",
      material: "copper",
      materialOtherText: null,
      contactName: "Owner Edit Fixture",
      contactPhone: "+971500030001",
      notes: null,
      quantityValue: 2,
      quantityUnit: null,
      quantityUnitOther: null,
      sellerEmirate: null,
      sellerArea: null,
    },
  });
  if (error) throw error;
  return (data as { lead_id: string }).lead_id;
}

/** A normal website submission — full seller completeness, so leads_website_requiredness is genuinely load-bearing for it. */
async function createWebsiteLead(client: SupabaseClient): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`owner-edit-website-${idempotencyKey}`));
  const payloadHash = Array.from(new Uint8Array(payloadHashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data, error } = await client.rpc("create_website_quote_v1", {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_submission: {
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
      sellerName: "Owner Edit Website Fixture",
      sellerPhone: "+971500030002",
      sellerPreferredContact: "whatsapp",
    },
    p_files: [],
  });
  if (error) throw error;
  return (data as { lead_id: string }).lead_id;
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

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSupabaseSettings;
let serviceClient: SupabaseClient;
let ownerAccessToken: string;
let leadId: string;
let websiteLeadId: string;
let handleOwnerLeadEditRequest: (request: Request, id: string) => Promise<Response>;

beforeAll(async () => {
  settings = getLocalSupabaseSettingsOrThrow();
  process.env["SUPABASE_URL"] = settings.apiUrl;
  process.env["SUPABASE_SECRET_KEY"] = settings.secretKey;

  serviceClient = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  resetLocalDatabase();
  const owner = await mintOwner(serviceClient);
  ownerAccessToken = owner.accessToken;
  leadId = await createPhoneLead(serviceClient, owner.userId);
  websiteLeadId = await createWebsiteLead(serviceClient);
  ({ handleOwnerLeadEditRequest } = await import("../../src/routes/api/owner/leads/$leadId.details"));
}, 120_000);

afterAll(async () => {
  resetLocalDatabase();
  await reprovisionDemoOwnerIfMissing(serviceClient);
}, 120_000);

function ownerEditRequest(id: string, body: unknown): Request {
  return new Request(`https://example.test/api/owner/leads/${id}/details`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerAccessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function currentUpdatedAt(id: string): Promise<string> {
  const { data, error } = await serviceClient.from("leads").select("updated_at").eq("id", id).single();
  if (error || !data) throw error ?? new Error("lead not found");
  return (data as { updated_at: string }).updated_at;
}

describe("Owner Edit enquiry — real local update_lead_details_v1 round trip", () => {
  it("a material-only change (Copper -> Aluminium) with quantity=2 and unit/emirate/area/notes absent persists (the exact reported defect's own lead shape)", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(leadId);
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(leadId, {
        contactName: "Owner Edit Fixture",
        contactPhone: "+971500030001",
        material: "aluminium",
        quantityValue: 2,
        expectedUpdatedAt,
      }),
      leadId,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.updated).toBe(true);
    expect(body.data.changedFields).toEqual(["Material"]);

    const { data: row } = await serviceClient
      .from("leads")
      .select(
        "material,material_subtype,seller_quantity_value,seller_quantity_unit,seller_emirate,seller_area,seller_notes,reference,status,intent,capture_channel,submission_completed_at",
      )
      .eq("id", leadId)
      .single();
    expect(row!.material).toBe("aluminium");
    expect(row!.material_subtype).toBeNull();
    expect(row!.seller_quantity_value).toBe(2);
    // Never set to begin with — stays a real null, never an empty-string
    // or stray "undefined" literal.
    expect(row!.seller_quantity_unit).toBeNull();
    expect(row!.seller_emirate).toBeNull();
    expect(row!.seller_area).toBeNull();
    expect(row!.seller_notes).toBeNull();
    // Protected fields untouched.
    expect(row!.reference).toMatch(/^MSM-/);
    expect(row!.status).toBe("new");
    expect(row!.intent).toBe("sell");
    expect(row!.capture_channel).toBe("phone");
    expect(row!.submission_completed_at).not.toBeNull();
  });

  it("recorded exactly one owner-attributed 'lead_details_updated' activity for that save", async () => {
    const { data: activities } = await serviceClient
      .from("lead_activities")
      .select("event_type,actor_type,metadata")
      .eq("lead_id", leadId)
      .eq("event_type", "lead_details_updated");
    expect(activities).toHaveLength(1);
    expect(activities![0]!.actor_type).toBe("owner");
    expect((activities![0]!.metadata as { changedFields: string[] }).changedFields).toEqual(["Material"]);
  });

  it("resubmitting the exact same values is a deterministic no-op — no second UPDATE, no second activity row", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(leadId);
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(leadId, {
        contactName: "Owner Edit Fixture",
        contactPhone: "+971500030001",
        material: "aluminium",
        quantityValue: 2,
        expectedUpdatedAt,
      }),
      leadId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.updated).toBe(false);
    expect(body.data.changedFields).toEqual([]);

    const { count } = await serviceClient
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("event_type", "lead_details_updated");
    expect(count).toBe(1);
  });

  it("rejects a payload carrying a protected field (status) — the server-side allowlist, not client trust, decides what's writable", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(leadId);
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(leadId, {
        contactName: "Owner Edit Fixture",
        contactPhone: "+971500030001",
        material: "aluminium",
        status: "completed",
        expectedUpdatedAt,
      }),
      leadId,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const { data: row } = await serviceClient.from("leads").select("status").eq("id", leadId).single();
    expect(row!.status).toBe("new");
  });

  it("a stale expectedUpdatedAt is rejected with 409 CONFLICT, never silently overwritten", async () => {
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(leadId, {
        contactName: "Owner Edit Fixture",
        contactPhone: "+971500030001",
        material: "copper",
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      }),
      leadId,
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
    const { data: row } = await serviceClient.from("leads").select("material").eq("id", leadId).single();
    expect(row!.material).toBe("aluminium");
  });
});

describe("Owner Edit enquiry — website-sourced lead completeness guard", () => {
  it("clearing emirate/area/quantity-unit on a website-sourced sell lead returns a sanitized 400, never a raw constraint-violation 500", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(websiteLeadId);
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(websiteLeadId, {
        contactName: "Owner Edit Website Fixture",
        contactPhone: "+971500030002",
        material: "aluminium",
        quantityValue: 2,
        expectedUpdatedAt,
      }),
      websiteLeadId,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body)).not.toMatch(/constraint|23514|relation|postgres/i);

    const { data: row } = await serviceClient.from("leads").select("material,seller_emirate,seller_area").eq("id", websiteLeadId).single();
    // Rejected before the UPDATE — nothing changed.
    expect(row!.material).toBe("copper");
    expect(row!.seller_emirate).toBe("dubai");
    expect(row!.seller_area).toBe("Al Quoz Industrial 3");
  });

  it("a material-only change that keeps the required emirate/area/quantity-unit intact still saves successfully on the same website lead", async () => {
    const expectedUpdatedAt = await currentUpdatedAt(websiteLeadId);
    const response = await handleOwnerLeadEditRequest(
      ownerEditRequest(websiteLeadId, {
        contactName: "Owner Edit Website Fixture",
        contactPhone: "+971500030002",
        material: "aluminium",
        quantityValue: 100,
        quantityUnit: "kg",
        emirate: "dubai",
        area: "Al Quoz Industrial 3",
        expectedUpdatedAt,
      }),
      websiteLeadId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.updated).toBe(true);
    expect(body.data.changedFields).toEqual(["Material"]);
  });
});
