import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OWNER_LEAD_NOTE_MAX_LENGTH } from "@/lib/owner/owner-lead-detail-contract";
import type { OwnerLeadMutationOutcome } from "./use-owner-lead-mutations";

/**
 * CHECKPOINT C2J-E — the private note composer. Clears its text only on
 * confirmed success; a failed submission preserves exactly what the owner
 * typed so nothing is lost to a transient error. Submit is disabled while
 * empty/whitespace-only or already pending (the mutation hook's own
 * synchronous ref-lock is the backstop against a genuine double-click).
 */

export interface OwnerLeadNoteComposerProps {
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onAddNote: (body: string) => Promise<OwnerLeadMutationOutcome>;
  readonly onClearError: () => void;
}

export function OwnerLeadNoteComposer({ isSaving, error, onAddNote, onClearError }: OwnerLeadNoteComposerProps) {
  const [body, setBody] = useState("");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fieldId = useId();

  const trimmedLength = body.trim().length;
  const canSubmit = trimmedLength > 0 && trimmedLength <= OWNER_LEAD_NOTE_MAX_LENGTH && !isSaving;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSuccessMessage(null);
    const result = await onAddNote(body.trim());
    if (result.ok) {
      setBody("");
      setSuccessMessage("Note added.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId}>Add a private note</Label>
      <Textarea
        id={fieldId}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setSuccessMessage(null);
          onClearError();
        }}
        maxLength={OWNER_LEAD_NOTE_MAX_LENGTH}
        rows={3}
        disabled={isSaving}
        placeholder="Visible only to owner/staff — never shown to the customer."
        aria-describedby={`${fieldId}-hint`}
      />
      <div className="flex items-center justify-between">
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {body.length}/{OWNER_LEAD_NOTE_MAX_LENGTH} · Private — not visible to the customer
        </p>
        <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()} className="gap-1.5">
          {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSaving ? "Saving…" : "Add note"}
        </Button>
      </div>
      <div aria-live="polite" className="min-h-4 text-xs">
        {error ? <p className="text-destructive">{error}</p> : null}
        {!error && successMessage ? <p className="text-green-600 dark:text-green-500">{successMessage}</p> : null}
      </div>
    </div>
  );
}
