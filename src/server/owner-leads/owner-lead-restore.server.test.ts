import { describe, expect, it, vi } from "vitest";
import { restoreOwnerLead, type RestoreOwnerLeadServiceDeps, type OwnerLeadRestoreRpcClient } from "./owner-lead-restore.server";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function fakeDeps(rpcImpl: OwnerLeadRestoreRpcClient["rpc"]): RestoreOwnerLeadServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadRestoreRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("restoreOwnerLead — success mapping", () => {
  it("maps a real restore RPC success into a typed ok result and calls the RPC with the right args", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ restored: true, status: "contacted" }));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: true, restored: true, status: "contacted" });
    expect(rpc).toHaveBeenCalledWith("restore_lead_v1", { p_lead_id: LEAD_ID, p_owner_user_id: OWNER_ID });
  });

  it("maps an idempotent-replay success (restored: false, not currently trashed) into a typed ok result", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ restored: false, status: "new" }));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result.ok && result.restored).toBe(false);
  });

  it("preserves the lead's status exactly as returned — restoring never changes workflow status", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ restored: true, status: "quote_sent" }));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result.ok && result.status).toBe("quote_sent");
  });
});

describe("restoreOwnerLead — error fragment mapping (never forwards the raw message)", () => {
  it("maps 'lead not found' to reason: not_found", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("restore_lead_v1: lead not found"));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("restore_lead_v1: owner not authorized"));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function restore_lead_v1"));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ restored: "yes" }));
    const result = await restoreOwnerLead({ leadId: LEAD_ID, ownerUserId: OWNER_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});
