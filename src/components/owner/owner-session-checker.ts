import { z } from "zod";

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
      let response: Response;
      try {
        response = await fetchImpl("/api/owner/session", {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
        });
      } catch {
        return { ok: false };
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
