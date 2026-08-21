import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerAuthClient } from "./owner-auth-client";
import { OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS, OwnerAuthTimeoutError } from "./owner-auth-timeout";

function fakeSupabaseClient(overrides: Partial<{ getSession: () => Promise<unknown>; setSession: (v: unknown) => Promise<unknown>; signOut: () => Promise<unknown> }> = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      setSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    },
  };
}

describe("createOwnerAuthClient — getAccessToken", () => {
  it("returns null when there is no local session", async () => {
    const supabase = fakeSupabaseClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null } }) });
    const client = createOwnerAuthClient(() => supabase as never);
    expect(await client.getAccessToken()).toBeNull();
  });

  it("returns the access token when a session exists", async () => {
    const supabase = fakeSupabaseClient({
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "at-1" } } }),
    });
    const client = createOwnerAuthClient(() => supabase as never);
    expect(await client.getAccessToken()).toBe("at-1");
  });

  it("returns null (fails closed) rather than throwing when getSession itself throws", async () => {
    const supabase = fakeSupabaseClient({ getSession: vi.fn().mockRejectedValue(new Error("storage unavailable")) });
    const client = createOwnerAuthClient(() => supabase as never);
    expect(await client.getAccessToken()).toBeNull();
  });
});

describe("createOwnerAuthClient — getAccessToken bounded completion (a stalled Supabase call must not hang forever)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with OwnerAuthTimeoutError once OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS elapses on a getSession() that never resolves", async () => {
    vi.useFakeTimers();
    const supabase = fakeSupabaseClient({ getSession: vi.fn(() => new Promise(() => {})) });
    const client = createOwnerAuthClient(() => supabase as never);

    const outcome = client.getAccessToken();
    const assertion = expect(outcome).rejects.toBeInstanceOf(OwnerAuthTimeoutError);
    await vi.advanceTimersByTimeAsync(OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS);
    await assertion;
  });

  it("resolves normally when getSession() answers just under the timeout", async () => {
    vi.useFakeTimers();
    const supabase = fakeSupabaseClient({
      getSession: vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: { session: { access_token: "at-1" } } }), OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS - 1);
          }),
      ),
    });
    const client = createOwnerAuthClient(() => supabase as never);

    const outcome = client.getAccessToken();
    await vi.advanceTimersByTimeAsync(OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS - 1);
    expect(await outcome).toBe("at-1");
  });
});

describe("createOwnerAuthClient — setSession", () => {
  it("calls the official supabase-js setSession with the exact tokens", async () => {
    const supabase = fakeSupabaseClient();
    const client = createOwnerAuthClient(() => supabase as never);
    await client.setSession({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: 123 });
    expect(supabase.auth.setSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
  });
});

describe("createOwnerAuthClient — signOut", () => {
  it("calls the official supabase-js signOut", async () => {
    const supabase = fakeSupabaseClient();
    const client = createOwnerAuthClient(() => supabase as never);
    await client.signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});
