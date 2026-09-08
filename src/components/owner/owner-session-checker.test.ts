import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerSessionChecker } from "./owner-session-checker";
import { OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS, OwnerAuthTimeoutError } from "./owner-auth-timeout";

describe("createOwnerSessionChecker", () => {
  it("sends the access token as a Bearer authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, owner: { userId: "u1", role: "owner" } }),
    }) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    await checker.check("at-1");
    expect(fetchImpl).toHaveBeenCalledWith("/api/owner/session", {
      method: "GET",
      headers: { authorization: "Bearer at-1" },
      signal: expect.any(AbortSignal),
    });
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

describe("createOwnerSessionChecker — bounded completion (a stalled fetch must not hang forever)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the fetch and rejects with OwnerAuthTimeoutError once OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS elapses", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const checker = createOwnerSessionChecker(fetchImpl as unknown as typeof fetch);

    const outcome = checker.check("at-1");
    const assertion = expect(outcome).rejects.toBeInstanceOf(OwnerAuthTimeoutError);
    await vi.advanceTimersByTimeAsync(OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS);
    await assertion;

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });

  it("a genuine (non-timeout) fetch rejection still returns ok:false, not a thrown timeout error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const checker = createOwnerSessionChecker(fetchImpl);
    const result = await checker.check("at-1");
    expect(result).toEqual({ ok: false });
  });
});
