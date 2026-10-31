/**
 * CHECKPOINT C2I-A — the smallest browser-only Supabase client, Auth-only.
 * Only the project URL and the PUBLISHABLE (anon) key are ever read here —
 * both are safe to expose in the client bundle by design, matching
 * VITE_TURNSTILE_SITE_KEY's own established precedent (see .env.example's
 * comment on VITE_-prefixed variables). The server's secret service-role
 * key (see env.server.ts) and every other server-only variable are never
 * imported, referenced, or reachable from this module — it lives under
 * src/lib/ (browser-safe utilities, like lib/utils.ts and lib/site.ts),
 * never src/server/, and imports nothing from src/server/.
 *
 * Session persistence uses supabase-js's own default, official
 * localStorage-backed mechanism (persistSession: true) — this is the ONLY
 * way a Supabase token is ever written to client storage anywhere in this
 * codebase; nothing here (or anywhere else in this project) manually reads
 * or writes a Supabase access/refresh token to/from localStorage itself.
 * Adopting a server-verified session uses the client's own official
 * setSession() call (see owner-login-transport.ts), never a hand-rolled
 * storage write.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ?? "";
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined) ?? "";

/** Deliberately carries no configuration detail — mirrors ServerConfigurationError in env.server.ts. */
export class BrowserConfigurationError extends Error {
  constructor() {
    super("Owner sign-in is not configured.");
    this.name = "BrowserConfigurationError";
  }
}

let cachedClient: SupabaseClient | null = null;

/**
 * Lazily constructed, memoized singleton — read only when the owner-auth UI
 * actually needs it, mirroring this codebase's own "never read config at
 * module scope" posture (see env.server.ts's doc comment) applied here to
 * client-side config instead. Fails closed (throws) rather than silently
 * constructing a client pointed at an empty URL.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new BrowserConfigurationError();
  }
  cachedClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The owner login flow never round-trips a session through a URL
      // fragment/query (six-digit code entry + explicit setSession() only,
      // see owner-login-transport.ts) — disabling URL-based session
      // detection removes that surface entirely rather than leaving it
      // unused-but-present.
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

/** Test-only escape hatch so each test file starts from a clean singleton — never called from production code. */
export function resetSupabaseBrowserClientForTests(): void {
  cachedClient = null;
}
