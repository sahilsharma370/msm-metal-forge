import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * QT-CLI audit — server-visible, privacy-safe diagnostic beacon. The whole
 * body is six closed booleans/enums, so this ceiling is deliberately tiny —
 * matches complete-quote.ts's own "the honest bound, not a borrowed one"
 * reasoning for its own 4 KB cap, sized down further since this contract has
 * no UUIDs at all, only fixed-length scalars.
 */
export const MAX_CLIENT_DIAGNOSTICS_BODY_BYTES = 1 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

/** Deliberately duplicated rather than imported — see complete-quote.ts's own identical comment on this exact function. */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new BodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

// ---------------------------------------------------------------------------
// Request contract — `.strict()` is the whole enforcement that a caller
// cannot smuggle through any extra field (a name, a phone, a token, a URL,
// a payload hash, anything): these seven keys are the entire accepted
// shape, exactly mirroring quote_client_diagnostics' own six data columns
// plus the fixed event-category discriminator.
// ---------------------------------------------------------------------------

/** Mirrors QuoteClientExceptionStage exactly (quote-submission-engine.ts) — see that module for the authoritative definition this must stay in sync with. */
const STAGE_VALUES = [
  "before_computing_identity",
  "computing_identity",
  "initiating",
  "resolving_slots",
  "uploading",
  "completing",
  "unknown",
] as const;

const clientDiagnosticsRequestSchema = z
  .object({
    stage: z.enum(STAGE_VALUES),
    initiateInvoked: z.boolean(),
    initiateSettled: z.boolean(),
    subtleAvailable: z.boolean(),
    getRandomValuesAvailable: z.boolean(),
    randomUUIDAvailable: z.boolean(),
  })
  .strict();

export type ClientDiagnosticsRequest = z.infer<typeof clientDiagnosticsRequestSchema>;

// ---------------------------------------------------------------------------
// Response contract — the caller treats this as fire-and-forget (see
// QuoteExperience.tsx's own call site), so the body is never inspected by
// any real caller; kept structured anyway, matching every other route's
// convention, so a test can assert on it directly.
// ---------------------------------------------------------------------------

export type ClientDiagnosticsErrorCode = "VALIDATION_ERROR" | "INTERNAL_ERROR" | "RATE_LIMITED";

export interface ClientDiagnosticsSuccessBody {
  ok: true;
}

export interface ClientDiagnosticsErrorBody {
  ok: false;
  error: { code: ClientDiagnosticsErrorCode; message: string; retryable: boolean };
}

export type ClientDiagnosticsResponseBody = ClientDiagnosticsSuccessBody | ClientDiagnosticsErrorBody;

export interface ClientDiagnosticsResult {
  status: number;
  body: ClientDiagnosticsResponseBody;
}

const GENERIC_MESSAGE = "Something went wrong.";

function validationError(message: string): ClientDiagnosticsResult {
  return { status: 400, body: { ok: false, error: { code: "VALIDATION_ERROR", message, retryable: false } } };
}

function internalError(): ClientDiagnosticsResult {
  return { status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR", message: GENERIC_MESSAGE, retryable: false } } };
}

function successResult(): ClientDiagnosticsResult {
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// RPC client contract — defensively narrow, same pattern as
// complete-quote.ts's own toCompleteQuoteRpcClient.
// ---------------------------------------------------------------------------

export interface ClientDiagnosticsRpcClient {
  rpc(
    fn: "log_quote_client_diagnostic_v1",
    args: {
      p_stage: string;
      p_initiate_invoked: boolean;
      p_initiate_settled: boolean;
      p_subtle_available: boolean;
      p_get_random_values_available: boolean;
      p_random_uuid_available: boolean;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toClientDiagnosticsRpcClient(client: SupabaseClient): ClientDiagnosticsRpcClient {
  return client as unknown as ClientDiagnosticsRpcClient;
}

export interface HandleClientDiagnosticsDeps {
  rpc: ClientDiagnosticsRpcClient;
}

/**
 * Core route logic, independent of Request/Response so it can be unit
 * tested directly against a raw body string and a fake RPC client — same
 * shape as handleCompleteQuoteBody. No logOutcome()-style console logging
 * here at all: unlike complete/initiate, this endpoint's entire purpose
 * already IS the log; a second, redundant console line would add nothing
 * (and risks drifting out of sync with what actually landed in the table).
 */
export async function handleClientDiagnosticsBody(
  rawBody: string,
  deps: HandleClientDiagnosticsDeps,
): Promise<ClientDiagnosticsResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return validationError("The request body is not valid JSON.");
  }

  const parsedRequest = clientDiagnosticsRequestSchema.safeParse(parsedJson);
  if (!parsedRequest.success) {
    return validationError("The request could not be validated.");
  }
  const { stage, initiateInvoked, initiateSettled, subtleAvailable, getRandomValuesAvailable, randomUUIDAvailable } =
    parsedRequest.data;

  let rpcResponse: { data: unknown; error: { message: string } | null };
  try {
    rpcResponse = await deps.rpc.rpc("log_quote_client_diagnostic_v1", {
      p_stage: stage,
      p_initiate_invoked: initiateInvoked,
      p_initiate_settled: initiateSettled,
      p_subtle_available: subtleAvailable,
      p_get_random_values_available: getRandomValuesAvailable,
      p_random_uuid_available: randomUUIDAvailable,
    });
  } catch {
    return internalError();
  }

  if (rpcResponse.error) {
    return internalError();
  }

  return successResult();
}
