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

const getOwnerLeadOverviewMock = vi.fn();
const createProductionOwnerLeadOverviewServiceDepsMock = vi.fn(() => ({
  queryOwnerVisibleLeads: vi.fn(),
  queryLatestActivityAt: vi.fn(),
  queryNotificationStatuses: vi.fn(),
}));

vi.mock("@/server/owner-leads/owner-lead-overview.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-overview.server")>();
  return {
    ...actual,
    createProductionOwnerLeadOverviewServiceDeps: () => createProductionOwnerLeadOverviewServiceDepsMock(),
    getOwnerLeadOverview: (deps: unknown) => getOwnerLeadOverviewMock(deps),
  };
});

const { handleOwnerLeadOverviewRequest } = await import("./overview");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };

function authorizedRequest(): Request {
  return new Request("https://example.test/api/owner/leads/overview", { headers: { authorization: "Bearer aaaa.bbbb.cccc" } });
}

const SAMPLE_DATA = {
  generatedAt: "2026-08-18T12:00:00.000Z",
  totals: { total: 0, new: 0, open: 0, completed: 0 },
  byStatus: {},
  byIntent: {},
  byMaterial: {},
  byCaptureChannel: {},
  dailyCounts: [],
  stale: { thresholdHours: 72 as const, count: 0 },
  attentionCount: 0,
  attentionLeads: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleOwnerLeadOverviewRequest — method guard", () => {
  it("rejects a non-GET method with 405", async () => {
    const response = await handleOwnerLeadOverviewRequest(new Request("https://example.test/api/owner/leads/overview", { method: "POST" }));
    expect(response.status).toBe(405);
  });
});

describe("handleOwnerLeadOverviewRequest — auth", () => {
  it("returns a generic 401 with no body detail when there is no token", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const response = await handleOwnerLeadOverviewRequest(new Request("https://example.test/api/owner/leads/overview"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ ok: false });
  });

  it("returns a generic 401 for an inactive owner, identical in shape to every other auth failure", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadOverviewRequest(authorizedRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(getOwnerLeadOverviewMock).not.toHaveBeenCalled();
  });

  it("never distinguishes auth-failure reasons in the response body", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "malformed_token" });
    const response = await handleOwnerLeadOverviewRequest(authorizedRequest());
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ok"]);
  });
});

describe("handleOwnerLeadOverviewRequest — success", () => {
  it("returns the aggregated snapshot for an authorized active owner", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadOverviewMock.mockResolvedValue(SAMPLE_DATA);

    const response = await handleOwnerLeadOverviewRequest(authorizedRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: SAMPLE_DATA });
  });
});

describe("handleOwnerLeadOverviewRequest — error handling", () => {
  it("never forwards a raw thrown error — collapses to a generic 500", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadOverviewMock.mockRejectedValue(new Error("relation \"leads\" does not exist"));

    const response = await handleOwnerLeadOverviewRequest(authorizedRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  });

  it("returns a generic 500 when session-verifier deps construction throws", async () => {
    getOwnerSessionVerifierDepsMock.mockImplementationOnce(() => {
      throw new Error("missing env var");
    });
    const response = await handleOwnerLeadOverviewRequest(authorizedRequest());
    expect(response.status).toBe(500);
  });
});
