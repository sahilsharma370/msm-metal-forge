import { z } from "zod";
import type { SubmissionShape, CanonicalFileDeclaration } from "./quote-submission-identity";

/**
 * CHECKPOINT C2F-D — the browser-safe HTTP client for the three existing
 * Quote submission endpoints (POST /api/quote/initiate, /upload, /complete).
 *
 * Every request/response shape below is a browser-side DUPLICATE of the
 * corresponding server contract (src/server/quote/initiate-quote.ts,
 * upload-quote.ts, complete-quote.ts) — never an import from those files,
 * since this module is imported by browser code and the project build
 * hard-denies any client-side import resolving under `**\/server/**`
 * regardless of the imported file's own runtime safety (see
 * quote-submission-identity.ts's own doc comment for the full explanation).
 * Keeping the shapes duplicated rather than shared also means a server-side
 * contract change is a deliberate, visible edit here too, never a silent
 * drift picked up through a shared type.
 *
 * Every response body is re-validated with zod before this module trusts a
 * single field of it — exactly the same "never trust blindly, even our own
 * backend" posture every server route in this codebase already follows.
 * A response that doesn't match — malformed JSON, an unexpected shape, an
 * HTTP-level failure the platform itself surfaces — becomes a
 * `transportFailure` result, never a thrown exception the caller has to
 * remember to catch, and never a value silently coerced into looking like
 * a real success or a real typed API error.
 */

// ---------------------------------------------------------------------------
// Shared transport result shape
// ---------------------------------------------------------------------------

/**
 * "aborted" is reported distinctly from "network_error" so a caller (the
 * orchestration engine) can tell "the caller cancelled this on purpose"
 * apart from "something actually went wrong" — the two must never be
 * conflated into the same outcome, since only the engine — not this
 * transport — decides what an abort means for persisted recovery state.
 */
export type TransportFailureKind = "network_error" | "malformed_response" | "aborted";

export interface TransportFailure {
  readonly ok: false;
  readonly transportFailure: TransportFailureKind;
}

export interface TransportApiError<TCode extends string> {
  readonly ok: false;
  readonly transportFailure?: undefined;
  readonly status: number;
  readonly code: TCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fieldErrors?: readonly { readonly path: string; readonly message: string }[] | undefined;
}

export interface TransportSuccess<TData> {
  readonly ok: true;
  readonly status: number;
  readonly data: TData;
}

export type TransportResult<TData, TCode extends string> =
  | TransportSuccess<TData>
  | TransportApiError<TCode>
  | TransportFailure;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Runs one fetch call, mapping every non-2xx-shaped-body outcome to a TransportFailure rather than throwing. */
async function runFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: unknown } | TransportFailure> {
  if (signal?.aborted) return { ok: false, transportFailure: "aborted" };
  let response: Response;
  try {
    response = await fetchImpl(input, signal ? { ...init, signal } : init);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) return { ok: false, transportFailure: "aborted" };
    return { ok: false, transportFailure: "network_error" };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, transportFailure: "malformed_response" };
  }
  return { status: response.status, json };
}

// ---------------------------------------------------------------------------
// POST /api/quote/initiate
// ---------------------------------------------------------------------------

/** Mirrors src/server/quote/initiate-quote.ts's UploadSlotStatus exactly (quote_upload_slots.status's own five CHECK values). */
export type UploadSlotStatus = "pending" | "uploading" | "verified" | "failed" | "expired";

/** Mirrors src/server/quote/initiate-quote.ts's UploadSlotResponse exactly, field for field. */
export interface InitiateUploadSlot {
  readonly slotId: string;
  readonly slotIndex: number;
  readonly kind: "seller_photo" | "buyer_document";
  readonly status: UploadSlotStatus;
  readonly storagePath: string;
  readonly expiresAt: string;
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly declaredByteSize: number;
}

export interface InitiateSuccessData {
  readonly leadId: string;
  readonly reference: string;
  readonly idempotentReplay: boolean;
  readonly uploadSlots: readonly InitiateUploadSlot[];
}

