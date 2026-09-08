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

const exportOwnerLeadsCsvMock = vi.fn();
const createProductionOwnerLeadExportServiceDepsMock = vi.fn(() => ({ queryExportRows: vi.fn() }));

vi.mock("@/server/owner-leads/owner-lead-export.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-export.server")>();
  return {
    ...actual,
    createProductionOwnerLeadExportServiceDeps: () => createProductionOwnerLeadExportServiceDepsMock(),
    exportOwnerLeadsCsv: (query: unknown, deps: unknown) => exportOwnerLeadsCsvMock(query, deps),
  };
});

const { handleOwnerLeadExportRequest } = await import("./export");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };

function authorizedRequest(query = ""): Request {
  return new Request(`https://example.test/api/owner/leads/export${query}`, {
    method: "GET",
    headers: { authorization: "Bearer aaaa.bbbb.cccc" },
  });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  exportOwnerLeadsCsvMock.mockReset();
  createProductionOwnerLeadExportServiceDepsMock.mockClear();
});

describe("handleOwnerLeadExportRequest — method and authorization", () => {
  it("rejects a non-GET method", async () => {
    const response = await handleOwnerLeadExportRequest(new Request("https://example.test/api/owner/leads/export", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });

  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const response = await handleOwnerLeadExportRequest(new Request("https://example.test/api/owner/leads/export", { method: "GET" }));
    expect(response.status).toBe(401);
    expect(exportOwnerLeadsCsvMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner identically, before touching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadExportRequest(authorizedRequest());
    expect(response.status).toBe(401);
    expect(exportOwnerLeadsCsvMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadExportRequest — Trash is rejected before ever querying", () => {
  it("returns a sanitized 400 for view=trash, without calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadExportRequest(authorizedRequest("?view=trash"));
    expect(response.status).toBe(400);
    expect(exportOwnerLeadsCsvMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadExportRequest — current filters flow through to the service", () => {
  it("passes the parsed view/status/material query through to exportOwnerLeadsCsv", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    exportOwnerLeadsCsvMock.mockResolvedValue({ ok: true, csv: "Reference\r\n", filename: "msm-enquiries-inbox-2026-08-21.csv", rowCount: 0 });
    await handleOwnerLeadExportRequest(authorizedRequest("?view=archived&material=copper"));
    expect(exportOwnerLeadsCsvMock).toHaveBeenCalledWith(
      expect.objectContaining({ view: "archived", material: "copper" }),
      expect.anything(),
    );
  });
});

describe("handleOwnerLeadExportRequest — happy path", () => {
  it("returns a real text/csv attachment with the built filename", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    exportOwnerLeadsCsvMock.mockResolvedValue({ ok: true, csv: "Reference\r\nMSM-1\r\n", filename: "msm-enquiries-inbox-2026-08-21.csv", rowCount: 1 });
    const response = await handleOwnerLeadExportRequest(authorizedRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="msm-enquiries-inbox-2026-08-21.csv"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("Reference\r\nMSM-1\r\n");
  });
});

describe("handleOwnerLeadExportRequest — service failure mapping", () => {
  it("internal_error maps to a generic 500, never a raw Postgres/Supabase error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    exportOwnerLeadsCsvMock.mockResolvedValue({ ok: false, reason: "internal_error" });
    const response = await handleOwnerLeadExportRequest(authorizedRequest());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/postgres|supabase|relation|constraint/i);
  });
});
