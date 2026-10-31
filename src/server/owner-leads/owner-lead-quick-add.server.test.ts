import { describe, expect, it, vi } from "vitest";
import { createOwnerQuickAddLead, buildQuickAddSubmission, type OwnerLeadQuickAddServiceDeps, type OwnerLeadQuickAddRpcClient } from "./owner-lead-quick-add.server";
import type { OwnerLeadQuickAddRequest } from "@/lib/owner/owner-lead-quick-add-contract";

const OWNER_ID = "22222222-2222-2222-2222-222222222222";

const BASE_REQUEST: OwnerLeadQuickAddRequest = {
  requestId: "44444444-4444-4444-4444-444444444444",
  intent: "sell",
  channel: "phone",
  material: "copper",
  contactName: "Ahmed",
  contactPhone: "0501234567", // deliberately UN-normalized (local UAE format), to prove server-side normalization
};

function fakeDeps(rpcImpl: OwnerLeadQuickAddRpcClient["rpc"]): OwnerLeadQuickAddServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadQuickAddRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("buildQuickAddSubmission — normalization", () => {
  it("normalizes a local UAE phone number to E.164 via the canonical helper", () => {
    const submission = buildQuickAddSubmission(BASE_REQUEST);
    expect(submission["contactPhone"]).toBe("+971501234567");
  });

  it("normalizes every omitted optional field to null, never undefined", () => {
    const submission = buildQuickAddSubmission(BASE_REQUEST);
    expect(submission["materialOtherText"]).toBeNull();
    expect(submission["notes"]).toBeNull();
    expect(submission["quantityValue"]).toBeNull();
    expect(submission["sellerEmirate"]).toBeNull();
    expect(submission["sellerArea"]).toBeNull();
  });
});

describe("createOwnerQuickAddLead — success mapping", () => {
  it("maps an RPC success into a typed ok result and calls the RPC with the normalized, hashed payload", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ lead_id: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotent_replay: false }),
    );
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("create_owner_quick_add_lead_v1");
    expect(args["p_owner_user_id"]).toBe(OWNER_ID);
    expect(args["p_idempotency_key"]).toBe(BASE_REQUEST.requestId);
    expect(args["p_payload_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect((args["p_submission"] as Record<string, unknown>)["contactPhone"]).toBe("+971501234567");
  });

  it("the same request always produces the same payload_hash (deterministic)", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ lead_id: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotent_replay: false }),
    );
    await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    const firstHash = (rpc.mock.calls[0]?.[1] as Record<string, unknown>)["p_payload_hash"];
    const secondHash = (rpc.mock.calls[1]?.[1] as Record<string, unknown>)["p_payload_hash"];
    expect(firstHash).toBe(secondHash);
  });
});

describe("createOwnerQuickAddLead — error fragment mapping (never forwards the raw message)", () => {
  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("create_owner_quick_add_lead_v1: owner not authorized"));
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps an idempotency conflict to reason: conflict", async () => {
    const rpc = vi.fn().mockResolvedValue(
      errorResponse("create_owner_quick_add_lead_v1: idempotency_key 44444444-4444-4444-4444-444444444444 was already used with a different payload_hash"),
    );
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function create_owner_quick_add_lead_v1"));
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ lead_id: "not-a-uuid" }));
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});

describe("createOwnerQuickAddLead — idempotent replay success", () => {
  it("a replay response (idempotent_replay: true) is still mapped as ok: true, not an error", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ lead_id: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotent_replay: true }),
    );
    const result = await createOwnerQuickAddLead({ ownerUserId: OWNER_ID, request: BASE_REQUEST }, fakeDeps(rpc));
    expect(result).toEqual({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: true });
  });
});
