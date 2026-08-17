import { useId, useState } from "react";
import { Loader2, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OWNER_LEAD_INTENT_VALUES, OWNER_LEAD_MATERIAL_VALUES } from "@/lib/owner/owner-leads-contract";
import {
  QUICK_ADD_CHANNEL_VALUES,
  QUICK_ADD_QUANTITY_UNIT_VALUES,
  QUICK_ADD_EMIRATE_VALUES,
  QUICK_ADD_NOTES_MAX_LENGTH,
  ownerLeadQuickAddFormValuesSchema,
  type OwnerLeadQuickAddFormValues,
} from "@/lib/owner/owner-lead-quick-add-contract";
import { OWNER_LEAD_INTENT_LABELS, OWNER_LEAD_MATERIAL_LABELS, OWNER_LEAD_CAPTURE_CHANNEL_LABELS } from "./owner-lead-format";
import { UNIT_LABELS, EMIRATE_LABELS } from "@/components/site/quote/quote-options";
import type { OwnerLeadQuickAddOutcome } from "./use-owner-lead-quick-add";

/**
 * CHECKPOINT C2J-F — the owner Quick Add form: seller/buyer branching,
 * required-field validation (gates the submit button, never blocks typing),
 * a double-submit lock owned by the parent hook, and a success panel that
 * shows the genuine server-issued reference plus an explicit "Open
 * enquiry" action. A failed submission never clears anything the owner
 * typed — this component's own field state is untouched on error, and the
 * mutation hook (see use-owner-lead-quick-add.ts) never resets it either.
 */

const SELECT_CLASS_NAME =
  "flex h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export interface OwnerLeadQuickAddFormProps {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: OwnerLeadQuickAddFormValues) => Promise<OwnerLeadQuickAddOutcome>;
  readonly onClearError: () => void;
  readonly onOpenLead: (leadId: string) => void;
}

interface QuickAddFieldState {
  intent: (typeof OWNER_LEAD_INTENT_VALUES)[number];
  channel: (typeof QUICK_ADD_CHANNEL_VALUES)[number];
  material: (typeof OWNER_LEAD_MATERIAL_VALUES)[number];
  materialOtherText: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  quantityValue: string;
  quantityUnit: (typeof QUICK_ADD_QUANTITY_UNIT_VALUES)[number] | "";
  quantityUnitOther: string;
  sellerEmirate: (typeof QUICK_ADD_EMIRATE_VALUES)[number] | "";
  sellerArea: string;
}

const INITIAL_FIELDS: QuickAddFieldState = {
  intent: "sell",
  channel: "phone",
  material: "copper",
  materialOtherText: "",
  contactName: "",
  contactPhone: "",
  notes: "",
  quantityValue: "",
  quantityUnit: "",
  quantityUnitOther: "",
  sellerEmirate: "",
  sellerArea: "",
};

function toFormValues(fields: QuickAddFieldState): unknown {
  return {
    intent: fields.intent,
    channel: fields.channel,
    material: fields.material,
    materialOtherText: fields.materialOtherText.trim() || undefined,
    contactName: fields.contactName,
    contactPhone: fields.contactPhone,
    notes: fields.notes.trim() || undefined,
    quantityValue: fields.quantityValue.trim() ? Number(fields.quantityValue) : undefined,
    quantityUnit: fields.quantityUnit || undefined,
    quantityUnitOther: fields.quantityUnitOther.trim() || undefined,
    sellerEmirate: fields.intent === "sell" ? fields.sellerEmirate || undefined : undefined,
    sellerArea: fields.intent === "sell" ? fields.sellerArea.trim() || undefined : undefined,
  };
}

