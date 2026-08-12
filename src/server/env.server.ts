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
