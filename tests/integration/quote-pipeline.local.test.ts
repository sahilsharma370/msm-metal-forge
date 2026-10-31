/**
 * CHECKPOINT C2C — permanent, local-only end-to-end integration test for
 * the Quote submission pipeline: initiate -> claim -> upload -> finalize,
 * exercised through the REAL route handlers (src/routes/api/quote/initiate.ts,
 * src/routes/api/quote/upload.ts) against a REAL local Supabase Postgres +
 * Storage stack (`npx supabase start`). Nothing in this file mocks
 * createSupabaseAdminClient, rpc, storage.upload/download/remove, or either
 * route handler — that is the entire point of this checkpoint.
 *
 * Deliberately NOT part of `npm test` (see vitest.integration.config.ts's
 * own comment) — only reachable via `npm run test:integration:local`, and
 * only ever runs after the safety gate below passes.
 *
 * SAFETY GATE — read before touching this file:
 *   1. getLocalSupabaseSettingsOrThrow() is the ONLY way this file learns
 *      SUPABASE_URL/keys — always from `npx supabase status -o json`
 *      (a local CLI command), never from a checked-in .env file.
 *   2/3. It fails closed unless the reported API_URL's hostname is exactly
 *      "localhost" or "127.0.0.1", and explicitly rejects any *.supabase.co
 *      hostname — this runs before any other integration operation.
 *   4/5. The anon/service-role keys returned by that function are held only
 *      in local variables and process.env for this process's own lifetime.
 *      They are never passed to expect()/console/any assertion message,
 *      never written to a file, and this file must stay that way.
 *   6. Only `supabase status`, `supabase db reset` and ordinary
 *      supabase-js calls against the validated local API_URL are ever run
 *      here — no `--linked`, no `projects list`, no `db push`, no
 *      `migration repair`, no `functions deploy`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LEAD_FILES_BUCKET = "lead-files";

// ---------------------------------------------------------------------------
// CHECKPOINT C2G — this file's whole point is Postgres/Storage correctness
// through the REAL route handlers, not abuse-protection behavior (that has
// its own exhaustive, DI-based coverage in initiate.test.ts/upload.test.ts/
// complete.test.ts). The real handlers unconditionally construct a REAL
// Cloudflare rate-limiter binding and a REAL Turnstile Siteverify client —
// neither exists in this plain local Node process (no Cloudflare Worker
// runtime, and hitting the real https://challenges.cloudflare.com endpoint
// would violate this checkpoint's own "no remote Cloudflare access" rule).
// Mocking exactly these two modules to always-allow keeps every other real
// dependency (Supabase admin client, RPCs, Storage) completely untouched —
// consistent with this file's own "nothing mocks the route handler" intent,
// which was always specifically about Supabase, not this unrelated layer.
// ---------------------------------------------------------------------------
// Relative specifiers, not the "@/..." alias — this file lives outside
// src/, and the "@/..." alias does not resolve from here (confirmed: using
// it left this mock silently unattached, with the REAL rate-limit/turnstile
// modules still running underneath and failing closed on every request).
// Vitest resolves vi.mock's target to an absolute module id before
// intercepting, so this still applies correctly to the same file
// initiate.ts/upload.ts/complete.ts import via "@/server/...".
vi.mock("../../src/server/rate-limit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/rate-limit.server")>();
  return {
    ...actual,
    getRateLimiterBinding: () => ({ limit: async () => ({ success: true }) }),
  };
});

// A vi.fn() (not a plain closure) so CHECKPOINT C2G-LT's own tests below can
// swap in the REAL createCloudflareTurnstileVerifier (imported via
// importOriginal, with a fake fetchImpl — never a real network call) for
// exactly the two tests that need genuine verify() logic; every other test
// in this file is unaffected by the default always-ok implementation.
const turnstileVerifierMock = vi.fn(() => ({ verify: async () => ({ ok: true }) }));
vi.mock("../../src/server/turnstile.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/turnstile.server")>();
  return {
    ...actual,
    getTurnstileVerifier: (request: Request) => turnstileVerifierMock(request),
  };
});

// A fixed, documented TEST-NET-3 (RFC 5737) address — never a real client
// IP — standing in for the Cloudflare-edge-set `CF-Connecting-IP` header
// every real request would carry. Merged into every Request built below.
const CF_CONNECTING_IP_HEADER = { "cf-connecting-ip": "203.0.113.10" };
const INTEGRATION_TURNSTILE_TOKEN = "integration-test-turnstile-token";

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

interface LocalSupabaseSettings {
  apiUrl: string;
  anonKey: string;
  secretKey: string;
}

/**
 * Obtains local Supabase connection settings via the local CLI's own status
 * command — never from a checked-in .env file, never guessed. Fails closed
 * (throws) unless the reported API URL's hostname is exactly "localhost" or
 * "127.0.0.1", and explicitly rejects any hosted *.supabase.co hostname.
 * This must run before ANY other integration operation in this file.
 */
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

  // Explicit, independent rejection of any hosted Supabase URL — checked
  // before, and regardless of, the allowlist check below.
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
  // Never --linked — this only ever resets the local Postgres container
  // this same process just validated the hostname of.
  execFileSync("npx", ["supabase", "db", "reset"], { cwd: process.cwd(), stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Deterministic in-code fixtures — no binary fixture files, no customer data
// ---------------------------------------------------------------------------

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function buildJpegFixture(size: number, pattern: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_SIGNATURE, 0);
  for (let i = JPEG_SIGNATURE.length; i < size; i += 1) {
    bytes[i] = (i + pattern) % 256;
  }
  return bytes;
}

const ORIGINAL_FIXTURE = buildJpegFixture(64, 0);
const CHANGED_FIXTURE = buildJpegFixture(64, 1); // same length, different content
const SPOOFED_PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function buildPngFixture(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(SPOOFED_PNG_SIGNATURE, 0);
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
    sellerQuantityValue: "100",
    sellerQuantityUnit: "kg",
    sellerQuantityUnsure: false,
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "no",
    sellerName: "Integration Test Seller",
    sellerPhone: "+971501234567",
    sellerPreferredContact: "whatsapp",
  };
}

