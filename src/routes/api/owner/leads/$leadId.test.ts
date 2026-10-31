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

const getOwnerLeadDetailMock = vi.fn();
const createProductionOwnerLeadDetailServiceDepsMock = vi.fn(() => ({
  queryLeadById: vi.fn(),
  queryLeadFiles: vi.fn(),
  queryLeadActivities: vi.fn(),
  queryNotificationDelivery: vi.fn(),
}));

vi.mock("@/server/owner-leads/owner-lead-detail.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-detail.server")>();
  return {
    ...actual,
    createProductionOwnerLeadDetailServiceDeps: () => createProductionOwnerLeadDetailServiceDepsMock(),
    getOwnerLeadDetail: (leadId: string, deps: unknown) => getOwnerLeadDetailMock(leadId, deps),
  };
});

const { handleOwnerLeadDetailRequest } = await import("./$leadId");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";

function authorizedRequest(path: string): Request {
  return new Request(`https://example.test${path}`, { headers: { authorization: "Bearer aaaa.bbbb.cccc" } });
}

const SAMPLE_RESULT = {
  ok: true as const,
  lead: {
    id: VALID_LEAD_ID,
    reference: "MSM-260101-ABCDEF",
    status: "new",
    intent: "sell" as const,
    captureChannel: "website",
    material: "copper",
    materialSubtype: null,
    materialSubtypeOtherText: null,
    materialOtherText: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    submissionCompletedAt: "2026-01-01T00:05:00.000Z",
    fileUploadStatus: "complete",
    contact: { name: "Ahmed", phone: "+971501234567", email: null, company: null },
    location: { emirate: "dubai", area: "Al Quoz", mapLink: null },
    enquiry: {
      quantityValue: 100, quantityUnit: "kg", quantityUnitOther: null, quantityUnsure: false,
      condition: "clean_separated", description: null, pickupRequired: "yes", pickupDate: null,
      accessNote: null, preferredContact: "whatsapp", notes: null,
    },
  },
  files: [],
  activities: [],
  notification: { status: "pending" as const, attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null },
};

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  getOwnerLeadDetailMock.mockReset();
  createProductionOwnerLeadDetailServiceDepsMock.mockClear();
});

describe("handleOwnerLeadDetailRequest — method", () => {
  it("rejects a non-GET method", async () => {
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}`, { method: "POST" });
    const response = await handleOwnerLeadDetailRequest(request, VALID_LEAD_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadDetailRequest — authorization", () => {
  it("denies a request with no bearer token (401, bare body)", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const response = await handleOwnerLeadDetailRequest(new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(getOwnerLeadDetailMock).not.toHaveBeenCalled();
  });

  it("denies an invalid/expired token", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "invalid_token" });
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(getOwnerLeadDetailMock).not.toHaveBeenCalled();
  });

  it("denies a verified user with no owner_accounts row", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "no_owner_row" });
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(getOwnerLeadDetailMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner, identically to every other auth failure", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
  });

  it("an active owner reaches the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(200);
    expect(getOwnerLeadDetailMock).toHaveBeenCalledTimes(1);
  });
});

describe("handleOwnerLeadDetailRequest — leadId validation", () => {
  it("returns a sanitized 400 for a non-UUID leadId, never reaching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadDetailRequest(authorizedRequest("/api/owner/leads/not-a-uuid"), "not-a-uuid");
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(getOwnerLeadDetailMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadDetailRequest — not-found collapsing", () => {
  it("a nonexistent lead returns a generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("an incomplete lead returns the byte-identical 404 body as a nonexistent lead", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const first = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    const firstBody = await first.text();

    getOwnerLeadDetailMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const second = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    const secondBody = await second.text();

    expect(firstBody).toBe(secondBody);
  });
});

describe("handleOwnerLeadDetailRequest — success shape, headers, and field exclusion", () => {
  it("returns the exact ok/data envelope", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { lead: SAMPLE_RESULT.lead, files: [], activities: [], notification: SAMPLE_RESULT.notification } });
  });

  it("sets Cache-Control: private, no-store", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("the serialized response never contains a forbidden internal field", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockResolvedValue(SAMPLE_RESULT);
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    const raw = await response.text();
    expect(raw).not.toMatch(
      /storage_path|submission_snapshot|payload_hash|idempotency_key|checksum|claim_token|provider_message_id|service_role|SUPABASE_SECRET_KEY/i,
    );
  });
});

describe("handleOwnerLeadDetailRequest — error sanitization", () => {
  it("returns a generic 500 when the service throws, never a raw database error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadDetailMock.mockRejectedValue(new Error("relation \"leads\" violates row-level security policy: pgcode 42501"));
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(500);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toMatch(/relation|pgcode|row-level security/i);
  });

  it("returns a generic 500 when constructing session verifier deps throws", async () => {
    getOwnerSessionVerifierDepsMock.mockImplementationOnce(() => {
      throw new Error("missing SUPABASE_URL");
    });
    const response = await handleOwnerLeadDetailRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}`), VALID_LEAD_ID);
    expect(response.status).toBe(500);
  });
});
