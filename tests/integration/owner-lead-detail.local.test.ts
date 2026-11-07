/**
 * CHECKPOINT C2J-B/C — permanent, local-only end-to-end integration test for
 * the owner lead-detail read service and the private-file signed-URL access
 * service: exercises the REAL route handlers
 * (src/routes/api/owner/leads/$leadId.ts,
 * src/routes/api/owner/leads/$leadId.files.$fileId.access.ts) against a REAL
 * local Supabase Postgres + Storage stack (`npx supabase start`). Nothing
 * here mocks createSupabaseAdminClient, rpc, storage.upload/download/
 * createSignedUrl, or either route handler.
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
import { execFileSync, spawn } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LEAD_FILES_BUCKET = "lead-files";
const CF_CONNECTING_IP_HEADER = { "cf-connecting-ip": "203.0.113.10" };
const INTEGRATION_TURNSTILE_TOKEN = "integration-test-turnstile-token";

// Relative specifiers — this file lives outside src/, matching
// quote-pipeline.local.test.ts's own established reasoning exactly (the
// real initiate/upload/complete handlers unconditionally construct a real
// Cloudflare rate-limiter binding and Turnstile client that don't exist in
// this plain local Node process).
vi.mock("../../src/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/rate-limit.server")>();
  return { ...actual, getRateLimiterBinding: () => ({ limit: async () => ({ success: true }) }) };
});
vi.mock("../../src/server/turnstile.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/turnstile.server")>();
  return { ...actual, getTurnstileVerifier: () => ({ verify: async () => ({ ok: true }) }) };
});

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

/**
 * Bounded milliseconds for the reset subprocess itself — comfortably under
 * every existing hook/test budget that calls this (all are explicit
 * 120_000ms in this file; none rely on the bare 60_000ms default), leaving
 * real margin for whatever RPC work a test does after the reset returns.
 * Never raised to accommodate a slow reset — a reset that cannot finish in
 * 60s is exactly the failure this bound exists to surface promptly.
 */
const RESET_SUBPROCESS_DEADLINE_MS = 60_000;
/** Grace period after SIGTERM before escalating to SIGKILL — bounds total teardown time even if the child/group ignores SIGTERM. */
const RESET_KILL_GRACE_MS = 5_000;

/**
 * Async, bounded, logged replacement for the previous execFileSync-based
 * reset. execFileSync is synchronous — it blocks the entire Node event
 * loop until the child exits, which means Vitest's own async hook/test
 * timeout can never preempt a hung `supabase db reset`: the timer can only
 * fire once the blocking call finally returns, so a genuinely stuck reset
 * can silently run far longer than any declared timeout before Vitest even
 * gets a chance to report it — measured directly this session: a test in
 * this same integration suite failed with `AuthRetryableFetchError:
 * Database error creating new user` immediately after one of these resets,
 * during a period when the local stack was under heavy cumulative reset
 * load; whether that failure is itself reset-contamination or an
 * independent Auth-service issue was not established and is not assumed
 * here — this change only makes reset execution itself bounded, observed,
 * and interruptible, never silently blocking indefinitely. This version
 * spawns the child detached (its own process group, POSIX) so a
 * deadline-triggered kill can target the whole owned subprocess tree — not
 * just the immediate `npx` process, which would otherwise risk leaving an
 * orphaned `supabase`/docker-cli child behind — and always resolves or
 * rejects within RESET_SUBPROCESS_DEADLINE_MS (+ the short kill grace
 * period), never by raising any Vitest timeout value. Throwing on
 * deadline/non-zero-exit (rather than swallowing either) is deliberate: a
 * `beforeAll`/`afterAll` throw fails that hook immediately, which is what
 * stops Vitest from running any further test in this file against a
 * database left in an unknown, possibly-mid-reset state.
 */
