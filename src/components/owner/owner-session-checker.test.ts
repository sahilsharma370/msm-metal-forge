import { describe, expect, it, vi } from "vitest";
import { createOwnerSessionChecker } from "./owner-session-checker";

describe("createOwnerSessionChecker", () => {
  it("sends the access token as a Bearer authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, owner: { userId: "u1", role: "owner" } }),
    }) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    await checker.check("at-1");
    expect(fetchImpl).toHaveBeenCalledWith("/api/owner/session", { method: "GET", headers: { authorization: "Bearer at-1" } });
  });

  it("returns ok:true with the owner identity on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, owner: { userId: "u1", role: "owner" } }),
    }) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    const result = await checker.check("at-1");
    expect(result).toEqual({ ok: true, owner: { userId: "u1", role: "owner" } });
  });

  it("returns ok:false when the HTTP response is not ok (e.g. 401)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false }) }) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    const result = await checker.check("at-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false when fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    const result = await checker.check("at-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false when the response body doesn't match the expected schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unexpected: true }) }) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    const result = await checker.check("at-1");
    expect(result).toEqual({ ok: false });
  });
});
