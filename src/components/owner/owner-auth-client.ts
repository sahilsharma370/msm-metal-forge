import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { OwnerSessionTokens } from "./owner-login-transport";
import { withOwnerAuthTimeout, OwnerAuthTimeoutError } from "./owner-auth-timeout";

/**
 * CHECKPOINT C2I-A — the one place browser code touches Supabase Auth's own
 * session mechanism (getSession/setSession/signOut), so OwnerLoginFlow and
 * the /owner shell never call the Supabase client directly and every test
 * can inject a fake implementation of this narrow interface instead of a
 * real Supabase client. setSession/signOut are the OFFICIAL supabase-js
 * session calls — this module never reads or writes localStorage itself;
 * see supabase-browser.ts's own doc comment.
 */
export interface OwnerAuthClient {
  /** Returns the current session's access token, or null if there is no local session. Never throws, EXCEPT OwnerAuthTimeoutError if the underlying Supabase call doesn't resolve within OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS — see owner-auth-timeout.ts for why that call has no bound of its own. */
  getAccessToken(): Promise<string | null>;
  /** Adopts a server-verified session via the official setSession() call. */
  setSession(tokens: OwnerSessionTokens): Promise<void>;
  /** Clears the local session via the official signOut() call. */
  signOut(): Promise<void>;
}

export function createOwnerAuthClient(getClient: () => ReturnType<typeof getSupabaseBrowserClient> = getSupabaseBrowserClient): OwnerAuthClient {
  return {
    async getAccessToken() {
      try {
        const { data } = await withOwnerAuthTimeout(getClient().auth.getSession());
        return data.session?.access_token ?? null;
      } catch (error) {
        // A timeout must reach the caller's own error/Retry state (see
        // OwnerShell.tsx/routes/owner/login.tsx), never be swallowed into
        // "no session" — that would silently sign out a genuinely
        // signed-in owner whose network merely stalled. Every other
        // failure (storage unavailable, SDK throwing synchronously, etc.)
        // keeps failing closed to null, unchanged from before.
        if (error instanceof OwnerAuthTimeoutError) throw error;
        return null;
      }
    },
    async setSession(tokens) {
      await getClient().auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
    },
    async signOut() {
      await getClient().auth.signOut();
    },
  };
}
