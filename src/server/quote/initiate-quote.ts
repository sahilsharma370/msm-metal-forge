import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  initiateQuoteRequestSchema,
  checkSubmissionCompleteness,
  checkFilesAgainstIntent,
  normalizeSubmission,
} from "./submission-schema";
import { computeQuotePayloadHash } from "./canonicalize";
import type { TurnstileVerifier } from "../turnstile.server";

/**
 * 64 KB — the same bound is_safe_json_object already enforces on
 * leads.submission_snapshot at the DB layer. Reusing that figure here
 * keeps "how big can one Quote submission be" a single, consistent number
 * across the stack rather than two independently-chosen ones. This route
 * never accepts file bytes, only small JSON metadata, so 64 KB is generous
 * headroom, not a tight fit.
 */
export const MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads a Request body up to maxBytes, rejecting anything larger — checked
 * both via a fast-path Content-Length header check (when present) AND by
 * counting actual bytes read from the stream, since Content-Length can be
 * absent (chunked transfer) or simply wrong. No file bytes are ever
 * expected on this route, so this bound is deliberately small.
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
// Response contract
// ---------------------------------------------------------------------------

/** CHECKPOINT C2F-C1: exactly quote_upload_slots.status's own five values — see that column's CHECK constraint. */
export type UploadSlotStatus = "pending" | "uploading" | "verified" | "failed" | "expired";

export interface UploadSlotResponse {
  slotId: string;
  slotIndex: number;
  kind: "seller_photo" | "buyer_document";
  status: UploadSlotStatus;
  storagePath: string;
  expiresAt: string;
  originalFilename: string;
  declaredMimeType: string;
  declaredByteSize: number;
}

export interface InitiateQuoteSuccessBody {
  ok: true;
  data: {
    leadId: string;
    reference: string;
    idempotentReplay: boolean;
    uploadSlots: UploadSlotResponse[];
  };
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "VERIFICATION_REQUIRED"
  | "RATE_LIMITED";

export interface FieldError {
  path: string;
  message: string;
}

export interface InitiateQuoteErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldError[];
  };
}

export type InitiateQuoteResponseBody = InitiateQuoteSuccessBody | InitiateQuoteErrorBody;

export interface InitiateQuoteResult {
  status: number;
  body: InitiateQuoteResponseBody;
}

function validationError(message: string, fieldErrors?: FieldError[]): InitiateQuoteResult {
  return {
    status: 400,
    body: {
      ok: false,
      error:
        fieldErrors && fieldErrors.length > 0
          ? { code: "VALIDATION_ERROR", message, fieldErrors }
          : { code: "VALIDATION_ERROR", message },
    },
  };
}

function internalError(): InitiateQuoteResult {
  return {
    status: 500,
    body: {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    },
  };
}

function idempotencyConflict(): InitiateQuoteResult {
  return {
    status: 409,
    body: {
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "This request was already submitted with different details.",
      },
    },
  };
}

/**
 * CHECKPOINT C2G: one generic response for every Turnstile failure reason
 * (missing/invalid/expired/duplicate token, action mismatch, hostname
 * mismatch, or Siteverify itself being unavailable) — the specific reason
 * is server-side diagnostic detail only, never surfaced to the customer,
 * matching "never show raw Siteverify error codes". 403, not 400: this is
 * a genuine validation failure of the SUBMITTED DATA (VALIDATION_ERROR
 * stays reserved for that); a missing/failed human-verification token is a
 * distinct failure the client maps to its own dedicated outcome so it can
 * fetch a fresh challenge rather than treat it like a form field error.
 */
function verificationRequiredResult(): InitiateQuoteResult {
  return {
    status: 403,
    body: {
      ok: false,
      error: {
        code: "VERIFICATION_REQUIRED",
        message: "We couldn't verify this request. Please complete the verification and try again.",
      },
    },
  };
}

