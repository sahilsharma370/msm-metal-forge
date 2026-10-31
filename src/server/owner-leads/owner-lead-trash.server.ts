/**
 * CHECKPOINT C2M-A — the owner lead Move-to-Trash service: calls
 * trash_lead_v1 and maps its RAISE EXCEPTION fragments to a typed result.
 * Matches owner-lead-status.server.ts's own established RPC pattern
 * exactly (structural rpc() client interface, toXRpcClient cast helper,
 * FRAGMENT + isXError substring matching against the raw error message —
 * never forwarded to the browser).
 *
 * Never re-checks authorization — the caller (the API route) has already
 * verified the owner session; ownerUserId here is always that session's
 * own verified user id, never browser input.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { OWNER_LEAD_STATUS_VALUES, type OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";

export interface OwnerLeadTrashRpcClient {
  rpc(
    fn: "trash_lead_v1",
    args: { p_lead_id: string; p_owner_user_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadTrashRpcClient(client: SupabaseClient): OwnerLeadTrashRpcClient {
  return client as unknown as OwnerLeadTrashRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "trash_lead_v1: owner not authorized";
const NOT_FOUND_FRAGMENT = "trash_lead_v1: lead not found";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isNotFoundError(message: string): boolean {
  return message.includes(NOT_FOUND_FRAGMENT);
}

const trashResultSchema = z.object({
  trashed: z.boolean(),
  deletedAt: z.string().nullable(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
});

export interface TrashOwnerLeadInput {
  readonly leadId: string;
  readonly ownerUserId: string;
}

export interface TrashOwnerLeadServiceDeps {
  rpc: OwnerLeadTrashRpcClient;
}

export function createProductionOwnerLeadTrashServiceDeps(): TrashOwnerLeadServiceDeps {
  return { rpc: toOwnerLeadTrashRpcClient(createSupabaseAdminClient()) };
}

export type TrashOwnerLeadResult =
  | { readonly ok: true; readonly trashed: boolean; readonly deletedAt: string | null; readonly status: OwnerLeadStatus }
  | { readonly ok: false; readonly reason: "unauthorized" | "not_found" | "internal_error" };

/** The one entry point the trash route calls. A retried/duplicate request against an already-trashed lead succeeds idempotently (trashed: false, no new activity row) rather than erroring — see trash_lead_v1's own header comment. */
export async function trashOwnerLead(input: TrashOwnerLeadInput, deps: TrashOwnerLeadServiceDeps): Promise<TrashOwnerLeadResult> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("trash_lead_v1", { p_lead_id: input.leadId, p_owner_user_id: input.ownerUserId });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  if (response.error) {
    if (isNotAuthorizedError(response.error.message)) return { ok: false, reason: "unauthorized" };
    if (isNotFoundError(response.error.message)) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "internal_error" };
  }

  const parsed = trashResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, trashed: parsed.data.trashed, deletedAt: parsed.data.deletedAt, status: parsed.data.status };
}
