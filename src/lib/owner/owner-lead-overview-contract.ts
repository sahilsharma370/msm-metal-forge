/**
 * CHECKPOINT C2K — the ONE canonical, browser-safe contract for the owner
 * overview response (`GET /api/owner/leads/overview`). Mirrors
 * owner-leads-contract.ts's own established shape exactly: shared
 * vocabularies imported (never re-declared), `.strict()` schemas so an
 * extra/forbidden field fails validation, a discriminated success/error
 * union, no server-only import.
 *
 * "Owner-visible" = submission_completed_at is not null (same completed-only
 * gate the inbox already applies) — an in-progress/never-completed website
 * submission is invisible here too, for the same reason it is invisible in
 * the inbox.
 */
import { z } from "zod";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_INTENT_VALUES,
} from "./owner-leads-contract";

// ---------------------------------------------------------------------------
// Closed/open status split — the single source of truth for this contract's
// consumers. Mirrors leads_closed_at_matches_status exactly (see
// 20260811165757_create_quote_backend_foundation.sql): closed = completed,
// lost, archived; open = every other canonical status. Never re-derived by
// hand anywhere else in owner-lead-overview code.
// ---------------------------------------------------------------------------

export const OWNER_LEAD_CLOSED_STATUS_VALUES = ["completed", "lost", "archived"] as const;
export type OwnerLeadClosedStatus = (typeof OWNER_LEAD_CLOSED_STATUS_VALUES)[number];

export function isOwnerLeadClosedStatus(status: string): boolean {
  return (OWNER_LEAD_CLOSED_STATUS_VALUES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/** zod's ZodRecord has no `.strict()` (that's ZodObject-only) — a record's exhaustiveness is instead proven by computeOwnerLeadOverview always populating every enum key with 0, and every test asserting the full key set. */
const statusCountsSchema = z.record(z.enum(OWNER_LEAD_STATUS_VALUES), z.number().int().nonnegative());
const intentCountsSchema = z.record(z.enum(OWNER_LEAD_INTENT_VALUES), z.number().int().nonnegative());
const materialCountsSchema = z.record(z.enum(OWNER_LEAD_MATERIAL_VALUES), z.number().int().nonnegative());
const captureChannelCountsSchema = z.record(z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES), z.number().int().nonnegative());

const ownerOverviewDailyCountSchema = z
  .object({
    /** Asia/Dubai calendar date, YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type OwnerOverviewDailyCount = z.infer<typeof ownerOverviewDailyCountSchema>;

/** Union member reason(s) a lead appears in attentionLeads — a lead can be both stale and notification-attention at once; never fabricated, always the true derived reason(s). */
export const OWNER_OVERVIEW_ATTENTION_REASON_VALUES = ["stale", "notification_attention"] as const;
export type OwnerOverviewAttentionReason = (typeof OWNER_OVERVIEW_ATTENTION_REASON_VALUES)[number];

/** Provisional stale-lead rule: an open lead (see isOwnerLeadClosedStatus) whose most recent lead_activities row (or, absent any, submission_completed_at) is 72+ hours old at request time. Always UI-labelled as provisional — see this checkpoint's own overview spec. */
const ownerOverviewStaleLeadSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string(),
    status: z.enum(OWNER_LEAD_STATUS_VALUES),
    /** ISO timestamp of the lead's most recent known activity (or submissionCompletedAt if it has none yet). */
    lastActivityAt: z.string(),
    hoursSinceActivity: z.number().nonnegative(),
    reasons: z.array(z.enum(OWNER_OVERVIEW_ATTENTION_REASON_VALUES)).min(1),
  })
  .strict();
export type OwnerOverviewStaleLead = z.infer<typeof ownerOverviewStaleLeadSchema>;

export const ownerLeadOverviewDataSchema = z
  .object({
    /** Server request time this snapshot was computed at (ISO), so the UI can label it rather than imply live data. */
    generatedAt: z.string(),
    totals: z
      .object({
        total: z.number().int().nonnegative(),
        new: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
      })
      .strict(),
    byStatus: statusCountsSchema,
    byIntent: intentCountsSchema,
    byMaterial: materialCountsSchema,
    byCaptureChannel: captureChannelCountsSchema,
    /** Exactly 7 entries, oldest first, one per Asia/Dubai calendar day ending today (UAE). */
    dailyCounts: z.array(ownerOverviewDailyCountSchema).length(7),
    stale: z
      .object({
        /** Provisional rule — see ownerOverviewStaleLeadSchema's own comment. */
        thresholdHours: z.literal(72),
        count: z.number().int().nonnegative(),
      })
      .strict(),
    attentionCount: z.number().int().nonnegative(),
    /** Up to 5 leads needing attention: the union of stale-open leads and genuine notification-attention leads, most urgent first. Never fabricated — empty when nothing qualifies. */
    attentionLeads: z.array(ownerOverviewStaleLeadSchema).max(5),
  })
  .strict();
export type OwnerLeadOverviewData = z.infer<typeof ownerLeadOverviewDataSchema>;

export const ownerLeadOverviewSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: ownerLeadOverviewDataSchema,
  })
  .strict();
export type OwnerLeadOverviewSuccessBody = z.infer<typeof ownerLeadOverviewSuccessBodySchema>;

export const OWNER_LEAD_OVERVIEW_ERROR_CODES = ["UNAUTHORIZED", "INTERNAL_ERROR"] as const;
export type OwnerLeadOverviewErrorCode = (typeof OWNER_LEAD_OVERVIEW_ERROR_CODES)[number];

export const ownerLeadOverviewErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_OVERVIEW_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadOverviewErrorBody = z.infer<typeof ownerLeadOverviewErrorBodySchema>;

export const ownerLeadOverviewResponseBodySchema = z.union([
  ownerLeadOverviewSuccessBodySchema,
  ownerLeadOverviewErrorBodySchema,
]);
export type OwnerLeadOverviewResponseBody = z.infer<typeof ownerLeadOverviewResponseBodySchema>;
