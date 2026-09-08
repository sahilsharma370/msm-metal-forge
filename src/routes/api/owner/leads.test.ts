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

const listOwnerLeadsMock = vi.fn();
const createProductionOwnerLeadsServiceDepsMock = vi.fn(() => ({ queryLeadsPage: vi.fn(), queryNotificationStatuses: vi.fn() }));

vi.mock("@/server/owner-leads/owner-leads.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-leads.server")>();
  return {
    ...actual,
    createProductionOwnerLeadsServiceDeps: () => createProductionOwnerLeadsServiceDepsMock(),
    listOwnerLeads: (query: unknown, deps: unknown) => listOwnerLeadsMock(query, deps),
  };
});

const createOwnerQuickAddLeadMock = vi.fn();
const createProductionOwnerLeadQuickAddServiceDepsMock = vi.fn(() => ({ rpc: { rpc: vi.fn() } }));

vi.mock("@/server/owner-leads/owner-lead-quick-add.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-quick-add.server")>();
  return {
    ...actual,
    createProductionOwnerLeadQuickAddServiceDeps: () => createProductionOwnerLeadQuickAddServiceDepsMock(),
    createOwnerQuickAddLead: (input: unknown, deps: unknown) => createOwnerQuickAddLeadMock(input, deps),
  };
});

const { handleOwnerLeadListRequest, handleOwnerLeadQuickAddCreateRequest } = await import("./leads");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };

function authorizedRequest(path: string): Request {
  return new Request(`https://example.test${path}`, { headers: { authorization: "Bearer aaaa.bbbb.cccc" } });
}

const SAMPLE_RESULT = {
  leads: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      status: "new",
      intent: "sell" as const,
      captureChannel: "website",
      material: "copper",
      materialSubtype: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      contact: { name: "Ahmed", phone: "+971501234567" },
      location: { emirate: "dubai", area: "Al Quoz" },
      quantity: { value: 100, unit: "kg" },
      fileUploadStatus: "complete",
      notificationStatus: "sent" as const,
    },
  ],
  nextCursor: null,
  hasMore: false,
};

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  listOwnerLeadsMock.mockReset();
  createProductionOwnerLeadsServiceDepsMock.mockClear();
  createOwnerQuickAddLeadMock.mockReset();
  createProductionOwnerLeadQuickAddServiceDepsMock.mockClear();
});

function quickAddRequest(body: unknown): Request {
  return new Request("https://example.test/api/owner/leads", {
    method: "POST",
    headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_QUICK_ADD_BODY = {
  requestId: "44444444-4444-4444-4444-444444444444",
  intent: "sell",
  channel: "phone",
  material: "copper",
  contactName: "Ahmed",
  contactPhone: "+971501234567",
};

describe("handleOwnerLeadListRequest — method", () => {
  it("rejects a non-GET method", async () => {
    const request = new Request("https://example.test/api/owner/leads", { method: "POST" });
    const response = await handleOwnerLeadListRequest(request);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadListRequest — authorization (reuses verifyOwnerSession)", () => {
  it("denies a request with no bearer token", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request("https://example.test/api/owner/leads");
    const response = await handleOwnerLeadListRequest(request);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("denies an invalid/unverifiable token", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "invalid_token" });
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(401);
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("denies a verified Auth user with no owner_accounts row", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "no_owner_row" });
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(401);
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(401);
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("never leaks the internal failure reason", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(await response.json()).toEqual({ ok: false });
  });

  it("an active owner succeeds and reaches the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    listOwnerLeadsMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(200);
    expect(listOwnerLeadsMock).toHaveBeenCalledTimes(1);
  });
});

describe("handleOwnerLeadListRequest — query validation", () => {
  it("returns a sanitized 400 for an invalid filter value, and never reaches the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads?status=not-a-real-status"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a limit above 50", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads?limit=999"));
    expect(response.status).toBe(400);
  });

  it("returns a sanitized 400 for a search term containing filter-syntax characters", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads?q=" + encodeURIComponent("a,b)(DROP")));
    expect(response.status).toBe(400);
    expect(listOwnerLeadsMock).not.toHaveBeenCalled();
  });

  it("accepts valid filters and forwards the parsed query to the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    listOwnerLeadsMock.mockResolvedValue(SAMPLE_RESULT);
    await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads?status=contacted&intent=sell&limit=10"));
    expect(listOwnerLeadsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "contacted", intent: "sell", limit: 10 }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadListRequest — success shape and field exclusion", () => {
  it("returns the exact ok/data/page envelope", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    listOwnerLeadsMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        leads: SAMPLE_RESULT.leads,
        page: { nextCursor: null, hasMore: false },
      },
    });
  });

  it("the serialized response never contains a forbidden internal field", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    listOwnerLeadsMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    const raw = await response.text();
    expect(raw).not.toMatch(/storage_path|submission_snapshot|payload_hash|idempotency_key|checksum|claim_token|provider_message_id|service_role|SUPABASE_SECRET_KEY/i);
  });
});

