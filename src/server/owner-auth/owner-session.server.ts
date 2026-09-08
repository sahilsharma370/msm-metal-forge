/**
 * CHECKPOINT C2I-A — the one reusable server-only owner-auth verifier.
 * Every current and future protected owner route must call
 * verifyOwnerSession instead of duplicating any part of this logic.
 * `.server.ts` suffix — see env.server.ts for why that's sufficient import
 * protection on its own.
 *
 * A valid Supabase Auth session is NEVER sufficient authorization on its
 * own — see the owner_accounts check below (CHECKPOINT C2I-A's whole
 * point). This module never decodes a JWT locally and trusts its payload:
 * the caller-supplied token is always handed to Supabase Auth's own
 * getUser(token), which verifies it server-side against the Auth service
 * (signature, expiry, revocation) before this module trusts the user id it
 * returns. Nothing here ever trusts an email, role or user_id supplied
 * directly by browser input — the only user_id this function ever acts on
 * is the one Supabase Auth itself returned for the verified token.
 */
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { lookupOwnerAccount, toOwnerAccountsQueryClient, type OwnerAccountsQueryClient } from "./owner-accounts.server";
import { OWNER_ROLE, type OwnerAuthResult } from "./owner-auth-types";

/** Structural subset of SupabaseClient["auth"] — only the one verification call this module needs. */
export interface OwnerAuthUserVerifier {
  getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
}

export interface VerifyOwnerSessionDeps {
  readonly authVerifier: OwnerAuthUserVerifier;
  readonly ownerAccounts: OwnerAccountsQueryClient;
}

/**
 * Reads the bearer access token from the request — the one established
 * mechanism this API surface uses to carry a Supabase access token from
 * browser to server (see owner-login-transport.ts, which reads the token
 * from the official supabase-js client's own session via getSession(),
 * never a manually managed cookie/localStorage read). A missing, empty, or
 * non-"Bearer " header returns null rather than throwing.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** A Supabase access token is always a JWT: three dot-separated, non-empty, base64url-ish segments. Structural only — this is NOT verification, just a cheap pre-filter so an obviously-wrong value never spends a call on Supabase Auth. Real verification is exclusively deps.authVerifier.getUser() below. */
function looksLikeJwt(token: string): boolean {
  const segments = token.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}

/**
 * The one reusable verifier: token -> Supabase-Auth-verified user -> active
 * owner_accounts row -> minimal typed identity. Every step fails closed;
 * no step's failure detail (a raw Supabase Auth error, which exact
 * database check failed) ever leaves this function — callers only ever see
 * one of OwnerAuthFailureReason's short, internal-only reasons, and every
 * caller-facing surface (the /api/owner/session route, the browser UI)
 * collapses even that to one generic message/redirect.
 */
export async function verifyOwnerSession(token: string | null, deps: VerifyOwnerSessionDeps): Promise<OwnerAuthResult> {
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }
  if (!looksLikeJwt(token)) {
    return { ok: false, reason: "malformed_token" };
  }

  let userId: string;
  try {
    const { data, error } = await deps.authVerifier.getUser(token);
    if (error || !data.user) {
      return { ok: false, reason: "invalid_token" };
    }
    userId = data.user.id;
  } catch {
    return { ok: false, reason: "verification_error" };
  }

  const account = await lookupOwnerAccount(deps.ownerAccounts, userId);
  if (!account.found) {
    return { ok: false, reason: "no_owner_row" };
  }
  if (!account.isActive) {
    return { ok: false, reason: "inactive_owner" };
  }

  return { ok: true, owner: { userId, role: OWNER_ROLE } };
}

/**
 * Production factory — the one real Supabase admin client, reused for both
 * the Auth verification call and the owner_accounts lookup (same client
 * instance every other server module in this codebase already uses via
 * createSupabaseAdminClient(); this introduces no second client
 * construction path). Never exposes SUPABASE_SECRET_KEY beyond what
 * createSupabaseAdminClient() itself already encapsulates.
 */
export function getOwnerSessionVerifierDeps(): VerifyOwnerSessionDeps {
  const admin = createSupabaseAdminClient();
  return {
    authVerifier: { getUser: (token: string) => admin.auth.getUser(token) },
    ownerAccounts: toOwnerAccountsQueryClient(admin),
  };
}