async function resetLocalDatabase(): Promise<void> {
  const command = "npx supabase db reset";
  const startedAt = new Date();
  let stdout = "";
  let stderr = "";

  const child = spawn("npx", ["supabase", "db", "reset"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  const termTimer = setTimeout(() => {
    timedOut = true;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM"); // negative pid = whole process group
      } catch {
        // Process group already gone — nothing further to do.
      }
    }
    // Escalate to SIGKILL on the same group if SIGTERM alone hasn't finished it within the grace period.
    killTimer = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }, RESET_KILL_GRACE_MS);
  }, RESET_SUBPROCESS_DEADLINE_MS);

  // `settled` guards against the documented Node case where a spawn
  // failure can fire 'error' without 'close' ever following (there was no
  // real process to close) — without this listener, that path would hang
  // this promise forever, reproducing the exact unbounded-hang pathology
  // this rewrite exists to eliminate. Both listeners funnel through the
  // same settle() so timers are cleared identically on every exit path.
  let settled = false;
  let spawnError: Error | undefined;
  const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const settle = (code: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode: code, signal: sig });
    };
    child.on("error", (err) => {
      spawnError = err;
      settle(null, null);
    });
    child.on("close", (code, sig) => {
      settle(code, sig);
    });
  });

  const endedAt = new Date();
  const elapsedMs = endedAt.getTime() - startedAt.getTime();

  console.log(
    `[resetLocalDatabase] command=${JSON.stringify(command)} startedAt=${startedAt.toISOString()} ` +
      `endedAt=${endedAt.toISOString()} elapsedMs=${elapsedMs} exitCode=${exitCode} signal=${signal} ` +
      `timedOut=${timedOut} spawnError=${spawnError ? spawnError.message : "none"}`,
  );
  if (stdout.trim()) console.log(`[resetLocalDatabase] stdout:\n${stdout}`);
  if (stderr.trim()) console.log(`[resetLocalDatabase] stderr:\n${stderr}`);

  if (spawnError) {
    throw new Error(`resetLocalDatabase: failed to spawn ${command}: ${spawnError.message}`);
  }
  if (timedOut) {
    throw new Error(
      `resetLocalDatabase: deadline of ${RESET_SUBPROCESS_DEADLINE_MS}ms exceeded after ${elapsedMs}ms — ` +
        `subprocess tree terminated deliberately (not a completed reset). The local database's state is not ` +
        `guaranteed consistent; no further test in this file should run against it.`,
    );
  }
  if (exitCode !== 0) {
    throw new Error(
      `resetLocalDatabase: ${command} exited with code=${exitCode} signal=${signal} after ${elapsedMs}ms.\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
function buildJpegFixture(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_SIGNATURE, 0);
  for (let i = JPEG_SIGNATURE.length; i < size; i += 1) bytes[i] = i % 256;
  return bytes;
}
const SELLER_PHOTO_FIXTURE = buildJpegFixture(96);

function syntheticEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

async function obtainOtpForEmail(client: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const otp = (data.properties as { email_otp?: string } | undefined)?.email_otp;
  if (!otp) throw new Error("Local integration test: generateLink did not return an email_otp.");
  return otp;
}

async function mintOwnerAccessToken(serviceClient: SupabaseClient): Promise<string> {
  const { handleOwnerLoginVerifyCodeBody, getOwnerLoginAuthClient } = await import("../../src/server/owner-auth/owner-login.server");
  const email = syntheticEmail("c2j-bc-owner");
  const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !createdUser.user) throw createError ?? new Error("failed to create synthetic owner user");
  const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: createdUser.user.id });
  if (insertError) throw insertError;
  const otp = await obtainOtpForEmail(serviceClient, email);
  const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email, code: otp }), { auth: getOwnerLoginAuthClient() });
  if (result.status !== 200 || !result.body.ok) throw new Error(`verify-code did not succeed (status ${result.status})`);
  return result.body.session.accessToken;
}

function validSellerSubmission(overrides: Record<string, unknown> = {}) {
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
    sellerName: "C2J-BC Seller Fixture",
    sellerPhone: "+971500020001",
    sellerEmail: "c2j-bc.integration.seller@example.com",
    sellerPreferredContact: "whatsapp",
    ...overrides,
  };
}

function multipartUploadRequest(slotId: string, idempotencyKey: string, fileBytes: Uint8Array): Request {
  const formData = new FormData();
  formData.append("slotId", slotId);
  formData.append("idempotencyKey", idempotencyKey);
  formData.append("file", new File([fileBytes as BufferSource], "seller-photo.jpg", { type: "image/jpeg" }));
  return new Request("https://example.test/api/quote/upload", { method: "POST", headers: { ...CF_CONNECTING_IP_HEADER }, body: formData });
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
let anonClient: SupabaseClient;
let ownerAccessToken: string;
const createdObjectPaths: string[] = [];

let sellLeadId: string;
let sellFileId: string;
let sellObjectPath: string;
let buyLeadId: string;
let incompleteLeadId: string;

beforeAll(async () => {
  settings = getLocalSupabaseSettingsOrThrow();
  process.env["SUPABASE_URL"] = settings.apiUrl;
  process.env["SUPABASE_SECRET_KEY"] = settings.secretKey;

  serviceClient = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  anonClient = createClient(settings.apiUrl, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  await resetLocalDatabase();
  ownerAccessToken = await mintOwnerAccessToken(serviceClient);

  // Seller lead: full initiate -> upload -> complete through the real
  // handlers, exactly mirroring quote-pipeline.local.test.ts, so the
  // resulting lead_files row and Storage object are both entirely genuine.
  const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");
  const { handleQuoteUploadRequest } = await import("../../src/routes/api/quote/upload");
  const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");

  const sellIdempotencyKey = crypto.randomUUID();
  const initiateResponse = await handleQuoteInitiateRequest(
    new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
      body: JSON.stringify({
        idempotencyKey: sellIdempotencyKey,
        submission: validSellerSubmission(),
        files: [{ original_filename: "seller-photo.jpg", declared_mime_type: "image/jpeg", declared_byte_size: SELLER_PHOTO_FIXTURE.length }],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    }),
  );
  const initiateBody = await initiateResponse.json();
  sellLeadId = initiateBody.data.leadId;
  const slotId = initiateBody.data.uploadSlots[0].slotId;

  const uploadResponse = await handleQuoteUploadRequest(multipartUploadRequest(slotId, sellIdempotencyKey, SELLER_PHOTO_FIXTURE));
  const uploadBody = await uploadResponse.json();
  sellFileId = uploadBody.data.fileId;

  const slotRow = await serviceClient.from("quote_upload_slots").select("upload_object_path").eq("id", slotId).single();
  sellObjectPath = slotRow.data!.upload_object_path as string;
  createdObjectPaths.push(sellObjectPath);

  await handleQuoteCompleteRequest(
    new Request("https://example.test/api/quote/complete", {
      method: "POST",
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
      body: JSON.stringify({ leadId: sellLeadId, idempotencyKey: sellIdempotencyKey }),
    }),
  );

  // Buyer lead: completed with zero files, via the same direct RPC path
  // owner-lead-list.local.test.ts already established.
  const buyIdempotencyKey = crypto.randomUUID();
  const buyPayloadHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`c2j-bc-buy-${buyIdempotencyKey}`));
  const buyPayloadHash = Array.from(new Uint8Array(buyPayloadHashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: buyRpcData, error: buyRpcError } = await serviceClient.rpc("create_website_quote_v1", {
    p_idempotency_key: buyIdempotencyKey,
    p_payload_hash: buyPayloadHash,
    p_submission: {
      intent: "buy",
      source: "hero",
      material: "aluminium",
      buyerQuantityValue: "500",
      buyerQuantityUnit: "kg",
      buyerTradeRequirement: "local",
      buyerContactPerson: "C2J-BC Buyer Fixture",
      buyerPhone: "+971500020002",
      buyerPreferredContact: "whatsapp",
      buyerDestinationEmirate: "sharjah",
      buyerDestinationArea: "Industrial 3",
      buyerFulfilment: "delivery",
    },
    p_files: [],
  });
  if (buyRpcError) throw buyRpcError;
  buyLeadId = (buyRpcData as { lead_id: string }).lead_id;
  // A buyer lead with no files completes immediately (no upload slots to wait on).

  // Incomplete lead: initiated only, its one declared file never uploaded —
  // submission_completed_at stays null.
  const incompleteIdempotencyKey = crypto.randomUUID();
  const incompleteInitiateResponse = await handleQuoteInitiateRequest(
    new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
      body: JSON.stringify({
        idempotencyKey: incompleteIdempotencyKey,
        submission: validSellerSubmission({ sellerPhone: "+971500020003" }),
        files: [{ original_filename: "never-uploaded.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 64 }],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    }),
  );
  const incompleteBody = await incompleteInitiateResponse.json();
  incompleteLeadId = incompleteBody.data.leadId;
}, 120_000);

afterAll(async () => {
  try {
    if (settings && createdObjectPaths.length > 0) {
      const cleanupClient = createClient(settings.apiUrl, settings.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await cleanupClient.storage.from(LEAD_FILES_BUCKET).remove(createdObjectPaths).catch(() => undefined);
    }
  } finally {
    await resetLocalDatabase();
    await reprovisionDemoOwnerIfMissing(serviceClient);
  }
}, 120_000);

function ownerRequest(path: string, method = "GET"): Request {
  return new Request(`https://example.test${path}`, { method, headers: { authorization: `Bearer ${ownerAccessToken}` } });
}

describe("CHECKPOINT C2J-B — real local owner lead-detail service", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  it("the active demo/test owner can fetch a completed seller lead's detail, with exact seller mapping and its one file/activity", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
    const response = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${sellLeadId}`), sellLeadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.lead.intent).toBe("sell");
    expect(body.data.lead.contact).toEqual({ name: "C2J-BC Seller Fixture", phone: "+971500020001", email: "c2j-bc.integration.seller@example.com", company: null });
    expect(body.data.lead.enquiry.condition).toBe("clean_separated");
    expect(body.data.files).toHaveLength(1);
    expect(body.data.files[0].id).toBe(sellFileId);
    expect(body.data.files[0].mimeType).toBe("image/jpeg");
    expect(body.data.files[0].uploadStatus).toBe("complete");
    const eventTypes = body.data.activities.map((a: { eventType: string }) => a.eventType).sort();
    expect(eventTypes).toEqual(["lead_created", "submission_completed"]);
    expect(body.data.notification.status).toBe("pending");
  });

  it("the active owner can fetch a completed buyer lead's detail, with exact buyer mapping and zero files", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
    const response = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${buyLeadId}`), buyLeadId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.lead.intent).toBe("buy");
    expect(body.data.lead.contact).toEqual({ name: "C2J-BC Buyer Fixture", phone: "+971500020002", email: null, company: null });
    expect(body.data.lead.enquiry.tradeRequirement).toBe("local");
    expect(body.data.files).toHaveLength(0);
  });

  it("an incomplete lead returns the generic 404 — never revealing that it exists", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
    const response = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${incompleteLeadId}`), incompleteLeadId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("a nonexistent lead returns the byte-identical 404 as the incomplete lead", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
    const nonexistentId = crypto.randomUUID();
    const incompleteResponse = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${incompleteLeadId}`), incompleteLeadId);
    const nonexistentResponse = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${nonexistentId}`), nonexistentId);
    expect(await incompleteResponse.text()).toBe(await nonexistentResponse.text());
  });

  it("the seller lead's detail response never contains the storage path or signed-URL token", async () => {
    const { handleOwnerLeadDetailRequest } = await import("../../src/routes/api/owner/leads/$leadId");
    const response = await handleOwnerLeadDetailRequest(ownerRequest(`/api/owner/leads/${sellLeadId}`), sellLeadId);
    const raw = await response.text();
    expect(raw).not.toContain(sellObjectPath);
    expect(raw).not.toMatch(/token=/);
  });
});

describe("CHECKPOINT C2J-C — real local private-file signed-URL access", () => {
  it("the active owner can request a signed URL for the seller lead's real uploaded file, and the exact synthetic bytes are retrievable", async () => {
    const { handleOwnerLeadFileAccessRequest } = await import("../../src/routes/api/owner/leads/$leadId.files.$fileId.access");
    const response = await handleOwnerLeadFileAccessRequest(ownerRequest(`/api/owner/leads/${sellLeadId}/files/${sellFileId}/access`, "POST"), sellLeadId, sellFileId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.expiresInSeconds).toBe(60);
    expect(typeof body.data.url).toBe("string");
    expect(Object.keys(body.data).sort()).toEqual(["expiresInSeconds", "url"]);

    const fetched = await fetch(body.data.url);
    expect(fetched.status).toBe(200);
    const fetchedBytes = new Uint8Array(await fetched.arrayBuffer());
    expect(Array.from(fetchedBytes)).toEqual(Array.from(SELLER_PHOTO_FIXTURE));
  });

  it("the signed URL response carries no separate storage_path field or service-role key — only the URL, which necessarily embeds the object path as part of Supabase's own signed-URL scheme, and a short-lived token", async () => {
    const { handleOwnerLeadFileAccessRequest } = await import("../../src/routes/api/owner/leads/$leadId.files.$fileId.access");
    const response = await handleOwnerLeadFileAccessRequest(ownerRequest(`/api/owner/leads/${sellLeadId}/files/${sellFileId}/access`, "POST"), sellLeadId, sellFileId);
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(["expiresInSeconds", "url"]);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"storage_path"|"storagePath"/);
    expect(raw).not.toMatch(/service_role|SUPABASE_SECRET_KEY/i);
  });

  it("a real file requested against the WRONG lead id is denied with the generic 404", async () => {
    const { handleOwnerLeadFileAccessRequest } = await import("../../src/routes/api/owner/leads/$leadId.files.$fileId.access");
    const response = await handleOwnerLeadFileAccessRequest(ownerRequest(`/api/owner/leads/${buyLeadId}/files/${sellFileId}/access`, "POST"), buyLeadId, sellFileId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("a nonexistent file id against the real lead is denied with the identical generic 404", async () => {
    const { handleOwnerLeadFileAccessRequest } = await import("../../src/routes/api/owner/leads/$leadId.files.$fileId.access");
    const missingFileId = crypto.randomUUID();
    const response = await handleOwnerLeadFileAccessRequest(ownerRequest(`/api/owner/leads/${sellLeadId}/files/${missingFileId}/access`, "POST"), sellLeadId, missingFileId);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("an incomplete lead cannot access any file, even with a syntactically valid fileId", async () => {
    const { handleOwnerLeadFileAccessRequest } = await import("../../src/routes/api/owner/leads/$leadId.files.$fileId.access");
    const someFileId = crypto.randomUUID();
    const response = await handleOwnerLeadFileAccessRequest(ownerRequest(`/api/owner/leads/${incompleteLeadId}/files/${someFileId}/access`, "POST"), incompleteLeadId, someFileId);
    expect(response.status).toBe(404);
  });

  it("keeps the bucket private: anon cannot download the object directly, only a minted signed URL works", async () => {
    const bucket = await serviceClient.storage.getBucket(LEAD_FILES_BUCKET);
    expect(bucket.data?.public).toBe(false);
    const anonDownload = await anonClient.storage.from(LEAD_FILES_BUCKET).download(sellObjectPath);
    expect(anonDownload.error).not.toBeNull();
  });
});

describe("CHECKPOINT C2J-B/C — cleanup", () => {
  it("cleans up the local Storage object and resets the local database, leaving zero rows/objects and a re-provisioned demo owner", async () => {
    const removal = await serviceClient.storage.from(LEAD_FILES_BUCKET).remove(createdObjectPaths);
    expect(removal.error).toBeNull();

    await resetLocalDatabase();

    const [leads, activities, slots, files, notifications, ownerAccounts] = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }),
      serviceClient.from("quote_upload_slots").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_files").select("id", { count: "exact", head: true }),
      serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }),
      serviceClient.from("owner_accounts").select("user_id", { count: "exact", head: true }),
    ]);
    expect(leads.count).toBe(0);
    expect(activities.count).toBe(0);
    expect(slots.count).toBe(0);
    expect(files.count).toBe(0);
    expect(notifications.count).toBe(0);
    expect(ownerAccounts.count).toBe(0);

    // storage.objects lives outside PostgREST's exposed public schema, so it
    // is verified via the Storage API's own list() (which walks the same
    // bucket this suite created every object in), not a cross-schema
    // PostgREST query.
    const remainingObjects = await serviceClient.storage.from(LEAD_FILES_BUCKET).list("quote-uploads", { limit: 1000 });
    expect((remainingObjects.data ?? []).length).toBe(0);

    const postResetDownload = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(sellObjectPath);
    expect(postResetDownload.error).not.toBeNull();

    await reprovisionDemoOwnerIfMissing(serviceClient);
    const { count: reprovisioned } = await serviceClient.from("owner_accounts").select("user_id", { count: "exact", head: true });
    expect(reprovisioned).toBe(1);
  }, 120_000); // resetLocalDatabase() alone can take the majority of the default 60s budget.
});
