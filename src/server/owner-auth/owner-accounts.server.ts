/**
 * CHECKPOINT C2I-A — narrow read-only query surface onto public.owner_accounts,
 * matching this codebase's own established QuoteRpcClient
 * (initiate-quote.ts) / NotificationDispatchRpcClient
 * (dispatch-notification.server.ts) pattern: a structural subset of the
 * real @supabase/supabase-js SupabaseClient, small enough to fake
 * completely in tests, and the response is defensively re-validated with
 * zod rather than trusted blindly even though it comes from this project's
 * own database — same posture as every other server module here. `.server.ts`
 * suffix — see env.server.ts for why that's sufficient import protection on
 * its own.
 *
 * A plain point SELECT via the service-role admin client (not an RPC) is
 * used here, matching dispatch-notification.server.ts's own loadLead()
 * precedent for reads — see the migration's own comment for why no helper
 * RPC was added for this table.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const ownerAccountRowSchema = z.object({
  role: z.literal("owner"),
  is_active: z.boolean(),
});

/**
 * The exact shape this module calls on a SupabaseClient — narrow enough to
 * type this one lookup without a generated Database type, and small enough
 * to fake completely in tests (see owner-session.test.ts).
 */
export interface OwnerAccountsQueryClient {
  from(table: "owner_accounts"): {
    select(columns: "role, is_active"): {
      eq(
        column: "user_id",
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

export function toOwnerAccountsQueryClient(client: SupabaseClient): OwnerAccountsQueryClient {
  return client as unknown as OwnerAccountsQueryClient;
}

export interface OwnerAccountLookupResult {
  readonly found: boolean;
  readonly isActive: boolean;
}

/**
 * Looks up exactly one owner_accounts row by user_id. A missing row, a
 * query error, and a row that fails re-validation are all treated
 * identically as "not found" — verifyOwnerSession fails closed on any of
 * them the same way, and this function never throws.
 */
export async function lookupOwnerAccount(client: OwnerAccountsQueryClient, userId: string): Promise<OwnerAccountLookupResult> {
  let data: unknown;
  let error: { message: string } | null;
  try {
    ({ data, error } = await client.from("owner_accounts").select("role, is_active").eq("user_id", userId).maybeSingle());
  } catch {
    return { found: false, isActive: false };
  }
  if (error || data === null || data === undefined) {
    return { found: false, isActive: false };
  }
  const parsed = ownerAccountRowSchema.safeParse(data);
  if (!parsed.success) {
    return { found: false, isActive: false };
  }
  return { found: true, isActive: parsed.data.is_active };
}
