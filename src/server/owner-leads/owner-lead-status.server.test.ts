import { describe, expect, it, vi } from "vitest";
import { changeOwnerLeadStatus, type ChangeOwnerLeadStatusServiceDeps, type OwnerLeadStatusRpcClient } from "./owner-lead-status.server";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function fakeDeps(rpcImpl: OwnerLeadStatusRpcClient["rpc"]): ChangeOwnerLeadStatusServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadStatusRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("changeOwnerLeadStatus — success mapping", () => {
  it("maps a real-transition RPC success into a typed ok result", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: true, changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("change_lead_status_v1", {
      p_lead_id: LEAD_ID,
      p_owner_user_id: OWNER_ID,
      p_expected_status: "new",
      p_new_status: "contacted",
      p_lost_reason: null,
    });
  });

  it("maps a no-op RPC success (changed: false) into a typed ok result", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ changed: false, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "contacted", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result.ok && result.changed).toBe(false);
  });
});

describe("changeOwnerLeadStatus — error fragment mapping (never forwards the raw message)", () => {
  it("maps 'lead not found' to reason: not_found", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("change_lead_status_v1: lead not found"));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("change_lead_status_v1: owner not authorized"));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps 'stale status' to reason: conflict", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("change_lead_status_v1: stale status"));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it.each([
    "change_lead_status_v1: lost reason required",
    "change_lead_status_v1: lost reason too long",
    "change_lead_status_v1: invalid status",
  ])("maps %s to reason: validation", async (message) => {
    const rpc = vi.fn().mockResolvedValue(errorResponse(message));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "lost", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "validation" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function change_lead_status_v1"));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ changed: "yes" }));
    const result = await changeOwnerLeadStatus(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedStatus: "new", newStatus: "contacted", lostReason: null },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});
