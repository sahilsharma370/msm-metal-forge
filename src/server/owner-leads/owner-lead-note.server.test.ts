import { describe, expect, it, vi } from "vitest";
import { addOwnerLeadNote, type AddOwnerLeadNoteServiceDeps, type OwnerLeadNoteRpcClient } from "./owner-lead-note.server";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "44444444-4444-4444-4444-444444444444";

function fakeDeps(rpcImpl: OwnerLeadNoteRpcClient["rpc"]): AddOwnerLeadNoteServiceDeps {
  return { rpc: { rpc: rpcImpl } as OwnerLeadNoteRpcClient };
}

function successResponse(data: unknown) {
  return { data, error: null };
}

function errorResponse(message: string) {
  return { data: null, error: { message } };
}

describe("addOwnerLeadNote — success mapping", () => {
  it("maps an RPC success into a typed ok result and forwards the exact args, including requestId", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ activityId: "33333333-3333-3333-3333-333333333333", note: "Customer called twice.", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "Customer called twice.", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({
      ok: true,
      activityId: "33333333-3333-3333-3333-333333333333",
      note: "Customer called twice.",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("add_lead_note_v1", {
      p_lead_id: LEAD_ID,
      p_owner_user_id: OWNER_ID,
      p_note_body: "Customer called twice.",
      p_request_id: REQUEST_ID,
    });
  });
});

describe("addOwnerLeadNote — error fragment mapping (never forwards the raw message or note body)", () => {
  it("maps 'owner not authorized' to reason: unauthorized", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("add_lead_note_v1: owner not authorized"));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps 'lead not found' to reason: not_found", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("add_lead_note_v1: lead not found"));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    "add_lead_note_v1: note body required",
    "add_lead_note_v1: note body too long",
    "add_lead_note_v1: request_id is required",
    "add_lead_note_v1: request_id reused with different input",
  ])("maps %s to reason: validation", async (message) => {
    const rpc = vi.fn().mockResolvedValue(errorResponse(message));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "validation" });
  });

  it("maps an unrecognized error message to reason: internal_error, never echoing it", async () => {
    const rpc = vi.fn().mockResolvedValue(errorResponse("permission denied for function add_lead_note_v1"));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a thrown network/client exception to reason: internal_error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });

  it("maps a malformed success payload (fails schema validation) to reason: internal_error", async () => {
    const rpc = vi.fn().mockResolvedValue(successResponse({ activityId: "not-a-uuid" }));
    const result = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "hello", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});

describe("addOwnerLeadNote — idempotent replay success", () => {
  it("a replay response (server returns the original row) is still mapped as ok: true, not an error", async () => {
    const rpc = vi.fn().mockResolvedValue(
      successResponse({ activityId: "33333333-3333-3333-3333-333333333333", note: "Original note.", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    const first = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "Original note.", requestId: REQUEST_ID }, fakeDeps(rpc));
    const second = await addOwnerLeadNote({ leadId: LEAD_ID, ownerUserId: OWNER_ID, body: "Original note.", requestId: REQUEST_ID }, fakeDeps(rpc));
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });
});
