/**
 * CHECKPOINT C2J-F — the owner Quick Add service: normalizes the submitted
 * contact phone via the Quote Experience's own canonical
 * normalizePhoneNumber (never re-implemented here), computes the
 * idempotency payload_hash via the same canonicalize/sha256Hex method
 * create_website_quote_v1's own payload_hash uses, calls
 * create_owner_quick_add_lead_v1, and maps its RAISE EXCEPTION fragments to
 * a typed result. Matches owner-lead-note.server.ts's own
 * (dispatch-notification.server.ts-derived) RPC pattern exactly.
 *
 * Never re-checks authorization at THIS layer — the caller (the API route)
 * has already verified the owner session; ownerUserId here is always that
 * session's own verified user id, never browser input. The RPC itself
 * independently re-verifies that identity against owner_accounts.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { canonicalize, sha256Hex, type CanonicalJsonValue } from "@/lib/quote/canonicalize";
import { normalizePhoneNumber } from "@/components/site/quote/quote-schema";
import type { OwnerLeadQuickAddRequest } from "@/lib/owner/owner-lead-quick-add-contract";

export interface OwnerLeadQuickAddRpcClient {
  rpc(
    fn: "create_owner_quick_add_lead_v1",
    args: {
      p_owner_user_id: string;
      p_idempotency_key: string;
      p_payload_hash: string;
      p_submission: Record<string, CanonicalJsonValue>;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toOwnerLeadQuickAddRpcClient(client: SupabaseClient): OwnerLeadQuickAddRpcClient {
  return client as unknown as OwnerLeadQuickAddRpcClient;
}

const NOT_AUTHORIZED_FRAGMENT = "create_owner_quick_add_lead_v1: owner not authorized";
// The RPC's own exact wording for its one custom-raised idempotency failure
// mode — matched here, not guessed, mirroring initiate-quote.ts's own
// IDEMPOTENCY_CONFLICT_MESSAGE_FRAGMENT precedent for create_website_quote_v1.
const IDEMPOTENCY_CONFLICT_FRAGMENT = "was already used with a different payload_hash";

function isNotAuthorizedError(message: string): boolean {
  return message.includes(NOT_AUTHORIZED_FRAGMENT);
}
function isIdempotencyConflictError(message: string): boolean {
  return message.includes(IDEMPOTENCY_CONFLICT_FRAGMENT);
}

const quickAddResultSchema = z.object({
  lead_id: z.string().uuid(),
  reference: z.string(),
  idempotent_replay: z.boolean(),
});

export interface CreateOwnerQuickAddLeadInput {
  readonly ownerUserId: string;
  readonly request: OwnerLeadQuickAddRequest;
}

export interface OwnerLeadQuickAddServiceDeps {
  rpc: OwnerLeadQuickAddRpcClient;
}

export function createProductionOwnerLeadQuickAddServiceDeps(): OwnerLeadQuickAddServiceDeps {
  return { rpc: toOwnerLeadQuickAddRpcClient(createSupabaseAdminClient()) };
}

export type CreateOwnerQuickAddLeadResult =
  | { readonly ok: true; readonly leadId: string; readonly reference: string; readonly idempotentReplay: boolean }
  | { readonly ok: false; readonly reason: "unauthorized" | "conflict" | "internal_error" };

/**
 * Builds the exact camelCase submission object create_owner_quick_add_lead_v1
 * expects. Every optional field normalizes to `null` (never `undefined`,
 * which canonicalize() must never see — see canonicalize.ts's own
 * contract), so the same logical Quick Add attempt always canonicalizes
 * identically regardless of which optional fields the browser happened to
 * omit vs. send as empty.
 */
export function buildQuickAddSubmission(request: OwnerLeadQuickAddRequest): { readonly [key: string]: CanonicalJsonValue } {
  return {
    intent: request.intent,
    captureChannel: request.channel,
    material: request.material,
    materialOtherText: request.materialOtherText ?? null,
    contactName: request.contactName,
    contactPhone: normalizePhoneNumber(request.contactPhone) ?? request.contactPhone,
    notes: request.notes ?? null,
    quantityValue: request.quantityValue ?? null,
    quantityUnit: request.quantityUnit ?? null,
    quantityUnitOther: request.quantityUnitOther ?? null,
    sellerEmirate: request.sellerEmirate ?? null,
    sellerArea: request.sellerArea ?? null,
  };
}

/** The one entry point this checkpoint's quick-add route calls. */
export async function createOwnerQuickAddLead(
  input: CreateOwnerQuickAddLeadInput,
  deps: OwnerLeadQuickAddServiceDeps,
): Promise<CreateOwnerQuickAddLeadResult> {
  const normalizedSubmission = buildQuickAddSubmission(input.request);
  const payloadHash = await sha256Hex(canonicalize(normalizedSubmission));

  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("create_owner_quick_add_lead_v1", {
      p_owner_user_id: input.ownerUserId,
      p_idempotency_key: input.request.requestId,
      p_payload_hash: payloadHash,
      p_submission: normalizedSubmission as Record<string, CanonicalJsonValue>,
    });
  } catch {
    return { ok: false, reason: "internal_error" };
  }

  if (response.error) {
    if (isNotAuthorizedError(response.error.message)) return { ok: false, reason: "unauthorized" };
    if (isIdempotencyConflictError(response.error.message)) return { ok: false, reason: "conflict" };
    // Every other failure — a CHECK constraint the browser's own zod schema
    // somehow didn't catch, a connection error, anything else — is reported
    // generically. SQL text, Supabase error internals and the computed hash
    // never reach the response body, matching initiate-quote.ts's own
    // established convention exactly.
    return { ok: false, reason: "internal_error" };
  }

  const parsed = quickAddResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { ok: false, reason: "internal_error" };
  }

  return {
    ok: true,
    leadId: parsed.data.lead_id,
    reference: parsed.data.reference,
    idempotentReplay: parsed.data.idempotent_replay,
  };
}
