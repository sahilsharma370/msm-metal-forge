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

const changeOwnerLeadStatusMock = vi.fn();
const createProductionOwnerLeadStatusServiceDepsMock = vi.fn(() => ({ rpc: { rpc: vi.fn() } }));

vi.mock("@/server/owner-leads/owner-lead-status.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-status.server")>();
  return {
    ...actual,
    createProductionOwnerLeadStatusServiceDeps: () => createProductionOwnerLeadStatusServiceDepsMock(),
    changeOwnerLeadStatus: (input: unknown, deps: unknown) => changeOwnerLeadStatusMock(input, deps),
  };
});

const { handleOwnerLeadStatusChangeRequest } = await import("./$leadId.status");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";

function authorizedRequest(body: unknown): Request {
  return new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/status`, {
    method: "POST",
    headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  changeOwnerLeadStatusMock.mockReset();
  createProductionOwnerLeadStatusServiceDepsMock.mockClear();
});

describe("handleOwnerLeadStatusChangeRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/status`, { method: "GET" });
    const response = await handleOwnerLeadStatusChangeRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadStatusChangeRequest — authorization checked before any service call", () => {
  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/status`, { method: "POST" });
    const response = await handleOwnerLeadStatusChangeRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner identically to every other auth failure, before touching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadStatusChangeRequest — validation", () => {
  it("returns a sanitized 400 for a non-UUID leadId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), "not-a-uuid");
    expect(response.status).toBe(400);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for malformed JSON", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/status`, {
      method: "POST",
      headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
      body: "{not-json",
    });
    const response = await handleOwnerLeadStatusChangeRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a status value outside the canonical vocabulary", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "bogus" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a transition to lost with no reason, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "lost" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for an unknown key (e.g. a client-supplied ownerUserId)", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadStatusChangeRequest(
      authorizedRequest({ expectedStatus: "new", newStatus: "contacted", ownerUserId: "attacker-controlled" }),
      VALID_LEAD_ID,
    );
    expect(response.status).toBe(400);
    expect(changeOwnerLeadStatusMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadStatusChangeRequest — the owner identity is always server-sourced, never from the body", () => {
  it("passes session.owner.userId as ownerUserId, never anything from the request body", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: true, changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(changeOwnerLeadStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", leadId: VALID_LEAD_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadStatusChangeRequest — happy path", () => {
  it("a real transition returns 200 with the reconciled state", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: true, changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" } });
  });

  it("a same-status no-op also returns 200, with changed: false", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: true, changed: false, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "contacted", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.changed).toBe(false);
  });

  it("sets Cache-Control: private, no-store", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: true, changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handleOwnerLeadStatusChangeRequest — service failure mapping", () => {
  it("unauthorized (RPC-level owner_accounts recheck failed) maps to the same bare 401 as a session failure", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("not_found maps to a generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("conflict (stale expectedStatus) maps to 409", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("validation maps to a sanitized 400", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: false, reason: "validation" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "lost", lostReason: "x" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
  });

  it("internal_error maps to a generic 500, never a raw Postgres/Supabase error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/postgres|supabase|relation|constraint/i);
  });

  it("a thrown service exception returns a generic 500, never a raw error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    changeOwnerLeadStatusMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const response = await handleOwnerLeadStatusChangeRequest(authorizedRequest({ expectedStatus: "new", newStatus: "contacted" }), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/connection terminated/i);
  });
});
