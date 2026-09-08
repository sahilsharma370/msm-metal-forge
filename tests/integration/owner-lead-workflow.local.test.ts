/**
 * Permanent, local-only end-to-end integration test for four Owner
 * lead-workflow RPCs that, before this suite, had ONLY mocked-RPC unit
 * tests (src/server/owner-leads/*.server.test.ts) — those tests prove the
 * JS mapping layer is correct once given a canned RPC response; they
 * cannot prove the SQL itself runs. Real local Supabase Postgres, real HTTP
 * route handlers — nothing here mocks createSupabaseAdminClient or rpc().
 *
 * Covers: create_owner_quick_add_lead_v1, change_lead_status_v1,
 * add_lead_note_v1, trash_lead_v1, restore_lead_v1.
 *
 * Deliberately NOT part of `npm test` — only reachable via
 * `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to every other local integration suite in
 * this repository (see tests/integration/owner-lead-edit.local.test.ts):
 * local Supabase connection settings come exclusively from
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
  const email = `owner-workflow-${crypto.randomUUID()}@example.test`;
  const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !createdUser.user) throw createError ?? new Error("failed to create synthetic owner user");
  const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: createdUser.user.id });
  if (insertError) throw insertError;
  const otp = await obtainOtpForEmail(serviceClient, email);
  const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email, code: otp }), { auth: getOwnerLoginAuthClient() });
  if (result.status !== 200 || !result.body.ok) throw new Error(`verify-code did not succeed (status ${result.status})`);
  return { accessToken: result.body.session.accessToken, userId: createdUser.user.id };
}

/** Same direct-RPC seed shape as owner-lead-edit.local.test.ts's own createPhoneLead — phone-captured, quantity set, no unit/emirate/area/notes. */
async function createPhoneLead(client: SupabaseClient, ownerUserId: string, phoneSuffix: string): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`owner-workflow-${idempotencyKey}`));
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
      contactName: "Owner Workflow Fixture",
      contactPhone: `+9715000${phoneSuffix}`,
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
let ownerUserId: string;

let handleOwnerLeadQuickAddCreateRequest: (request: Request) => Promise<Response>;
let handleOwnerLeadStatusChangeRequest: (request: Request, leadId: string) => Promise<Response>;
let handleOwnerLeadNoteCreateRequest: (request: Request, leadId: string) => Promise<Response>;
let handleOwnerLeadTrashRequest: (request: Request, leadId: string) => Promise<Response>;
let handleOwnerLeadRestoreRequest: (request: Request, leadId: string) => Promise<Response>;

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
  ownerUserId = owner.userId;

  ({ handleOwnerLeadQuickAddCreateRequest } = await import("../../src/routes/api/owner/leads"));
  ({ handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status"));
  ({ handleOwnerLeadNoteCreateRequest } = await import("../../src/routes/api/owner/leads/$leadId.notes"));
  ({ handleOwnerLeadTrashRequest } = await import("../../src/routes/api/owner/leads/$leadId.trash"));
  ({ handleOwnerLeadRestoreRequest } = await import("../../src/routes/api/owner/leads/$leadId.restore"));
}, 120_000);

afterAll(async () => {
  resetLocalDatabase();
  await reprovisionDemoOwnerIfMissing(serviceClient);
}, 120_000);

