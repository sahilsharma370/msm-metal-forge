import { describe, expect, it, vi } from "vitest";
import { lookupOwnerAccount, toOwnerAccountsQueryClient, type OwnerAccountsQueryClient } from "./owner-accounts.server";

function fakeClient(result: { data: unknown; error: { message: string } | null }, maybeSingleImpl?: () => PromiseLike<typeof result>): OwnerAccountsQueryClient {
  const maybeSingle = maybeSingleImpl ?? (() => Promise.resolve(result));
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle,
        })),
      })),
    })),
  };
}

describe("lookupOwnerAccount", () => {
  it("returns found:true, isActive:true for an active owner row", async () => {
    const client = fakeClient({ data: { role: "owner", is_active: true }, error: null });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: true, isActive: true });
  });

  it("returns found:true, isActive:false for an inactive owner row", async () => {
    const client = fakeClient({ data: { role: "owner", is_active: false }, error: null });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: true, isActive: false });
  });

  it("returns found:false when no row exists (data null)", async () => {
    const client = fakeClient({ data: null, error: null });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: false, isActive: false });
  });

  it("returns found:false when the query errors", async () => {
    const client = fakeClient({ data: null, error: { message: "boom" } });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: false, isActive: false });
  });

  it("returns found:false when the row fails schema re-validation (e.g. an unexpected role value)", async () => {
    const client = fakeClient({ data: { role: "staff", is_active: true }, error: null });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: false, isActive: false });
  });

  it("returns found:false when the row is missing a required field", async () => {
    const client = fakeClient({ data: { role: "owner" }, error: null });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: false, isActive: false });
  });

  it("fails closed (found:false) when the client throws", async () => {
    const client = fakeClient({ data: null, error: null }, () => {
      throw new Error("connection lost");
    });
    const result = await lookupOwnerAccount(client, "u1");
    expect(result).toEqual({ found: false, isActive: false });
  });

  it("queries by the exact user_id supplied", async () => {
    const eqMock = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }));
    const client: OwnerAccountsQueryClient = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: eqMock })) })),
    };
    await lookupOwnerAccount(client, "specific-user-id");
    expect(eqMock).toHaveBeenCalledWith("user_id", "specific-user-id");
  });
});

describe("toOwnerAccountsQueryClient", () => {
  it("passes the client through as-is (structural cast, no transformation)", () => {
    const fakeSupabaseClient = { from: vi.fn() } as never;
    expect(toOwnerAccountsQueryClient(fakeSupabaseClient)).toBe(fakeSupabaseClient);
  });
});
