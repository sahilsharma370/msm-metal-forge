/**
 * CHECKPOINT C2J-A — the owner lead-inbox read service: query validation,
 * keyset ("cursor") pagination, seller/buyer branch mapping, and
 * notification-status derivation, all in one cohesive module (matching
 * this codebase's own established initiate-quote.ts precedent — validation
 * + types + business logic together for one route's one job, rather than
 * fragmented across many tiny files). `.server.ts` suffix — see
 * env.server.ts for why that's sufficient import protection on its own.
 *
 * Read-only. No RPC is used (unlike the Quote pipeline's write paths) —
 * this is a plain server-side SELECT via the service-role admin client,
 * matching dispatch-notification.server.ts's own loadLead()/
 * countLeadFiles() precedent of injecting the actual DB calls as narrow
 * async functions rather than a raw chained query-builder interface (the
 * filter/sort/pagination shape here is too varied to type as a small
 * structural interface the way QuoteRpcClient's single .rpc() call is).
 *
 * Security: this module never runs unless the caller (the API route) has
 * already confirmed an active, verified owner session — see
 * owner-session.server.ts. This module itself does not re-check
 * authorization; it trusts its caller exactly like every other
 * deps-injected server module in this codebase.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { normalizePhoneNumber } from "@/components/site/quote/quote-schema";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_INTENT_VALUES,
  OWNER_LEAD_LIST_QUERY_PARAMS,
  type OwnerLeadListItem,
  type OwnerNotificationSummaryStatus,
} from "@/lib/owner/owner-leads-contract";

// ---------------------------------------------------------------------------
// Query parameter validation — allowlist values only, matching this
// schema's own established CHECK-constraint vocabularies exactly (never
// invented, never widened here). The vocabularies themselves come from
// @/lib/owner/owner-leads-contract — the one canonical, browser-safe source
// of truth — never redeclared here.
// ---------------------------------------------------------------------------

/** Same reasoning as the search-classification patterns below — a Postgres timestamptz's own text representation never contains a comma or parenthesis, so this allowlist closes the same filter-injection surface for cursor values. */
const CURSOR_TIMESTAMP_PATTERN = /^[0-9T:+\-. Z]+$/;

// ---------------------------------------------------------------------------
// Search classification — `q` is never concatenated into a raw PostgREST
// `.or()` string as free text. It is first classified into exactly one of
// three known-safe shapes (reference / phone / name), each normalized to a
// restricted, provably-safe character set before it ever reaches
// buildSearchFilter(). Any input matching none of the three is rejected
// outright (fail closed) rather than passed through.
//
// This design was verified empirically against the real local PostgREST
// stack (not guessed): raw Unicode (Arabic script, accented Latin) and raw
// apostrophes pass through an `.ilike.` filter *value* position completely
// safely — PostgREST does not require quoting/escaping for those. A raw
// comma, however, splits the surrounding `.or(...)` expression into an
// extra, fully attacker-controlled top-level condition (confirmed: an
// unescaped comma turned one intended `ilike` condition into two OR'd
// conditions) — so `,` `(` `)` must never reach the filter string. PostgREST
// also treats `*` as a stand-in for the SQL `%` wildcard in this operator
// position, so `*`, `%`, and `_` (the LIKE single-char wildcard) are
// excluded from the name allowlist too, so a search can't turn into an
// unintended wildcard match.
// ---------------------------------------------------------------------------

/** MSM-YYMMDD-XXXXXX, from generate_lead_reference() — matches a full or partial (prefix) reference, letters/digits/hyphen only after the literal "MSM-". */
const REFERENCE_SEARCH_PATTERN = /^MSM-[0-9A-Za-z-]{0,13}$/i;
/** Only common phone-formatting characters — digits, +, parens, hyphen, dot, whitespace — never letters, so it can never collide with the name branch. */
const PHONE_SEARCH_CHARSET_PATTERN = /^[0-9+()\-.\s]+$/;
/**
 * Unicode letters (\p{L}) and combining marks (\p{M}) — covers Arabic
 * script, accented Latin, etc. — plus space, straight/curly apostrophe,
 * hyphen and dot. Must start with a letter/mark (so it can never be
 * confused with the phone/digit branch). Deliberately excludes digits,
 * comma, parentheses, `%`, `_`, `*`, quotes, backslash, and every other
 * PostgREST-structural or SQL-wildcard character.
 */
