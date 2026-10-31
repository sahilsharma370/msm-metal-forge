import { z } from "zod";
import { OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS, OwnerAuthTimeoutError } from "./owner-auth-timeout";

/**
 * CHECKPOINT C2I-A — browser-side client for GET /api/owner/session, the
 * real server-side authorization check. The /owner shell's own local
 * session presence check is a UX layer only (see OwnerShell.tsx's own
 * comment) — THIS is what actually decides whether the shell renders,
 * exactly matching "sensitive future owner APIs must still perform
 * server-side authorization; client route protection is only a UX layer".
 */

export interface OwnerIdentitySummary {
  readonly userId: string;
  readonly role: string;
}

export interface OwnerSessionCheckResult {
  readonly ok: boolean;
  readonly owner?: OwnerIdentitySummary;
}

export interface OwnerSessionChecker {
  check(accessToken: string): Promise<OwnerSessionCheckResult>;
}

const responseSchema = z.union([
  z.object({ ok: z.literal(true), owner: z.object({ userId: z.string(), role: z.string() }) }),
  z.object({ ok: z.literal(false) }),
]);

export function createOwnerSessionChecker(fetchImpl: typeof fetch = fetch): OwnerSessionChecker {
  return {
    async check(accessToken) {
      // A real AbortController, not a race — this fetch is ours to cancel
      // directly (see owner-auth-timeout.ts's own header comment for why
      // getAccessToken() can't do the same for the Supabase SDK's call).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OWNER_AUTH_BOOTSTRAP_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl("/api/owner/session", {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
      } catch {
        // Timed out (we aborted it ourselves) must reach the caller's
        // error/Retry state, never be flattened into ok:false — that path
        // means "session invalid, sign out and go to login", which is
        // wrong for "we couldn't tell within the time budget". Every other
        // rejection (genuine network failure, DNS, etc.) keeps its
        // existing ok:false behaviour, unchanged.
        if (controller.signal.aborted) throw new OwnerAuthTimeoutError();
        return { ok: false };
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) return { ok: false };

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { ok: false };
      }

      const parsed = responseSchema.safeParse(json);
      if (!parsed.success || !parsed.data.ok) return { ok: false };
      return { ok: true, owner: parsed.data.owner };
    },
  };
}
