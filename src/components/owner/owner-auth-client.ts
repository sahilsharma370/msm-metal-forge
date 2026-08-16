import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { OwnerSessionTokens } from "./owner-login-transport";

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
  /** Returns the current session's access token, or null if there is no local session. Never throws. */
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
        const { data } = await getClient().auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
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
