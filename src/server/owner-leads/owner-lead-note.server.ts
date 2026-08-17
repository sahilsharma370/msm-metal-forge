/**
 * CHECKPOINT C2J-E — the owner private-note service: calls add_lead_note_v1
 * and maps its RAISE EXCEPTION fragments to a typed result. Matches
 * owner-lead-status.server.ts's own (dispatch-notification.server.ts-derived)
 * RPC pattern exactly.
 *
 * Never re-checks authorization at THIS layer — the caller (the API route)
 * has already verified the owner session; ownerUserId here is always that
 * session's own verified user id, never browser input. The RPC itself
 * independently re-verifies that identity against owner_accounts (see the
 * migration's correction-pass comment) — "unauthorized" below is that rare
 * race (e.g. deactivated between the route's check and this call), mapped
 * to the same sanitized 401 shape the route already uses for a session
 * failure. The note body itself is never logged anywhere in this module.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";

export interface OwnerLeadNoteRpcClient {
  rpc(
    fn: "add_lead_note_v1",
    args: { p_lead_id: string; p_owner_user_id: string; p_note_body: string; p_request_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadNoteRpcClient(client: SupabaseClient): OwnerLeadNoteRpcClient {
  return client as unknown as OwnerLeadNoteRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "add_lead_note_v1: owner not authorized";
const NOT_FOUND_FRAGMENT = "add_lead_note_v1: lead not found";
const BODY_REQUIRED_FRAGMENT = "add_lead_note_v1: note body required";
const BODY_TOO_LONG_FRAGMENT = "add_lead_note_v1: note body too long";
const REQUEST_ID_REQUIRED_FRAGMENT = "add_lead_note_v1: request_id is required";
const REQUEST_ID_REUSED_FRAGMENT = "add_lead_note_v1: request_id reused with different input";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isNotFoundError(message: string): boolean {
  return message.includes(NOT_FOUND_FRAGMENT);
}
function isValidationError(message: string): boolean {
  return (
    message.includes(BODY_REQUIRED_FRAGMENT) ||
    message.includes(BODY_TOO_LONG_FRAGMENT) ||
    message.includes(REQUEST_ID_REQUIRED_FRAGMENT) ||
    message.includes(REQUEST_ID_REUSED_FRAGMENT)
  );
}

const addNoteResultSchema = z.object({
  activityId: z.string().uuid(),
  note: z.string(),
  createdAt: z.string(),
});

export interface AddOwnerLeadNoteInput {
  readonly leadId: string;
  readonly ownerUserId: string;
  readonly body: string;
  readonly requestId: string;
}

export interface AddOwnerLeadNoteServiceDeps {
  rpc: OwnerLeadNoteRpcClient;
}

export function createProductionOwnerLeadNoteServiceDeps(): AddOwnerLeadNoteServiceDeps {
  return { rpc: toOwnerLeadNoteRpcClient(createSupabaseAdminClient()) };
}

export type AddOwnerLeadNoteResult =
  | { readonly ok: true; readonly activityId: string; readonly note: string; readonly createdAt: string }
  | { readonly ok: false; readonly reason: "unauthorized" | "not_found" | "validation" | "internal_error" };

/**
 * The one entry point this checkpoint's notes route calls. Idempotent: a
 * retry with the same requestId and the same (leadId, ownerUserId, body)
 * returns the original success (ok: true) rather than an error — see
 * add_lead_note_v1's own replay logic. A retry with the same requestId but
 * different input maps to reason: "validation" (never silently applied,
 * never silently treated as a duplicate).
 */
export async function addOwnerLeadNote(input: AddOwnerLeadNoteInput, deps: AddOwnerLeadNoteServiceDeps): Promise<AddOwnerLeadNoteResult> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("add_lead_note_v1", {
      p_lead_id: input.leadId,
      p_owner_user_id: input.ownerUserId,
      p_note_body: input.body,
      p_request_id: input.requestId,
    });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  if (response.error) {
    if (isNotAuthorizedError(response.error.message)) return { ok: false, reason: "unauthorized" };
    if (isNotFoundError(response.error.message)) return { ok: false, reason: "not_found" };
    if (isValidationError(response.error.message)) return { ok: false, reason: "validation" };
    return { ok: false, reason: "internal_error" };
  }

  const parsed = addNoteResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, activityId: parsed.data.activityId, note: parsed.data.note, createdAt: parsed.data.createdAt };
}
