/**
 * CHECKPOINT C2J-A1 — the ONE canonical, browser-safe contract for the
 * owner lead-inbox list response (`GET /api/owner/leads`). Both the server
 * service (src/server/owner-leads/owner-leads.server.ts) and the API route
 * (src/routes/api/owner/leads.ts) import their public types/vocabularies
 * from here — there is exactly one source of truth for this shape, never a
 * server-side duplicate and never a second copy under src/components/owner/
 * (the previous, now-removed duplicate explicitly said it was a copy; this
 * module is the real thing). Future browser/UI code (not built in this
 * checkpoint) will import from here too.
 *
 * No server-only import, secret, Supabase admin client, Node-only
 * dependency, or `process.env` access — safe to import from any browser
 * bundle; only `zod` (already a browser-safe dependency used throughout
 * this codebase's own client-side schemas, e.g. quote-schema.ts) is
 * imported. Internal raw database-row types (snake_case, defensively
 * re-validated Supabase query results) remain server-only, defined in
 * owner-leads.server.ts itself — only the sanitized, camelCase public
 * response shape and its shared vocabularies live here.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared vocabularies — the single source of truth for these enums,
// mirrored exactly from this schema's own CHECK constraints (never
// invented, never widened here). Both the server's query-parameter
// validation/raw-row validation and this module's own response-item schema
// import these same arrays — no second copy of any of these lists exists
// anywhere else in the codebase.
// ---------------------------------------------------------------------------

export const OWNER_LEAD_STATUS_VALUES = [
  "new", "needs_information", "contacted", "inspection", "quote_sent",
  "pickup_delivery", "completed", "lost", "archived",
] as const;
export const OWNER_LEAD_CAPTURE_CHANNEL_VALUES = ["website", "phone", "whatsapp", "walk_in", "owner_manual"] as const;
export const OWNER_LEAD_MATERIAL_VALUES = ["copper", "aluminium", "steel_iron", "lead", "other"] as const;
export const OWNER_LEAD_INTENT_VALUES = ["sell", "buy"] as const;
export const OWNER_NOTIFICATION_SUMMARY_STATUS_VALUES = ["sent", "pending", "attention", "not_required"] as const;

export type OwnerLeadStatus = (typeof OWNER_LEAD_STATUS_VALUES)[number];
export type OwnerLeadCaptureChannel = (typeof OWNER_LEAD_CAPTURE_CHANNEL_VALUES)[number];
export type OwnerLeadMaterial = (typeof OWNER_LEAD_MATERIAL_VALUES)[number];
export type OwnerLeadIntent = (typeof OWNER_LEAD_INTENT_VALUES)[number];
export type OwnerNotificationSummaryStatus = (typeof OWNER_NOTIFICATION_SUMMARY_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// Response item schema/type — `.strict()` so an extra/forbidden field (e.g.
// a stray `storagePath` or `submissionSnapshot`) fails validation rather
// than silently passing through, which is what this module's own tests use
// to prove the schema actively rejects forbidden shapes, not just documents
// the intended one.
// ---------------------------------------------------------------------------

export const ownerLeadListItemSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string(),
    status: z.enum(OWNER_LEAD_STATUS_VALUES),
    intent: z.enum(OWNER_LEAD_INTENT_VALUES),
    captureChannel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
    material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
    materialSubtype: z.string().nullable(),
    createdAt: z.string(),
    submissionCompletedAt: z.string(),
    contact: z
      .object({
        name: z.string().nullable(),
        phone: z.string().nullable(),
      })
      .strict(),
    location: z
      .object({
        emirate: z.string().nullable(),
        area: z.string().nullable(),
      })
      .strict(),
    quantity: z
      .object({
        value: z.number().nullable(),
        unit: z.string().nullable(),
      })
      .strict(),
    fileUploadStatus: z.string(),
    notificationStatus: z.enum(OWNER_NOTIFICATION_SUMMARY_STATUS_VALUES),
  })
  .strict();

export type OwnerLeadListItem = z.infer<typeof ownerLeadListItemSchema>;

export const ownerLeadListPageSchema = z
  .object({
    /** Opaque — never parse or construct this on the browser side. Null when there is no further page. */
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export type OwnerLeadListPage = z.infer<typeof ownerLeadListPageSchema>;

export const ownerLeadListSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        leads: z.array(ownerLeadListItemSchema),
        page: ownerLeadListPageSchema,
      })
      .strict(),
  })
  .strict();
export type OwnerLeadListSuccessBody = z.infer<typeof ownerLeadListSuccessBodySchema>;

export const OWNER_LEAD_LIST_ERROR_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "INTERNAL_ERROR"] as const;
export type OwnerLeadListErrorCode = (typeof OWNER_LEAD_LIST_ERROR_CODES)[number];

export const ownerLeadListErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_LIST_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadListErrorBody = z.infer<typeof ownerLeadListErrorBodySchema>;

export const ownerLeadListResponseBodySchema = z.union([ownerLeadListSuccessBodySchema, ownerLeadListErrorBodySchema]);
export type OwnerLeadListResponseBody = z.infer<typeof ownerLeadListResponseBodySchema>;

// ---------------------------------------------------------------------------
// Query parameter allowlist — the single source of truth for
// GET /api/owner/leads' fixed, versioned parameter set. The server rejects
// any request containing a key outside this exact list (CHECKPOINT C2J-A1
// part C) — an internal API is not obligated to silently tolerate extra
// parameters the way a public one might.
// ---------------------------------------------------------------------------

export const OWNER_LEAD_LIST_QUERY_PARAMS = [
  "status",
  "intent",
  "material",
  "captureChannel",
  "submittedFrom",
  "submittedTo",
  "q",
  "cursor",
  "limit",
] as const;
export type OwnerLeadListQueryParamName = (typeof OWNER_LEAD_LIST_QUERY_PARAMS)[number];
