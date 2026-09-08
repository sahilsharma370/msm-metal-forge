/**
 * CHECKPOINT C2J-E — the owner lead status-change service: calls
 * change_lead_status_v1 and maps its RAISE EXCEPTION fragments to a typed
 * result. Matches dispatch-notification.server.ts's own established RPC
 * pattern (structural rpc() client interface, toXRpcClient cast helper,
 * FRAGMENT + isXError substring matching against the raw error message —
 * never forwarded to the browser) and owner-lead-file-access.server.ts's
 * plain-async-functions-injected-as-deps shape.
 *
 * Never re-checks authorization — the caller (the API route) has already
 * verified the owner session; ownerUserId here is always that session's
 * own verified user id, never browser input.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { OWNER_LEAD_STATUS_VALUES, type OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";

export interface OwnerLeadStatusRpcClient {
  rpc(
    fn: "change_lead_status_v1",
    args: {
      p_lead_id: string;
      p_owner_user_id: string;
      p_expected_status: string;
      p_new_status: string;
      p_lost_reason: string | null;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadStatusRpcClient(client: SupabaseClient): OwnerLeadStatusRpcClient {
  return client as unknown as OwnerLeadStatusRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "change_lead_status_v1: owner not authorized";
const NOT_FOUND_FRAGMENT = "change_lead_status_v1: lead not found";
const NOT_EDITABLE_FRAGMENT = "change_lead_status_v1: lead not editable";
const STALE_FRAGMENT = "change_lead_status_v1: stale status";
const LOST_REASON_REQUIRED_FRAGMENT = "change_lead_status_v1: lost reason required";
const LOST_REASON_TOO_LONG_FRAGMENT = "change_lead_status_v1: lost reason too long";
const INVALID_STATUS_FRAGMENT = "change_lead_status_v1: invalid status";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isNotFoundError(message: string): boolean {
  return message.includes(NOT_FOUND_FRAGMENT);
}
/** BATCH 3B — a trashed lead (deleted_at is not null); never status = 'archived', which stays fully mutable. */
function isNotEditableError(message: string): boolean {
  return message.includes(NOT_EDITABLE_FRAGMENT);
}
function isStaleError(message: string): boolean {
  return message.includes(STALE_FRAGMENT);
}
function isValidationError(message: string): boolean {
  return (
    message.includes(LOST_REASON_REQUIRED_FRAGMENT) ||
    message.includes(LOST_REASON_TOO_LONG_FRAGMENT) ||
    message.includes(INVALID_STATUS_FRAGMENT)
  );
}

const changeStatusResultSchema = z.object({
  changed: z.boolean(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  lostReason: z.string().nullable(),
  closedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export interface ChangeOwnerLeadStatusInput {
  readonly leadId: string;
  readonly ownerUserId: string;
  readonly expectedStatus: OwnerLeadStatus;
  readonly newStatus: OwnerLeadStatus;
  readonly lostReason: string | null;
}

export interface ChangeOwnerLeadStatusServiceDeps {
  rpc: OwnerLeadStatusRpcClient;
}

export function createProductionOwnerLeadStatusServiceDeps(): ChangeOwnerLeadStatusServiceDeps {
  return { rpc: toOwnerLeadStatusRpcClient(createSupabaseAdminClient()) };
}

export type ChangeOwnerLeadStatusResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly status: OwnerLeadStatus;
      readonly lostReason: string | null;
      readonly closedAt: string | null;
      readonly updatedAt: string;
    }
  | { readonly ok: false; readonly reason: "unauthorized" | "not_found" | "not_editable" | "conflict" | "validation" | "internal_error" };

/**
 * The one entry point this checkpoint's status route calls. "not_found"
 * covers both a genuinely missing lead and an incomplete one — the RPC
 * itself never distinguishes them (see the migration's own comment), so
 * this service can't either.
 */
export async function changeOwnerLeadStatus(
  input: ChangeOwnerLeadStatusInput,
  deps: ChangeOwnerLeadStatusServiceDeps,
): Promise<ChangeOwnerLeadStatusResult> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("change_lead_status_v1", {
      p_lead_id: input.leadId,
      p_owner_user_id: input.ownerUserId,
      p_expected_status: input.expectedStatus,
      p_new_status: input.newStatus,
      p_lost_reason: input.lostReason,
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
    return { ok: false, reason: "internal_error" };
  }

  const parsed = changeStatusResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return {
    ok: true,
    changed: parsed.data.changed,
    status: parsed.data.status,
    lostReason: parsed.data.lostReason,
    closedAt: parsed.data.closedAt,
    updatedAt: parsed.data.updatedAt,
  };
}