const NAME_SEARCH_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'’\-.]*$/u;

export type SearchClassification =
  | { readonly kind: "reference"; readonly value: string }
  | { readonly kind: "phone"; readonly digits: string }
  | { readonly kind: "name"; readonly value: string };

/** Classifies an already-trimmed, length-bounded search term into exactly one safe shape, or null if it matches none (caller must reject the request). */
export function classifySearchTerm(trimmed: string): SearchClassification | null {
  if (REFERENCE_SEARCH_PATTERN.test(trimmed)) {
    const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    return normalized.length > 0 ? { kind: "reference", value: normalized } : null;
  }
  if (PHONE_SEARCH_CHARSET_PATTERN.test(trimmed)) {
    const rawDigits = trimmed.replace(/[^0-9]/g, "");
    if (rawDigits.length < 3) return null;
    const normalizedPhone = normalizePhoneNumber(trimmed);
    const digits = normalizedPhone ? normalizedPhone.replace(/[^0-9]/g, "") : rawDigits;
    return { kind: "phone", digits };
  }
  if (NAME_SEARCH_PATTERN.test(trimmed)) {
    return { kind: "name", value: trimmed };
  }
  return null;
}

const queryParamsSchema = z.object({
  status: z.enum(OWNER_LEAD_STATUS_VALUES).optional(),
  intent: z.enum(OWNER_LEAD_INTENT_VALUES).optional(),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES).optional(),
  captureChannel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES).optional(),
  submittedFrom: z.string().datetime({ offset: true }).optional(),
  submittedTo: z.string().datetime({ offset: true }).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const OWNER_LEAD_LIST_QUERY_PARAM_SET: ReadonlySet<string> = new Set(OWNER_LEAD_LIST_QUERY_PARAMS);

/**
 * CHECKPOINT C2J-A1 — GET /api/owner/leads is an internal, versioned API
 * with a fixed parameter set, not a public one expected to tolerate extra
 * tracking/marketing parameters gracefully — so, unlike the reasoning this
 * module's earlier revision documented, any key outside
 * OWNER_LEAD_LIST_QUERY_PARAMS now fails the request outright with the
 * same sanitized 400 every other validation failure uses, rather than
 * being silently ignored.
 */
function hasOnlyAllowedQueryParams(searchParams: URLSearchParams): boolean {
  for (const key of searchParams.keys()) {
    if (!OWNER_LEAD_LIST_QUERY_PARAM_SET.has(key)) return false;
  }
  return true;
}

const cursorPayloadSchema = z.object({
  s: z.string().min(1).max(64).regex(CURSOR_TIMESTAMP_PATTERN),
  c: z.string().min(1).max(64).regex(CURSOR_TIMESTAMP_PATTERN),
  i: z.string().uuid(),
});

export interface DecodedCursor {
  readonly submissionCompletedAt: string;
  readonly createdAt: string;
  readonly id: string;
}

export const DEFAULT_OWNER_LEAD_LIST_LIMIT = 20;
export const MAX_OWNER_LEAD_LIST_LIMIT = 50;

export interface ParsedOwnerLeadListQuery {
  readonly status?: string;
  readonly intent?: "sell" | "buy";
  readonly material?: string;
  readonly captureChannel?: string;
  readonly submittedFrom?: string;
  readonly submittedTo?: string;
  readonly search?: SearchClassification;
  readonly cursor?: DecodedCursor;
  readonly limit: number;
}

export type ParseOwnerLeadListQueryResult =
  | { readonly ok: true; readonly query: ParsedOwnerLeadListQuery }
  | { readonly ok: false; readonly message: string };

