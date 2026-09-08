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

const getOwnerLeadFileAccessMock = vi.fn();
const createProductionOwnerLeadFileAccessServiceDepsMock = vi.fn(() => ({
  queryLeadIsCompleted: vi.fn(),
  queryLeadFile: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock("@/server/owner-leads/owner-lead-file-access.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/owner-leads/owner-lead-file-access.server")>();
  return {
    ...actual,
    createProductionOwnerLeadFileAccessServiceDeps: () => createProductionOwnerLeadFileAccessServiceDepsMock(),
    getOwnerLeadFileAccess: (leadId: string, fileId: string, deps: unknown) => getOwnerLeadFileAccessMock(leadId, fileId, deps),
  };
});

const { handleOwnerLeadFileAccessRequest } = await import("./$leadId.files.$fileId.access");

const AUTHORIZED_SESSION = { ok: true as const, owner: { userId: "owner-1", role: "owner" as const } };
const VALID_LEAD_ID = "11111111-1111-1111-1111-111111111111";
const VALID_FILE_ID = "22222222-2222-2222-2222-222222222222";

function authorizedRequest(path: string): Request {
  return new Request(`https://example.test${path}`, { method: "POST", headers: { authorization: "Bearer aaaa.bbbb.cccc" } });
}

afterEach(() => {
  verifyOwnerSessionMock.mockReset();
  getOwnerSessionVerifierDepsMock.mockClear();
  getOwnerLeadFileAccessMock.mockReset();
  createProductionOwnerLeadFileAccessServiceDepsMock.mockClear();
});

describe("handleOwnerLeadFileAccessRequest — method", () => {
  it("rejects a non-POST method", async () => {
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`, { method: "GET" });
    const response = await handleOwnerLeadFileAccessRequest(request, VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(405);
    expect(verifyOwnerSessionMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadFileAccessRequest — authorization checked before any Storage/service call", () => {
  it("denies a request with no bearer token, and never calls the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "missing_token" });
    const request = new Request(`https://example.test/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`, { method: "POST" });
    const response = await handleOwnerLeadFileAccessRequest(request, VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(getOwnerLeadFileAccessMock).not.toHaveBeenCalled();
    expect(createProductionOwnerLeadFileAccessServiceDepsMock).not.toHaveBeenCalled();
  });

  it("denies an inactive owner identically to every other auth failure, before touching the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue({ ok: false, reason: "inactive_owner" });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(401);
    expect(getOwnerLeadFileAccessMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadFileAccessRequest — UUID validation", () => {
  it("returns a sanitized 400 for a non-UUID leadId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadFileAccessRequest(
      authorizedRequest(`/api/owner/leads/not-a-uuid/files/${VALID_FILE_ID}/access`),
      "not-a-uuid",
      VALID_FILE_ID,
    );
    expect(response.status).toBe(400);
    expect(getOwnerLeadFileAccessMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized 400 for a non-UUID fileId, before calling the service", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    const response = await handleOwnerLeadFileAccessRequest(
      authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/not-a-uuid/access`),
      VALID_LEAD_ID,
      "not-a-uuid",
    );
    expect(response.status).toBe(400);
    expect(getOwnerLeadFileAccessMock).not.toHaveBeenCalled();
  });
});

describe("handleOwnerLeadFileAccessRequest — happy path", () => {
  it("an active owner requesting their own completed lead's complete file receives a signed URL", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: true, url: "https://example.test/signed?token=abc", expiresInSeconds: 60 });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, data: { url: "https://example.test/signed?token=abc", expiresInSeconds: 60 } });
  });

  it("the response contains exactly url and expiresInSeconds — nothing else", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: true, url: "https://example.test/signed?token=abc", expiresInSeconds: 60 });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    const body = await response.json();
    expect(Object.keys(body.data).sort()).toEqual(["expiresInSeconds", "url"]);
  });

  it("the TTL is exactly 60 seconds", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: true, url: "https://example.test/signed?token=abc", expiresInSeconds: 60 });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    const body = await response.json();
    expect(body.data.expiresInSeconds).toBe(60);
  });

  it("sets Cache-Control: private, no-store", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: true, url: "https://example.test/signed?token=abc", expiresInSeconds: 60 });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("handleOwnerLeadFileAccessRequest — membership/state failures collapse to one generic 404", () => {
  it("a file belonging to another lead returns the generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("a missing file returns the byte-identical 404 body as a wrong-lead file", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const first = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    const firstBody = await first.text();

    getOwnerLeadFileAccessMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const second = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    const secondBody = await second.text();

    expect(firstBody).toBe(secondBody);
  });

  it("an incomplete lead returns the identical generic 404", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(404);
  });
});

describe("handleOwnerLeadFileAccessRequest — Storage/provider failure sanitized", () => {
  it("a Storage signing failure returns a generic 500, never a raw provider error", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: false, reason: "storage_error" });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(500);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toMatch(/storage|bucket|s3|supabase/i);
  });

  it("a thrown query error returns a generic 500", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockRejectedValue(new Error("relation \"lead_files\" violates row-level security policy"));
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    expect(response.status).toBe(500);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toMatch(/relation|row-level security/i);
  });
});

describe("handleOwnerLeadFileAccessRequest — no signed-URL/response field leakage", () => {
  it("the serialized error responses never contain storage_path or a service secret", async () => {
    verifyOwnerSessionMock.mockResolvedValue(AUTHORIZED_SESSION);
    getOwnerLeadFileAccessMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const response = await handleOwnerLeadFileAccessRequest(authorizedRequest(`/api/owner/leads/${VALID_LEAD_ID}/files/${VALID_FILE_ID}/access`), VALID_LEAD_ID, VALID_FILE_ID);
    const raw = await response.text();
    expect(raw).not.toMatch(/storage_path|service_role|SUPABASE_SECRET_KEY/i);
  });
});
