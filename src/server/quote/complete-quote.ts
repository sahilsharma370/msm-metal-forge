import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tiny relative to initiate-quote.ts's own MAX_BODY_BYTES (64 KB, sized for
 * a full submission snapshot) — this endpoint's whole body is two UUIDs, so
 * a much smaller ceiling is the honest bound, not a borrowed one.
 */
export const MAX_COMPLETE_BODY_BYTES = 4 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Deliberately duplicated rather than imported from initiate-quote.ts —
 * matches upload-quote.ts's own established precedent of each orchestration
 * module owning its own small body-reading guard rather than sharing one
 * across modules with otherwise-unrelated contracts.
 */
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
// Request contract
// ---------------------------------------------------------------------------

/**
 * `.strict()` is the whole enforcement of "never trust a reference number
 * or completion status supplied by the browser" at the request-shape
 * layer: leadId/idempotencyKey are the only two keys this schema knows
 * about — a `reference`, `status`, `success`, or `alreadyCompleted` key
 * from the client is rejected outright as unknown, never silently ignored
 * or (worse) trusted.
 */
const completeQuoteRequestSchema = z
  .object({
    leadId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type CompleteQuoteRequest = z.infer<typeof completeQuoteRequestSchema>;

// ---------------------------------------------------------------------------
// Response contract — browser-safe only
// ---------------------------------------------------------------------------

export type CompleteErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "NOT_READY"
  | "INTERNAL_ERROR"
  | "RATE_LIMITED";

export interface FieldError {
  path: string;
  message: string;
}

export interface CompleteQuoteSuccessBody {
  ok: true;
  data: {
    leadId: string;
    reference: string;
    submissionCompletedAt: string;
    alreadyCompleted: boolean;
  };
}

export interface CompleteQuoteErrorBody {
  ok: false;
  error: {
    code: CompleteErrorCode;
    message: string;
    retryable: boolean;
    fieldErrors?: FieldError[];
  };
}

export type CompleteQuoteResponseBody = CompleteQuoteSuccessBody | CompleteQuoteErrorBody;

export interface CompleteQuoteResult {
  status: number;
  body: CompleteQuoteResponseBody;
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

function validationError(message: string, fieldErrors?: FieldError[]): CompleteQuoteResult {
  return {
    status: 400,
    body: {
      ok: false,
      error:
        fieldErrors && fieldErrors.length > 0
          ? { code: "VALIDATION_ERROR", message, retryable: false, fieldErrors }
          : { code: "VALIDATION_ERROR", message, retryable: false },
    },
  };
}

function internalError(): CompleteQuoteResult {
  return { status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR", message: GENERIC_MESSAGE, retryable: false } } };
}

function notFoundResult(): CompleteQuoteResult {
  return {
    status: 404,
    body: {
      ok: false,
      error: { code: "NOT_FOUND", message: "This quote could not be found.", retryable: false },
    },
  };
}

function notReadyResult(): CompleteQuoteResult {
  return {
    status: 409,
    body: {
      ok: false,
      error: {
        code: "NOT_READY",
        message: "This quote is not ready to be completed yet — some uploads are still in progress.",
        retryable: true,
      },
    },
  };
}

function successResult(data: {
  leadId: string;
  reference: string;
  submissionCompletedAt: string;
  alreadyCompleted: boolean;
}): CompleteQuoteResult {
  return { status: 200, body: { ok: true, data } };
}

function zodIssuesToFieldErrors(issues: readonly z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

// ---------------------------------------------------------------------------
// Minimal, PII/token/secret-free structured logging
// ---------------------------------------------------------------------------

type CompleteOutcome = "success" | "already_completed" | "not_ready" | "not_found" | "internal_error";

/**
 * Never includes leadId, idempotencyKey, reference, or any RPC error text —
 * only a coarse outcome classification, which is all an operator needs to
 * see completion volume/failure-rate trends without any per-customer
 * correlation risk.
 */
function logOutcome(outcome: CompleteOutcome): void {
  console.log(JSON.stringify({ event: "quote.complete", outcome }));
}

// ---------------------------------------------------------------------------
// RPC client contract — defensively re-validated, never trusted blindly
// ---------------------------------------------------------------------------

export interface CompleteQuoteRpcClient {
  rpc(
    fn: "complete_website_quote_v1",
    args: { p_lead_id: string; p_idempotency_key: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toCompleteQuoteRpcClient(client: SupabaseClient): CompleteQuoteRpcClient {
  return client as unknown as CompleteQuoteRpcClient;
}

/**
 * Matches complete_website_quote_v1's exact return shape (see
 * supabase/migrations/20260813114500_lead_completion_lifecycle.sql, part G):
 * jsonb_build_object('lead_id', ..., 'reference', ..., 'submission_completed_at', ..., 'already_completed', ...).
 */
const rpcCompleteResultSchema = z.object({
  lead_id: z.string().uuid(),
  reference: z.string(),
  submission_completed_at: z.string(),
  already_completed: z.boolean(),
});

/**
 * complete_website_quote_v1's own two exact exception fragments (never the
 * full message, which interpolates the lead id) — matched here, not
 * guessed, exactly like every other RPC error-mapping in this codebase.
 */
const NOT_FOUND_FRAGMENT = "lead not found for the supplied idempotency key";
const NOT_READY_FRAGMENT = "(NOT_READY)";

export interface HandleCompleteQuoteDeps {
  rpc: CompleteQuoteRpcClient;
}

/**
 * Core route logic, independent of Request/Response so it can be unit
 * tested directly against a raw body string and a fake RPC client. Calls
 * complete_website_quote_v1 exactly once per request — that RPC's own
 * idempotent-replay branch is the sole authority on "already completed";
 * this function never re-derives or second-guesses it.
 */
export async function handleCompleteQuoteBody(
  rawBody: string,
  deps: HandleCompleteQuoteDeps,
): Promise<CompleteQuoteResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return validationError("The request body is not valid JSON.");
  }

  const parsedRequest = completeQuoteRequestSchema.safeParse(parsedJson);
  if (!parsedRequest.success) {
    return validationError(
      "The request could not be validated.",
      zodIssuesToFieldErrors(parsedRequest.error.issues),
    );
  }
  const { leadId, idempotencyKey } = parsedRequest.data;

  let rpcResponse: { data: unknown; error: { message: string } | null };
  try {
    rpcResponse = await deps.rpc.rpc("complete_website_quote_v1", {
      p_lead_id: leadId,
      p_idempotency_key: idempotencyKey,
    });
  } catch {
    // A rejected call (network failure, timeout) is handled identically to
    // a resolved {error} — the client never sees the difference, and
    // nothing about the underlying failure is ever surfaced.
    logOutcome("internal_error");
    return internalError();
  }

  if (rpcResponse.error) {
    if (rpcResponse.error.message.includes(NOT_FOUND_FRAGMENT)) {
      logOutcome("not_found");
      return notFoundResult();
    }
    if (rpcResponse.error.message.includes(NOT_READY_FRAGMENT)) {
      logOutcome("not_ready");
      return notReadyResult();
    }
    // Every other failure — a genuine DB error this layer's own validation
    // didn't catch, a connection error, anything else — is reported
    // generically. SQL text and Supabase error internals never reach the
    // response body.
    logOutcome("internal_error");
    return internalError();
  }

  const parsedResult = rpcCompleteResultSchema.safeParse(rpcResponse.data);
  if (!parsedResult.success) {
    logOutcome("internal_error");
    return internalError();
  }
  const result = parsedResult.data;

  logOutcome(result.already_completed ? "already_completed" : "success");
  return successResult({
    leadId: result.lead_id,
    reference: result.reference,
    submissionCompletedAt: result.submission_completed_at,
    alreadyCompleted: result.already_completed,
  });
}