/** Mirrors src/server/quote/initiate-quote.ts's ErrorCode exactly. */
export type InitiateErrorCode = "VALIDATION_ERROR" | "IDEMPOTENCY_CONFLICT" | "INTERNAL_ERROR";

export type InitiateTransportResult = TransportResult<InitiateSuccessData, InitiateErrorCode>;

export interface InitiateTransportRequest {
  readonly idempotencyKey: string;
  readonly submission: SubmissionShape;
  readonly files: readonly CanonicalFileDeclaration[];
}

const uploadSlotResponseSchema = z.object({
  slotId: z.string(),
  slotIndex: z.number(),
  kind: z.enum(["seller_photo", "buyer_document"]),
  status: z.enum(["pending", "uploading", "verified", "failed", "expired"]),
  storagePath: z.string(),
  expiresAt: z.string(),
  originalFilename: z.string(),
  declaredMimeType: z.string(),
  declaredByteSize: z.number(),
});

const initiateSuccessBodySchema = z.object({
  ok: z.literal(true),
  data: z.object({
    leadId: z.string(),
    reference: z.string(),
    idempotentReplay: z.boolean(),
    uploadSlots: z.array(uploadSlotResponseSchema),
  }),
});

const initiateErrorBodySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["VALIDATION_ERROR", "IDEMPOTENCY_CONFLICT", "INTERNAL_ERROR"]),
    message: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/**
 * initiate's own error body carries no `retryable` flag (see
 * InitiateQuoteErrorBody) — this transport derives it once, here, from the
 * error code alone, so every caller shares one answer instead of each
 * re-deriving its own: a genuine transient server fault is safe to retry
 * unmodified; a validation failure or an idempotency-key/hash conflict is
 * not (retrying the exact same request would just repeat the same outcome).
 */
function initiateErrorRetryable(code: InitiateErrorCode): boolean {
  return code === "INTERNAL_ERROR";
}

