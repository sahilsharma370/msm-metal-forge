import { describe, expect, it, vi } from "vitest";
import { trashOwnerLead, type TrashOwnerLeadServiceDeps, type OwnerLeadTrashRpcClient } from "./owner-lead-trash.server";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function fakeDeps(rpcImpl: OwnerLeadTrashRpcClient["rpc"]): TrashOwnerLeadServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadTrashRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("trashOwnerLead — success mapping", () => {
  it("maps a real trash RPC success into a typed ok result and calls the RPC with the right args", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ trashed: true, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" }));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: true, trashed: true, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" });
    expect(rpc).toHaveBeenCalledWith("trash_lead_v1", { p_lead_id: LEAD_ID, p_owner_user_id: OWNER_ID });
  });

  it("maps an idempotent-replay success (trashed: false, already trashed) into a typed ok result", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ trashed: false, deletedAt: "2026-01-01T00:00:00.000Z", status: "new" }));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result.ok && result.trashed).toBe(false);
  });
});

describe("trashOwnerLead — error fragment mapping (never forwards the raw message)", () => {
  it("maps 'lead not found' to reason: not_found", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("trash_lead_v1: lead not found"));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("trash_lead_v1: owner not authorized"));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function trash_lead_v1"));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ trashed: "yes" }));
    const result = await trashOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});
