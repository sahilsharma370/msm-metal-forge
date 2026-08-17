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
            <SelectTrigger id="owner-lead-status-select" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OWNER_LEAD_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {OWNER_LEAD_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" disabled={!canSave} onClick={() => void handleSave()} className="gap-1.5">
          {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSaving ? "Saving…" : "Save status"}
        </Button>
      </div>

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
