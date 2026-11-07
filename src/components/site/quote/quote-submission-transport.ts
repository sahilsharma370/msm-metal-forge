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

/**
 * Bounded deadline for the two lightweight JSON-only calls (initiate,
 * complete via postJson below) — never applied to upload, see that call
 * site's own comment for why. Without ANY deadline, a stalled connection
 * (common on weak mobile networks, where a request can hang with no error
 * and no default browser timeout) left the caller awaiting runFetch()
 * forever: no outcome, no retry option, an indefinitely stuck
 * "Submitting..." state.
 *
 * 30s is sized for a few KB of JSON plus one RPC round-trip — generous
 * even on high-latency 2G (hundreds of ms to low seconds of RTT, not
 * tens of seconds), so it should essentially never fire on a connection
 * that is merely slow, only on one that is genuinely stalled. If the
 * SERVER actually finishes the write after the client has already given
 * up and shown a retryable network_error, that is still safe, not a
 * duplicate-lead risk: initiate's idempotency key is derived from the
 * submission's own payload hash and reused unchanged across a retry
 * (quote-submission-engine.ts's resolveIdempotencyKey), so a retried
 * initiate call hits create_website_quote_v1's existing idempotent-replay
 * branch (same lead_id/reference returned, idempotentReplay:true — see
 * initiate-quote.test.ts's own coverage of this). A retried complete call
 * is equally safe via complete_website_quote_v1's already_completed
 * branch. Both are pre-existing server-side guarantees this client-side
 * timeout merely needs to not break — it doesn't add any new write path.
 */
const JSON_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Runs one fetch call, mapping every non-2xx-shaped-body outcome to a
 * TransportFailure rather than throwing. `timeoutMs` is optional and
 * undefined by default: omitting it (as the upload call site below does)
 * means this function imposes NO internal deadline of its own — only the
 * caller-supplied `signal` can end the request, exactly the pre-existing
 * behavior for upload. Passing a `timeoutMs` (as postJson always does)
 * adds a bounded internal deadline on top of that, without changing how
 * the caller's own signal behaves.
 */
