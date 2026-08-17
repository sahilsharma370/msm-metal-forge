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

const addOwnerLeadNoteMock = vi.fn();
const createProductionOwnerLeadNoteServiceDepsMock = vi.fn(() => ({ rpc: { rpc: vi.fn() } }));

vi.mock("@/server/owner-leads/owner-lead-note.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-note.server")>();
  return {
    ...actual,
    createProductionOwnerLeadNoteServiceDeps: () => createProductionOwnerLeadNoteServiceDepsMock(),
    addOwnerLeadNote: (input: unknown, deps: unknown) => addOwnerLeadNoteMock(input, deps),
  };
});

const { handleOwnerLeadNoteCreateRequest } = await import("./$leadId.notes");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";
const VALID_REQUEST_ID = "44444444-4444-4444-4444-444444444444";

function authorizedRequest(body: unknown): Request {
  return new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/notes`, {
    method: "POST",
    headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  addOwnerLeadNoteMock.mockReset();
  createProductionOwnerLeadNoteServiceDepsMock.mockClear();
});

describe("handleOwnerLeadNoteCreateRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/notes`, { method: "GET" });
    const response = await handleOwnerLeadNoteCreateRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadNoteCreateRequest — authorization checked before any service call", () => {
  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/notes`, { method: "POST" });
    const response = await handleOwnerLeadNoteCreateRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadNoteCreateRequest — validation", () => {
  it("returns a sanitized 400 for a non-UUID leadId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), "not-a-uuid");
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for an empty note body", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a whitespace-only note body", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "   ", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a note body over the max length", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "n".repeat(2001), requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for an unknown key", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(
      authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID, ownerUserId: "attacker-controlled" }),
      VALID_LEAD_ID,
    );
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a missing requestId", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello" }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    expect(addOwnerLeadNoteMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadNoteCreateRequest — the owner identity is always server-sourced, never from the body", () => {
  it("passes session.owner.userId as ownerUserId", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: true, activityId: "33333333-3333-3333-3333-333333333333", note: "hello", createdAt: "2026-01-01T00:00:00.000Z" });
    await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(addOwnerLeadNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", leadId: VALID_LEAD_ID, body: "hello", requestId: VALID_REQUEST_ID }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadNoteCreateRequest — happy path", () => {
  it("a successful note creation returns 200 with the created note", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: true, activityId: "33333333-3333-3333-3333-333333333333", note: "Customer called twice.", createdAt: "2026-01-01T00:00:00.000Z" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "Customer called twice.", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: { activityId: "33333333-3333-3333-3333-333333333333", note: "Customer called twice.", createdAt: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("sets Cache-Control: private, no-store", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: true, activityId: "33333333-3333-3333-3333-333333333333", note: "hello", createdAt: "2026-01-01T00:00:00.000Z" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handleOwnerLeadNoteCreateRequest — service failure mapping, never leaking the note body", () => {
  it("unauthorized (RPC-level owner_accounts recheck failed) maps to the same bare 401 as a session failure", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("not_found maps to a generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("validation maps to a sanitized 400, never echoing the rejected text", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: false, reason: "validation" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "some very specific secret-looking text", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(400);
    const raw = await response.text();
    expect(raw).not.toMatch(/secret-looking/i);
  });

  it("internal_error maps to a generic 500", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/postgres|supabase|relation|constraint/i);
  });

  it("a thrown service exception returns a generic 500, never a raw error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    addOwnerLeadNoteMock.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const response = await handleOwnerLeadNoteCreateRequest(authorizedRequest({ body: "hello", requestId: VALID_REQUEST_ID }), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toMatch(/connection terminated/i);
  });
});
