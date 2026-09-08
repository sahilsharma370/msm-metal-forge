import { describe, expect, it, vi } from "vitest";
import { updateOwnerLeadDetails, buildEditSubmission, type OwnerLeadEditServiceDeps, type OwnerLeadEditRpcClient } from "./owner-lead-edit.server";
import type { OwnerLeadEditRequest } from "@/lib/owner/owner-lead-detail-contract";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";
const EXPECTED_UPDATED_AT = "2026-01-01T00:05:00.000Z";

const BASE_REQUEST: OwnerLeadEditRequest = {
  contactName: "Ahmed Seller",
  contactPhone: "0501234567",
  material: "copper",
  expectedUpdatedAt: EXPECTED_UPDATED_AT,
};

function fakeDeps(rpcImpl: OwnerLeadEditRpcClient["rpc"]): OwnerLeadEditServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadEditRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("buildEditSubmission — normalization", () => {
  it("normalizes a UAE local-format phone to canonical E.164 via the shared normalizer", () => {
    const submission = buildEditSubmission(BASE_REQUEST);
    expect(submission["contactPhone"]).toBe("+971501234567");
  });

  it("normalizes every omitted optional field to null, never undefined", () => {
    const submission = buildEditSubmission(BASE_REQUEST);
    expect(submission["materialOtherText"]).toBeNull();
    expect(submission["quantityValue"]).toBeNull();
    expect(submission["quantityUnit"]).toBeNull();
    expect(submission["quantityUnitOther"]).toBeNull();
    expect(submission["emirate"]).toBeNull();
    expect(submission["area"]).toBeNull();
    expect(submission["notes"]).toBeNull();
  });

  it("passes through an already-canonical phone number unchanged", () => {
    const submission = buildEditSubmission({ ...BASE_REQUEST, contactPhone: "+971501234567" });
    expect(submission["contactPhone"]).toBe("+971501234567");
  });
});

describe("updateOwnerLeadDetails — success mapping", () => {
  it("maps a real-update RPC success into a typed ok result, calling the RPC with the exact expected args", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] }));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z", changedFields: ["Material"] });
    expect(rpc).toHaveBeenCalledWith("update_lead_details_v1", {
      p_lead_id: LEAD_ID,
      p_owner_user_id: OWNER_ID,
      p_expected_updated_at: EXPECTED_UPDATED_AT,
      p_submission: expect.objectContaining({ contactName: "Ahmed Seller", contactPhone: "+971501234567", material: "copper" }),
    });
  });

  it("maps a no-op RPC success (updated: false) into a typed ok result", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ updated: false, updatedAt: EXPECTED_UPDATED_AT, changedFields: [] }));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result.ok && result.updated).toBe(false);
  });
});

describe("updateOwnerLeadDetails — error fragment mapping (never forwards the raw message)", () => {
  it("maps 'lead not found' to reason: not_found", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("update_lead_details_v1: lead not found"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("update_lead_details_v1: owner not authorized"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps 'lead not editable' (archived/trashed) to reason: not_editable", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("update_lead_details_v1: lead not editable"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "not_editable" });
  });

  it("maps 'stale update' to reason: conflict", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("update_lead_details_v1: stale update"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it.each([
    "update_lead_details_v1: contact name required",
    "update_lead_details_v1: invalid phone number",
    "update_lead_details_v1: invalid material",
    "update_lead_details_v1: material description required",
    "update_lead_details_v1: quantity must be positive",
    "update_lead_details_v1: invalid emirate",
    "update_lead_details_v1: location does not apply to a buyer enquiry",
  ])("maps %s to reason: validation", async (message) => {
    const rpc = vi.fn().mockResolvedValue(errorResponse(message));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "validation" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function update_lead_details_v1"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ updated: "yes" }));
    const result = await updateOwnerLeadDetails(
      { leadId: LEAD_ID, ownerUserId: OWNER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT, request: BASE_REQUEST },
      fakeDeps(rpc),
    );
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});