function ownerRequest(path: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerAccessToken}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function fetchActivities(leadId: string) {
  const { data } = await serviceClient
    .from("lead_activities")
    .select("event_type,actor_type,metadata,created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

// ---------------------------------------------------------------------------
// 1. create_owner_quick_add_lead_v1
// ---------------------------------------------------------------------------

describe("Owner workflow — create_owner_quick_add_lead_v1 (real local RPC)", () => {
  it("creates a lead row with a generated reference, correct capture channel/source, and one lead_created activity", async () => {
    const requestId = crypto.randomUUID();
    const response = await handleOwnerLeadQuickAddCreateRequest(
      ownerRequest("/api/owner/leads", {
        intent: "sell",
        channel: "whatsapp",
        material: "aluminium",
        contactName: "Quick Add Fixture",
        contactPhone: "+971500099001",
        requestId,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);
    const leadId = body.data.leadId as string;

    const { data: row } = await serviceClient
      .from("leads")
      .select("reference,intent,material,capture_channel,source,status,submission_completed_at")
      .eq("id", leadId)
      .single();
    expect(row!.reference).toBe(body.data.reference);
    expect(row!.intent).toBe("sell");
    expect(row!.material).toBe("aluminium");
    expect(row!.capture_channel).toBe("whatsapp");
    expect(row!.source).toBeNull();
    expect(row!.status).toBe("new");
    expect(row!.submission_completed_at).not.toBeNull();

    const activities = await fetchActivities(leadId);
    expect(activities.map((a) => a.event_type)).toEqual(["lead_created"]);
    expect(activities[0]!.actor_type).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// 2. change_lead_status_v1
// ---------------------------------------------------------------------------

describe("Owner workflow — change_lead_status_v1 (real local RPC)", () => {
  let leadId: string;

  beforeAll(async () => {
    leadId = await createPhoneLead(serviceClient, ownerUserId, "1001");
  }, 30_000);

  it("a real transition persists the new status and records exactly one status_changed activity", async () => {
    const response = await handleOwnerLeadStatusChangeRequest(
      ownerRequest(`/api/owner/leads/${leadId}/status`, { expectedStatus: "new", newStatus: "contacted" }),
      leadId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.changed).toBe(true);
    expect(body.data.status).toBe("contacted");

    const { data: row } = await serviceClient.from("leads").select("status").eq("id", leadId).single();
    expect(row!.status).toBe("contacted");

    const activities = await fetchActivities(leadId);
    const statusChanges = activities.filter((a) => a.event_type === "status_changed");
    expect(statusChanges).toHaveLength(1);
    expect(statusChanges[0]!.metadata).toMatchObject({ from_status: "new", to_status: "contacted" });
  });

  it("an invalid transition (stale expectedStatus) fails safely with 409 CONFLICT and does not change the row", async () => {
    const response = await handleOwnerLeadStatusChangeRequest(
      ownerRequest(`/api/owner/leads/${leadId}/status`, { expectedStatus: "new", newStatus: "quote_sent" }),
      leadId,
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
    const { data: row } = await serviceClient.from("leads").select("status").eq("id", leadId).single();
    expect(row!.status).toBe("contacted");
  });

  it("marking lost with no lostReason fails safely (400) and does not create a second activity row", async () => {
    const before = await fetchActivities(leadId);
    const response = await handleOwnerLeadStatusChangeRequest(
      ownerRequest(`/api/owner/leads/${leadId}/status`, { expectedStatus: "contacted", newStatus: "lost" }),
      leadId,
    );
    expect(response.status).toBe(400);
    const after = await fetchActivities(leadId);
    expect(after).toHaveLength(before.length);
  });
});

// ---------------------------------------------------------------------------
// 3. add_lead_note_v1
// ---------------------------------------------------------------------------

describe("Owner workflow — add_lead_note_v1 (real local RPC)", () => {
  let leadId: string;

  beforeAll(async () => {
    leadId = await createPhoneLead(serviceClient, ownerUserId, "1002");
  }, 30_000);

  it("persists a note_added activity with the exact body", async () => {
    const requestId = crypto.randomUUID();
    const response = await handleOwnerLeadNoteCreateRequest(ownerRequest(`/api/owner/leads/${leadId}/notes`, { body: "Customer called twice.", requestId }), leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.note).toBe("Customer called twice.");

    const activities = await fetchActivities(leadId);
    const notes = activities.filter((a) => a.event_type === "note_added");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.metadata).toMatchObject({ note: "Customer called twice." });
  });

  it("resending the identical requestId is idempotent — no duplicate activity row", async () => {
    const requestId = crypto.randomUUID();
    const first = await handleOwnerLeadNoteCreateRequest(ownerRequest(`/api/owner/leads/${leadId}/notes`, { body: "Follow up Friday.", requestId }), leadId);
    const second = await handleOwnerLeadNoteCreateRequest(ownerRequest(`/api/owner/leads/${leadId}/notes`, { body: "Follow up Friday.", requestId }), leadId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.data.activityId).toBe(firstBody.data.activityId);

    const activities = await fetchActivities(leadId);
    const followUps = activities.filter((a) => a.event_type === "note_added" && (a.metadata as { note?: string }).note === "Follow up Friday.");
    expect(followUps).toHaveLength(1);
  });

  it("an empty note body fails safely (400) and creates no activity", async () => {
    const before = await fetchActivities(leadId);
    const response = await handleOwnerLeadNoteCreateRequest(ownerRequest(`/api/owner/leads/${leadId}/notes`, { body: "   ", requestId: crypto.randomUUID() }), leadId);
    expect(response.status).toBe(400);
    expect(await fetchActivities(leadId)).toHaveLength(before.length);
  });

  it("an oversized note body (>2000 chars) fails safely (400) and creates no activity", async () => {
    const before = await fetchActivities(leadId);
    const response = await handleOwnerLeadNoteCreateRequest(
      ownerRequest(`/api/owner/leads/${leadId}/notes`, { body: "x".repeat(2001), requestId: crypto.randomUUID() }),
      leadId,
    );
    expect(response.status).toBe(400);
    expect(await fetchActivities(leadId)).toHaveLength(before.length);
  });
});

// ---------------------------------------------------------------------------
// 4. trash_lead_v1 / restore_lead_v1
// ---------------------------------------------------------------------------

describe("Owner workflow — trash_lead_v1 / restore_lead_v1 (real local RPC)", () => {
  let leadId: string;

  beforeAll(async () => {
    leadId = await createPhoneLead(serviceClient, ownerUserId, "1003");
    // Give the lead a real non-default status first, to prove trash/restore
    // never touch it.
    await handleOwnerLeadStatusChangeRequest(ownerRequest(`/api/owner/leads/${leadId}/status`, { expectedStatus: "new", newStatus: "inspection" }), leadId);
  }, 30_000);

  it("trash sets deleted_at/deleted_by, leaves status unchanged, and records one lead_trashed activity", async () => {
    const response = await handleOwnerLeadTrashRequest(ownerRequest(`/api/owner/leads/${leadId}/trash`), leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.trashed).toBe(true);
    expect(body.data.status).toBe("inspection");

    const { data: row } = await serviceClient.from("leads").select("deleted_at,deleted_by,status").eq("id", leadId).single();
    expect(row!.deleted_at).not.toBeNull();
    expect(row!.deleted_by).toBe(ownerUserId);
    expect(row!.status).toBe("inspection");

    const activities = await fetchActivities(leadId);
    expect(activities.filter((a) => a.event_type === "lead_trashed")).toHaveLength(1);
  });

  it("repeating the trash request is a safe no-op — no second activity row", async () => {
    const before = await fetchActivities(leadId);
    const response = await handleOwnerLeadTrashRequest(ownerRequest(`/api/owner/leads/${leadId}/trash`), leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.trashed).toBe(false);
    expect(await fetchActivities(leadId)).toHaveLength(before.length);
  });

  it("restore clears deleted_at/deleted_by, leaves status unchanged, and records one lead_restored activity", async () => {
    const response = await handleOwnerLeadRestoreRequest(ownerRequest(`/api/owner/leads/${leadId}/restore`), leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.restored).toBe(true);
    expect(body.data.status).toBe("inspection");

    const { data: row } = await serviceClient.from("leads").select("deleted_at,deleted_by,status").eq("id", leadId).single();
    expect(row!.deleted_at).toBeNull();
    expect(row!.deleted_by).toBeNull();
    expect(row!.status).toBe("inspection");

    const activities = await fetchActivities(leadId);
    expect(activities.filter((a) => a.event_type === "lead_restored")).toHaveLength(1);
  });

  it("repeating the restore request is a safe no-op — no second activity row", async () => {
    const before = await fetchActivities(leadId);
    const response = await handleOwnerLeadRestoreRequest(ownerRequest(`/api/owner/leads/${leadId}/restore`), leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.restored).toBe(false);
    expect(await fetchActivities(leadId)).toHaveLength(before.length);
  });
});
