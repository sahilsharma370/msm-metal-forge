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

const trashOwnerLeadMock = vi.fn();
const createProductionOwnerLeadTrashServiceDepsMock = vi.fn(() => ({ rpc: { rpc: vi.fn() } }));

vi.mock("@/server/owner-leads/owner-lead-trash.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-trash.server")>();
  return {
    ...actual,
    createProductionOwnerLeadTrashServiceDeps: () => createProductionOwnerLeadTrashServiceDepsMock(),
    trashOwnerLead: (input: unknown, deps: unknown) => trashOwnerLeadMock(input, deps),
  };
});

const { handleOwnerLeadTrashRequest } = await import("./$leadId.trash");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";

function authorizedRequest(): Request {
  return new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/trash`, {
    method: "POST",
    headers: { authorization: "Bearer aaaa.bbbb.cccc" },
  });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  trashOwnerLeadMock.mockReset();
  createProductionOwnerLeadTrashServiceDepsMock.mockClear();
});

describe("handleOwnerLeadTrashRequest — method and authorization", () => {
  it("rejects a non-POST method", async () => {
    const response = await handleOwnerLeadTrashRequest(new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/trash`, { method: "GET" }), VALID_LEAD_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });

  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const response = await handleOwnerLeadTrashRequest(new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/trash`, { method: "POST" }), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(trashOwnerLeadMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner identically, before touching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(trashOwnerLeadMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a non-UUID leadId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), "not-a-uuid");
    expect(response.status).toBe(400);
    expect(trashOwnerLeadMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadTrashRequest — the owner identity is always server-sourced", () => {
  it("passes session.owner.userId as ownerUserId", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: true, trashed: true, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" });
    await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(trashOwnerLeadMock).toHaveBeenCalledWith({ leadId: VALID_LEAD_ID, ownerUserId: "owner-1" }, expect.anything());
  });
});

describe("handleOwnerLeadTrashRequest — happy path", () => {
  it("a real trash returns 200 with trashed: true", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: true, trashed: true, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { trashed: true, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" } });
  });

  it("an idempotent replay (already trashed) also returns 200, with trashed: false", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: true, trashed: false, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.trashed).toBe(false);
  });
});

describe("handleOwnerLeadTrashRequest — service failure mapping", () => {
  it("unauthorized maps to a bare 401", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(401);
  });

  it("not_found maps to a generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(404);
  });

  it("internal_error maps to a generic 500, never a raw Postgres/Supabase error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    trashOwnerLeadMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadTrashRequest(authorizedRequest(), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|supabase|relation|constraint/i);
  });
});