function multipartUploadRequest(slotId: string, idempotencyKey: string, fileBytes: Uint8Array): Request {
  const formData = new FormData();
  formData.append("slotId", slotId);
  formData.append("idempotencyKey", idempotencyKey);
  formData.append("file", new File([fileBytes as BufferSource], "integration.jpg", { type: "image/jpeg" }));
  return new Request("https://example.test/api/quote/upload", {
    method: "POST",
    headers: { ...CF_CONNECTING_IP_HEADER },
    body: formData,
  });
}

// ---------------------------------------------------------------------------
// Suite state
// ---------------------------------------------------------------------------

let settings: LocalSupabaseSettings;
let serviceClient: SupabaseClient;
let anonClient: SupabaseClient;
const createdObjectPaths: string[] = [];

let leadOneId: string;
let slotOneId: string;
let idempotencyKeyOne: string;
let fileOneId: string;
let objectPathOne: string;

let leadTwoId: string;
let slotTwoId: string;
let idempotencyKeyTwo: string;

beforeAll(() => {
  settings = getLocalSupabaseSettingsOrThrow();

  // Only ever set for this process's own lifetime — this is exactly how the
  // real route handlers' own createSupabaseAdminClient()/getServerEnv()
  // discover which project to talk to; setting it here (never in a checked
  // -in .env) is what lets the REAL handlers run against the REAL local
  // stack without any mocking.
  process.env["SUPABASE_URL"] = settings.apiUrl;
  process.env["SUPABASE_SECRET_KEY"] = settings.secretKey;

  serviceClient = createClient(settings.apiUrl, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  anonClient = createClient(settings.apiUrl, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  resetLocalDatabase();
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
    // Always runs, even if the try block above throws or any test in this
    // file failed — no local test records may remain afterward.
    resetLocalDatabase();
  }
}, 120_000);

// ---------------------------------------------------------------------------
// A/B/C — initiate through the real handler, verify DB state before upload
// ---------------------------------------------------------------------------

describe("CHECKPOINT C2C — real local Quote submission + upload pipeline", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  it("creates exactly one lead with one pending upload slot and no files, via the real initiate handler", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");

    idempotencyKeyOne = crypto.randomUUID();
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
      body: JSON.stringify({
        idempotencyKey: idempotencyKeyOne,
        submission: validSellerSubmission(),
        files: [
          {
            original_filename: "integration.jpg",
            declared_mime_type: "image/jpeg",
            declared_byte_size: ORIGINAL_FIXTURE.length,
          },
        ],
        turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
      }),
    });

    const response = await handleQuoteInitiateRequest(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);
    expect(body.data.idempotentReplay).toBe(false);
    expect(body.data.uploadSlots).toHaveLength(1);

    leadOneId = body.data.leadId;
    slotOneId = body.data.uploadSlots[0].slotId;
    expect(body.data.uploadSlots[0].kind).toBe("seller_photo");
    expect(body.data.uploadSlots[0].declaredByteSize).toBe(ORIGINAL_FIXTURE.length);

    const leadCount = await serviceClient
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("id", leadOneId);
    expect(leadCount.count).toBe(1);

    const activityCount = await serviceClient
      .from("lead_activities")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId)
      .eq("event_type", "lead_created");
    expect(activityCount.count).toBe(1);

    const slotRows = await serviceClient
      .from("quote_upload_slots")
      .select("id, status, verified_file_id")
      .eq("lead_id", leadOneId);
    expect(slotRows.data).toHaveLength(1);
    expect(slotRows.data?.[0]?.status).toBe("pending");
    expect(slotRows.data?.[0]?.verified_file_id).toBeNull();

    const fileCount = await serviceClient
      .from("lead_files")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId);
    expect(fileCount.count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // D/E — upload through the real handler; verify DB row + Storage object
  // -------------------------------------------------------------------------

  it("uploads the declared file through the real upload handler and verifies DB + Storage state", async () => {
    const { handleQuoteUploadRequest } = await import("../../src/routes/api/quote/upload");

    const response = await handleQuoteUploadRequest(
      multipartUploadRequest(slotOneId, idempotencyKeyOne, ORIGINAL_FIXTURE),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("verified");
    expect(body.data.replayed).toBe(false);
    expect(body.data.slotId).toBe(slotOneId);

    fileOneId = body.data.fileId;

    const slotRow = await serviceClient
      .from("quote_upload_slots")
      .select("status, verified_file_id, upload_object_path")
      .eq("id", slotOneId)
      .single();
    expect(slotRow.data?.status).toBe("verified");
    expect(slotRow.data?.verified_file_id).toBe(fileOneId);
    expect(typeof slotRow.data?.upload_object_path).toBe("string");
    objectPathOne = slotRow.data!.upload_object_path as string;
    createdObjectPaths.push(objectPathOne);

    const expectedChecksum = await sha256Hex(ORIGINAL_FIXTURE);

    const fileRows = await serviceClient
      .from("lead_files")
      .select("id, lead_id, storage_path, detected_mime_type, byte_size, checksum_sha256")
      .eq("lead_id", leadOneId);
    expect(fileRows.data).toHaveLength(1);
    const fileRow = fileRows.data![0]!;
    expect(fileRow.id).toBe(fileOneId);
    expect(fileRow.storage_path).toBe(objectPathOne);
    expect(fileRow.detected_mime_type).toBe("image/jpeg");
    expect(fileRow.byte_size).toBe(ORIGINAL_FIXTURE.length);
    expect(fileRow.checksum_sha256).toBe(expectedChecksum);

    const download = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(download.error).toBeNull();
    const downloadedBytes = new Uint8Array(await download.data!.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(ORIGINAL_FIXTURE));
  });

  // -------------------------------------------------------------------------
  // F — privacy proof
  // -------------------------------------------------------------------------

  it("keeps the bucket private: anon cannot list/download, service-role can read the exact object", async () => {
    const bucket = await serviceClient.storage.getBucket(LEAD_FILES_BUCKET);
    expect(bucket.data?.public).toBe(false);

    const anonDownload = await anonClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(anonDownload.error).not.toBeNull();
    expect(anonDownload.data).toBeNull();

    const anonList = await anonClient.storage.from(LEAD_FILES_BUCKET).list(`quote-uploads/${leadOneId}`);
    const anonListedOurObject = (anonList.data ?? []).length > 0;
    expect(anonList.error !== null || !anonListedOurObject).toBe(true);

    const serviceDownload = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(serviceDownload.error).toBeNull();
    expect(serviceDownload.data).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // G — idempotency / replay proof
  // -------------------------------------------------------------------------

  it("replays the exact same upload idempotently, creating no duplicate Storage object, file, slot or activity", async () => {
    const { handleQuoteUploadRequest } = await import("../../src/routes/api/quote/upload");

    const before = await Promise.all([
      serviceClient.from("lead_files").select("id", { count: "exact", head: true }).eq("lead_id", leadOneId),
      serviceClient
        .from("quote_upload_slots")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
      serviceClient
        .from("lead_activities")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
    ]);

    const response = await handleQuoteUploadRequest(
      multipartUploadRequest(slotOneId, idempotencyKeyOne, ORIGINAL_FIXTURE),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.replayed).toBe(true);
    expect(body.data.fileId).toBe(fileOneId);

    const after = await Promise.all([
      serviceClient.from("lead_files").select("id", { count: "exact", head: true }).eq("lead_id", leadOneId),
      serviceClient
        .from("quote_upload_slots")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
      serviceClient
        .from("lead_activities")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
    ]);

    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
    expect(after[2].count).toBe(before[2].count);
    expect(after[0].count).toBe(1);
  });

  it("rejects a changed-content replay as a verified mismatch, leaving the original object and rows unchanged", async () => {
    const { handleQuoteUploadRequest } = await import("../../src/routes/api/quote/upload");

    const response = await handleQuoteUploadRequest(
      multipartUploadRequest(slotOneId, idempotencyKeyOne, CHANGED_FIXTURE),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ALREADY_VERIFIED_MISMATCH");
    expect(body.error.retryable).toBe(false);

    const fileCount = await serviceClient
      .from("lead_files")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId);
    expect(fileCount.count).toBe(1);

    const download = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(download.error).toBeNull();
    const downloadedBytes = new Uint8Array(await download.data!.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(ORIGINAL_FIXTURE));
  });

  // -------------------------------------------------------------------------
  // H — validation isolation proof (a second, independent lead + slot)
  // -------------------------------------------------------------------------

  it("rejects spoofed bytes on a fresh, independent slot without creating rows or touching the first lead's verified file", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");
    const { handleQuoteUploadRequest } = await import("../../src/routes/api/quote/upload");

    idempotencyKeyTwo = crypto.randomUUID();
    const spoofed = buildPngFixture(64);
    const initiateResponse = await handleQuoteInitiateRequest(
      new Request("https://example.test/api/quote/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyTwo,
          submission: validSellerSubmission(),
          files: [
            {
              original_filename: "second.jpg",
              declared_mime_type: "image/jpeg",
              declared_byte_size: spoofed.length,
            },
          ],
          turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
        }),
      }),
    );
    expect(initiateResponse.status).toBe(200);
    const initiateBody = await initiateResponse.json();
    leadTwoId = initiateBody.data.leadId;
    slotTwoId = initiateBody.data.uploadSlots[0].slotId;

    const uploadResponse = await handleQuoteUploadRequest(
      multipartUploadRequest(slotTwoId, idempotencyKeyTwo, spoofed),
    );
    expect(uploadResponse.status).toBe(400);
    const uploadBody = await uploadResponse.json();
    expect(uploadBody.ok).toBe(false);
    expect(uploadBody.error.code).toBe("VALIDATION_ERROR");

    const leadTwoFileCount = await serviceClient
      .from("lead_files")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadTwoId);
    expect(leadTwoFileCount.count).toBe(0);

    const leadTwoSlot = await serviceClient
      .from("quote_upload_slots")
      .select("status")
      .eq("id", slotTwoId)
      .single();
    expect(leadTwoSlot.data?.status).toBe("pending");

    // The first lead's already-verified file must be completely unaffected
    // by an unrelated slot's rejected upload.
    const leadOneFileCount = await serviceClient
      .from("lead_files")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId);
    expect(leadOneFileCount.count).toBe(1);

    const download = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(download.error).toBeNull();
    const downloadedBytes = new Uint8Array(await download.data!.arrayBuffer());
    expect(Array.from(downloadedBytes)).toEqual(Array.from(ORIGINAL_FIXTURE));
  });

  // -------------------------------------------------------------------------
  // I — CHECKPOINT C2E: /api/quote/complete through the real handler
  // -------------------------------------------------------------------------

  it("completes the fully-uploaded lead through the real /api/quote/complete handler", async () => {
    const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");

    const response = await handleQuoteCompleteRequest(
      new Request("https://example.test/api/quote/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({ leadId: leadOneId, idempotencyKey: idempotencyKeyOne }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.leadId).toBe(leadOneId);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);
    // The lead completes automatically the instant its last (only) slot
    // verified, via the CHECKPOINT C2D-A trigger — by the time the browser
    // calls this endpoint, completion has already genuinely happened.
    // alreadyCompleted:true here is the CORRECT, expected outcome for the
    // normal happy path, not a failure of this endpoint or a stale result.
    expect(body.data.alreadyCompleted).toBe(true);

    const lead = await serviceClient
      .from("leads")
      .select("file_upload_status, submission_completed_at, status, reference")
      .eq("id", leadOneId)
      .single();
    expect(lead.data?.file_upload_status).toBe("complete");
    expect(lead.data?.submission_completed_at).not.toBeNull();
    expect(lead.data?.status).toBe("new");
    expect(lead.data?.reference).toBe(body.data.reference);

    const activities = await serviceClient.from("lead_activities").select("event_type").eq("lead_id", leadOneId);
    const eventTypes = (activities.data ?? []).map((a) => a.event_type as string).sort();
    expect(eventTypes).toEqual(["lead_created", "submission_completed"]);

    const notifications = await serviceClient
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId)
      .eq("event_type", "submission_completed")
      .eq("channel", "email");
    expect(notifications.count).toBe(1);

    const slots = await serviceClient.from("quote_upload_slots").select("status").eq("lead_id", leadOneId);
    expect(slots.data?.every((s) => s.status === "verified")).toBe(true);
    expect(slots.data?.some((s) => s.status === "uploading")).toBe(false);

    const files = await serviceClient
      .from("lead_files")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadOneId);
    expect(files.count).toBe(1);
  });

  it("replays the completion request idempotently — same genuine reference, no duplicate activity or notification rows", async () => {
    const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");

    const before = await Promise.all([
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadOneId),
      serviceClient
        .from("notification_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
    ]);

    const response = await handleQuoteCompleteRequest(
      new Request("https://example.test/api/quote/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({ leadId: leadOneId, idempotencyKey: idempotencyKeyOne }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.alreadyCompleted).toBe(true);
    expect(body.data.reference).toMatch(/^MSM-\d{6}-[0-9A-F]{6}$/);

    const after = await Promise.all([
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }).eq("lead_id", leadOneId),
      serviceClient
        .from("notification_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadOneId),
    ]);
    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
  });

  it("rejects a completion attempt with the wrong idempotency key exactly like a nonexistent lead — no enumeration leak", async () => {
    const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");
    const response = await handleQuoteCompleteRequest(
      new Request("https://example.test/api/quote/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({ leadId: leadOneId, idempotencyKey: crypto.randomUUID() }),
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a completion attempt for a lead with unresolved upload slots, leaving it uncompleted", async () => {
    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");
    const { handleQuoteCompleteRequest } = await import("../../src/routes/api/quote/complete");

    const idempotencyKeyThree = crypto.randomUUID();
    const initiateResponse = await handleQuoteInitiateRequest(
      new Request("https://example.test/api/quote/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyThree,
          submission: validSellerSubmission(),
          files: [{ original_filename: "third.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 64 }],
          turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
        }),
      }),
    );
    const initiateBody = await initiateResponse.json();
    const leadThreeId = initiateBody.data.leadId as string;

    const response = await handleQuoteCompleteRequest(
      new Request("https://example.test/api/quote/complete", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({ leadId: leadThreeId, idempotencyKey: idempotencyKeyThree }),
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_READY");

    const lead = await serviceClient
      .from("leads")
      .select("submission_completed_at")
      .eq("id", leadThreeId)
      .single();
    expect(lead.data?.submission_completed_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // I2 — CHECKPOINT C2G-LT: Turnstile local-test-mode boundary, through the
  // REAL initiate handler + REAL RPC. Every check on WHEN localTestMode may
  // activate is already exhaustively unit-tested in turnstile.server.test.ts
  // (pure verify() logic, fake fetchImpl, no DB); the two tests here prove
  // the one thing that file cannot: what the downstream lead-creation
  // boundary does with the verdict. turnstileVerifierMock is swapped with
  // mockImplementationOnce for exactly one call each, so every other test
  // in this file keeps the default always-ok behavior.
  // -------------------------------------------------------------------------

  it("a Siteverify response that does not match the exact synthetic test-key shape is still rejected even with localTestMode on, and creates no lead", async () => {
    const actualTurnstile = await vi.importActual<typeof import("../../src/server/turnstile.server")>(
      "../../src/server/turnstile.server",
    );
    turnstileVerifierMock.mockImplementationOnce(() =>
      actualTurnstile.createCloudflareTurnstileVerifier(
        {
          secretKey: "irrelevant-in-this-test",
          expectedAction: actualTurnstile.TURNSTILE_EXPECTED_ACTION,
          allowedHostnames: ["localhost"],
          localTestMode: true,
        },
        // A real widget response shape (has an action, wrong hostname) —
        // NOT Cloudflare's fixed test-key synthetic shape — so the
        // carve-out must not apply even though localTestMode is on.
        async () =>
          new Response(
            JSON.stringify({ success: true, action: actualTurnstile.TURNSTILE_EXPECTED_ACTION, hostname: "not-allowed.test" }),
            { status: 200 },
          ),
      ),
    );

    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");
    const idempotencyKey = crypto.randomUUID();
    const response = await handleQuoteInitiateRequest(
      new Request("https://example.test/api/quote/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: JSON.stringify({
          idempotencyKey,
          submission: validSellerSubmission(),
          files: [],
          turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
        }),
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("VERIFICATION_REQUIRED");

    const lead = await serviceClient.from("leads").select("id", { count: "exact", head: true }).eq("idempotency_key", idempotencyKey);
    expect(lead.count).toBe(0);
  });

  it("Cloudflare's official always-pass TEST-key synthetic response (no action, hostname:example.com) is accepted only with localTestMode on, and creates exactly one durable lead across an idempotent replay", async () => {
    const actualTurnstile = await vi.importActual<typeof import("../../src/server/turnstile.server")>(
      "../../src/server/turnstile.server",
    );
    const syntheticFetch = async () =>
      new Response(JSON.stringify({ success: true, hostname: "example.com" }), { status: 200 });
    const localTestVerifier = () =>
      actualTurnstile.createCloudflareTurnstileVerifier(
        {
          secretKey: "irrelevant-in-this-test",
          expectedAction: actualTurnstile.TURNSTILE_EXPECTED_ACTION,
          allowedHostnames: ["localhost"],
          localTestMode: true,
        },
        syntheticFetch,
      );

    const { handleQuoteInitiateRequest } = await import("../../src/routes/api/quote/initiate");
    const idempotencyKey = crypto.randomUUID();
    const requestBody = JSON.stringify({
      idempotencyKey,
      submission: validSellerSubmission(),
      files: [],
      turnstileToken: INTEGRATION_TURNSTILE_TOKEN,
    });

    turnstileVerifierMock.mockImplementationOnce(localTestVerifier);
    const first = await handleQuoteInitiateRequest(
      new Request("https://example.test/api/quote/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: requestBody,
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.data.idempotentReplay).toBe(false);

    // Replay with the exact same idempotencyKey — the RPC's own idempotency
    // guarantee, not this test's own dedup, is what must hold here.
    turnstileVerifierMock.mockImplementationOnce(localTestVerifier);
    const second = await handleQuoteInitiateRequest(
      new Request("https://example.test/api/quote/initiate", {
        method: "POST",
        headers: { "content-type": "application/json", ...CF_CONNECTING_IP_HEADER },
        body: requestBody,
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.ok).toBe(true);
    expect(secondBody.data.idempotentReplay).toBe(true);
    expect(secondBody.data.leadId).toBe(firstBody.data.leadId);

    const leads = await serviceClient.from("leads").select("id", { count: "exact", head: true }).eq("idempotency_key", idempotencyKey);
    expect(leads.count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // J — explicit cleanup + verification (afterAll is the unconditional
  // safety net for the failure case; this test performs and verifies the
  // same cleanup on the success path)
  // -------------------------------------------------------------------------

  it("cleans up the local Storage object and resets the local database, leaving zero rows and no test object behind", async () => {
    const removal = await serviceClient.storage.from(LEAD_FILES_BUCKET).remove([objectPathOne]);
    expect(removal.error).toBeNull();

    resetLocalDatabase();

    const [leads, activities, slots, files, notifications] = await Promise.all([
      serviceClient.from("leads").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_activities").select("id", { count: "exact", head: true }),
      serviceClient.from("quote_upload_slots").select("id", { count: "exact", head: true }),
      serviceClient.from("lead_files").select("id", { count: "exact", head: true }),
      serviceClient.from("notification_deliveries").select("id", { count: "exact", head: true }),
    ]);
    expect(leads.count).toBe(0);
    expect(activities.count).toBe(0);
    expect(slots.count).toBe(0);
    expect(files.count).toBe(0);
    expect(notifications.count).toBe(0);

    const postResetDownload = await serviceClient.storage.from(LEAD_FILES_BUCKET).download(objectPathOne);
    expect(postResetDownload.error).not.toBeNull();
  });
});
