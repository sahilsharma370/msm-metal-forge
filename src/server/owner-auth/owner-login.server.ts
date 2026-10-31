/**
 * CHECKPOINT C2I-A — owner passwordless (six-digit email OTP) login.
 * `.server.ts` suffix — see env.server.ts for why that's sufficient import
 * protection on its own.
 *
 * Two pure, deps-injected core functions (handleOwnerLoginRequestCodeBody /
 * handleOwnerLoginVerifyCodeBody), mirroring this codebase's own
 * established handleQuoteInitiateBody pattern: independent of the Fetch API
 * Request/Response types so they can be unit tested directly against a raw
 * body string and a fake auth client — no real HTTP server or Supabase
 * project involved. The thin route handlers in
 * src/routes/api/owner/login/{request-code,verify-code}.ts only ever do
 * content-type/rate-limit/env handling around a call to one of these.
 *
 * No console logging anywhere in this file — no email, code, token or raw
 * Supabase error ever reaches a log line.
 */
import { z } from "zod";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";

// ---------------------------------------------------------------------------
// Request-code — always a generic response, regardless of outcome
// ---------------------------------------------------------------------------

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

const requestCodeBodySchema = z.object({ email: emailSchema });

export type OwnerLoginErrorCode = "VALIDATION_ERROR" | "RATE_LIMITED" | "INTERNAL_ERROR";

export interface OwnerLoginRequestCodeSuccessBody {
  readonly ok: true;
  readonly message: string;
}
export interface OwnerLoginErrorBody {
  readonly ok: false;
  readonly error: { readonly code: OwnerLoginErrorCode; readonly message: string };
}
export type OwnerLoginRequestCodeResponseBody = OwnerLoginRequestCodeSuccessBody | OwnerLoginErrorBody;

export interface HandleOwnerLoginRequestCodeResult {
  readonly status: number;
  readonly body: OwnerLoginRequestCodeResponseBody;
}

/**
 * This exact wording is returned for EVERY outcome of the underlying
 * Supabase call — an email with no auth.users row, an email that exists
 * but has shouldCreateUser:false block it, a real code successfully sent,
 * or a transient Supabase-side error. Never varied by outcome: the whole
 * point is that a caller cannot learn anything about whether this email is
 * registered or authorized from the response.
 */
const GENERIC_REQUEST_CODE_MESSAGE = "If that email is registered for owner access, a sign-in code has been sent.";

function requestCodeValidationError(): HandleOwnerLoginRequestCodeResult {
  return {
    status: 400,
    body: { ok: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid email address." } },
  };
}

function genericRequestCodeSuccess(): HandleOwnerLoginRequestCodeResult {
  return { status: 200, body: { ok: true, message: GENERIC_REQUEST_CODE_MESSAGE } };
}

/** Structural subset of SupabaseClient["auth"] this module needs — small enough to fake completely in tests. */
export interface OwnerLoginAuthClient {
  signInWithOtp(params: {
    email: string;
    options: { shouldCreateUser: false };
  }): Promise<{ error: { message: string } | null }>;
  verifyOtp(params: { email: string; token: string; type: "email" }): Promise<{
    data: { session: { access_token: string; refresh_token: string; expires_at?: number } | null };
    error: { message: string } | null;
  }>;
}

export interface HandleOwnerLoginDeps {
  readonly auth: OwnerLoginAuthClient;
}

export async function handleOwnerLoginRequestCodeBody(
  rawBody: string,
  deps: HandleOwnerLoginDeps,
): Promise<HandleOwnerLoginRequestCodeResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return requestCodeValidationError();
  }

  const parsed = requestCodeBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return requestCodeValidationError();
  }

  try {
    // CHECKPOINT C2I-A: shouldCreateUser:false is the fail-closed setting
    // required by this checkpoint — public self-registration must remain
    // unavailable through this endpoint no matter what email is submitted.
    // The result (success or error) is deliberately not branched on below
    // — see GENERIC_REQUEST_CODE_MESSAGE's own doc comment for why.
    await deps.auth.signInWithOtp({ email: parsed.data.email, options: { shouldCreateUser: false } });
  } catch {
    // Deliberately swallowed for the same no-enumeration reason — even a
    // transport-level throw must not produce a response distinguishable
    // from the generic success path.
  }

  return genericRequestCodeSuccess();
}