async function runFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  timeoutMs?: number,
): Promise<{ status: number; json: unknown } | TransportFailure> {
  if (signal?.aborted) return { ok: false, transportFailure: "aborted" };

  // Internal timeout controller, merged with the caller's own signal (if
  // any): either one aborts the actual fetch, but only the CALLER's signal
  // being aborted means "aborted" — a timeout firing on its own means the
  // network stalled, which must surface as a retryable network_error, not
  // be silently conflated with a deliberate cancel (see this module's own
  // TransportFailureKind doc comment on why those two can never mean the
  // same thing to the engine). When timeoutMs is undefined, no timer is
  // ever started — fetchImpl receives exactly the caller's own signal,
  // unchanged from this function's pre-timeout-feature behavior.
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, timeoutMs);
  const relayExternalAbort = () => timeoutController.abort();
  signal?.addEventListener("abort", relayExternalAbort);

  let response: Response;
  try {
    response = await fetchImpl(input, { ...init, signal: timeoutController.signal });
  } catch (error) {
    if (signal?.aborted) return { ok: false, transportFailure: "aborted" };
    if (timedOut) return { ok: false, transportFailure: "network_error" };
    if (isAbortError(error)) return { ok: false, transportFailure: "aborted" };
    return { ok: false, transportFailure: "network_error" };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", relayExternalAbort);
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
export type InitiateErrorCode =
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "VERIFICATION_REQUIRED"
  | "RATE_LIMITED";

export type InitiateTransportResult = TransportResult<InitiateSuccessData, InitiateErrorCode>;

export interface InitiateTransportRequest {
  readonly idempotencyKey: string;
  readonly submission: SubmissionShape;
  readonly files: readonly CanonicalFileDeclaration[];
  /** CHECKPOINT C2G — a fresh Cloudflare Turnstile token, ephemeral: never persisted, never logged, sent only in this one request. */
  readonly turnstileToken: string;
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
    code: z.enum([
      "VALIDATION_ERROR",
      "IDEMPOTENCY_CONFLICT",
      "INTERNAL_ERROR",
      "VERIFICATION_REQUIRED",
      "RATE_LIMITED",
    ]),
    message: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/**
 * initiate's own error body carries no `retryable` flag (see
 * InitiateQuoteErrorBody) — this transport derives it once, here, from the
 * error code alone, so every caller shares one answer instead of each
 * re-deriving its own. INTERNAL_ERROR (a transient server fault) and
 * RATE_LIMITED (the customer just needs to wait) are safe to retry
 * unmodified. VERIFICATION_REQUIRED is also retryable in the sense that
 * trying again — with a fresh token — can succeed, but the engine maps it
 * to its own dedicated outcome (never a generic "retry the same request")
 * so the caller knows a NEW Turnstile challenge is needed first. A
 * validation failure or an idempotency-key/hash conflict is not retryable
 * (retrying the exact same request would just repeat the same outcome).
 */
function initiateErrorRetryable(code: InitiateErrorCode): boolean {
  return code === "INTERNAL_ERROR" || code === "RATE_LIMITED" || code === "VERIFICATION_REQUIRED";
}

async function postJson(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<{ status: number; json: unknown } | TransportFailure> {
  // MEASURED GAP — JSON.stringify(body) was previously evaluated inline as
  // a call argument, so it ran BEFORE runFetch's own try/catch (which only
  // wraps the fetchImpl(...) call itself) ever started. A throw here —
  // JSON.stringify can throw on a BigInt or a circular reference — would
  // have propagated uncaught, past this request never having been sent,
  // indistinguishable upstream from a genuine network/server failure.
  // Reusing "network_error" (never a new TransportFailureKind) keeps this
  // module's existing contract intact: the caller already treats
  // network_error as retryable with no assumption the request reached the
  // server, which is also true here.
  let serializedBody: string;
  try {
    serializedBody = JSON.stringify(body);
  } catch {
    return { ok: false, transportFailure: "network_error" };
  }
  return runFetch(
    `${baseUrl}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serializedBody,
    },
    signal,
    fetchImpl,
    JSON_REQUEST_TIMEOUT_MS,
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
  | "INTERNAL_ERROR"
  | "RATE_LIMITED";

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
      "RATE_LIMITED",
    ]),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// POST /api/quote/complete
// ---------------------------------------------------------------------------

/** Mirrors src/server/quote/complete-quote.ts's CompleteErrorCode exactly. */
export type CompleteErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "NOT_READY" | "INTERNAL_ERROR" | "RATE_LIMITED";

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
    code: z.enum(["VALIDATION_ERROR", "NOT_FOUND", "NOT_READY", "INTERNAL_ERROR", "RATE_LIMITED"]),
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
          turnstileToken: request.turnstileToken,
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

      // Deliberately no timeoutMs here — upload is excluded from
      // JSON_REQUEST_TIMEOUT_MS on purpose. At the existing 8 MiB cap
      // (upload-quote.ts's MAX_UPLOAD_FILE_BYTES), realistic weak-network
      // uplink speeds make a flat 30s deadline actively harmful, not
      // protective: 8 MiB = 67,108,864 bits, which needs ~2.24 Mbps
      // uplink just to land inside 30s. Measured against commonly-cited
      // real-world/DevTools-preset uplink speeds, a genuine (not
      // artificially stalled) upload at the size cap takes roughly:
      //   - weak 2G  (~50 kbps):  ~1,342s (~22 min)
      //   - Slow 3G  (~330 kbps):   ~203s (~3.4 min)
      //   - Fast 3G  (~750 kbps):    ~90s (~1.5 min)
      // A flat 30s timeout would false-positive-abort nearly every real
      // upload on exactly the weak-network conditions this is meant to
      // help — these are calculated durations for a genuine transfer,
      // not a measured/observed one: this module has no actual upload-
      // progress signal (see below), so it cannot distinguish a slow but
      // still-progressing transfer from a truly stalled one by watching
      // bytes move. "No internal deadline" is therefore the only claim
      // this code actually makes or tests for upload — not "detects and
      // tolerates slow progress".
      // A size-proportional or true upload-progress-based idle timeout
      // would be the correct fix, but the Fetch API gives no reliable
      // cross-browser upload-progress signal (notably inconsistent
      // streaming-upload support in Safari/iOS, the exact target of this
      // audit) without a materially larger change than this bounded pass
      // allows. Left unchanged: only the caller's own AbortSignal (user
      // cancel / Start Over) can end an upload call — unbounded duration,
      // not unbounded in the sense of ever hanging past what the browser
      // itself eventually does for a truly dead connection.
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
