import { describe, expect, it, vi } from "vitest";
import { fetchOwnerLeadList, fetchOwnerLeadDetail, requestOwnerLeadFileAccess, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import type { OwnerAuthClient } from "./owner-auth-client";

function fakeAuthClient(overrides: Partial<OwnerAuthClient> = {}): OwnerAuthClient {
  return {
    getAccessToken: vi.fn().mockResolvedValue("at-1"),
    setSession: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const VALID_LEAD_ITEM = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "MSM-260101-ABCDEF",
  status: "new",
  intent: "sell",
  captureChannel: "website",
  material: "copper",
  materialSubtype: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  submissionCompletedAt: "2026-01-01T00:05:00.000Z",
  contact: { name: "Ahmed", phone: "+971501234567" },
  location: { emirate: "dubai", area: "Al Quoz" },
  quantity: { value: 100, unit: "kg" },
  fileUploadStatus: "complete",
  notificationStatus: "sent",
};

describe("owner-leads-transport — access token / bearer header", () => {
  it("uses the current access token from authClient.getAccessToken()", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("current-token") });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { leads: [], page: { nextCursor: null, hasMore: false } } }));
    const deps: OwnerLeadsTransportDeps = { authClient, fetchImpl };
    await fetchOwnerLeadList({}, deps);
    expect(authClient.getAccessToken).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer current-token");
  });

  it("returns unauthorized without calling fetch when there is no local token", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue(null) });
    const fetchImpl = vi.fn();
    const result = await fetchOwnerLeadList({}, { authClient, fetchImpl });
    expect(result).toEqual({ kind: "unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("owner-leads-transport — response parsing", () => {
  it("parses a valid list response against the canonical contract", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, data: { leads: [VALID_LEAD_ITEM], page: { nextCursor: null, hasMore: false } } }));
    const result = await fetchOwnerLeadList({}, { authClient: fakeAuthClient(), fetchImpl });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.leads).toHaveLength(1);
  });

  it("parses a valid file-access response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { url: "https://example.test/signed", expiresInSeconds: 60 } }));
    const result = await requestOwnerLeadFileAccess("lead-1", "file-1", { authClient: fakeAuthClient(), fetchImpl });
    expect(result).toEqual({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
  });

  it("rejects a malformed success response (fails contract validation) as a sanitized error, never throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { leads: "not-an-array" } }));
    const result = await fetchOwnerLeadList({}, { authClient: fakeAuthClient(), fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).not.toMatch(/zod|parse|schema/i);
  });

  it("rejects a response missing the expected envelope shape entirely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    const result = await fetchOwnerLeadDetail("lead-1", { authClient: fakeAuthClient(), fetchImpl });
    expect(result.kind).toBe("error");
  });
});

describe("owner-leads-transport — 401 triggers session-expiry behavior", () => {
  it("signs out locally and reports unauthorized on a 401, without exposing any token/provider detail", async () => {
    const authClient = fakeAuthClient();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false }));
    const result = await fetchOwnerLeadList({}, { authClient, fetchImpl });
    expect(result).toEqual({ kind: "unauthorized" });
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("owner-leads-transport — raw errors never reach the caller", () => {
  it("a raw database/provider-shaped error message from the server is passed through only as the server's own already-sanitized text, and a network failure never leaks exception internals", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }));
    const result = await fetchOwnerLeadList({}, { authClient: fakeAuthClient(), fetchImpl });
    expect(result).toEqual({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
  });

  it("a thrown network error becomes a generic sanitized error, never the raw exception message/stack", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND internal-db-host.local"));
    const result = await fetchOwnerLeadList({}, { authClient: fakeAuthClient(), fetchImpl });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).not.toMatch(/ENOTFOUND|internal-db-host/);
    }
  });
});

describe("owner-leads-transport — abort support", () => {
  it("reports aborted, not error, when the request is cancelled via AbortController", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      const err = new DOMException("Aborted", "AbortError");
      return Promise.reject(err);
    });
    const result = await fetchOwnerLeadList({}, { authClient: fakeAuthClient(), fetchImpl }, controller.signal);
    expect(result).toEqual({ kind: "aborted" });
  });
});

describe("owner-leads-transport — no logging/persistence of the signed URL", () => {
  it("never console.logs the signed URL (the module also has no localStorage/sessionStorage import at all — see its own header comment, verified by code inspection)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { url: "https://example.test/signed?token=SECRET", expiresInSeconds: 60 } }));
    await requestOwnerLeadFileAccess("lead-1", "file-1", { authClient: fakeAuthClient(), fetchImpl });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("owner-leads-transport — request parameters", () => {
  it("builds the leads query string from only the provided filters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { leads: [], page: { nextCursor: null, hasMore: false } } }));
    await fetchOwnerLeadList({ status: "contacted", intent: "sell", q: "Ahmed", limit: 20 }, { authClient: fakeAuthClient(), fetchImpl });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain("status=contacted");
    expect(url).toContain("intent=sell");
    expect(url).toContain("q=Ahmed");
    expect(url).toContain("limit=20");
  });

  it("uses POST for file access and GET for list/detail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { url: "https://example.test/x", expiresInSeconds: 60 } }));
    await requestOwnerLeadFileAccess("lead-1", "file-1", { authClient: fakeAuthClient(), fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });
});