async function postJson(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<{ status: number; json: unknown } | TransportFailure> {
  return runFetch(
    `${baseUrl}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
    fetchImpl,
  );
}

// ---------------------------------------------------------------------------
// POST /api/quote/upload
// ---------------------------------------------------------------------------

/** Mirrors src/server/quote/upload-quote.ts's UploadErrorCode exactly. */
export type UploadErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UPLOAD_IN_PROGRESS"
  | "SLOT_UNAVAILABLE"
  | "ALREADY_VERIFIED_MISMATCH"
  | "STORAGE_ERROR"
  | "FINALIZE_FAILED"
  | "INTERNAL_ERROR";

export interface UploadSuccessData {
  readonly success: true;
  readonly slotId: string;
  readonly fileId: string;
  readonly status: "verified";
  readonly replayed: boolean;
}

export type UploadTransportResult = TransportResult<UploadSuccessData, UploadErrorCode>;

export interface UploadTransportRequest {
  readonly slotId: string;
  readonly idempotencyKey: string;
  readonly file: File;
}

const uploadSuccessBodySchema = z.object({
  ok: z.literal(true),
  data: z.object({
    success: z.literal(true),
    slotId: z.string(),
    fileId: z.string(),
    status: z.literal("verified"),
    replayed: z.boolean(),
  }),
});

const uploadErrorBodySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      "VALIDATION_ERROR",
      "NOT_FOUND",
      "UPLOAD_IN_PROGRESS",
      "SLOT_UNAVAILABLE",
      "ALREADY_VERIFIED_MISMATCH",
      "STORAGE_ERROR",
      "FINALIZE_FAILED",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// POST /api/quote/complete
// ---------------------------------------------------------------------------

/** Mirrors src/server/quote/complete-quote.ts's CompleteErrorCode exactly. */
export type CompleteErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "NOT_READY" | "INTERNAL_ERROR";

export interface CompleteSuccessData {
  readonly leadId: string;
  readonly reference: string;
  readonly submissionCompletedAt: string;
  readonly alreadyCompleted: boolean;
}

export type CompleteTransportResult = TransportResult<CompleteSuccessData, CompleteErrorCode>;

export interface CompleteTransportRequest {
  readonly leadId: string;
  readonly idempotencyKey: string;
}

const completeSuccessBodySchema = z.object({
  ok: z.literal(true),
  data: z.object({
    leadId: z.string(),
    reference: z.string(),
    submissionCompletedAt: z.string(),
    alreadyCompleted: z.boolean(),
  }),
});

const completeErrorBodySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["VALIDATION_ERROR", "NOT_FOUND", "NOT_READY", "INTERNAL_ERROR"]),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Public transport interface + fetch-based implementation
// ---------------------------------------------------------------------------

/**
 * The one seam the orchestration engine depends on — every method here is
 * fully fake-able in tests with no real network call, per the DI
 * requirement. A production caller uses createFetchQuoteTransport(); a test
 * implements this interface directly with canned results.
 */
export interface QuoteTransport {
  initiate(request: InitiateTransportRequest, signal?: AbortSignal): Promise<InitiateTransportResult>;
  upload(request: UploadTransportRequest, signal?: AbortSignal): Promise<UploadTransportResult>;
  complete(request: CompleteTransportRequest, signal?: AbortSignal): Promise<CompleteTransportResult>;
}

export interface CreateFetchQuoteTransportOptions {
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Prepended to every request path — empty by default (relative to the current origin), overridable for tests. */
  readonly baseUrl?: string;
}

export function createFetchQuoteTransport(options: CreateFetchQuoteTransportOptions = {}): QuoteTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "";

  return {
    async initiate(request, signal) {
      const result = await postJson(
        "/api/quote/initiate",
        {
          idempotencyKey: request.idempotencyKey,
          submission: request.submission,
          files: request.files,
        },
        signal,
        fetchImpl,
        baseUrl,
      );
      if ("transportFailure" in result) return result;

      const success = initiateSuccessBodySchema.safeParse(result.json);
      if (success.success) {
        return { ok: true, status: result.status, data: success.data.data };
      }
      const errorParsed = initiateErrorBodySchema.safeParse(result.json);
      if (!errorParsed.success) return { ok: false, transportFailure: "malformed_response" };
      const { code, message, fieldErrors } = errorParsed.data.error;
      return {
        ok: false,
        status: result.status,
        code,
        message,
        retryable: initiateErrorRetryable(code),
        fieldErrors,
      };
    },

    async upload(request, signal) {
      const formData = new FormData();
      formData.append("slotId", request.slotId);
      formData.append("idempotencyKey", request.idempotencyKey);
      formData.append("file", request.file);

      const result = await runFetch(
        `${baseUrl}/api/quote/upload`,
        { method: "POST", body: formData },
        signal,
        fetchImpl,
      );
      if ("transportFailure" in result) return result;

      const success = uploadSuccessBodySchema.safeParse(result.json);
      if (success.success) {
        return { ok: true, status: result.status, data: success.data.data };
      }
      const errorParsed = uploadErrorBodySchema.safeParse(result.json);
      if (!errorParsed.success) return { ok: false, transportFailure: "malformed_response" };
      const { code, message, retryable } = errorParsed.data.error;
      return { ok: false, status: result.status, code, message, retryable };
    },

    async complete(request, signal) {
      const result = await postJson(
        "/api/quote/complete",
        { leadId: request.leadId, idempotencyKey: request.idempotencyKey },
        signal,
        fetchImpl,
        baseUrl,
      );
      if ("transportFailure" in result) return result;

      const success = completeSuccessBodySchema.safeParse(result.json);
      if (success.success) {
        return { ok: true, status: result.status, data: success.data.data };
      }
      const errorParsed = completeErrorBodySchema.safeParse(result.json);
      if (!errorParsed.success) return { ok: false, transportFailure: "malformed_response" };
      const { code, message, retryable } = errorParsed.data.error;
      return { ok: false, status: result.status, code, message, retryable };
    },
  };
}