// ---------------------------------------------------------------------------
// Verify-code
// ---------------------------------------------------------------------------

const verifyCodeBodySchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^[0-9]{6}$/, "The code must be exactly 6 digits."),
});

export type OwnerLoginVerifyErrorCode = "VALIDATION_ERROR" | "RATE_LIMITED" | "INVALID_OR_EXPIRED_CODE" | "INTERNAL_ERROR";

export interface OwnerSessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix seconds. */
  readonly expiresAt: number;
}
export interface OwnerLoginVerifyCodeSuccessBody {
  readonly ok: true;
  readonly session: OwnerSessionTokens;
}
export interface OwnerLoginVerifyCodeErrorBody {
  readonly ok: false;
  readonly error: { readonly code: OwnerLoginVerifyErrorCode; readonly message: string };
}
export type OwnerLoginVerifyCodeResponseBody = OwnerLoginVerifyCodeSuccessBody | OwnerLoginVerifyCodeErrorBody;

export interface HandleOwnerLoginVerifyCodeResult {
  readonly status: number;
  readonly body: OwnerLoginVerifyCodeResponseBody;
}

function verifyCodeValidationError(): HandleOwnerLoginVerifyCodeResult {
  return {
    status: 400,
    body: { ok: false, error: { code: "VALIDATION_ERROR", message: "Enter your email and the 6-digit code." } },
  };
}

/**
 * A single generic wording covering every failure — Supabase Auth's own
 * verifyOtp deliberately does not reliably distinguish "wrong code" from
 * "expired code" from "unknown email" (a single ambiguous message is
 * itself an anti-enumeration measure on Supabase's side), and this module
 * preserves that ambiguity rather than trying to narrow it.
 */
const GENERIC_INVALID_CODE_MESSAGE = "That code is invalid or has expired. Request a new one and try again.";

function invalidOrExpiredCodeResult(): HandleOwnerLoginVerifyCodeResult {
  return {
    status: 401,
    body: { ok: false, error: { code: "INVALID_OR_EXPIRED_CODE", message: GENERIC_INVALID_CODE_MESSAGE } },
  };
}

function verifyCodeInternalError(): HandleOwnerLoginVerifyCodeResult {
  return {
    status: 500,
    body: { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } },
  };
}

/**
 * Verifies a submitted six-digit code and, on success, returns the
 * resulting Supabase session tokens so the browser's official supabase-js
 * client can adopt them via setSession() (see owner-login-transport.ts) —
 * never a password, never this project's own custom session mechanism.
 *
 * Deliberately does NOT check owner_accounts here — proving control of the
 * email only establishes a Supabase Auth session, never owner
 * authorization on its own (see owner-session.server.ts's verifyOwnerSession,
 * which the browser calls next via /api/owner/session before treating this
 * session as authorized for the owner shell).
 */
export async function handleOwnerLoginVerifyCodeBody(
  rawBody: string,
  deps: HandleOwnerLoginDeps,
): Promise<HandleOwnerLoginVerifyCodeResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return verifyCodeValidationError();
  }

  const parsed = verifyCodeBodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return verifyCodeValidationError();
  }

  let result: Awaited<ReturnType<OwnerLoginAuthClient["verifyOtp"]>>;
  try {
    result = await deps.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  } catch {
    return verifyCodeInternalError();
  }

  if (result.error || !result.data.session) {
    return invalidOrExpiredCodeResult();
  }

  const session = result.data.session;
  return {
    status: 200,
    body: {
      ok: true,
      session: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      },
    },
  };
}

/**
 * Production factory — reuses the one real Supabase admin client (same
 * instance every other server module in this codebase already uses via
 * createSupabaseAdminClient()). signInWithOtp/verifyOtp are public Auth API
 * operations that do not themselves require service-role privilege; using
 * the existing admin client here introduces no new client construction
 * path or secret-handling surface.
 */
export function getOwnerLoginAuthClient(): OwnerLoginAuthClient {
  const admin = createSupabaseAdminClient();
  return {
    signInWithOtp: (params) => admin.auth.signInWithOtp(params),
    verifyOtp: (params) =>
      admin.auth.verifyOtp(params) as unknown as ReturnType<OwnerLoginAuthClient["verifyOtp"]>,
  };
}
