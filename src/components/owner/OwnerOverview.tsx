import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { UseOwnerLeadOverviewResult } from "./use-owner-lead-overview";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  formatUaeDateTime,
} from "./owner-lead-format";
import type { OwnerLeadOverviewData } from "@/lib/owner/owner-lead-overview-contract";

/**
 * CHECKPOINT C2K — the /owner/overview page body. Purely presentational
 * (every piece of state comes from useOwnerLeadOverview, owned by the
 * route), matching OwnerLeadInbox.tsx's own established shape so a later
 * unified redesign can lift this component wholesale.
 *
 * No revenue, conversion, percentage, or forecast figures anywhere — only
 * literal counts already present in the owner-visible lead data, matching
 * this checkpoint's own scope.
 */
export interface OwnerOverviewProps extends UseOwnerLeadOverviewResult {}

function StatTile({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function BreakdownList({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly (readonly [label: string, count: number])[];
}) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="space-y-2">
        {entries.map(([label, count]) => (
          <li key={label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-copper" style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right text-xs font-medium text-foreground">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DailyCountsChart({ dailyCounts }: { readonly dailyCounts: OwnerLeadOverviewData["dailyCounts"] }) {
  const max = Math.max(1, ...dailyCounts.map((day) => day.count));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Enquiries per day (last 7 UAE days)</h3>
      <div className="flex items-end justify-between gap-2" style={{ height: "96px" }}>
        {dailyCounts.map((day) => (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-medium text-foreground">{day.count}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-copper"
                style={{ height: `${Math.max(4, (day.count / max) * 100)}%` }}
                aria-hidden="true"
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{day.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttentionReasonBadge({ reason }: { readonly reason: "stale" | "notification_attention" }) {
  return reason === "stale" ? (
    <Badge variant="outline" className="border-amber-500/40 text-amber-600">
      Stale 72h+
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      Notification attention
    </Badge>
  );
}

export function OwnerOverview({ state, refresh }: OwnerOverviewProps) {
  if (state.isLoading && !state.data) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.error && !state.data) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
        <p className="text-sm text-foreground">{state.error}</p>
        <Button type="button" variant="outline" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  const data = state.data;
  if (!data) return null;

  const statusEntries = Object.entries(OWNER_LEAD_STATUS_LABELS).map(
    ([status, label]) => [label, data.byStatus[status as keyof typeof data.byStatus] ?? 0] as const,
  );
  const intentEntries = Object.entries(OWNER_LEAD_INTENT_LABELS).map(
    ([intent, label]) => [label, data.byIntent[intent as keyof typeof data.byIntent] ?? 0] as const,
  );
  const materialEntries = Object.entries(OWNER_LEAD_MATERIAL_LABELS).map(
    ([material, label]) => [label, data.byMaterial[material as keyof typeof data.byMaterial] ?? 0] as const,
  );
  const channelEntries = Object.entries(OWNER_LEAD_CAPTURE_CHANNEL_LABELS).map(
    ([channel, label]) => [label, data.byCaptureChannel[channel as keyof typeof data.byCaptureChannel] ?? 0] as const,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Overview</h2>
          <Button asChild size="sm" variant="outline">
            <Link to="/owner">Enquiries</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Snapshot generated {formatUaeDateTime(data.generatedAt) ?? data.generatedAt}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total enquiries" value={data.totals.total} />
        <StatTile label="New" value={data.totals.new} />
        <StatTile label="Open" value={data.totals.open} />
        <StatTile label="Completed" value={data.totals.completed} />
      </div>

      <DailyCountsChart dailyCounts={data.dailyCounts} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BreakdownList title="Status" entries={statusEntries} />
        <BreakdownList title="Seller vs buyer" entries={intentEntries} />
        <BreakdownList title="Material" entries={materialEntries} />
        <BreakdownList title="Capture channel" entries={channelEntries} />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Needs attention</h3>
          <Badge variant="outline" className="border-amber-500/40 text-amber-600">
            Stale rule is provisional: open, no activity for {data.stale.thresholdHours}+ hours
          </Badge>
        </div>
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            Stale open leads: <strong className="text-foreground">{data.stale.count}</strong>
          </span>
          <span>
            Notification attention: <strong className="text-foreground">{data.attentionCount}</strong>
          </span>
        </div>

        {data.attentionLeads.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing needs attention right now.</p>
        ) : (
          <ul className="space-y-2">
            {data.attentionLeads.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span className="text-xs font-medium text-foreground">{lead.reference}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {OWNER_LEAD_STATUS_LABELS[lead.status]}
                  </Badge>
                  {lead.reasons.map((reason) => (
                    <AttentionReasonBadge key={reason} reason={reason} />
                  ))}
                  <span className="text-[11px] text-muted-foreground">{Math.floor(lead.hoursSinceActivity)}h since activity</span>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/owner/leads/$leadId" params={{ leadId: lead.id }}>
                    View
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
