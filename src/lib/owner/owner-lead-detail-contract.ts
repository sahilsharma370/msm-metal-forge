/**
 * CHECKPOINT C2J-B/C — the ONE canonical, browser-safe contract for the
 * owner lead-detail response (`GET /api/owner/leads/:leadId`) and the
 * private-file access response (`.../files/:fileId/access`). Matches
 * owner-leads-contract.ts's own established pattern exactly: no
 * server-only import, secret, Supabase admin client, Node-only dependency,
 * or `process.env` access — safe to import from any browser bundle; only
 * `zod` (and this schema's own already-canonical list vocabularies) is
 * imported. Internal raw database-row types remain server-only, defined in
 * owner-lead-detail.server.ts / owner-lead-file-access.server.ts.
 *
 * Every field below traces to a real column inspected directly in
 * supabase/migrations/20260811165757_create_quote_backend_foundation.sql,
 * 20260813114500_lead_completion_lifecycle.sql,
 * 20260816170000_notification_delivery_outbox_lifecycle.sql, and
 * 20260816203000_notification_delivery_operator_recovery.sql — nothing here
 * is invented ahead of schema truth.
 */
import { z } from "zod";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_NOTIFICATION_SUMMARY_STATUS_VALUES,
} from "./owner-leads-contract";

// ---------------------------------------------------------------------------
// Shared vocabularies specific to the detail/file surfaces — mirrored
// exactly from their own CHECK constraints, never invented, never widened.
// ---------------------------------------------------------------------------

export const OWNER_LEAD_QUANTITY_UNIT_VALUES = ["kg", "tonnes", "pieces", "load", "other"] as const;
export const OWNER_LEAD_SELLER_CONDITION_VALUES = ["clean_separated", "mixed", "used_surplus", "not_sure"] as const;
export const OWNER_LEAD_SELLER_PICKUP_REQUIRED_VALUES = ["yes", "no", "not_sure"] as const;
export const OWNER_LEAD_PREFERRED_CONTACT_VALUES = ["whatsapp", "call", "email"] as const;
export const OWNER_LEAD_BUYER_TRADE_REQUIREMENT_VALUES = ["local", "import", "export"] as const;
export const OWNER_LEAD_BUYER_FULFILMENT_VALUES = ["delivery", "collection", "discuss"] as const;
export const OWNER_LEAD_BUYER_PREFERRED_PORT_VALUES = ["jebel_ali", "khalifa_port", "other", "no_preference"] as const;

export const OWNER_LEAD_FILE_KIND_VALUES = ["seller_photo", "buyer_document", "owner_attachment"] as const;
export const OWNER_LEAD_FILE_MIME_TYPE_VALUES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const OWNER_LEAD_FILE_UPLOAD_STATUS_VALUES = ["pending", "complete", "failed"] as const;

export const OWNER_LEAD_ACTIVITY_ACTOR_TYPE_VALUES = ["system", "owner"] as const;