export function OwnerLeadQuickAddForm({ isSubmitting, error, onSubmit, onClearError, onOpenLead }: OwnerLeadQuickAddFormProps) {
  const [fields, setFields] = useState<QuickAddFieldState>(INITIAL_FIELDS);
  const [success, setSuccess] = useState<{ leadId: string; reference: string } | null>(null);
  const fieldId = useId();

  function update<K extends keyof QuickAddFieldState>(key: K, value: QuickAddFieldState[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    onClearError();
  }

  const parsed = ownerLeadQuickAddFormValuesSchema.safeParse(toFormValues(fields));
  const canSubmit = parsed.success && !isSubmitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed.success || isSubmitting) return;
    const result = await onSubmit(parsed.data);
    if (result.ok) {
      setSuccess({ leadId: result.leadId, reference: result.reference });
    }
  }

  function handleAddAnother() {
    setSuccess(null);
    setFields(INITIAL_FIELDS);
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card/40 px-4 py-10 text-center">
        <PlusCircle className="size-8 text-copper-bright" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Enquiry recorded.</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{success.reference}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => onOpenLead(success.leadId)}>
            Open enquiry
          </Button>
          <Button type="button" variant="outline" onClick={handleAddAnother}>
            Add another enquiry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5" noValidate>
      <fieldset disabled={isSubmitting} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-intent`}>Enquiry type</Label>
            <select
              id={`${fieldId}-intent`}
              className={SELECT_CLASS_NAME}
              value={fields.intent}
              onChange={(event) => update("intent", event.target.value as QuickAddFieldState["intent"])}
            >
              {OWNER_LEAD_INTENT_VALUES.map((value) => (
                <option key={value} value={value}>
                  {OWNER_LEAD_INTENT_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-channel`}>How it came in</Label>
            <select
              id={`${fieldId}-channel`}
              className={SELECT_CLASS_NAME}
              value={fields.channel}
              onChange={(event) => update("channel", event.target.value as QuickAddFieldState["channel"])}
            >
              {QUICK_ADD_CHANNEL_VALUES.map((value) => (
                <option key={value} value={value}>
                  {OWNER_LEAD_CAPTURE_CHANNEL_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-contact-name`}>Contact name</Label>
            <Input
              id={`${fieldId}-contact-name`}
              value={fields.contactName}
              onChange={(event) => update("contactName", event.target.value)}
              placeholder="Full name"
              maxLength={120}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-contact-phone`}>Phone / WhatsApp number</Label>
            <Input
              id={`${fieldId}-contact-phone`}
              value={fields.contactPhone}
              onChange={(event) => update("contactPhone", event.target.value)}
              placeholder="+971 5X XXX XXXX"
              inputMode="tel"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-material`}>Material</Label>
            <select
              id={`${fieldId}-material`}
              className={SELECT_CLASS_NAME}
              value={fields.material}
              onChange={(event) => update("material", event.target.value as QuickAddFieldState["material"])}
            >
              {OWNER_LEAD_MATERIAL_VALUES.map((value) => (
                <option key={value} value={value}>
                  {OWNER_LEAD_MATERIAL_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {fields.material === "other" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-material-other`}>Describe the material</Label>
              <Input
                id={`${fieldId}-material-other`}
                value={fields.materialOtherText}
                onChange={(event) => update("materialOtherText", event.target.value)}
                maxLength={200}
                required
              />
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-quantity-value`}>Quantity (optional)</Label>
            <Input
              id={`${fieldId}-quantity-value`}
              type="number"
              min={0}
              step="any"
              value={fields.quantityValue}
              onChange={(event) => update("quantityValue", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-quantity-unit`}>Unit</Label>
            <select
              id={`${fieldId}-quantity-unit`}
              className={SELECT_CLASS_NAME}
              value={fields.quantityUnit}
              onChange={(event) => update("quantityUnit", event.target.value as QuickAddFieldState["quantityUnit"])}
            >
              <option value="">—</option>
              {QUICK_ADD_QUANTITY_UNIT_VALUES.map((value) => (
                <option key={value} value={value}>
                  {UNIT_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          {fields.quantityUnit === "other" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-quantity-unit-other`}>Describe the unit</Label>
              <Input
                id={`${fieldId}-quantity-unit-other`}
                value={fields.quantityUnitOther}
                onChange={(event) => update("quantityUnitOther", event.target.value)}
                maxLength={60}
                required
              />
            </div>
          ) : null}
        </div>

        {fields.intent === "sell" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-seller-emirate`}>Emirate (optional)</Label>
              <select
                id={`${fieldId}-seller-emirate`}
                className={SELECT_CLASS_NAME}
                value={fields.sellerEmirate}
                onChange={(event) => update("sellerEmirate", event.target.value as QuickAddFieldState["sellerEmirate"])}
              >
                <option value="">—</option>
                {QUICK_ADD_EMIRATE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {EMIRATE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-seller-area`}>Area (optional)</Label>
              <Input
                id={`${fieldId}-seller-area`}
                value={fields.sellerArea}
                onChange={(event) => update("sellerArea", event.target.value)}
                maxLength={150}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-notes`}>Notes (optional)</Label>
          <Textarea
            id={`${fieldId}-notes`}
            value={fields.notes}
            onChange={(event) => update("notes", event.target.value)}
            rows={3}
            maxLength={QUICK_ADD_NOTES_MAX_LENGTH}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div aria-live="polite" className="min-h-4 text-xs">
            {error ? <p className="text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" disabled={!canSubmit} className="gap-1.5">
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isSubmitting ? "Saving…" : "Save enquiry"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
