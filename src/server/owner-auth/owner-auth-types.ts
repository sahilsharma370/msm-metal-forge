/**
 * CHECKPOINT C2I-A — shared types for the owner authentication/authorization
 * foundation. Nothing here ever carries a password, OTP, access token or
 * refresh token beyond what a single request/response needs to cross the
 * wire once — none of it is persisted by this module.
 */

/** The only role this checkpoint recognizes — mirrors owner_accounts.role's own narrow CHECK constraint exactly. */
export const OWNER_ROLE = "owner" as const;

/** Minimal typed identity verifyOwnerSession hands to trusted server code — never more than this (no email, no raw token, no database row). */
export interface OwnerIdentity {
  readonly userId: string;
  readonly role: typeof OWNER_ROLE;
}

/**
 * Every reason a session verification can fail. Deliberately internal/
 * diagnostic only — every caller-facing surface (API route, UI) collapses
 * this to one generic message; the specific reason exists for server-side
 * discipline and tests, exactly like TurnstileFailureReason in
 * turnstile.server.ts. In particular, "no_owner_row" and "inactive_owner"
 * must never be distinguished from each other (or from "invalid_token") in
 * any response body — doing so would let a caller enumerate which emails
 * have an owner_accounts row.
 */
export type OwnerAuthFailureReason =
  | "missing_token"
  | "malformed_token"
  | "invalid_token"
  | "no_owner_row"
  | "inactive_owner"
  | "verification_error";

export type OwnerAuthResult =
  | { readonly ok: true; readonly owner: OwnerIdentity }
  | { readonly ok: false; readonly reason: OwnerAuthFailureReason };
