import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OWNER_LEAD_STATUS_VALUES, type OwnerLeadStatus } from "@/lib/owner/owner-leads-contract";
import { OWNER_LEAD_STATUS_LABELS } from "./owner-lead-format";
import type { OwnerLeadMutationOutcome } from "./use-owner-lead-mutations";

/**
 * CHECKPOINT C2J-E — the lead status control: a Select over the canonical
 * 9-value vocabulary (never invented/widened), a reason field that only
 * appears when 'lost' is selected (mirrors leads_lost_reason_matches_status),
 * a saving indicator, and double-submit prevention via the disabled Save
 * button (the mutation hook itself adds a synchronous ref-lock backstop).
 *
 * `currentStatus` is always resynced from a fresh server response (see the
 * useEffect below) — after a successful change OR a 409 conflict, the
 * parent re-fetches detail and this control's pending selection resets to
 * whatever the server now actually holds, so a stale/rejected selection is
 * never left dangling in the UI.
 */

const LOST_REASON_MAX_LENGTH = 300;

export interface OwnerLeadStatusControlProps {
  readonly currentStatus: OwnerLeadStatus;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onChangeStatus: (input: { expectedStatus: OwnerLeadStatus; newStatus: OwnerLeadStatus; lostReason: string | null }) => Promise<OwnerLeadMutationOutcome>;
  readonly onClearError: () => void;
}

export function OwnerLeadStatusControl({ currentStatus, isSaving, error, onChangeStatus, onClearError }: OwnerLeadStatusControlProps) {
  const [pendingStatus, setPendingStatus] = useState<OwnerLeadStatus>(currentStatus);
  const [lostReason, setLostReason] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const reasonFieldId = useId();

  useEffect(() => {
    setPendingStatus(currentStatus);
    setLostReason("");
  }, [currentStatus]);

  const hasChange = pendingStatus !== currentStatus;
  const needsReason = pendingStatus === "lost";
  const reasonIsBlank = lostReason.trim().length === 0;
  const canSave = hasChange && !isSaving && (!needsReason || !reasonIsBlank);

  async function handleSave() {
    if (!canSave) return;
    setSuccessMessage(null);
    const result = await onChangeStatus({
      expectedStatus: currentStatus,
      newStatus: pendingStatus,
      lostReason: needsReason ? lostReason.trim() : null,
    });
    if (result.ok) {
      setSuccessMessage(`Status updated to ${OWNER_LEAD_STATUS_LABELS[pendingStatus]}.`);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-lead-status-select">Status</Label>
          <Select
            value={pendingStatus}
            onValueChange={(value) => {
              setPendingStatus(value as OwnerLeadStatus);
              setSuccessMessage(null);
              onClearError();
            }}
            disabled={isSaving}
          >
            {/* CHECKPOINT OWNER DESKTOP CORRECTION — matte navy trigger/popover,
                matching every other operational control now; previously this
                already used the accessible Select primitive but with no
                dark styling of its own, which is what still read as a
                light popup breaking the approved system. */}
            <SelectTrigger
              id="owner-lead-status-select"
              className="w-56 rounded-xl border-white/15 bg-navy-deep/95 hover:border-white/25"
            >
              <SelectValue />
            </SelectTrigger>
            {/* CHECKPOINT OWNER DESKTOP CORRECTION (menu anchoring pass) —
                diagnosis: with the full 9-item list's natural height
                (~340px+), Radix's own collision avoidance correctly
                determined there wasn't enough room below the trigger and
                flipped the whole popover above it — which then floated far
                enough up to cover the Contact card. Capping the popover to
                a modest height (max 260px, still respecting the dynamic
                --radix-select-content-available-height var for genuinely
                short viewports via min()) means the list almost always
                fits below the trigger without needing to flip, and simply
                scrolls internally for the remaining items — anchored,
                on-screen, never covering content above it. */}
            {/* CHECKPOINT OWNER DESKTOP MICRO-POLISH — bg-navy-deep/95 left
                the popover 95% opaque, letting the Internal note textarea
                and other content beneath bleed through slightly; the
                --navy-deep token itself is a solid (non-alpha) colour, so
                dropping the /95 modifier makes this fully opaque while
                keeping the same restrained border + the shared primitive's
                own shadow-md — no glass/blur effect either way. */}
            <SelectContent
              sideOffset={4}
              className="max-h-[min(260px,var(--radix-select-content-available-height))] border-white/10 bg-navy-deep text-foreground"
            >
              {OWNER_LEAD_STATUS_VALUES.map((status) => (
                <SelectItem
                  key={status}
                  value={status}
                  className="text-foreground/85 focus:bg-copper/15 focus:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-copper-bright"
                >
                  {OWNER_LEAD_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!canSave} onClick={() => void handleSave()} className="gap-1.5">
          {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSaving ? "Saving…" : "Update status"}
        </Button>
      </div>

      {/* CHECKPOINT C2M-A — status is never auto-saved; a selected-but-not-
          yet-persisted change always shows this explicit, accessible
          indicator rather than silently sitting in the dropdown. Archived
          is called out in plain language here specifically so selecting it
          never reads as a delete action. */}
      {hasChange ? (
        <p role="status" className="text-xs font-medium text-copper-bright">
          Unsaved status change{pendingStatus === "archived" ? " — Archiving keeps the enquiry, just moves it out of the active Inbox." : "."}
        </p>
      ) : null}

      {needsReason ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={reasonFieldId}>Reason lead was lost</Label>
          <Textarea
            id={reasonFieldId}
            value={lostReason}
            onChange={(event) => {
              setLostReason(event.target.value);
              onClearError();
            }}
            maxLength={LOST_REASON_MAX_LENGTH}
            rows={2}
            disabled={isSaving}
            placeholder="e.g. Customer went with another buyer"
          />
          <p className="text-xs text-muted-foreground">{lostReason.length}/{LOST_REASON_MAX_LENGTH}</p>
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-4 text-xs">
        {error ? <p className="text-destructive">{error}</p> : null}
        {!error && successMessage ? <p className="text-green-600 dark:text-green-500">{successMessage}</p> : null}
      </div>
    </div>
  );
}
