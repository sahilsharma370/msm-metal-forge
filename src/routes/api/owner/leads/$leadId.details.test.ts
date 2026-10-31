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

const updateOwnerLeadDetailsMock = vi.fn();
const createProductionOwnerLeadEditServiceDepsMock = vi.fn(() => ({ rpc: { rpc: vi.fn() } }));

vi.mock("@/server/owner-leads/owner-lead-edit.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-edit.server")>();
  return {
    ...actual,
    createProductionOwnerLeadEditServiceDeps: () => createProductionOwnerLeadEditServiceDepsMock(),
    updateOwnerLeadDetails: (input: unknown, deps: unknown) => updateOwnerLeadDetailsMock(input, deps),
  };
});

const { handleOwnerLeadEditRequest } = await import("./$leadId.details");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";
const VALID_BODY = { contactName: "Ahmed Seller", contactPhone: "+971501234567", material: "copper", expectedUpdatedAt: "2026-01-01T00:05:00.000Z" };

function authorizedRequest(body: unknown): Request {
  return new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/details`, {
    method: "POST",
    headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  updateOwnerLeadDetailsMock.mockReset();
  createProductionOwnerLeadEditServiceDepsMock.mockClear();
});

describe("handleOwnerLeadEditRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/details`, { method: "GET" });
    const response = await handleOwnerLeadEditRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadEditRequest — authorization checked before any service call", () => {
  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/details`, { method: "POST" });
    const response = await handleOwnerLeadEditRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner identically to every other auth failure, before touching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadEditRequest — validation", () => {
  it("returns a sanitized 400 for a non-UUID leadId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), "not-a-uuid");
    expect(response.status).toBe(400);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for malformed JSON", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/details`, {
      method: "POST",
      headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
      body: "{not-json",
    });
    const response = await handleOwnerLeadEditRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a material value outside the canonical vocabulary", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadEditRequest(authorizedRequest({ ...VALID_BODY, material: "bogus" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a missing expectedUpdatedAt", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const { expectedUpdatedAt: _expectedUpdatedAt, ...withoutExpectedUpdatedAt } = VALID_BODY;
    const response = await handleOwnerLeadEditRequest(authorizedRequest(withoutExpectedUpdatedAt), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for an unknown key (e.g. a client-supplied status or ownerUserId)", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadEditRequest(authorizedRequest({ ...VALID_BODY, ownerUserId: "attacker-controlled" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(updateOwnerLeadDetailsMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadEditRequest — the owner identity is always server-sourced, never from the body", () => {
  it("passes session.owner.userId as ownerUserId, never anything from the request body", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] });
    await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(updateOwnerLeadDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", leadId: VALID_LEAD_ID, expectedUpdatedAt: VALID_BODY.expectedUpdatedAt }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadEditRequest — happy path", () => {
  it("a real update returns 200 with the reconciled state", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] } });
  });

  it("an unchanged submission also returns 200, with updated: false", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: true, updated: false, updatedAt: "2026-01-01T00:05:00.000Z", changedFields: [] });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.updated).toBe(false);
  });

  it("sets Cache-Control: private, no-store", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handleOwnerLeadEditRequest — service failure mapping", () => {
  it("unauthorized (RPC-level owner_accounts recheck failed) maps to the same bare 401 as a session failure", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("not_found maps to a generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("not_editable (archived/trashed) maps to 409 NOT_EDITABLE", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "not_editable" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_EDITABLE");
  });

  it("conflict (stale expectedUpdatedAt) maps to 409 CONFLICT", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("validation maps to a sanitized 400", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "validation" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(400);
  });

  it("internal_error maps to a generic 500, never a raw Postgres/Supabase error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/postgres|supabase|relation|constraint/i);
  });

  it("a thrown service exception returns a generic 500, never a raw error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    updateOwnerLeadDetailsMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const response = await handleOwnerLeadEditRequest(authorizedRequest(VALID_BODY), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/connection terminated/i);
  });
});
