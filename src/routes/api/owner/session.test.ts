import { afterEach, describe, expect, it, vi } from "vitest";

const verifyOwnerSessionMock = vi.fn();
const getOwnerSessionVerifierDepsMock = vi.fn(() => ({ authVerifier: { getUser: vi.fn() }, ownerAccounts: { from: vi.fn() } }));

vi.mock("@/server/owner-auth/owner-session.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-auth/owner-session.server")>();
  return {
    ...actual,
    getOwnerSessionVerifierDeps: () => getOwnerSessionVerifierDepsMock(),
    verifyOwnerSession: (token: string | null, deps: unknown) => verifyOwnerSessionMock(token, deps),
  };
});

const { handleOwnerSessionRequest } = await import("./session");

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
});

describe("handleOwnerSessionRequest — method", () => {
  it("rejects a non-GET method", async () => {
    const request = new Request("https://example.test/api/owner/session", { method: "POST" });
    const response = await handleOwnerSessionRequest(request);
    expect(response.status).toBe(405);
  });
});

describe("handleOwnerSessionRequest — authorization outcomes", () => {
  it("returns 401 {ok:false} when verifyOwnerSession rejects (any reason)", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "no_owner_row" });
    const request = new Request("https://example.test/api/owner/session", {
      headers: { authorization: "Bearer aaaa.bbbb.cccc" },
    });
    const response = await handleOwnerSessionRequest(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ ok: false });
  });

  it("never leaks the internal failure reason in the response body", async () => {
    for (const reason of ["missing_token", "malformed_token", "invalid_token", "no_owner_row", "inactive_owner", "verification_error"] as const) {
      verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason });
      const request = new Request("https://example.test/api/owner/session");
      const response = await handleOwnerSessionRequest(request);
      const body = await response.json();
      expect(response.status).toBe(401);
      expect(body).toEqual({ ok: false });
    }
  });

  it("returns 200 with the minimal owner identity when authorized", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } });
    const request = new Request("https://example.test/api/owner/session", {
      headers: { authorization: "Bearer aaaa.bbbb.cccc" },
    });
    const response = await handleOwnerSessionRequest(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, owner: { userId: "u1", role: "owner" } });
  });

  it("passes the extracted bearer token through to verifyOwnerSession", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request("https://example.test/api/owner/session", {
      headers: { authorization: "Bearer aaaa.bbbb.cccc" },
    });
    await handleOwnerSessionRequest(request);
    expect(verifyOwnerSessionMock).toHaveBeenCalledWith("aaaa.bbbb.cccc", expect.anything());
  });

  it("passes null when there is no authorization header", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request("https://example.test/api/owner/session");
    await handleOwnerSessionRequest(request);
    expect(verifyOwnerSessionMock).toHaveBeenCalledWith(null, expect.anything());
  });

  it("returns 500 when constructing the verifier deps throws", async () => {
    getOwnerSessionVerifierDepsMock.mockImplementationOnce(() => {
      throw new Error("missing SUPABASE_URL");
    });
    const request = new Request("https://example.test/api/owner/session");
    const response = await handleOwnerSessionRequest(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false });
  });
});