describe("handleOwnerLeadListRequest — error sanitization", () => {
  it("returns a generic 500 when the service throws, never a raw database/provider error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    listOwnerLeadsMock.mockRejectedValue(new Error("relation \"leads\" violates row-level security policy: pgcode 42501, connection string postgres://..."));
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: expect.any(String) } });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/relation|pgcode|postgres:\/\/|row-level security/i);
  });

  it("returns a generic 500 when constructing session verifier deps throws", async () => {
    getOwnerSessionVerifierDepsMock.mockImplementationOnce(() => {
      throw new Error("missing SUPABASE_URL");
    });
    const response = await handleOwnerLeadListRequest(authorizedRequest("/api/owner/leads"));
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// CHECKPOINT C2J-F — POST /api/owner/leads (Quick Add)
// ---------------------------------------------------------------------------

describe("handleOwnerLeadQuickAddCreateRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request("https://example.test/api/owner/leads", { method: "GET" });
    const response = await handleOwnerLeadQuickAddCreateRequest(request);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadQuickAddCreateRequest — authorization", () => {
  it("denies a request with no bearer token, never reaching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const response = await handleOwnerLeadQuickAddCreateRequest(new Request("https://example.test/api/owner/leads", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(401);
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadQuickAddCreateRequest — request validation", () => {
  it("returns a sanitized 400 for malformed JSON", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const request = new Request("https://example.test/api/owner/leads", {
      method: "POST",
      headers: { authorization: "Bearer aaaa.bbbb.cccc", "content-type": "application/json" },
      body: "{not-json",
    });
    const response = await handleOwnerLeadQuickAddCreateRequest(request);
    expect(response.status).toBe(400);
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for an unknown field, never reaching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest({ ...VALID_QUICK_ADD_BODY, ownerUserId: "sneaky" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for the 'website' capture channel", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest({ ...VALID_QUICK_ADD_BODY, channel: "website" }));
    expect(response.status).toBe(400);
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a seller/buyer cross-field violation (buyer request carrying seller location)", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadQuickAddCreateRequest(
      quickAddRequest({ ...VALID_QUICK_ADD_BODY, intent: "buy", sellerEmirate: "dubai" }),
    );
    expect(response.status).toBe(400);
    expect(createOwnerQuickAddLeadMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadQuickAddCreateRequest — success", () => {
  it("an active owner's valid submission succeeds and forwards the verified ownerUserId (never trusting a browser-supplied one)", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    createOwnerQuickAddLeadMock.mockResolvedValue({
      ok: true,
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      idempotentReplay: false,
    });
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false },
    });
    expect(createOwnerQuickAddLeadMock).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: AUTHORIZED_SESSION.owner.userId }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadQuickAddCreateRequest — service failure mapping", () => {
  it("maps reason: unauthorized to 401", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    createOwnerQuickAddLeadMock.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(401);
  });

  it("maps reason: conflict to 409 with a sanitized message", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    createOwnerQuickAddLeadMock.mockResolvedValue({ ok: false, reason: "conflict" });
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("maps reason: internal_error to a generic 500, never a raw database/provider error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    createOwnerQuickAddLeadMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(500);
  });

  it("returns a generic 500 when the service throws", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    createOwnerQuickAddLeadMock.mockRejectedValue(new Error("connection reset"));
    const response = await handleOwnerLeadQuickAddCreateRequest(quickAddRequest(VALID_QUICK_ADD_BODY));
    expect(response.status).toBe(500);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toMatch(/connection reset/i);
  });
});
