/**
 * CHECKPOINT C2I-A — permanent, local-only end-to-end integration test for
 * the owner authentication/authorization foundation, exercised through the
 * REAL handleOwnerLoginVerifyCodeBody() / verifyOwnerSession() /
 * handleOwnerSessionRequest() functions against a REAL local Supabase
 * Postgres + Auth stack (`npx supabase start`). Nothing here mocks
 * Supabase, the RPC client, or the verifier logic itself — that is the
 * entire point of this checkpoint's integration coverage.
 *
 * Never depends on the real demo owner email — every fixture uses a fresh
 * synthetic `*.example.test` address, and the synthetic auth user is
 * created exclusively through the service-role Admin API (a test-only
 * admin path), never any public signup surface.
 *
 * OTP delivery: this suite deliberately does NOT call the real
 * request-code path (which would actually attempt to send an email through
 * the local stack's own SMTP capture and spend Supabase's own limited
 * local `auth.rate_limit.email_sent` budget — 2/hour, see
 * supabase/config.toml). Instead it uses
 * `serviceClient.auth.admin.generateLink({ type: "magiclink", email })`,
 * which returns the six-digit `email_otp` directly via the Admin API
 * without sending or capturing any email — the safest available local
 * equivalent to real OTP delivery, and the same mechanism Supabase's own
 * documentation recommends for local/CI passwordless-flow testing. The
 * OTP is then verified through the REAL production verify-code function,
 * exactly as a real request would be.
 *
 * Deliberately NOT part of `npm test` (see vitest.integration.config.ts's
 * own comment) — only reachable via `npm run test:integration:local`.
 *
 * SAFETY GATE — identical pattern to notification-dispatch.local.test.ts /
 * quote-pipeline.local.test.ts (see those files' own header comments for
 * the full reasoning): local Supabase connection settings come exclusively
 * from `npx supabase status -o json`, fail closed unless the reported
 * hostname is exactly "localhost" or "127.0.0.1", and explicitly reject
 * any *.supabase.co hostname. Only `supabase status`, `supabase db reset`,
 * and ordinary supabase-js calls against the validated local API_URL are
 * ever run here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleOwnerLoginVerifyCodeBody, getOwnerLoginAuthClient } from "../../src/server/owner-auth/owner-login.server";
import { handleOwnerSessionRequest } from "../../src/routes/api/owner/session";

// ---------------------------------------------------------------------------
// Safety gate (duplicated from the existing local integration suites by
// design — each integration suite owns its own copy)
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
// Fixture helpers
// ---------------------------------------------------------------------------

function syntheticEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

/** Obtains a real, usable six-digit OTP for `email` without sending or capturing any email — see this file's own header comment. */
async function obtainOtpForEmail(client: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await client.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const otp = (data.properties as { email_otp?: string } | undefined)?.email_otp;
  if (!otp) throw new Error("Local integration test: generateLink did not return an email_otp.");
  return otp;
}

async function verifyOtpAndGetAccessToken(email: string, otp: string): Promise<string> {
  const result = await handleOwnerLoginVerifyCodeBody(JSON.stringify({ email, code: otp }), {
    auth: getOwnerLoginAuthClient(),
  });
  if (result.status !== 200 || !result.body.ok) {
    throw new Error(`Local integration test: verify-code did not succeed (status ${result.status}).`);
  }
  return result.body.session.accessToken;
}

async function checkOwnerSession(accessToken: string): Promise<{ status: number; body: unknown }> {
  const request = new Request("https://example.test/api/owner/session", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const response = await handleOwnerSessionRequest(request);
  return { status: response.status, body: await response.json() };
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

describe("CHECKPOINT C2I-A — real local owner authentication + authorization", () => {
  it("accepts the local API_URL only after the safety gate validates its hostname", () => {
    const hostname = new URL(settings.apiUrl).hostname;
    expect(["localhost", "127.0.0.1"]).toContain(hostname);
    expect(hostname.endsWith(".supabase.co")).toBe(false);
  });

  it("a synthetic user with an active owner_accounts row completes the real OTP flow and protected access succeeds", async () => {
    const email = syntheticEmail("active-owner");
    const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    const userId = createdUser.user?.id;
    expect(userId).toBeTruthy();

    const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: userId as string });
    expect(insertError).toBeNull();

    const otp = await obtainOtpForEmail(serviceClient, email);
    const accessToken = await verifyOtpAndGetAccessToken(email, otp);
    expect(accessToken).toBeTruthy();

    const { status, body } = await checkOwnerSession(accessToken);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, owner: { userId, role: "owner" } });
  });

  it("a signed-in user with NO owner_accounts row is denied — a valid Supabase session alone is not sufficient", async () => {
    const email = syntheticEmail("no-owner-row");
    const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    // Deliberately no owner_accounts row inserted for this user.

    const otp = await obtainOtpForEmail(serviceClient, email);
    const accessToken = await verifyOtpAndGetAccessToken(email, otp);
    // The Supabase Auth session itself succeeds — proving the denial below
    // comes specifically from the owner_accounts check, not from a failed
    // sign-in.
    expect(accessToken).toBeTruthy();

    const { status, body } = await checkOwnerSession(accessToken);
    expect(status).toBe(401);
    expect(body).toEqual({ ok: false });
  });

  it("deactivating a previously-active owner row revokes access for an already-issued, still-valid session", async () => {
    const email = syntheticEmail("revoke-me");
    const { data: createdUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    const userId = createdUser.user?.id as string;

    const { error: insertError } = await serviceClient.from("owner_accounts").insert({ user_id: userId });
    expect(insertError).toBeNull();

    const otp = await obtainOtpForEmail(serviceClient, email);
    const accessToken = await verifyOtpAndGetAccessToken(email, otp);

    const before = await checkOwnerSession(accessToken);
    expect(before.status).toBe(200);

    const { error: updateError } = await serviceClient.from("owner_accounts").update({ is_active: false }).eq("user_id", userId);
    expect(updateError).toBeNull();

    // The exact same still-cryptographically-valid access token — no
    // sign-out, no token revocation — must now be denied purely because
    // the owner_accounts row is inactive.
    const after = await checkOwnerSession(accessToken);
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ ok: false });
  });

  it("cleans up: resetting the local database leaves zero owner_accounts rows and zero synthetic auth users behind", async () => {
    resetLocalDatabase();

    const { count: ownerAccountsCount } = await serviceClient
      .from("owner_accounts")
      .select("user_id", { count: "exact", head: true });
    expect(ownerAccountsCount).toBe(0);

    const { data: usersList, error: listError } = await serviceClient.auth.admin.listUsers();
    expect(listError).toBeNull();
    const leftoverTestUsers = (usersList?.users ?? []).filter((u) => u.email?.endsWith("@example.test"));
    expect(leftoverTestUsers).toHaveLength(0);
  });
});
