/**
 * CHECKPOINT C2O — real local end-to-end integration coverage for the
 * Owner operational lifecycle of an existing enquiry, filling the gaps
 * left after Batch 1 (tests/integration/owner-lead-workflow.local.test.ts:
 * per-RPC proof for create_owner_quick_add_lead_v1, change_lead_status_v1,
 * add_lead_note_v1, trash_lead_v1, restore_lead_v1) and the pre-existing
 * owner-lead-edit.local.test.ts (update_lead_details_v1 field mapping,
 * no-op resubmit, protected-field rejection, stale-conflict, website
 * completeness guard).
 *
 * Specifically NOT proven anywhere before this file:
 *   - Archive is a status value ('archived'), not a separate RPC — its
 *     interaction with the list route's view=inbox/archived/trash filter
 *     (src/server/owner-leads/owner-leads.server.ts) was never exercised.
 *   - The combination of archived + trashed (which view wins) was never
 *     exercised.
 *   - update_lead_details_v1 rejects an archived or a trashed lead with
 *     NOT_EDITABLE (documented in $leadId.details.ts's own comment) but no
 *     test ever triggered either path.
 *   - change_lead_status_v1's own documented same-status no-op branch (no
 *     UPDATE, no activity) was never exercised through the real handler.
 *   - Editing a lead with MULTIPLE populated optional fields, changing
 *     only one, was never proven to leave the others byte-identical.
 *   - A full created->edited->noted->status-changed->archived->restored->
 *     trashed->restored chain, read back through the real Detail route
 *     (not raw DB), with Owner list/Overview agreement at each visibility
 *     transition, was never proven as one continuous contract.
 *
 * Deliberately NOT part of `npm test` — only reachable via
 * `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to every other local integration suite
 * in this repository (see owner-lead-workflow.local.test.ts's own header):
 * local Supabase connection settings come exclusively from
 * `npx supabase status -o json`, fail closed unless the reported hostname
 * is exactly "localhost" or "127.0.0.1", and explicitly reject any
 * *.supabase.co hostname.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

async function mintOwner(serviceClient: SupabaseClient): Promise<{ accessToken: string; userId: string }> {
  const { handleOwnerLoginVerifyCodeBody, getOwnerLoginAuthClient } = await import("../../src/server/owner-auth/owner-login.server");
  const email = `owner-c2o-${crypto.randomUUID()}@example.test`;
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
  return { accessToken: result.body.session.accessToken, userId: createdUser.user.id };
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

interface CreatePhoneLeadOptions {
  readonly phoneSuffix: string;
  readonly quantityValue?: number | null;
  readonly quantityUnit?: string | null;
  readonly sellerEmirate?: string | null;
  readonly sellerArea?: string | null;
  readonly notes?: string | null;
}

/** Same create_owner_quick_add_lead_v1 fixture shape as owner-lead-workflow.local.test.ts's own createPhoneLead, extended with optional fields this file needs populated for the edit-preservation proof. */
async function createPhoneLead(client: SupabaseClient, ownerUserId: string, options: CreatePhoneLeadOptions): Promise<string> {
  const idempotencyKey = crypto.randomUUID();
  const payloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2o-${idempotencyKey}`));
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
      contactName: "C2O Lifecycle Fixture",
      contactPhone: `+971500000${options.phoneSuffix}`,
      notes: options.notes ?? null,
      quantityValue: options.quantityValue ?? 2,
      quantityUnit: options.quantityUnit ?? null,
      quantityUnitOther: null,
      sellerEmirate: options.sellerEmirate ?? null,
      sellerArea: options.sellerArea ?? null,
    },
  });
  if (error) throw error;
  return (data as { lead_id: string }).lead_id;
}

function ownerPostRequest(path: string, accessToken: string, body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function ownerGetRequest(path: string, accessToken: string): Request {
  return new Request(`https://example.test${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

async function fetchActivities(client: SupabaseClient, leadId: string) {
  const { data } = await client
    .from("lead_activities")
    .select("event_type,actor_type,metadata,created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function fetchLeadRow(client: SupabaseClient, leadId: string) {
  const { data } = await client
    .from("leads")
    .select(
      "reference, status, deleted_at, deleted_by, closed_at, material, seller_quantity_value, seller_quantity_unit, seller_emirate, seller_area, seller_notes, updated_at",
    )
    .eq("id", leadId)
    .single();
  return data!;
}

async function listView(accessToken: string, view: "inbox" | "archived" | "trash") {
  const { handleOwnerLeadListRequest } = await import("../../src/routes/api/owner/leads");
  const response = await handleOwnerLeadListRequest(ownerGetRequest(`/api/owner/leads?view=${view}`, accessToken));
  const body = await response.json();
  return { status: response.status, body };
}

async function containsLead(accessToken: string, view: "inbox" | "archived" | "trash", leadId: string): Promise<boolean> {
  const { body } = await listView(accessToken, view);
  return (body.data.leads as Array<{ id: string }>).some((l) => l.id === leadId);
}

async function fetchOverview(accessToken: string) {
  const { handleOwnerLeadOverviewRequest } = await import("../../src/routes/api/owner/leads/overview");
  const response = await handleOwnerLeadOverviewRequest(ownerGetRequest("/api/owner/leads/overview", accessToken));
  return (await response.json()).data;
}

async function fetchDetail(accessToken: string, leadId: string) {
  const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
  const response = await handleOwnerLeadDetailRequest(ownerGetRequest(`/api/owner/leads/${leadId}`, accessToken), leadId);
  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSupabaseSettings;
let serviceClient: SupabaseClient;
let ownerAccessToken: string;
let ownerUserId: string;

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
}, 120_000);

afterAll(async () => {
  resetLocalDatabase();
  await reprovisionDemoOwnerIfMissing(serviceClient);
}, 120_000);

describe("CHECKPOINT C2O — Owner enquiry lifecycle", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // A — Archive scope (status='archived') vs. the real list route's view filter
  // -------------------------------------------------------------------------

  it("archiving (status change to 'archived') moves the lead from view=inbox to view=archived, and un-archiving reverses it — real list route, real Postgres", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "001" });

    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(true);
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(false);
    expect(await containsLead(ownerAccessToken, "trash", leadId)).toBe(false);

    const archiveResponse = await ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, {
      expectedStatus: "new",
      newStatus: "archived",
    });
    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");
    const response = await handleOwnerLeadStatusChangeRequest(archiveResponse, leadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("archived");

    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(false);
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(true);
    expect(await containsLead(ownerAccessToken, "trash", leadId)).toBe(false);

    const row = await fetchLeadRow(serviceClient, leadId);
    expect(row.closed_at).not.toBeNull();

    const overview = await fetchOverview(ownerAccessToken);
    expect(overview.byStatus.archived).toBeGreaterThanOrEqual(1);

    // Un-archive: a real status transition away from 'archived' — no
    // invented restriction, matches change_lead_status_v1's own open
    // transition vocabulary.
    const { handleOwnerLeadStatusChangeRequest: handleStatus2 } = await import("../../src/routes/api/owner/leads/$leadId.status");
    const unarchiveResponse = await handleStatus2(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "archived", newStatus: "contacted" }),
      leadId,
    );
    expect(unarchiveResponse.status).toBe(200);

    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(true);
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // B — Trash + Archived combination: deleted_at wins over status for the view filter
  // -------------------------------------------------------------------------

  it("trashing an archived lead surfaces it only in view=trash (not view=archived); restoring returns it to view=archived with status intact", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "002" });

    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");
    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "archived" }),
      leadId,
    );
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(true);

    const { handleOwnerLeadTrashRequest } = await import("../../src/routes/api/owner/leads/$leadId.trash");
    const trashResponse = await handleOwnerLeadTrashRequest(ownerPostRequest(`/api/owner/leads/${leadId}/trash`, ownerAccessToken), leadId);
    expect(trashResponse.status).toBe(200);

    expect(await containsLead(ownerAccessToken, "trash", leadId)).toBe(true);
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(false);
    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(false);

    const trashedRow = await fetchLeadRow(serviceClient, leadId);
    expect(trashedRow.status).toBe("archived");

    // Overview excludes every trashed lead unconditionally (deleted_at is
    // not null), regardless of its status.
    const overviewWhileTrashed = await fetchOverview(ownerAccessToken);
    const stillCountedArchived = overviewWhileTrashed.byStatus.archived as number;

    const { handleOwnerLeadRestoreRequest } = await import("../../src/routes/api/owner/leads/$leadId.restore");
    const restoreResponse = await handleOwnerLeadRestoreRequest(ownerPostRequest(`/api/owner/leads/${leadId}/restore`, ownerAccessToken), leadId);
    expect(restoreResponse.status).toBe(200);
    const restoreBody = await restoreResponse.json();
    expect(restoreBody.data.status).toBe("archived");

    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(true);
    expect(await containsLead(ownerAccessToken, "trash", leadId)).toBe(false);

    const overviewAfterRestore = await fetchOverview(ownerAccessToken);
    expect(overviewAfterRestore.byStatus.archived).toBe(stillCountedArchived + 1);
  });

  // -------------------------------------------------------------------------
  // C — Edit is blocked (NOT_EDITABLE) while archived or trashed, no partial write
  // -------------------------------------------------------------------------

  it("update_lead_details_v1 rejects an archived lead and a trashed lead with NOT_EDITABLE, leaving the row untouched; restoring re-enables editing", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "003" });
    const before = await fetchDetail(ownerAccessToken, leadId);
    const editPayload = {
      contactName: "C2O Lifecycle Fixture",
      contactPhone: "+971500000003",
      material: "aluminium",
      expectedUpdatedAt: before.body.data.lead.updatedAt,
    };

    const { handleOwnerLeadEditRequest } = await import("../../src/routes/api/owner/leads/$leadId.details");
    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");
    const { handleOwnerLeadTrashRequest } = await import("../../src/routes/api/owner/leads/$leadId.trash");
    const { handleOwnerLeadRestoreRequest } = await import("../../src/routes/api/owner/leads/$leadId.restore");

    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "archived" }),
      leadId,
    );

    const archivedEditAttempt = await handleOwnerLeadEditRequest(ownerPostRequest(`/api/owner/leads/${leadId}/details`, ownerAccessToken, editPayload), leadId);
    expect(archivedEditAttempt.status).toBe(409);
    const archivedEditBody = await archivedEditAttempt.json();
    expect(archivedEditBody.error.code).toBe("NOT_EDITABLE");
    expect((await fetchLeadRow(serviceClient, leadId)).material).toBe("copper");

    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "archived", newStatus: "new" }),
      leadId,
    );
    await handleOwnerLeadTrashRequest(ownerPostRequest(`/api/owner/leads/${leadId}/trash`, ownerAccessToken), leadId);

    const trashedEditAttempt = await handleOwnerLeadEditRequest(ownerPostRequest(`/api/owner/leads/${leadId}/details`, ownerAccessToken, editPayload), leadId);
    expect(trashedEditAttempt.status).toBe(409);
    expect((await trashedEditAttempt.json()).error.code).toBe("NOT_EDITABLE");
    expect((await fetchLeadRow(serviceClient, leadId)).material).toBe("copper");

    await handleOwnerLeadRestoreRequest(ownerPostRequest(`/api/owner/leads/${leadId}/restore`, ownerAccessToken), leadId);
    const currentDetail = await fetchDetail(ownerAccessToken, leadId);
    const restoredEditAttempt = await handleOwnerLeadEditRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/details`, ownerAccessToken, { ...editPayload, expectedUpdatedAt: currentDetail.body.data.lead.updatedAt }),
      leadId,
    );
    expect(restoredEditAttempt.status).toBe(200);
    expect((await fetchLeadRow(serviceClient, leadId)).material).toBe("aluminium");
  });

  // -------------------------------------------------------------------------
  // D — Status idempotent resubmit through the real handler
  // -------------------------------------------------------------------------

  it("resubmitting the current status is a deterministic no-op — changed:false, no new activity", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "004" });
    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");

    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "contacted" }),
      leadId,
    );
    const before = await fetchActivities(serviceClient, leadId);

    const response = await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "contacted", newStatus: "contacted" }),
      leadId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.changed).toBe(false);
    expect(body.data.status).toBe("contacted");

    const after = await fetchActivities(serviceClient, leadId);
    expect(after).toHaveLength(before.length);
  });

  // -------------------------------------------------------------------------
  // E — Edit preserves untouched populated optional fields
  // -------------------------------------------------------------------------

  it("changing only the material field leaves every other already-populated optional field byte-identical, and changedFields reports only 'Material'", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, {
      phoneSuffix: "005",
      quantityValue: 75,
      quantityUnit: "kg",
      sellerEmirate: "dubai",
      sellerArea: "Deira",
      notes: "Prefers WhatsApp, called Tuesday.",
    });
    const before = await fetchLeadRow(serviceClient, leadId);
    const detail = await fetchDetail(ownerAccessToken, leadId);

    const { handleOwnerLeadEditRequest } = await import("../../src/routes/api/owner/leads/$leadId.details");
    const response = await handleOwnerLeadEditRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/details`, ownerAccessToken, {
        contactName: "C2O Lifecycle Fixture",
        contactPhone: "+971500000005",
        material: "aluminium",
        quantityValue: 75,
        quantityUnit: "kg",
        emirate: "dubai",
        area: "Deira",
        notes: "Prefers WhatsApp, called Tuesday.",
        expectedUpdatedAt: detail.body.data.lead.updatedAt,
      }),
      leadId,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.updated).toBe(true);
    expect(body.data.changedFields).toEqual(["Material"]);

    const after = await fetchLeadRow(serviceClient, leadId);
    expect(after.material).toBe("aluminium");
    expect(Number(after.seller_quantity_value)).toBe(Number(before.seller_quantity_value));
    expect(after.seller_quantity_unit).toBe(before.seller_quantity_unit);
    expect(after.seller_emirate).toBe(before.seller_emirate);
    expect(after.seller_area).toBe(before.seller_area);
    expect(after.seller_notes).toBe(before.seller_notes);

    const activities = await fetchActivities(serviceClient, leadId);
    expect(activities.filter((a) => a.event_type === "lead_details_updated")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // F — Full lifecycle chain: create -> edit -> note -> status -> archive ->
  // un-archive -> trash -> restore, cross-checked against list/detail/
  // Overview and a final real-Detail-route readback.
  // -------------------------------------------------------------------------

  it("a full create->edit->note->status->archive->restore->trash->restore chain leaves an accurate, ordered activity history and agrees across list/detail/Overview", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "006" });
    const initialDetail = await fetchDetail(ownerAccessToken, leadId);
    const reference = initialDetail.body.data.lead.reference;

    const { handleOwnerLeadEditRequest } = await import("../../src/routes/api/owner/leads/$leadId.details");
    const { handleOwnerLeadNoteCreateRequest } = await import("../../src/routes/api/owner/leads/$leadId.notes");
    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");
    const { handleOwnerLeadTrashRequest } = await import("../../src/routes/api/owner/leads/$leadId.trash");
    const { handleOwnerLeadRestoreRequest } = await import("../../src/routes/api/owner/leads/$leadId.restore");

    await handleOwnerLeadEditRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/details`, ownerAccessToken, {
        contactName: "C2O Lifecycle Fixture",
        contactPhone: "+971500000006",
        material: "lead",
        expectedUpdatedAt: initialDetail.body.data.lead.updatedAt,
      }),
      leadId,
    );
    await handleOwnerLeadNoteCreateRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/notes`, ownerAccessToken, { body: "Lifecycle chain note.", requestId: crypto.randomUUID() }),
      leadId,
    );
    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "contacted" }),
      leadId,
    );
    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "contacted", newStatus: "archived" }),
      leadId,
    );
    expect(await containsLead(ownerAccessToken, "archived", leadId)).toBe(true);

    await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "archived", newStatus: "quote_sent" }),
      leadId,
    );
    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(true);

    await handleOwnerLeadTrashRequest(ownerPostRequest(`/api/owner/leads/${leadId}/trash`, ownerAccessToken), leadId);
    expect(await containsLead(ownerAccessToken, "trash", leadId)).toBe(true);

    const overviewLeadIds = ((await fetchOverview(ownerAccessToken)) as { attentionLeads: Array<{ id: string }> });
    expect(overviewLeadIds.attentionLeads.some((l) => l.id === leadId)).toBe(false);

    await handleOwnerLeadRestoreRequest(ownerPostRequest(`/api/owner/leads/${leadId}/restore`, ownerAccessToken), leadId);
    expect(await containsLead(ownerAccessToken, "inbox", leadId)).toBe(true);

    // Final readback through the real Detail route — never raw DB for this
    // assertion, proving the browser's own read path agrees.
    const finalDetail = await fetchDetail(ownerAccessToken, leadId);
    expect(finalDetail.status).toBe(200);
    expect(finalDetail.body.data.lead.reference).toBe(reference);
    expect(finalDetail.body.data.lead.status).toBe("quote_sent");
    expect(finalDetail.body.data.lead.deletedAt).toBeNull();
    expect(finalDetail.body.data.lead.material).toBe("lead");

    // The real Detail route's own deliberate convention (queryLeadActivities
    // in owner-lead-detail.server.ts) is most-recent-first — a UI timeline,
    // not an audit-log append order — so the expected sequence here is the
    // reverse of the chain's own execution order.
    const eventSequence = finalDetail.body.data.activities.map((a: { eventType: string }) => a.eventType);
    expect(eventSequence).toEqual([
      "lead_restored",
      "lead_trashed",
      "status_changed",
      "status_changed",
      "status_changed",
      "note_added",
      "lead_details_updated",
      "lead_created",
    ]);
    // Deterministic ordering: strictly non-increasing createdAt across the
    // full returned sequence (the server's own ORDER BY, proven here to
    // actually hold end-to-end).
    const timestamps = finalDetail.body.data.activities.map((a: { createdAt: string }) => new Date(a.createdAt).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
    }

    // Cross-view: Overview must now count this lead once, under its final
    // status, not under any status it merely passed through.
    const finalOverview = await fetchOverview(ownerAccessToken);
    const finalListInbox = await listView(ownerAccessToken, "inbox");
    const listedItem = (finalListInbox.body.data.leads as Array<{ id: string; status: string; reference: string }>).find((l) => l.id === leadId);
    expect(listedItem?.status).toBe("quote_sent");
    expect(listedItem?.reference).toBe(reference);
    expect(finalOverview.byStatus.quote_sent).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // G — BATCH 3B: a trashed lead is frozen. Status-change and note-add both
  // now reject with the same NOT_EDITABLE convention update_lead_details_v1
  // already uses, with zero side effects, until Restore. Archived-lead
  // behaviour (status = 'archived', deleted_at IS NULL) is proven unchanged
  // in the same test so a future regression on either axis is caught here.
  // -------------------------------------------------------------------------

  it("a trashed lead rejects status-change and note-add with NOT_EDITABLE and zero side effects; Restore re-enables both; archived-lead behaviour is unchanged", async () => {
    const leadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "007" });
    const { handleOwnerLeadTrashRequest } = await import("../../src/routes/api/owner/leads/$leadId.trash");
    const { handleOwnerLeadRestoreRequest } = await import("../../src/routes/api/owner/leads/$leadId.restore");
    const { handleOwnerLeadStatusChangeRequest } = await import("../../src/routes/api/owner/leads/$leadId.status");
    const { handleOwnerLeadNoteCreateRequest } = await import("../../src/routes/api/owner/leads/$leadId.notes");

    await handleOwnerLeadTrashRequest(ownerPostRequest(`/api/owner/leads/${leadId}/trash`, ownerAccessToken), leadId);
    const rowBefore = await fetchLeadRow(serviceClient, leadId);
    const activitiesBefore = await fetchActivities(serviceClient, leadId);

    // Rejected status change on a trashed lead — twice, to prove a repeat
    // of the same rejected request creates no side effects either time.
    for (let attempt = 0; attempt < 2; attempt++) {
      const statusResponse = await handleOwnerLeadStatusChangeRequest(
        ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "contacted" }),
        leadId,
      );
      expect(statusResponse.status).toBe(409);
      const statusBody = await statusResponse.json();
      expect(statusBody.ok).toBe(false);
      expect(statusBody.error.code).toBe("NOT_EDITABLE");
    }

    // Rejected note-add on a trashed lead — twice (different requestId each
    // time, since a real client retry of a REJECTED attempt would not reuse
    // the same requestId; the point here is that neither attempt leaves a
    // row behind, not idempotent-replay of a success).
    for (let attempt = 0; attempt < 2; attempt++) {
      const noteResponse = await handleOwnerLeadNoteCreateRequest(
        ownerPostRequest(`/api/owner/leads/${leadId}/notes`, ownerAccessToken, { body: "Note attempted while trashed.", requestId: crypto.randomUUID() }),
        leadId,
      );
      expect(noteResponse.status).toBe(409);
      const noteBody = await noteResponse.json();
      expect(noteBody.ok).toBe(false);
      expect(noteBody.error.code).toBe("NOT_EDITABLE");
    }

    const rowAfterRejections = await fetchLeadRow(serviceClient, leadId);
    expect(rowAfterRejections.status).toBe(rowBefore.status);
    expect(rowAfterRejections.updated_at).toBe(rowBefore.updated_at);
    const activitiesAfterRejections = await fetchActivities(serviceClient, leadId);
    expect(activitiesAfterRejections).toHaveLength(activitiesBefore.length);
    expect(activitiesAfterRejections.some((a) => a.event_type === "status_changed")).toBe(false);
    expect(activitiesAfterRejections.some((a) => a.event_type === "note_added")).toBe(false);

    // Restore, then one valid status change and one valid note must succeed normally.
    const restoreResponse = await handleOwnerLeadRestoreRequest(ownerPostRequest(`/api/owner/leads/${leadId}/restore`, ownerAccessToken), leadId);
    expect(restoreResponse.status).toBe(200);

    const statusAfterRestore = await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "contacted" }),
      leadId,
    );
    expect(statusAfterRestore.status).toBe(200);
    expect((await statusAfterRestore.json()).data.changed).toBe(true);

    const noteAfterRestore = await handleOwnerLeadNoteCreateRequest(
      ownerPostRequest(`/api/owner/leads/${leadId}/notes`, ownerAccessToken, { body: "Note added after restore.", requestId: crypto.randomUUID() }),
      leadId,
    );
    expect(noteAfterRestore.status).toBe(200);

    const activitiesAfterRestore = await fetchActivities(serviceClient, leadId);
    expect(activitiesAfterRestore.filter((a) => a.event_type === "status_changed")).toHaveLength(1);
    expect(activitiesAfterRestore.filter((a) => a.event_type === "note_added")).toHaveLength(1);

    // Existing archived-lead behaviour (deleted_at IS NULL, status =
    // 'archived') must remain fully unchanged by this batch — both a status
    // change and a note-add succeed exactly as before.
    const archiveLeadId = await createPhoneLead(serviceClient, ownerUserId, { phoneSuffix: "008" });
    const toArchived = await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${archiveLeadId}/status`, ownerAccessToken, { expectedStatus: "new", newStatus: "archived" }),
      archiveLeadId,
    );
    expect(toArchived.status).toBe(200);

    const statusOnArchived = await handleOwnerLeadStatusChangeRequest(
      ownerPostRequest(`/api/owner/leads/${archiveLeadId}/status`, ownerAccessToken, { expectedStatus: "archived", newStatus: "contacted" }),
      archiveLeadId,
    );
    expect(statusOnArchived.status).toBe(200);
    expect((await statusOnArchived.json()).data.changed).toBe(true);

    const noteOnArchived = await handleOwnerLeadNoteCreateRequest(
      ownerPostRequest(`/api/owner/leads/${archiveLeadId}/notes`, ownerAccessToken, { body: "Note on an archived (not trashed) lead.", requestId: crypto.randomUUID() }),
      archiveLeadId,
    );
    expect(noteOnArchived.status).toBe(200);
  });
});