/** Rejects any request whose query string contains a key outside OWNER_LEAD_LIST_QUERY_PARAMS (see hasOnlyAllowedQueryParams' own comment), then validates every allowed value against its exact vocabulary/shape. */
export function parseOwnerLeadListQuery(searchParams: URLSearchParams): ParseOwnerLeadListQueryResult {
  if (!hasOnlyAllowedQueryParams(searchParams)) {
    return { ok: false, message: "The request could not be validated." };
  }

  const parsed = queryParamsSchema.safeParse({
    status: searchParams.get("status") ?? undefined,
    intent: searchParams.get("intent") ?? undefined,
    material: searchParams.get("material") ?? undefined,
    captureChannel: searchParams.get("captureChannel") ?? undefined,
    submittedFrom: searchParams.get("submittedFrom") ?? undefined,
    submittedTo: searchParams.get("submittedTo") ?? undefined,
    q: searchParams.get("q") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: "The request could not be validated." };
  }

  let cursor: DecodedCursor | undefined;
  if (parsed.data.cursor) {
    const decoded = decodeCursor(parsed.data.cursor);
    if (!decoded) {
      return { ok: false, message: "The request could not be validated." };
    }
    cursor = decoded;
  }

  let search: SearchClassification | undefined;
  if (parsed.data.q) {
    const classified = classifySearchTerm(parsed.data.q);
    if (!classified) {
      return { ok: false, message: "The request could not be validated." };
    }
    search = classified;
  }

  return {
    ok: true,
    query: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.intent ? { intent: parsed.data.intent } : {}),
      ...(parsed.data.material ? { material: parsed.data.material } : {}),
      ...(parsed.data.captureChannel ? { captureChannel: parsed.data.captureChannel } : {}),
      ...(parsed.data.submittedFrom ? { submittedFrom: parsed.data.submittedFrom } : {}),
      ...(parsed.data.submittedTo ? { submittedTo: parsed.data.submittedTo } : {}),
      ...(search ? { search } : {}),
      ...(cursor ? { cursor } : {}),
      limit: parsed.data.limit ?? DEFAULT_OWNER_LEAD_LIST_LIMIT,
    },
  };
}

// ---------------------------------------------------------------------------
// Cursor — opaque to the browser, base64url of a small validated JSON
// object carrying the exact three sort-tuple values from the last returned
// row, as their raw Postgres text representation (never round-tripped
// through a JS Date, which would silently truncate to millisecond
// precision and could misorder two rows whose real difference is smaller
// than that).
// ---------------------------------------------------------------------------

function base64UrlEncode(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + padding);
}

export function encodeCursor(row: DecodedCursor): string {
  return base64UrlEncode(JSON.stringify({ s: row.submissionCompletedAt, c: row.createdAt, i: row.id }));
}

export function decodeCursor(cursor: string): DecodedCursor | null {
  let json: unknown;
  try {
    json = JSON.parse(base64UrlDecode(cursor));
  } catch {
    return null;
  }
  const parsed = cursorPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { submissionCompletedAt: parsed.data.s, createdAt: parsed.data.c, id: parsed.data.i };
}

/**
 * The classified value already passed through classifySearchTerm() above,
 * so it is restricted to one of three provably-safe character sets — never
 * raw, unclassified user input. Reference searches only ever touch
 * `reference`; phone searches only ever touch `seller_phone`/`buyer_phone`;
 * name searches only ever touch `seller_name`/`buyer_contact_person`. Notes,
 * descriptions, and `submission_snapshot` are never searched.
 */
function buildSearchFilter(search: SearchClassification): string {
  switch (search.kind) {
    case "reference":
      return `reference.ilike.${search.value}%`;
    case "phone":
      return [`seller_phone.ilike.%${search.digits}%`, `buyer_phone.ilike.%${search.digits}%`].join(",");
    case "name":
      return [`seller_name.ilike.%${search.value}%`, `buyer_contact_person.ilike.%${search.value}%`].join(",");
  }
}

