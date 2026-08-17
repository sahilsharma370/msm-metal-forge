import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, MapPin, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OwnerLeadListItem as OwnerLeadListItemType } from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  OWNER_NOTIFICATION_STATUS_LABELS,
  formatQuantity,
  formatUaeDateTime,
} from "./owner-lead-format";

/**
 * CHECKPOINT C2J-D — a single inbox row. A real `<a>` (via TanStack
 * `Link`), never a clickable `<div>`, so it is keyboard-reachable and
 * screen-reader-announced as a link on its own. The notification-attention
 * state is always icon + text together (never a color-only chip) — see
 * NOTIFICATION_ICONS below.
 */

const NOTIFICATION_ICONS = {
  sent: CheckCircle2,
  pending: Clock,
  attention: AlertTriangle,
} as const;

const NOTIFICATION_BADGE_VARIANT = {
  sent: "outline",
  pending: "outline",
  attention: "destructive",
} as const;

export interface OwnerLeadListItemProps {
  readonly lead: OwnerLeadListItemType;
}

export function OwnerLeadListItem({ lead }: OwnerLeadListItemProps) {
  const NotificationIcon = NOTIFICATION_ICONS[lead.notificationStatus];
  const quantity = formatQuantity(lead.quantity.value, lead.quantity.unit);
  const location = [lead.location.area, lead.location.emirate].filter(Boolean).join(", ");
  const submitted = formatUaeDateTime(lead.submissionCompletedAt);
  const materialLine = [OWNER_LEAD_MATERIAL_LABELS[lead.material], lead.materialSubtype].filter(Boolean).join(" — ");

  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/owner/leads/$leadId"
        params={{ leadId: lead.id }}
        className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{lead.reference}</span>
            <Badge variant={lead.intent === "sell" ? "default" : "secondary"} className="text-[10px]">
              {OWNER_LEAD_INTENT_LABELS[lead.intent]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {OWNER_LEAD_STATUS_LABELS[lead.status]}
            </Badge>
          </div>
          <p className="truncate text-sm font-medium text-foreground">{lead.contact.name ?? "No name provided"}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {lead.contact.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" aria-hidden="true" />
                {lead.contact.phone}
              </span>
            ) : null}
            <span>{materialLine}</span>
            {quantity ? <span>{quantity}</span> : null}
            {location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {location}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          <Badge variant={NOTIFICATION_BADGE_VARIANT[lead.notificationStatus]} className="inline-flex items-center gap-1 text-[10px]">
            <NotificationIcon className="size-3" aria-hidden="true" />
            {OWNER_NOTIFICATION_STATUS_LABELS[lead.notificationStatus]}
          </Badge>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>{OWNER_LEAD_CAPTURE_CHANNEL_LABELS[lead.captureChannel]}</p>
            {submitted ? <p>{submitted}</p> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