function zodIssuesToFieldErrors(issues: readonly z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

// ---------------------------------------------------------------------------
// RPC response contract — defensively re-validated, never trusted blindly
// even though it comes from our own database.
// ---------------------------------------------------------------------------

const rpcUploadSlotSchema = z.object({
  slot_id: z.string().uuid(),
  slot_index: z.number().int(),
  kind: z.enum(["seller_photo", "buyer_document"]),
  // CHECKPOINT C2F-C1: a strict enum, not a bare string — a malformed or
  // unrecognized status value from the RPC (which should be structurally
  // impossible given quote_upload_slots.status's own CHECK constraint, but
  // this layer never trusts that blindly, matching every other field here)
  // fails this whole slot's parse, which fails rpcResultSchema's parse,
  // which the caller below already maps to a generic 500 — never forwarded
  // to the browser, and never inferred as any particular status.
  status: z.enum(["pending", "uploading", "verified", "failed", "expired"]),
  storage_path: z.string(),
  expires_at: z.string(),
  original_filename: z.string(),
  declared_mime_type: z.string(),
  declared_byte_size: z.number(),
});

const rpcResultSchema = z.object({
  lead_id: z.string().uuid(),
  reference: z.string(),
  idempotent_replay: z.boolean(),
  upload_slots: z.array(rpcUploadSlotSchema),
});

/**
 * The RPC's own signature (see supabase/migrations/20260812172936_create_website_quote_rpc.sql):
 *   create_website_quote_v1(p_idempotency_key uuid, p_payload_hash text, p_submission jsonb, p_files jsonb)
 * This is a structural subset of the real @supabase/supabase-js
 * SupabaseClient — narrow enough to type this one call without a
 * generated Database type, and small enough to fake completely in tests.
 */
export interface QuoteRpcClient {
  rpc(
    fn: "create_website_quote_v1",
    args: {
      p_idempotency_key: string;
      p_payload_hash: string;
      p_submission: unknown;
      p_files: unknown;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toQuoteRpcClient(client: SupabaseClient): QuoteRpcClient {
  return client as unknown as QuoteRpcClient;
}

/** create_website_quote_v1's own exact wording for its one custom-raised failure mode — matched here, not guessed, so a genuine idempotency conflict is the only thing that maps to 409. */
const IDEMPOTENCY_CONFLICT_MESSAGE_FRAGMENT = "was already used with a different payload_hash";

export interface HandleQuoteInitiateDeps {
  supabase: QuoteRpcClient;
  /** CHECKPOINT C2G — verified before any RPC call; see turnstile.server.ts for the real implementation and its own reasoning. */
  turnstile: TurnstileVerifier;
}

/**
 * Core route logic, deliberately independent of the Fetch API Request/
 * Response types so it can be unit tested directly against a raw body
 * string and a fake RPC client — no real HTTP server or Supabase project
 * involved. The thin route handler in src/routes/api/quote/initiate.ts
 * only ever does content-type/env/body-size handling around a call to
 * this function.
 */
export async function handleQuoteInitiateBody(
  rawBody: string,
  deps: HandleQuoteInitiateDeps,
): Promise<InitiateQuoteResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return validationError("The request body is not valid JSON.");
  }

  const topLevel = initiateQuoteRequestSchema.safeParse(parsedJson);
  if (!topLevel.success) {
    return validationError(
      "The request could not be validated.",
      zodIssuesToFieldErrors(topLevel.error.issues),
    );
  }
  const { idempotencyKey, submission, files, turnstileToken } = topLevel.data;
  // honeypot is already constrained to "" | undefined by the schema —
  // reaching here with any non-empty value is impossible, so there is
  // nothing further to check. The schema rejection above IS the honeypot.

  // CHECKPOINT C2G: verified before any other work below — completeness
  // checks, hashing and the RPC call all cost real work (the RPC is a real
  // database mutation), and a request that fails human verification never
  // needs any of it. The specific TurnstileFailureReason (missing/invalid/
  // expired/duplicate token, action mismatch, hostname mismatch, or
  // Siteverify itself being down) is deliberately not distinguished here —
  // every one of them is a stop, and none is ever exposed to the caller
  // beyond the one generic message in verificationRequiredResult().
  const turnstileResult = await deps.turnstile.verify(turnstileToken);
  if (!turnstileResult.ok) {
    return verificationRequiredResult();
  }

  const completenessIssues = checkSubmissionCompleteness(submission);
  const fileIntentIssues = checkFilesAgainstIntent(submission.intent, files);
  const allIssues = [...completenessIssues, ...fileIntentIssues];
  if (allIssues.length > 0) {
    return validationError(
      "The request could not be validated.",
      zodIssuesToFieldErrors(allIssues),
    );
  }

  const normalizedSubmission = normalizeSubmission(submission);
  const payloadHash = await computeQuotePayloadHash(normalizedSubmission, files);

  const { data, error } = await deps.supabase.rpc("create_website_quote_v1", {
    p_idempotency_key: idempotencyKey,
    p_payload_hash: payloadHash,
    p_submission: normalizedSubmission,
    p_files: files,
  });

  if (error) {
    if (error.message.includes(IDEMPOTENCY_CONFLICT_MESSAGE_FRAGMENT)) {
      return idempotencyConflict();
    }
    // Every other failure — a CHECK constraint this layer's own validation
    // somehow didn't catch, a connection error, anything else — is
    // reported generically. SQL text, Supabase error internals and the
    // computed hash never reach the response body.
    return internalError();
  }

  const parsedResult = rpcResultSchema.safeParse(data);
  if (!parsedResult.success) {
    return internalError();
  }
  const result = parsedResult.data;

  return {
    status: 200,
    body: {
      ok: true,
      data: {
        leadId: result.lead_id,
        reference: result.reference,
        idempotentReplay: result.idempotent_replay,
        uploadSlots: result.upload_slots.map((slot) => ({
          slotId: slot.slot_id,
          slotIndex: slot.slot_index,
          kind: slot.kind,
          status: slot.status,
          storagePath: slot.storage_path,
          expiresAt: slot.expires_at,
          originalFilename: slot.original_filename,
          declaredMimeType: slot.declared_mime_type,
          declaredByteSize: slot.declared_byte_size,
        })),
      },
    },
  };
}

export { internalError as buildInternalErrorResult, validationError as buildValidationErrorResult };
