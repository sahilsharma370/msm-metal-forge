/**
 * Owner "Edit enquiry" — the service layer: normalizes the submitted
 * contact phone via the Quote Experience's own canonical
 * normalizePhoneNumber (never re-implemented here, matching
 * owner-lead-quick-add.server.ts's own precedent), calls
 * update_lead_details_v1, and maps its RAISE EXCEPTION fragments to a typed
 * result. Matches owner-lead-status.server.ts's own established RPC pattern
 * exactly (structural rpc() client interface, toXRpcClient cast helper,
 * FRAGMENT + isXError substring matching against the raw error message —
 * never forwarded to the browser).
 *
 * Never re-checks authorization at THIS layer — the caller (the API route)
 * has already verified the owner session; ownerUserId here is always that
 * session's own verified user id, never browser input. The RPC itself
 * independently re-verifies that identity against owner_accounts.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { normalizePhoneNumber } from "@/components/site/quote/quote-schema";
import type { OwnerLeadEditRequest } from "@/lib/owner/owner-lead-detail-contract";

export interface OwnerLeadEditRpcClient {
  rpc(
    fn: "update_lead_details_v1",
    args: {
      p_lead_id: string;
      p_owner_user_id: string;
      p_expected_updated_at: string;
      p_submission: Record<string, unknown>;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadEditRpcClient(client: SupabaseClient): OwnerLeadEditRpcClient {
  return client as unknown as OwnerLeadEditRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "update_lead_details_v1: owner not authorized";
const NOT_FOUND_FRAGMENT = "update_lead_details_v1: lead not found";
const NOT_EDITABLE_FRAGMENT = "update_lead_details_v1: lead not editable";
const STALE_FRAGMENT = "update_lead_details_v1: stale update";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isNotFoundError(message: string): boolean {
  return message.includes(NOT_FOUND_FRAGMENT);
}
function isNotEditableError(message: string): boolean {
  return message.includes(NOT_EDITABLE_FRAGMENT);
}
function isStaleError(message: string): boolean {
  return message.includes(STALE_FRAGMENT);
}
/** Every other 'update_lead_details_v1: ...' RAISE fragment is a validation failure (invalid material, phone shape, over-length field, etc.) — the browser's own zod schema should normally catch these first, so reaching this branch means the RPC's own defense-in-depth check fired. */
function isValidationError(message: string): boolean {
  return message.startsWith("update_lead_details_v1:");
}

const editResultSchema = z.object({
  updated: z.boolean(),
  updatedAt: z.string(),
  changedFields: z.array(z.string()),
});

export interface UpdateOwnerLeadDetailsInput {
  readonly leadId: string;
  readonly ownerUserId: string;
  readonly expectedUpdatedAt: string;
  readonly request: OwnerLeadEditRequest;
}

export interface OwnerLeadEditServiceDeps {
  rpc: OwnerLeadEditRpcClient;
}

export function createProductionOwnerLeadEditServiceDeps(): OwnerLeadEditServiceDeps {
  return { rpc: toOwnerLeadEditRpcClient(createSupabaseAdminClient()) };
}

export type UpdateOwnerLeadDetailsResult =
  | { readonly ok: true; readonly updated: boolean; readonly updatedAt: string; readonly changedFields: readonly string[] }
  | { readonly ok: false; readonly reason: "unauthorized" | "not_found" | "not_editable" | "conflict" | "validation" | "internal_error" };

/**
 * Builds the exact camelCase submission object update_lead_details_v1
 * expects. Every optional field normalizes to `null` (never `undefined`),
 * matching buildQuickAddSubmission's own established convention.
 */
export function buildEditSubmission(request: OwnerLeadEditRequest): Record<string, unknown> {
  return {
    contactName: request.contactName,
    contactPhone: normalizePhoneNumber(request.contactPhone) ?? request.contactPhone,
    material: request.material,
    materialOtherText: request.materialOtherText ?? null,
    quantityValue: request.quantityValue ?? null,
    quantityUnit: request.quantityUnit ?? null,
    quantityUnitOther: request.quantityUnitOther ?? null,
    emirate: request.emirate ?? null,
    area: request.area ?? null,
    notes: request.notes ?? null,
  };
}

/** The one entry point this checkpoint's edit route calls. */
export async function updateOwnerLeadDetails(
  input: UpdateOwnerLeadDetailsInput,
  deps: OwnerLeadEditServiceDeps,
): Promise<UpdateOwnerLeadDetailsResult> {
  const submission = buildEditSubmission(input.request);

  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("update_lead_details_v1", {
      p_lead_id: input.leadId,
      p_owner_user_id: input.ownerUserId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_submission: submission,
    });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  if (response.error) {
    if (isNotAuthorizedError(response.error.message)) return { ok: false, reason: "unauthorized" };
    if (isNotFoundError(response.error.message)) return { ok: false, reason: "not_found" };
    if (isNotEditableError(response.error.message)) return { ok: false, reason: "not_editable" };
    if (isStaleError(response.error.message)) return { ok: false, reason: "conflict" };
    if (isValidationError(response.error.message)) return { ok: false, reason: "validation" };
    // Every other failure — a CHECK constraint the browser's own zod schema
    // somehow didn't catch, a connection error, anything else — is reported
    // generically. SQL text, Supabase error internals never reach the
    // response body.
    return { ok: false, reason: "internal_error" };
  }

  const parsed = editResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, updated: parsed.data.updated, updatedAt: parsed.data.updatedAt, changedFields: parsed.data.changedFields };
}