/** Every value here already passed CURSOR_TIMESTAMP_PATTERN / z.string().uuid() — see those validators' own comments for why this interpolation cannot escape the intended filter structure. Standard keyset-pagination tuple comparison: strictly "before" the cursor row in (submission_completed_at, created_at, id) DESC order. */
function buildCursorFilter(cursor: DecodedCursor): string {
  const { submissionCompletedAt: s, createdAt: c, id } = cursor;
  return [
    `submission_completed_at.lt.${s}`,
    `and(submission_completed_at.eq.${s},created_at.lt.${c})`,
    `and(submission_completed_at.eq.${s},created_at.eq.${c},id.lt.${id})`,
  ].join(",");
}

// ---------------------------------------------------------------------------
// Raw row shape — defensively re-validated, never trusted blindly even
// though it comes from this project's own database (matching every other
// server module's posture here).
// ---------------------------------------------------------------------------

const LEADS_SELECT_COLUMNS = [
  "id", "reference", "status", "intent", "capture_channel", "material", "material_subtype",
  "created_at", "submission_completed_at", "file_upload_status",
  "seller_name", "seller_phone", "seller_emirate", "seller_area", "seller_quantity_value", "seller_quantity_unit",
  "buyer_contact_person", "buyer_phone", "buyer_destination_emirate", "buyer_destination_area",
  "buyer_quantity_value", "buyer_quantity_unit",
].join(", ");

const leadRowSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  intent: z.enum(OWNER_LEAD_INTENT_VALUES),
  capture_channel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  material_subtype: z.string().nullable(),
  created_at: z.string(),
  submission_completed_at: z.string(),
  file_upload_status: z.string(),
  seller_name: z.string().nullable(),
  seller_phone: z.string().nullable(),
  seller_emirate: z.string().nullable(),
  seller_area: z.string().nullable(),
  seller_quantity_value: z.number().nullable(),
  seller_quantity_unit: z.string().nullable(),
  buyer_contact_person: z.string().nullable(),
  buyer_phone: z.string().nullable(),
  buyer_destination_emirate: z.string().nullable(),
  buyer_destination_area: z.string().nullable(),
  buyer_quantity_value: z.number().nullable(),
  buyer_quantity_unit: z.string().nullable(),
});
export type LeadRow = z.infer<typeof leadRowSchema>;

const notificationStatusRowSchema = z.object({
  lead_id: z.string().uuid(),
  status: z.string(),
});

// ---------------------------------------------------------------------------
// Injected DB access — plain async functions, matching
// dispatch-notification.server.ts's own DispatchNotificationDeps precedent.
// ---------------------------------------------------------------------------

export class OwnerLeadsQueryError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "OwnerLeadsQueryError";
  }
}

