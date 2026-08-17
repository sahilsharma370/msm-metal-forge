/**
 * CHECKPOINT C2J-B — the owner lead-detail read service: single-lead fetch,
 * seller/buyer branch mapping into the discriminated-union canonical shape,
 * file/activity listing, and notification-status derivation. Matches
 * owner-leads.server.ts's own established pattern exactly — validation +
 * types + business logic together, plain async functions injected as deps
 * (dispatch-notification.server.ts's own precedent), `.server.ts` suffix
 * for import protection.
 *
 * Read-only. This module never re-checks authorization — it trusts its
 * caller (the API route) to have already confirmed an active, verified
 * owner session, exactly like owner-leads.server.ts.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  type OwnerLeadCaptureChannel,
} from "@/lib/owner/owner-leads-contract";
import { deriveNotificationSummaryStatus } from "@/server/owner-leads/owner-leads.server";
import {
  OWNER_LEAD_QUANTITY_UNIT_VALUES,
  OWNER_LEAD_SELLER_CONDITION_VALUES,
  OWNER_LEAD_SELLER_PICKUP_REQUIRED_VALUES,
  OWNER_LEAD_PREFERRED_CONTACT_VALUES,
  OWNER_LEAD_BUYER_TRADE_REQUIREMENT_VALUES,
  OWNER_LEAD_BUYER_FULFILMENT_VALUES,
  OWNER_LEAD_BUYER_PREFERRED_PORT_VALUES,
  OWNER_LEAD_FILE_KIND_VALUES,
  OWNER_LEAD_FILE_MIME_TYPE_VALUES,
  OWNER_LEAD_FILE_UPLOAD_STATUS_VALUES,
  OWNER_LEAD_ACTIVITY_ACTOR_TYPE_VALUES,
  ownerLeadDetailActivityStatusChangeSchema,
  type OwnerLeadDetail,
  type OwnerLeadDetailFile,
  type OwnerLeadDetailActivity,
  type OwnerLeadDetailActivityStatusChange,
  type OwnerLeadDetailNotification,
} from "@/lib/owner/owner-lead-detail-contract";

/** A Supabase access token is never a valid leadId/fileId — both are always Postgres uuid primary keys. Reused by both this checkpoint's routes so `:leadId`/`:fileId` are never trusted unvalidated. */
export function isValidUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Raw row shapes — defensively re-validated, matching owner-leads.server.ts's
// own posture of never trusting a query result blindly.
// ---------------------------------------------------------------------------

const LEAD_DETAIL_SELECT_COLUMNS = [
  "id", "reference", "status", "intent", "capture_channel", "material",
  "material_subtype", "material_subtype_other_text", "material_other_text", "material_spec",
  "created_at", "submission_completed_at", "file_upload_status",
  "seller_quantity_value", "seller_quantity_unit", "seller_quantity_unit_other", "seller_quantity_unsure",
  "seller_condition", "seller_description", "seller_emirate", "seller_area", "seller_map_link",
  "seller_pickup_required", "seller_pickup_date", "seller_access_note",
  "seller_name", "seller_phone", "seller_company", "seller_email", "seller_preferred_contact", "seller_notes",
  "buyer_quantity_value", "buyer_quantity_unit", "buyer_quantity_unit_other", "buyer_trade_requirement",
  "buyer_required_by_date", "buyer_additional_spec", "buyer_destination_emirate", "buyer_destination_area",
  "buyer_destination_map_link", "buyer_fulfilment", "buyer_destination_country", "buyer_destination_city_port",
  "buyer_preferred_port", "buyer_preferred_port_other", "buyer_origin_country_preference",
  "buyer_logistics_requirement", "buyer_logistics_note",
  "buyer_company", "buyer_contact_person", "buyer_phone", "buyer_email", "buyer_preferred_contact", "buyer_notes",
].join(", ");

const leadDetailRowSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  intent: z.enum(["sell", "buy"]),
  capture_channel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  material_subtype: z.string().nullable(),
  material_subtype_other_text: z.string().nullable(),
  material_other_text: z.string().nullable(),
  material_spec: z.string().nullable(),
  created_at: z.string(),
  submission_completed_at: z.string().nullable(),
  file_upload_status: z.string(),
  seller_quantity_value: z.number().nullable(),
  seller_quantity_unit: z.enum(OWNER_LEAD_QUANTITY_UNIT_VALUES).nullable(),
  seller_quantity_unit_other: z.string().nullable(),
  seller_quantity_unsure: z.boolean(),
  seller_condition: z.enum(OWNER_LEAD_SELLER_CONDITION_VALUES).nullable(),
  seller_description: z.string().nullable(),
  seller_emirate: z.string().nullable(),
  seller_area: z.string().nullable(),
  seller_map_link: z.string().nullable(),
  seller_pickup_required: z.enum(OWNER_LEAD_SELLER_PICKUP_REQUIRED_VALUES).nullable(),
  seller_pickup_date: z.string().nullable(),
  seller_access_note: z.string().nullable(),
  seller_name: z.string().nullable(),
  seller_phone: z.string().nullable(),
  seller_company: z.string().nullable(),
  seller_email: z.string().nullable(),
  seller_preferred_contact: z.enum(OWNER_LEAD_PREFERRED_CONTACT_VALUES).nullable(),
  seller_notes: z.string().nullable(),
  buyer_quantity_value: z.number().nullable(),
  buyer_quantity_unit: z.enum(OWNER_LEAD_QUANTITY_UNIT_VALUES).nullable(),
  buyer_quantity_unit_other: z.string().nullable(),
  buyer_trade_requirement: z.enum(OWNER_LEAD_BUYER_TRADE_REQUIREMENT_VALUES).nullable(),
  buyer_required_by_date: z.string().nullable(),
  buyer_additional_spec: z.string().nullable(),
  buyer_destination_emirate: z.string().nullable(),
  buyer_destination_area: z.string().nullable(),
  buyer_destination_map_link: z.string().nullable(),
  buyer_fulfilment: z.enum(OWNER_LEAD_BUYER_FULFILMENT_VALUES).nullable(),
  buyer_destination_country: z.string().nullable(),
  buyer_destination_city_port: z.string().nullable(),
  buyer_preferred_port: z.enum(OWNER_LEAD_BUYER_PREFERRED_PORT_VALUES).nullable(),
  buyer_preferred_port_other: z.string().nullable(),
  buyer_origin_country_preference: z.string().nullable(),
  buyer_logistics_requirement: z.enum(OWNER_LEAD_BUYER_FULFILMENT_VALUES).nullable(),
  buyer_logistics_note: z.string().nullable(),
  buyer_company: z.string().nullable(),
  buyer_contact_person: z.string().nullable(),
  buyer_phone: z.string().nullable(),
  buyer_email: z.string().nullable(),
  buyer_preferred_contact: z.enum(OWNER_LEAD_PREFERRED_CONTACT_VALUES).nullable(),
  buyer_notes: z.string().nullable(),
});
export type LeadDetailRow = z.infer<typeof leadDetailRowSchema>;

const LEAD_FILES_SELECT_COLUMNS = ["id", "kind", "original_filename", "detected_mime_type", "byte_size", "uploaded_at", "upload_status", "created_at"].join(", ");

const leadFileRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(OWNER_LEAD_FILE_KIND_VALUES),
  original_filename: z.string(),
  detected_mime_type: z.enum(OWNER_LEAD_FILE_MIME_TYPE_VALUES),
  byte_size: z.number().int().positive(),
  uploaded_at: z.string().nullable(),
  upload_status: z.enum(OWNER_LEAD_FILE_UPLOAD_STATUS_VALUES),
  created_at: z.string(),
});
export type LeadFileRow = z.infer<typeof leadFileRowSchema>;

const LEAD_ACTIVITIES_SELECT_COLUMNS = ["id", "event_type", "actor_type", "metadata", "created_at"].join(", ");

const leadActivityRowSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  actor_type: z.enum(OWNER_LEAD_ACTIVITY_ACTOR_TYPE_VALUES),
  // Never surfaced to the browser as-is — mapLeadActivityRow below projects
  // only the two narrow, allowlisted fields (statusChange/noteBody) the
  // contract exposes. See the migration's own header comment for why
  // status/note content lives in this column rather than a new table.
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type LeadActivityRow = z.infer<typeof leadActivityRowSchema>;

const NOTIFICATION_DELIVERY_SELECT_COLUMNS = [
  "status", "attempt_count", "manual_requeue_count", "last_error_code", "last_error_at", "sent_at",
].join(", ");

const notificationDeliveryRowSchema = z.object({
  status: z.string(),
  attempt_count: z.number().int().nonnegative(),
  manual_requeue_count: z.number().int().nonnegative(),
  last_error_code: z.string().nullable(),
  last_error_at: z.string().nullable(),
  sent_at: z.string().nullable(),
});
export type NotificationDeliveryRow = z.infer<typeof notificationDeliveryRowSchema>;

