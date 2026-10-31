/**
 * CHECKPOINT C2K — read-only owner overview aggregation. Same posture as
 * owner-leads.server.ts (this module's own established sibling): plain
 * server-side SELECTs via the service-role admin client, no RPC (a bounded
 * full-table aggregate over owner-visible leads is the smallest safe
 * implementation at this data volume — no migration/RPC needed), injected
 * deps for testability, pure aggregation function with no I/O.
 *
 * Security: never runs unless the caller (the API route) has already
 * confirmed an active, verified owner session — this module does not
 * re-check authorization, exactly like owner-leads.server.ts.
 *
 * Scope: owner-visible = submission_completed_at is not null (the same gate
 * the inbox already applies) — an incomplete website submission is invisible
 * here too.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_INTENT_VALUES,
  type OwnerLeadStatus,
  type OwnerLeadCaptureChannel,
  type OwnerLeadMaterial,
  type OwnerLeadIntent,
} from "@/lib/owner/owner-leads-contract";
import {
  isOwnerLeadClosedStatus,
  type OwnerLeadOverviewData,
  type OwnerOverviewAttentionReason,
} from "@/lib/owner/owner-lead-overview-contract";
import { deriveNotificationSummaryStatus } from "./owner-leads.server";

// ---------------------------------------------------------------------------
// Raw row shapes — defensively re-validated, never trusted blindly.
// ---------------------------------------------------------------------------

const overviewLeadRowSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  intent: z.enum(OWNER_LEAD_INTENT_VALUES),
  capture_channel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  created_at: z.string(),
  submission_completed_at: z.string(),
  // CHECKPOINT OWNER DESKTOP CORRECTION (Follow-ups row) — same
  // per-intent contact-name split as owner-leads.server.ts's own
  // LEADS_SELECT_COLUMNS/mapLeadRow (there is no single unified
  // "contact_name" column). Only selected/threaded into attentionLeads
  // below — every other aggregate in this file is unaffected.
  seller_name: z.string().nullable(),
  buyer_contact_person: z.string().nullable(),
});
export type OverviewLeadRow = z.infer<typeof overviewLeadRowSchema>;

const activityRowSchema = z.object({
  lead_id: z.string().uuid(),
  created_at: z.string(),
});

const notificationStatusRowSchema = z.object({
  lead_id: z.string().uuid(),
  status: z.string(),
});

export class OwnerLeadOverviewQueryError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "OwnerLeadOverviewQueryError";
  }
}

export interface OwnerLeadOverviewServiceDeps {
  /** Every owner-visible lead (submission_completed_at is not null) — no pagination; see module header for why a bounded full aggregate is the smallest safe implementation here. */
  queryOwnerVisibleLeads(): Promise<readonly OverviewLeadRow[]>;
  /** Most recent lead_activities.created_at per lead id, for exactly the given (open) lead ids. A lead with no row is simply absent — never an error. */
  queryLatestActivityAt(leadIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Keyed by lead_id, mirrors owner-leads.server.ts's own queryNotificationStatuses exactly (same table, same event_type filter). */
  queryNotificationStatuses(leadIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export function createProductionOwnerLeadOverviewServiceDeps(): OwnerLeadOverviewServiceDeps {
  const admin: SupabaseClient = createSupabaseAdminClient();
  return {
    async queryOwnerVisibleLeads() {
      // CHECKPOINT C2M-A — trashed leads are excluded from every Overview
      // aggregate by default (totals, breakdowns, daily counts, stale/
      // attention detection); archived leads remain fully included, since
      // Archived is a legitimate closed workflow outcome, not a removal.
      const { data, error } = await admin
        .from("leads")
        .select(
          "id, reference, status, intent, capture_channel, material, created_at, submission_completed_at, seller_name, buyer_contact_person",
        )
        .not("submission_completed_at", "is", null)
        .is("deleted_at", null);

      if (error) throw new OwnerLeadOverviewQueryError();

      const parsed = z.array(overviewLeadRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadOverviewQueryError();
      return parsed.data;
    },

    async queryLatestActivityAt(leadIds) {
      if (leadIds.length === 0) return new Map();

      const { data, error } = await admin
        .from("lead_activities")
        .select("lead_id, created_at")
        .in("lead_id", leadIds as string[])
        .order("created_at", { ascending: false });

      if (error) throw new OwnerLeadOverviewQueryError();

      const parsed = z.array(activityRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadOverviewQueryError();

      // Rows arrive newest-first (see .order() above); the first row seen
      // for a given lead_id is therefore its most recent activity — a plain
      // forward scan that never overwrites an already-set entry is enough,
      // no per-lead max() needed.
      const map = new Map<string, string>();
      for (const row of parsed.data) {
        if (!map.has(row.lead_id)) map.set(row.lead_id, row.created_at);
      }
      return map;
    },

    async queryNotificationStatuses(leadIds) {
      if (leadIds.length === 0) return new Map();

      const { data, error } = await admin
        .from("notification_deliveries")
        .select("lead_id, status")
        .eq("event_type", "submission_completed")
        .in("lead_id", leadIds as string[]);

      if (error) throw new OwnerLeadOverviewQueryError();

      const parsed = z.array(notificationStatusRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadOverviewQueryError();

      const map = new Map<string, string>();
      for (const row of parsed.data) map.set(row.lead_id, row.status);
      return map;
    },
  };
}

// ---------------------------------------------------------------------------
// UAE (Asia/Dubai) calendar-day bucketing — pure, no I/O. UAE has no DST, so
// pure UTC-anchored calendar-date arithmetic below is safe (each date key is
// computed from a real Intl Asia/Dubai conversion first; only the day-to-day
// stepping is done as UTC-midnight arithmetic on that already-correct key).
// ---------------------------------------------------------------------------

const UAE_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dubai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD calendar date in Asia/Dubai for a given instant. */
export function uaeDateKey(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return UAE_DATE_KEY_FORMATTER.format(date);
}

/** The last `n` Asia/Dubai calendar dates ending today (UAE "today", per `now`), oldest first. */
export function lastNUaeDateKeys(now: Date, n: number): readonly string[] {
  const todayKey = uaeDateKey(now);
  const parts = todayKey.split("-").map(Number);
  const [y, m, d] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const anchorMs = Date.UTC(y, m - 1, d);
  const dayMs = 24 * 60 * 60 * 1000;
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(anchorMs - i * dayMs);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    keys.push(`${yy}-${mm}-${dd}`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Pure aggregation — no I/O, exhaustively covers every canonical vocabulary
// value with 0 for a value that never occurs (an honest zero, never an
// absent key).
// ---------------------------------------------------------------------------

const STALE_THRESHOLD_HOURS = 72;
const MAX_ATTENTION_LEADS = 5;

function zeroCounts<K extends string>(values: readonly K[]): Record<K, number> {
  const record = {} as Record<K, number>;
  for (const value of values) record[value] = 0;
  return record;
}

export function computeOwnerLeadOverview(
  rows: readonly OverviewLeadRow[],
  latestActivityByLeadId: ReadonlyMap<string, string>,
  notificationStatusByLeadId: ReadonlyMap<string, string>,
  now: Date,
): OwnerLeadOverviewData {
  const byStatus = zeroCounts<OwnerLeadStatus>(OWNER_LEAD_STATUS_VALUES);
  const byIntent = zeroCounts<OwnerLeadIntent>(OWNER_LEAD_INTENT_VALUES);
  const byMaterial = zeroCounts<OwnerLeadMaterial>(OWNER_LEAD_MATERIAL_VALUES);
  const byCaptureChannel = zeroCounts<OwnerLeadCaptureChannel>(OWNER_LEAD_CAPTURE_CHANNEL_VALUES);

  const dailyDateKeys = lastNUaeDateKeys(now, 7);
  const dailyCountByKey = new Map<string, number>(dailyDateKeys.map((key) => [key, 0]));

  let openCount = 0;
  let completedCount = 0;

  interface AttentionCandidate {
    readonly id: string;
    readonly reference: string;
    readonly status: OwnerLeadStatus;
    readonly contactName: string | null;
    readonly material: OwnerLeadMaterial;
    readonly lastActivityAt: string;
    readonly hoursSinceActivity: number;
    readonly reasons: OwnerOverviewAttentionReason[];
  }
  const attentionByLeadId = new Map<string, AttentionCandidate>();
  let notificationAttentionCount = 0;

  for (const row of rows) {
    byStatus[row.status] += 1;
    byIntent[row.intent] += 1;
    byMaterial[row.material] += 1;
    byCaptureChannel[row.capture_channel] += 1;

    const isClosed = isOwnerLeadClosedStatus(row.status);
    if (!isClosed) openCount += 1;
    if (row.status === "completed") completedCount += 1;

    const dayKey = uaeDateKey(row.submission_completed_at);
    if (dailyCountByKey.has(dayKey)) {
      dailyCountByKey.set(dayKey, (dailyCountByKey.get(dayKey) ?? 0) + 1);
    }

    const notificationStatus = deriveNotificationSummaryStatus(
      notificationStatusByLeadId.get(row.id),
      row.capture_channel,
    );
    const isNotificationAttention = notificationStatus === "attention";
    if (isNotificationAttention) notificationAttentionCount += 1;

    const lastActivityAt = latestActivityByLeadId.get(row.id) ?? row.submission_completed_at;
    const hoursSinceActivity = (now.getTime() - new Date(lastActivityAt).getTime()) / (60 * 60 * 1000);
    const isStale = !isClosed && hoursSinceActivity >= STALE_THRESHOLD_HOURS;

    if (isStale || isNotificationAttention) {
      const reasons: OwnerOverviewAttentionReason[] = [];
      if (isStale) reasons.push("stale");
      if (isNotificationAttention) reasons.push("notification_attention");
      attentionByLeadId.set(row.id, {
        id: row.id,
        reference: row.reference,
        status: row.status,
        // Same per-intent contact-name split as owner-leads.server.ts's own mapLeadRow.
        contactName: row.intent === "sell" ? row.seller_name : row.buyer_contact_person,
        material: row.material,
        lastActivityAt,
        hoursSinceActivity,
        reasons,
      });
    }
  }

  const staleCount = Array.from(attentionByLeadId.values()).filter((candidate) => candidate.reasons.includes("stale")).length;

  const attentionLeads = Array.from(attentionByLeadId.values())
    .sort((a, b) => b.hoursSinceActivity - a.hoursSinceActivity)
    .slice(0, MAX_ATTENTION_LEADS);

  return {
    generatedAt: now.toISOString(),
    totals: {
      total: rows.length,
      new: byStatus.new,
      open: openCount,
      completed: completedCount,
    },
    byStatus,
    byIntent,
    byMaterial,
    byCaptureChannel,
    dailyCounts: dailyDateKeys.map((date) => ({ date, count: dailyCountByKey.get(date) ?? 0 })),
    stale: { thresholdHours: STALE_THRESHOLD_HOURS, count: staleCount },
    attentionCount: notificationAttentionCount,
    attentionLeads,
  };
}

/**
 * The one entry point the route calls: fetches every owner-visible lead,
 * fetches latest-activity/notification-status only for the open subset
 * (closed leads never need either for this aggregation), and reduces to the
 * final snapshot via computeOwnerLeadOverview.
 */
export async function getOwnerLeadOverview(deps: OwnerLeadOverviewServiceDeps, now: Date = new Date()): Promise<OwnerLeadOverviewData> {
  const rows = await deps.queryOwnerVisibleLeads();
  const openLeadIds = rows.filter((row) => !isOwnerLeadClosedStatus(row.status)).map((row) => row.id);
  const allLeadIds = rows.map((row) => row.id);

  const [latestActivityByLeadId, notificationStatusByLeadId] = await Promise.all([
    deps.queryLatestActivityAt(openLeadIds),
    deps.queryNotificationStatuses(allLeadIds),
  ]);

  return computeOwnerLeadOverview(rows, latestActivityByLeadId, notificationStatusByLeadId, now);
}