export interface OwnerLeadsServiceDeps {
  /** Returns up to (query.limit + 1) rows so the caller can determine hasMore without a separate count query — never fewer. */
  queryLeadsPage(query: ParsedOwnerLeadListQuery): Promise<readonly LeadRow[]>;
  /** Keyed by lead_id. A lead with no row is simply absent from the returned map — never an error. */
  queryNotificationStatuses(leadIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export function createProductionOwnerLeadsServiceDeps(): OwnerLeadsServiceDeps {
  const admin: SupabaseClient = createSupabaseAdminClient();
  return {
    async queryLeadsPage(query) {
      let builder = admin
        .from("leads")
        .select(LEADS_SELECT_COLUMNS)
        .not("submission_completed_at", "is", null);

      if (query.status) builder = builder.eq("status", query.status);
      if (query.intent) builder = builder.eq("intent", query.intent);
      if (query.material) builder = builder.eq("material", query.material);
      if (query.captureChannel) builder = builder.eq("capture_channel", query.captureChannel);
      if (query.submittedFrom) builder = builder.gte("submission_completed_at", query.submittedFrom);
      if (query.submittedTo) builder = builder.lte("submission_completed_at", query.submittedTo);
      if (query.search) builder = builder.or(buildSearchFilter(query.search));
      if (query.cursor) builder = builder.or(buildCursorFilter(query.cursor));

      const { data, error } = await builder
        .order("submission_completed_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(query.limit + 1);

      if (error) throw new OwnerLeadsQueryError();

      const parsed = z.array(leadRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadsQueryError();
      return parsed.data;
    },

    async queryNotificationStatuses(leadIds) {
      if (leadIds.length === 0) return new Map();

      const { data, error } = await admin
        .from("notification_deliveries")
        .select("lead_id, status")
        .eq("event_type", "submission_completed")
        .in("lead_id", leadIds as string[]);

      if (error) throw new OwnerLeadsQueryError();

      const parsed = z.array(notificationStatusRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadsQueryError();

      const map = new Map<string, string>();
      for (const row of parsed.data) map.set(row.lead_id, row.status);
      return map;
    },
  };
}

// ---------------------------------------------------------------------------
// Notification-status derivation and seller/buyer mapping — pure, no I/O.
// ---------------------------------------------------------------------------

/**
 * sent -> "sent". pending/processing/retry_wait -> "pending" (still in
 * flight, nothing wrong yet). dead_letter -> "attention" (permanently
 * failed, needs a human). A completed lead with NO matching
 * notification_deliveries row also maps to "attention", never "sent" or
 * omitted — complete_lead_if_ready is expected to create that row
 * atomically in the same transaction that completes the lead, so a
 * missing row for an already-completed lead is itself an anomaly worth
 * surfacing, not a healthy default.
 */
export function deriveNotificationSummaryStatus(rawStatus: string | undefined): OwnerNotificationSummaryStatus {
  if (rawStatus === undefined) return "attention";
  if (rawStatus === "sent") return "sent";
  if (rawStatus === "dead_letter") return "attention";
  return "pending";
}

function mapLeadRow(row: LeadRow, notificationStatus: OwnerNotificationSummaryStatus): OwnerLeadListItem {
  const isSell = row.intent === "sell";
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    intent: row.intent,
    captureChannel: row.capture_channel,
    material: row.material,
    materialSubtype: row.material_subtype,
    createdAt: row.created_at,
    submissionCompletedAt: row.submission_completed_at,
    contact: {
      name: isSell ? row.seller_name : row.buyer_contact_person,
      phone: isSell ? row.seller_phone : row.buyer_phone,
    },
    location: {
      emirate: isSell ? row.seller_emirate : row.buyer_destination_emirate,
      area: isSell ? row.seller_area : row.buyer_destination_area,
    },
    quantity: {
      value: isSell ? row.seller_quantity_value : row.buyer_quantity_value,
      unit: isSell ? row.seller_quantity_unit : row.buyer_quantity_unit,
    },
    fileUploadStatus: row.file_upload_status,
    notificationStatus,
  };
}

export interface OwnerLeadListResult {
  readonly leads: readonly OwnerLeadListItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The one entry point this checkpoint's route calls. Fetches limit+1 rows
 * to determine hasMore without a separate count query (see
 * OwnerLeadsServiceDeps' own doc comment), slices back to limit, derives
 * each row's notification summary from a second small batched query, and
 * builds nextCursor from the LAST returned row only when another page
 * genuinely exists.
 */
export async function listOwnerLeads(
  query: ParsedOwnerLeadListQuery,
  deps: OwnerLeadsServiceDeps,
): Promise<OwnerLeadListResult> {
  const fetched = await deps.queryLeadsPage(query);
  const hasMore = fetched.length > query.limit;
  const rows = hasMore ? fetched.slice(0, query.limit) : fetched;

  const notificationStatuses = await deps.queryNotificationStatuses(rows.map((row) => row.id));

  const leads = rows.map((row) =>
    mapLeadRow(row, deriveNotificationSummaryStatus(notificationStatuses.get(row.id))),
  );

  const lastRow = rows[rows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({ submissionCompletedAt: lastRow.submission_completed_at, createdAt: lastRow.created_at, id: lastRow.id })
      : null;

  return { leads, nextCursor, hasMore };
}