// ---------------------------------------------------------------------------
// Injected DB access
// ---------------------------------------------------------------------------

export class OwnerLeadDetailQueryError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "OwnerLeadDetailQueryError";
  }
}

export interface OwnerLeadDetailServiceDeps {
  /** Returns null when no row exists for this id — never throws for a simple not-found. */
  queryLeadById(leadId: string): Promise<LeadDetailRow | null>;
  queryLeadFiles(leadId: string): Promise<readonly LeadFileRow[]>;
  queryLeadActivities(leadId: string): Promise<readonly LeadActivityRow[]>;
  /** Null when no delivery row exists yet for this lead — mapped to "attention" for a website lead (never a healthy default) or "not_required" for a non-website one (see deriveNotificationSummaryStatus's own comment in owner-leads.server.ts). */
  queryNotificationDelivery(leadId: string): Promise<NotificationDeliveryRow | null>;
}

export function createProductionOwnerLeadDetailServiceDeps(): OwnerLeadDetailServiceDeps {
  const admin: SupabaseClient = createSupabaseAdminClient();
  return {
    async queryLeadById(leadId) {
      const { data, error } = await admin.from("leads").select(LEAD_DETAIL_SELECT_COLUMNS).eq("id", leadId).maybeSingle();
      if (error) throw new OwnerLeadDetailQueryError();
      if (!data) return null;
      const parsed = leadDetailRowSchema.safeParse(data);
      if (!parsed.success) throw new OwnerLeadDetailQueryError();
      return parsed.data;
    },

    async queryLeadFiles(leadId) {
      const { data, error } = await admin
        .from("lead_files")
        .select(LEAD_FILES_SELECT_COLUMNS)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw new OwnerLeadDetailQueryError();
      const parsed = z.array(leadFileRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadDetailQueryError();
      return parsed.data;
    },

    async queryLeadActivities(leadId) {
      const { data, error } = await admin
        .from("lead_activities")
        .select(LEAD_ACTIVITIES_SELECT_COLUMNS)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw new OwnerLeadDetailQueryError();
      const parsed = z.array(leadActivityRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadDetailQueryError();
      return parsed.data;
    },

    async queryNotificationDelivery(leadId) {
      const { data, error } = await admin
        .from("notification_deliveries")
        .select(NOTIFICATION_DELIVERY_SELECT_COLUMNS)
        .eq("event_type", "submission_completed")
        .eq("lead_id", leadId)
        .maybeSingle();
      if (error) throw new OwnerLeadDetailQueryError();
      if (!data) return null;
      const parsed = notificationDeliveryRowSchema.safeParse(data);
      if (!parsed.success) throw new OwnerLeadDetailQueryError();
      return parsed.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping — pure, no I/O. Notification-status derivation reuses
// owner-leads.server.ts's deriveNotificationSummaryStatus directly rather
// than reimplementing the sent/pending/attention mapping a second time.
// ---------------------------------------------------------------------------

function mapLeadDetailRow(row: LeadDetailRow): OwnerLeadDetail {
  const common = {
    id: row.id,
    reference: row.reference,
    status: row.status,
    captureChannel: row.capture_channel,
    material: row.material,
    materialSubtype: row.material_subtype,
    materialSubtypeOtherText: row.material_subtype_other_text,
    materialOtherText: row.material_other_text,
    createdAt: row.created_at,
    submissionCompletedAt: row.submission_completed_at as string,
    fileUploadStatus: row.file_upload_status,
  };

  if (row.intent === "sell") {
    return {
      ...common,
      intent: "sell",
      contact: { name: row.seller_name, phone: row.seller_phone, email: row.seller_email, company: row.seller_company },
      location: { emirate: row.seller_emirate, area: row.seller_area, mapLink: row.seller_map_link },
      enquiry: {
        quantityValue: row.seller_quantity_value,
        quantityUnit: row.seller_quantity_unit,
        quantityUnitOther: row.seller_quantity_unit_other,
        quantityUnsure: row.seller_quantity_unsure,
        condition: row.seller_condition,
        description: row.seller_description,
        pickupRequired: row.seller_pickup_required,
        pickupDate: row.seller_pickup_date,
        accessNote: row.seller_access_note,
        preferredContact: row.seller_preferred_contact,
        notes: row.seller_notes,
      },
    };
  }

  return {
    ...common,
    intent: "buy",
    contact: { name: row.buyer_contact_person, phone: row.buyer_phone, email: row.buyer_email, company: row.buyer_company },
    location: { emirate: row.buyer_destination_emirate, area: row.buyer_destination_area, mapLink: row.buyer_destination_map_link },
    enquiry: {
      quantityValue: row.buyer_quantity_value,
      quantityUnit: row.buyer_quantity_unit,
      quantityUnitOther: row.buyer_quantity_unit_other,
      tradeRequirement: row.buyer_trade_requirement,
      requiredByDate: row.buyer_required_by_date,
      additionalSpec: row.buyer_additional_spec,
      destinationCountry: row.buyer_destination_country,
      destinationCityPort: row.buyer_destination_city_port,
      preferredPort: row.buyer_preferred_port,
      preferredPortOther: row.buyer_preferred_port_other,
      originCountryPreference: row.buyer_origin_country_preference,
      logisticsRequirement: row.buyer_logistics_requirement,
      logisticsNote: row.buyer_logistics_note,
      fulfilment: row.buyer_fulfilment,
      materialSpec: row.material_spec,
      preferredContact: row.buyer_preferred_contact,
      notes: row.buyer_notes,
    },
  };
}

function mapLeadFileRow(row: LeadFileRow): OwnerLeadDetailFile {
  return {
    id: row.id,
    kind: row.kind,
    originalFilename: row.original_filename,
    mimeType: row.detected_mime_type,
    byteSize: row.byte_size,
    uploadedAt: row.uploaded_at,
    uploadStatus: row.upload_status,
  };
}

/** Malformed/unexpected metadata shape never throws — it just yields no statusChange, matching this codebase's general defensive-parsing posture on stored JSON. */
function extractStatusChange(metadata: Record<string, unknown>): OwnerLeadDetailActivityStatusChange | null {
  const parsed = ownerLeadDetailActivityStatusChangeSchema.safeParse({
    from: metadata["from_status"],
    to: metadata["to_status"],
    reason: metadata["reason"] ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function extractNoteBody(metadata: Record<string, unknown>): string | null {
  const note = metadata["note"];
  return typeof note === "string" ? note : null;
}

function mapLeadActivityRow(row: LeadActivityRow): OwnerLeadDetailActivity {
  return {
    id: row.id,
    eventType: row.event_type,
    actorType: row.actor_type,
    createdAt: row.created_at,
    statusChange: row.event_type === "status_changed" ? extractStatusChange(row.metadata) : null,
    noteBody: row.event_type === "note_added" ? extractNoteBody(row.metadata) : null,
  };
}

function mapNotification(row: NotificationDeliveryRow | null, captureChannel: OwnerLeadCaptureChannel): OwnerLeadDetailNotification {
  return {
    status: deriveNotificationSummaryStatus(row?.status, captureChannel),
    attemptCount: row?.attempt_count ?? 0,
    manualRequeueCount: row?.manual_requeue_count ?? 0,
    lastErrorCode: row?.last_error_code ?? null,
    lastErrorAt: row?.last_error_at ?? null,
    sentAt: row?.sent_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type OwnerLeadDetailResult =
  | {
      readonly ok: true;
      readonly lead: OwnerLeadDetail;
      readonly files: readonly OwnerLeadDetailFile[];
      readonly activities: readonly OwnerLeadDetailActivity[];
      readonly notification: OwnerLeadDetailNotification;
    }
  | { readonly ok: false; readonly reason: "not_found" };

/**
 * The one entry point this checkpoint's detail route calls. A lead that
 * does not exist and a lead that exists but is not yet completed
 * (submission_completed_at IS NULL) are indistinguishable to the caller —
 * both return { ok: false, reason: "not_found" } — so the Manage detail
 * endpoint never reveals whether a hidden/incomplete lead exists.
 */
export async function getOwnerLeadDetail(leadId: string, deps: OwnerLeadDetailServiceDeps): Promise<OwnerLeadDetailResult> {
  const row = await deps.queryLeadById(leadId);
  if (!row || row.submission_completed_at === null) {
    return { ok: false, reason: "not_found" };
  }

  const [files, activities, notificationRow] = await Promise.all([
    deps.queryLeadFiles(leadId),
    deps.queryLeadActivities(leadId),
    deps.queryNotificationDelivery(leadId),
  ]);

  return {
    ok: true,
    lead: mapLeadDetailRow(row),
    files: files.map(mapLeadFileRow),
    activities: activities.map(mapLeadActivityRow),
    notification: mapNotification(notificationRow, row.capture_channel),
  };
}
