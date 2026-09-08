/**
 * Server-only environment access. The `.server.ts` filename suffix opts
 * this file into TanStack Start's import protection (see
 * start-core/execution-model): importing it from client-rendered code
 * throws at build time in production and returns a mocked proxy in dev —
 * either way, SUPABASE_SECRET_KEY can never reach the browser bundle
 * through this module.
 *
 * Every read happens inside getServerEnv(), never at module scope.
 * Cloudflare Workers inject env per-request, so a module-scope read would
 * silently evaluate to undefined in production even though it works
 * locally — see the CRITICAL note in start-core/execution-model.
 */

export interface ServerEnv {
  readonly supabaseUrl: string;
  readonly supabaseSecretKey: string;
}

/** Deliberately carries no detail about which variable is missing — the caller-facing error is always the same generic message, regardless of cause. */
export class ServerConfigurationError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "ServerConfigurationError";
  }
}

export function getServerEnv(): ServerEnv {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseSecretKey = process.env["SUPABASE_SECRET_KEY"];

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new ServerConfigurationError();
  }

  return { supabaseUrl, supabaseSecretKey };
}

/**
 * CHECKPOINT C2H-B1 — owner-notification email configuration. Deliberately
 * a separate function from getServerEnv(), never folded into ServerEnv:
 * email config is dispatcher-scoped only (read exclusively from inside
 * dispatch-notification.server.ts's own production factory), so a missing
 * RESEND_API_KEY/OWNER_NOTIFICATION_EMAIL/EMAIL_FROM can never break
 * anything that doesn't itself try to dispatch an email — not application
 * startup, not the build, not unit tests, and never the customer-facing
 * Quote completion path (see dispatch-notification.server.ts's own doc
 * comment for how a missing-configuration failure here becomes a sanitized
 * dead-lettered delivery instead of ever touching the completed lead row).
 */
export interface EmailConfig {
  readonly resendApiKey: string;
  readonly ownerNotificationEmail: string;
  readonly emailFrom: string;
  readonly emailReplyTo?: string;
  readonly ownerDashboardUrl?: string;
}

/** Deliberately carries no detail about which variable is missing — mirrors ServerConfigurationError above. */
export class EmailConfigurationError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "EmailConfigurationError";
  }
}

export function getEmailConfig(): EmailConfig {
  const resendApiKey = process.env["RESEND_API_KEY"];
  const ownerNotificationEmail = process.env["OWNER_NOTIFICATION_EMAIL"];
  const emailFrom = process.env["EMAIL_FROM"];
  const emailReplyTo = process.env["EMAIL_REPLY_TO"];
  const ownerDashboardUrl = process.env["OWNER_DASHBOARD_URL"];

  if (!resendApiKey || !ownerNotificationEmail || !emailFrom) {
    throw new EmailConfigurationError();
  }

  return {
    resendApiKey,
    ownerNotificationEmail,
    emailFrom,
    ...(emailReplyTo ? { emailReplyTo } : {}),
    ...(ownerDashboardUrl ? { ownerDashboardUrl } : {}),
  };
}
