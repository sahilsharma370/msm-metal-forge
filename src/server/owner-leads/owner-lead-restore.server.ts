/**
 * CHECKPOINT C2M-A — the owner lead Restore service: calls restore_lead_v1
 * and maps its RAISE EXCEPTION fragments to a typed result. Mirrors
 * owner-lead-trash.server.ts exactly (its own inverse).
 *
 * Never re-checks authorization — the caller (the API route) has already
 * verified the owner session; ownerUserId here is always that session's
 * own verified user id, never browser input.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { OWNER_LEAD_STATUS_VALUES, type OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";

export interface OwnerLeadRestoreRpcClient {
  rpc(
    fn: "restore_lead_v1",
    args: { p_lead_id: string; p_owner_user_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadRestoreRpcClient(client: SupabaseClient): OwnerLeadRestoreRpcClient {
  return client as unknown as OwnerLeadRestoreRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "restore_lead_v1: owner not authorized";
const NOT_FOUND_FRAGMENT = "restore_lead_v1: lead not found";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isNotFoundError(message: string): boolean {
  return message.includes(NOT_FOUND_FRAGMENT);
}

const restoreResultSchema = z.object({
  restored: z.boolean(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
});

export interface RestoreOwnerLeadInput {
  readonly leadId: string;
  readonly ownerUserId: string;
}

export interface RestoreOwnerLeadServiceDeps {
  rpc: OwnerLeadRestoreRpcClient;
}

export function createProductionOwnerLeadRestoreServiceDeps(): RestoreOwnerLeadServiceDeps {
  return { rpc: toOwnerLeadRestoreRpcClient(createSupabaseAdminClient()) };
}

export type RestoreOwnerLeadResult =
  | { readonly ok: true; readonly restored: boolean; readonly status: OwnerLeadStatus }
  | { readonly ok: false; readonly reason: "unauthorized" | "not_found" | "internal_error" };

/** The one entry point the restore route calls. A retried/duplicate request against a lead that is not currently trashed succeeds idempotently (restored: false, no new activity row) rather than erroring — see restore_lead_v1's own header comment. */
export async function restoreOwnerLead(input: RestoreOwnerLeadInput, deps: RestoreOwnerLeadServiceDeps): Promise<RestoreOwnerLeadResult> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("restore_lead_v1", { p_lead_id: input.leadId, p_owner_user_id: input.ownerUserId });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  if (response.error) {
    if (isNotAuthorizedError(response.error.message)) return { ok: false, reason: "unauthorized" };
    if (isNotFoundError(response.error.message)) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "internal_error" };
  }

  const parsed = restoreResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, restored: parsed.data.restored, status: parsed.data.status };
}