export type OwnerLeadFileKind = (typeof OWNER_LEAD_FILE_KIND_VALUES)[number];
export type OwnerLeadFileMimeType = (typeof OWNER_LEAD_FILE_MIME_TYPE_VALUES)[number];
export type OwnerLeadFileUploadStatus = (typeof OWNER_LEAD_FILE_UPLOAD_STATUS_VALUES)[number];
export type OwnerLeadActivityActorType = (typeof OWNER_LEAD_ACTIVITY_ACTOR_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// lead — a discriminated union on `intent`, so a seller lead's schema
// structurally cannot carry a buyer field and vice versa (not just a
// runtime-null convention — TypeScript itself refuses to let a "sell"
// variant reference a buyer-only property).
// ---------------------------------------------------------------------------

const ownerLeadDetailCommonFields = {
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  captureChannel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  materialSubtype: z.string().nullable(),
  materialSubtypeOtherText: z.string().nullable(),
  materialOtherText: z.string().nullable(),
  createdAt: z.string(),
  submissionCompletedAt: z.string(),
  fileUploadStatus: z.string(),
};

const sellLeadDetailSchema = z
  .object({
    ...ownerLeadDetailCommonFields,
    intent: z.literal("sell"),
    contact: z
      .object({
        name: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        company: z.string().nullable(),
      })
      .strict(),
    location: z
      .object({
        emirate: z.string().nullable(),
        area: z.string().nullable(),
        mapLink: z.string().nullable(),
      })
      .strict(),
    enquiry: z
      .object({
        quantityValue: z.number().nullable(),
        quantityUnit: z.enum(OWNER_LEAD_QUANTITY_UNIT_VALUES).nullable(),
        quantityUnitOther: z.string().nullable(),
        quantityUnsure: z.boolean(),
        condition: z.enum(OWNER_LEAD_SELLER_CONDITION_VALUES).nullable(),
        description: z.string().nullable(),
        pickupRequired: z.enum(OWNER_LEAD_SELLER_PICKUP_REQUIRED_VALUES).nullable(),
        pickupDate: z.string().nullable(),
        accessNote: z.string().nullable(),
        preferredContact: z.enum(OWNER_LEAD_PREFERRED_CONTACT_VALUES).nullable(),
        notes: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

const buyLeadDetailSchema = z
  .object({
    ...ownerLeadDetailCommonFields,
    intent: z.literal("buy"),
    contact: z
      .object({
        name: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        company: z.string().nullable(),
      })
      .strict(),
    location: z
      .object({
        emirate: z.string().nullable(),
        area: z.string().nullable(),
        mapLink: z.string().nullable(),
      })
      .strict(),
    enquiry: z
      .object({
        quantityValue: z.number().nullable(),
        quantityUnit: z.enum(OWNER_LEAD_QUANTITY_UNIT_VALUES).nullable(),
        quantityUnitOther: z.string().nullable(),
        tradeRequirement: z.enum(OWNER_LEAD_BUYER_TRADE_REQUIREMENT_VALUES).nullable(),
        requiredByDate: z.string().nullable(),
        additionalSpec: z.string().nullable(),
        destinationCountry: z.string().nullable(),
        destinationCityPort: z.string().nullable(),
        preferredPort: z.enum(OWNER_LEAD_BUYER_PREFERRED_PORT_VALUES).nullable(),
        preferredPortOther: z.string().nullable(),
        originCountryPreference: z.string().nullable(),
        logisticsRequirement: z.enum(OWNER_LEAD_BUYER_FULFILMENT_VALUES).nullable(),
        logisticsNote: z.string().nullable(),
        fulfilment: z.enum(OWNER_LEAD_BUYER_FULFILMENT_VALUES).nullable(),
        materialSpec: z.string().nullable(),
        preferredContact: z.enum(OWNER_LEAD_PREFERRED_CONTACT_VALUES).nullable(),
        notes: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const ownerLeadDetailSchema = z.discriminatedUnion("intent", [sellLeadDetailSchema, buyLeadDetailSchema]);
export type OwnerLeadDetail = z.infer<typeof ownerLeadDetailSchema>;

// ---------------------------------------------------------------------------
// files — deliberately excludes storage_path/checksum_sha256/lead_id.
// ---------------------------------------------------------------------------

export const ownerLeadDetailFileSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(OWNER_LEAD_FILE_KIND_VALUES),
    originalFilename: z.string(),
    mimeType: z.enum(OWNER_LEAD_FILE_MIME_TYPE_VALUES),
    byteSize: z.number().int().positive(),
    uploadedAt: z.string().nullable(),
    uploadStatus: z.enum(OWNER_LEAD_FILE_UPLOAD_STATUS_VALUES),
  })
  .strict();
export type OwnerLeadDetailFile = z.infer<typeof ownerLeadDetailFileSchema>;

// ---------------------------------------------------------------------------
// activities — deliberately excludes the raw `metadata` jsonb column and
// `actor_owner_id` (an internal owner_profiles foreign key, not a public
// identity in this checkpoint). CHECKPOINT C2J-E adds two narrow,
// explicitly-allowlisted fields — statusChange / noteBody — populated by
// the server only for their matching eventType; this is still not a raw
// metadata pass-through, just two named projections of it.
// ---------------------------------------------------------------------------

export const ownerLeadDetailActivityStatusChangeSchema = z
  .object({
    from: z.enum(OWNER_LEAD_STATUS_VALUES),
    to: z.enum(OWNER_LEAD_STATUS_VALUES),
    reason: z.string().nullable(),
  })
  .strict();
export type OwnerLeadDetailActivityStatusChange = z.infer<typeof ownerLeadDetailActivityStatusChangeSchema>;

export const ownerLeadDetailActivitySchema = z
  .object({
    id: z.string().uuid(),
    eventType: z.string(),
    actorType: z.enum(OWNER_LEAD_ACTIVITY_ACTOR_TYPE_VALUES),
    createdAt: z.string(),
    statusChange: ownerLeadDetailActivityStatusChangeSchema.nullable(),
    noteBody: z.string().nullable(),
  })
  .strict();
export type OwnerLeadDetailActivity = z.infer<typeof ownerLeadDetailActivitySchema>;

// ---------------------------------------------------------------------------
// notification — richer than the list endpoint's flat `notificationStatus`,
// but the same three-value `status` derivation
// (deriveNotificationSummaryStatus, reused not reimplemented) underneath.
// ---------------------------------------------------------------------------

export const ownerLeadDetailNotificationSchema = z
  .object({
    status: z.enum(OWNER_NOTIFICATION_SUMMARY_STATUS_VALUES),
    attemptCount: z.number().int().nonnegative(),
    manualRequeueCount: z.number().int().nonnegative(),
    lastErrorCode: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
    sentAt: z.string().nullable(),
  })
  .strict();
export type OwnerLeadDetailNotification = z.infer<typeof ownerLeadDetailNotificationSchema>;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const ownerLeadDetailSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        lead: ownerLeadDetailSchema,
        files: z.array(ownerLeadDetailFileSchema),
        activities: z.array(ownerLeadDetailActivitySchema),
        notification: ownerLeadDetailNotificationSchema,
      })
      .strict(),
  })
  .strict();
export type OwnerLeadDetailSuccessBody = z.infer<typeof ownerLeadDetailSuccessBodySchema>;

export const OWNER_LEAD_DETAIL_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", "INTERNAL_ERROR"] as const;
export type OwnerLeadDetailErrorCode = (typeof OWNER_LEAD_DETAIL_ERROR_CODES)[number];

export const ownerLeadDetailErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_DETAIL_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadDetailErrorBody = z.infer<typeof ownerLeadDetailErrorBodySchema>;

export const ownerLeadDetailResponseBodySchema = z.union([ownerLeadDetailSuccessBodySchema, ownerLeadDetailErrorBodySchema]);
export type OwnerLeadDetailResponseBody = z.infer<typeof ownerLeadDetailResponseBodySchema>;

// ---------------------------------------------------------------------------
// CHECKPOINT C2J-E — status change (POST .../status) and private note
// creation (POST .../notes). Both share one error-code vocabulary that adds
// CONFLICT (a stale expectedStatus) to the detail endpoint's existing set.
// Neither request ever carries an owner identity or activity metadata —
// the server sources both exclusively from the verified session and its
// own RPC logic (see change-lead-status.server.ts / add-lead-note.server.ts).
// ---------------------------------------------------------------------------

export const OWNER_LEAD_MUTATION_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", "CONFLICT", "INTERNAL_ERROR"] as const;
export type OwnerLeadMutationErrorCode = (typeof OWNER_LEAD_MUTATION_ERROR_CODES)[number];

export const ownerLeadMutationErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_MUTATION_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadMutationErrorBody = z.infer<typeof ownerLeadMutationErrorBodySchema>;

// Status change ---------------------------------------------------------

export const ownerLeadStatusChangeRequestSchema = z
  .object({
    expectedStatus: z.enum(OWNER_LEAD_STATUS_VALUES),
    newStatus: z.enum(OWNER_LEAD_STATUS_VALUES),
    // Optional/nullable at the schema level (most transitions never need
    // it); the "required exactly when newStatus === 'lost'" rule is a
    // cross-field concern enforced below AND, independently, by the RPC's
    // own check against leads_lost_reason_matches_status — the browser
    // schema exists for fast/clear UX, not as the sole enforcement point.
    lostReason: z.string().max(300).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.newStatus === "lost" && (!value.lostReason || value.lostReason.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lostReason"], message: "A reason is required when marking a lead as lost." });
    }
  });
export type OwnerLeadStatusChangeRequest = z.infer<typeof ownerLeadStatusChangeRequestSchema>;

export const ownerLeadStatusChangeSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        changed: z.boolean(),
        status: z.enum(OWNER_LEAD_STATUS_VALUES),
        lostReason: z.string().nullable(),
        closedAt: z.string().nullable(),
        updatedAt: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadStatusChangeSuccessBody = z.infer<typeof ownerLeadStatusChangeSuccessBodySchema>;

export const ownerLeadStatusChangeResponseBodySchema = z.union([ownerLeadStatusChangeSuccessBodySchema, ownerLeadMutationErrorBodySchema]);
export type OwnerLeadStatusChangeResponseBody = z.infer<typeof ownerLeadStatusChangeResponseBodySchema>;

// Note creation -----------------------------------------------------------

export const OWNER_LEAD_NOTE_MAX_LENGTH = 2000;

export const ownerLeadNoteCreateRequestSchema = z
  .object({
    body: z.string().trim().min(1, "Note cannot be empty.").max(OWNER_LEAD_NOTE_MAX_LENGTH, "Note is too long."),
    // Client-generated once per logical note-composition attempt and resent
    // unchanged across a retry of that same attempt — the server-side
    // idempotency anchor (see add_lead_note_v1's own header comment).
    // Never reused across two intentionally-different notes.
    requestId: z.string().uuid(),
  })
  .strict();
export type OwnerLeadNoteCreateRequest = z.infer<typeof ownerLeadNoteCreateRequestSchema>;

export const ownerLeadNoteCreateSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        activityId: z.string().uuid(),
        note: z.string(),
        createdAt: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadNoteCreateSuccessBody = z.infer<typeof ownerLeadNoteCreateSuccessBodySchema>;

export const ownerLeadNoteCreateResponseBodySchema = z.union([ownerLeadNoteCreateSuccessBodySchema, ownerLeadMutationErrorBodySchema]);
export type OwnerLeadNoteCreateResponseBody = z.infer<typeof ownerLeadNoteCreateResponseBodySchema>;

// ---------------------------------------------------------------------------
// File-access response — deliberately minimal: only what a browser needs to
// fetch the file for the next 60 seconds, never storage_path or any
// bucket-internal detail.
// ---------------------------------------------------------------------------

export const OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS = 60;

export const ownerLeadFileAccessSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        url: z.string(),
        expiresInSeconds: z.literal(OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadFileAccessSuccessBody = z.infer<typeof ownerLeadFileAccessSuccessBodySchema>;

export const OWNER_LEAD_FILE_ACCESS_ERROR_CODES = ["VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", "INTERNAL_ERROR"] as const;
export type OwnerLeadFileAccessErrorCode = (typeof OWNER_LEAD_FILE_ACCESS_ERROR_CODES)[number];

export const ownerLeadFileAccessErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_FILE_ACCESS_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadFileAccessErrorBody = z.infer<typeof ownerLeadFileAccessErrorBodySchema>;

export const ownerLeadFileAccessResponseBodySchema = z.union([
  ownerLeadFileAccessSuccessBodySchema,
  ownerLeadFileAccessErrorBodySchema,
]);
export type OwnerLeadFileAccessResponseBody = z.infer<typeof ownerLeadFileAccessResponseBodySchema>;
