import { z } from "zod";

/**
 * CHECKPOINT C2I-A — the browser-safe HTTP client for the two owner login
 * endpoints (POST /api/owner/login/{request-code,verify-code}). A browser-
 * side DUPLICATE of the corresponding server contract
 * (src/server/owner-auth/owner-login.server.ts), never an import from it —
 * same reasoning as quote-submission-transport.ts's own doc comment: this
 * module is imported by browser code, and the project build hard-denies
 * any client-side import resolving under `**\/server/**`.
 *
 * Every response body is re-validated with zod before this module trusts a
 * single field of it, matching this codebase's own established
 * never-trust-blindly posture.
 */

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

// ---------------------------------------------------------------------------
// Request code
// ---------------------------------------------------------------------------

export type OwnerLoginRequestCodeOutcome =
  | { readonly kind: "sent"; readonly message: string }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "error"; readonly message: string };

const requestCodeResponseSchema = z.union([
  z.object({ ok: z.literal(true), message: z.string() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

// ---------------------------------------------------------------------------
// Verify code
// ---------------------------------------------------------------------------

export interface OwnerSessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export type OwnerLoginVerifyCodeOutcome =
  | { readonly kind: "verified"; readonly session: OwnerSessionTokens }
  | { readonly kind: "invalid_or_expired"; readonly message: string }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "error"; readonly message: string };

const verifyCodeResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    session: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number() }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface OwnerLoginTransport {
  requestCode(email: string, signal?: AbortSignal): Promise<OwnerLoginRequestCodeOutcome>;
  verifyCode(email: string, code: string, signal?: AbortSignal): Promise<OwnerLoginVerifyCodeOutcome>;
}

export function createOwnerLoginTransport(fetchImpl: typeof fetch = fetch): OwnerLoginTransport {
  return {
    async requestCode(email, signal) {
      let response: Response;
      try {
        response = await fetchImpl("/api/owner/login/request-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
          ...(signal ? { signal } : {}),
        });
      } catch {
        return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      }

      if (response.status === 429) return { kind: "rate_limited" };

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      }
      const parsed = requestCodeResponseSchema.safeParse(json);
      if (!parsed.success) return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      if (parsed.data.ok) return { kind: "sent", message: parsed.data.message };
      return { kind: "error", message: parsed.data.error.message };
    },

    async verifyCode(email, code, signal) {
      let response: Response;
      try {
        response = await fetchImpl("/api/owner/login/verify-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, code }),
          ...(signal ? { signal } : {}),
        });
      } catch {
        return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      }

      if (response.status === 429) return { kind: "rate_limited" };

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      }
      const parsed = verifyCodeResponseSchema.safeParse(json);
      if (!parsed.success) return { kind: "error", message: GENERIC_ERROR_MESSAGE };
      if (parsed.data.ok) return { kind: "verified", session: parsed.data.session };
      if (parsed.data.error.code === "INVALID_OR_EXPIRED_CODE") {
        return { kind: "invalid_or_expired", message: parsed.data.error.message };
      }
      return { kind: "error", message: parsed.data.error.message };
    },
  };
}
