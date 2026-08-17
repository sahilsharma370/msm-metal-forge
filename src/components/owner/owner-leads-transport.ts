import { z } from "zod";
import {
  ownerLeadListSuccessBodySchema,
  type OwnerLeadListSuccessBody,
  type OwnerLeadStatus,
  type OwnerLeadIntent,
  type OwnerLeadMaterial,
  type OwnerLeadCaptureChannel,
} from "@/lib/owner/owner-leads-contract";
import {
  ownerLeadDetailSuccessBodySchema,
  type OwnerLeadDetailSuccessBody,
  ownerLeadFileAccessSuccessBodySchema,
  type OwnerLeadFileAccessSuccessBody,
} from "@/lib/owner/owner-lead-detail-contract";
import type { OwnerAuthClient } from "./owner-auth-client";

/**
 * CHECKPOINT C2J-D — the one browser-safe transport for the owner Manage
 * UI's three read APIs (GET /api/owner/leads, GET /api/owner/leads/:leadId,
 * POST /api/owner/leads/:leadId/files/:fileId/access). Matches
 * owner-session-checker.ts's own established shape exactly: a narrow
 * injectable deps interface, zod re-validation of every response against
 * the canonical contracts (never trusted blindly even though it's this
 * project's own API), and a discriminated result type so callers never see
 * a raw fetch/parse exception.
 *
 * Never logs a token, signed URL, or raw response body — every failure
 * collapses to a short, already-server-sanitized message or a generic
 * fallback, never a raw provider/database error.
 */

export type OwnerApiResult<T> =
  | { readonly kind: "ok"; readonly data: T }
  | { readonly kind: "unauthorized" }
  /** `status` is the HTTP status code only (never response body content beyond the already-sanitized `message`) — safe to branch UI behavior on (e.g. 404 -> "not found, go back" vs 500 -> "retry"), since the status category itself carries no sensitive information the browser doesn't already see. */
  | { readonly kind: "error"; readonly message: string; readonly status: number | null }
  | { readonly kind: "aborted" };

export interface OwnerLeadsTransportDeps {
  readonly authClient: OwnerAuthClient;
  readonly fetchImpl: typeof fetch;
}

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

const looseErrorBodySchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

/**
 * The one place every owner API call passes through: attaches the current
 * access token (obtained fresh each call via authClient.getAccessToken(),
 * never cached/persisted by this module), treats a 401 as a signal to sign
 * the local session out and report "unauthorized" (the caller — see
 * use-owner-lead-list.ts/use-owner-lead-detail.ts — reacts by redirecting
 * to /owner/login), and re-validates every 200 body against the caller's
 * own canonical zod schema before ever handing it back.
 */
async function callOwnerApi<TBody>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: TBody } },
  deps: OwnerLeadsTransportDeps,
  init: RequestInit,
): Promise<OwnerApiResult<TBody>> {
  const token = await deps.authClient.getAccessToken();
  if (!token) {
    return { kind: "unauthorized" };
  }

  let response: Response;
  try {
    response = await deps.fetchImpl(path, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (init.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { kind: "aborted" };
    }
    return { kind: "error", message: GENERIC_ERROR_MESSAGE, status: null };
  }

  if (response.status === 401) {
    await deps.authClient.signOut();
    return { kind: "unauthorized" };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { kind: "error", message: GENERIC_ERROR_MESSAGE, status: response.status };
  }

  if (!response.ok) {
    const errorBody = looseErrorBodySchema.safeParse(json);
    return {
      kind: "error",
      message: errorBody.success ? errorBody.data.error.message : GENERIC_ERROR_MESSAGE,
      status: response.status,
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success || parsed.data === undefined) {
    return { kind: "error", message: GENERIC_ERROR_MESSAGE, status: response.status };
  }
  return { kind: "ok", data: parsed.data };
}

function mapOk<TBody extends { readonly data: TData }, TData>(result: OwnerApiResult<TBody>): OwnerApiResult<TData> {
  if (result.kind !== "ok") return result;
  return { kind: "ok", data: result.data.data };
}

/** RequestInit's own `signal` type is `AbortSignal | null`, never `undefined` — this keeps every call site from having to repeat the `exactOptionalPropertyTypes`-safe conditional-spread itself. */
function withMethod(method: "GET" | "POST", signal: AbortSignal | undefined): RequestInit {
  return signal ? { method, signal } : { method };
}

// ---------------------------------------------------------------------------
// Lead list
// ---------------------------------------------------------------------------

export interface OwnerLeadListQuery {
  readonly status?: OwnerLeadStatus;
  readonly intent?: OwnerLeadIntent;
  readonly material?: OwnerLeadMaterial;
  readonly captureChannel?: OwnerLeadCaptureChannel;
  readonly submittedFrom?: string;
  readonly submittedTo?: string;
  readonly q?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

function buildListSearchParams(query: OwnerLeadListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.intent) params.set("intent", query.intent);
  if (query.material) params.set("material", query.material);
  if (query.captureChannel) params.set("captureChannel", query.captureChannel);
  if (query.submittedFrom) params.set("submittedFrom", query.submittedFrom);
  if (query.submittedTo) params.set("submittedTo", query.submittedTo);
  if (query.q) params.set("q", query.q);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  return params;
}

export async function fetchOwnerLeadList(
  query: OwnerLeadListQuery,
  deps: OwnerLeadsTransportDeps,
  signal?: AbortSignal,
): Promise<OwnerApiResult<OwnerLeadListSuccessBody["data"]>> {
  const params = buildListSearchParams(query).toString();
  const result = await callOwnerApi(
    `/api/owner/leads${params ? `?${params}` : ""}`,
    ownerLeadListSuccessBodySchema,
    deps,
    withMethod("GET", signal),
  );
  return mapOk(result);
}

// ---------------------------------------------------------------------------
// Lead detail
// ---------------------------------------------------------------------------

export async function fetchOwnerLeadDetail(
  leadId: string,
  deps: OwnerLeadsTransportDeps,
  signal?: AbortSignal,
): Promise<OwnerApiResult<OwnerLeadDetailSuccessBody["data"]>> {
  const result = await callOwnerApi(
    `/api/owner/leads/${encodeURIComponent(leadId)}`,
    ownerLeadDetailSuccessBodySchema,
    deps,
    withMethod("GET", signal),
  );
  return mapOk(result);
}

// ---------------------------------------------------------------------------
// Private file access
// ---------------------------------------------------------------------------

export async function requestOwnerLeadFileAccess(
  leadId: string,
  fileId: string,
  deps: OwnerLeadsTransportDeps,
  signal?: AbortSignal,
): Promise<OwnerApiResult<OwnerLeadFileAccessSuccessBody["data"]>> {
  const result = await callOwnerApi(
    `/api/owner/leads/${encodeURIComponent(leadId)}/files/${encodeURIComponent(fileId)}/access`,
    ownerLeadFileAccessSuccessBodySchema,
    deps,
    withMethod("POST", signal),
  );
  return mapOk(result);
}
