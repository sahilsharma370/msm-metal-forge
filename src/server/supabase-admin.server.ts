/**
 * Server-only Supabase client, built from the service-role secret key.
 * `.server.ts` suffix — see env.server.ts for why that's sufficient import
 * protection on its own.
 *
 * No `Database` generic yet (deliberately — introducing generated-schema
 * types is out of scope for this checkpoint); the one RPC call this
 * project makes so far is typed narrowly at the call site instead, and its
 * response is defensively re-validated with zod rather than trusted from
 * a generic parameter.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env.server";

export function createSupabaseAdminClient(): SupabaseClient {
  const { supabaseUrl, supabaseSecretKey } = getServerEnv();

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      // This client only ever calls one RPC as the service role — it must
      // never behave like a signed-in browser session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
