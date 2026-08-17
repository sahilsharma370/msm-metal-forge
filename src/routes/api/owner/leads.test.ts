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

const { handleOwnerLeadListRequest } = await import("./leads");

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
});

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
