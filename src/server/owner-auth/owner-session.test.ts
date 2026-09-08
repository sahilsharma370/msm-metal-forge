import { describe, expect, it, vi } from "vitest";
import { extractBearerToken, verifyOwnerSession, type OwnerAuthUserVerifier, type VerifyOwnerSessionDeps } from "./owner-session.server";
import type { OwnerAccountsQueryClient } from "./owner-accounts.server";

const VALID_JWT_SHAPE = "aaaa.bbbb.cccc";

function fakeOwnerAccountsClient(row: { role: "owner"; is_active: boolean } | null): OwnerAccountsQueryClient {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        })),
      })),
    })),
  };
}

function deps(overrides: Partial<VerifyOwnerSessionDeps> = {}): VerifyOwnerSessionDeps {
  const authVerifier: OwnerAuthUserVerifier = {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
  };
  return {
    authVerifier,
    ownerAccounts: fakeOwnerAccountsClient({ role: "owner", is_active: true }),
    ...overrides,
  };
}

describe("extractBearerToken", () => {
  it("returns null when there is no authorization header", () => {
    const request = new Request("https://example.test/api/owner/session");
    expect(extractBearerToken(request)).toBeNull();
  });

  it("returns null for a header that isn't the Bearer scheme", () => {
    const request = new Request("https://example.test/api/owner/session", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(request)).toBeNull();
  });

  it("returns null for 'Bearer' with no token", () => {
    const request = new Request("https://example.test/api/owner/session", { headers: { authorization: "Bearer " } });
    expect(extractBearerToken(request)).toBeNull();
  });

  it("extracts the token from a well-formed Bearer header", () => {
    const request = new Request("https://example.test/api/owner/session", {
      headers: { authorization: `Bearer ${VALID_JWT_SHAPE}` },
    });
    expect(extractBearerToken(request)).toBe(VALID_JWT_SHAPE);
  });
});

describe("verifyOwnerSession — missing/malformed token", () => {
  it("rejects a null token with reason missing_token, without calling the auth verifier", async () => {
    const d = deps();
    const result = await verifyOwnerSession(null, d);
    expect(result).toEqual({ ok: false, reason: "missing_token" });
    expect(d.authVerifier.getUser).not.toHaveBeenCalled();
  });

  it("rejects an empty string token with reason missing_token", async () => {
    const d = deps();
    const result = await verifyOwnerSession("", d);
    expect(result).toEqual({ ok: false, reason: "missing_token" });
  });

  it("rejects a token that isn't JWT-shaped with reason malformed_token, without calling the auth verifier", async () => {
    const d = deps();
    const result = await verifyOwnerSession("not-a-jwt", d);
    expect(result).toEqual({ ok: false, reason: "malformed_token" });
    expect(d.authVerifier.getUser).not.toHaveBeenCalled();
  });

  it("rejects a token with the wrong number of dot-separated segments", async () => {
    const d = deps();
    const result = await verifyOwnerSession("aaaa.bbbb", d);
    expect(result).toEqual({ ok: false, reason: "malformed_token" });
  });
});

describe("verifyOwnerSession — Supabase Auth verification", () => {
  it("rejects with reason invalid_token when Supabase Auth returns an error", async () => {
    const d = deps({
      authVerifier: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } }) },
    });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects with reason invalid_token when Supabase Auth returns no user and no error", async () => {
    const d = deps({ authVerifier: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects with reason verification_error when the auth verifier throws (never leaks the thrown error)", async () => {
    const d = deps({
      authVerifier: {
        getUser: vi.fn().mockRejectedValue(new Error("network down: connected to db-internal-host:5432")),
      },
    });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: false, reason: "verification_error" });
  });

  it("never trusts a user id supplied any other way — only the value Supabase Auth's own getUser returns is used for the owner_accounts lookup", async () => {
    const ownerAccounts = fakeOwnerAccountsClient({ role: "owner", is_active: true });
    const eqSpy = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { role: "owner", is_active: true }, error: null }) }));
    (ownerAccounts.from as ReturnType<typeof vi.fn>).mockReturnValue({ select: vi.fn(() => ({ eq: eqSpy })) });
    const d = deps({
      authVerifier: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "the-real-verified-id" } }, error: null }) },
      ownerAccounts,
    });
    await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(eqSpy).toHaveBeenCalledWith("user_id", "the-real-verified-id");
  });
});

describe("verifyOwnerSession — owner_accounts authorization", () => {
  it("rejects with reason no_owner_row when the verified user has no owner_accounts row", async () => {
    const d = deps({ ownerAccounts: fakeOwnerAccountsClient(null) });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: false, reason: "no_owner_row" });
  });

  it("rejects with reason inactive_owner when the owner row exists but is_active is false", async () => {
    const d = deps({ ownerAccounts: fakeOwnerAccountsClient({ role: "owner", is_active: false }) });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: false, reason: "inactive_owner" });
  });

  it("succeeds with a minimal typed identity for an active owner", async () => {
    const d = deps({ ownerAccounts: fakeOwnerAccountsClient({ role: "owner", is_active: true }) });
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result).toEqual({ ok: true, owner: { userId: "user-1", role: "owner" } });
  });

  it("the successful identity never carries an email, token, or database row beyond userId/role", async () => {
    const d = deps();
    const result = await verifyOwnerSession(VALID_JWT_SHAPE, d);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.owner).sort()).toEqual(["role", "userId"]);
    }
  });
});
