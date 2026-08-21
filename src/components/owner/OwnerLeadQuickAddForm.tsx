import { useId, useState } from "react";
import { ArrowLeft, Loader2, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
 * CHECKPOINT C2J-F / OWNER DESKTOP REFINEMENT — the owner Add enquiry form
 * (formerly labelled "Quick Add" — same route, same fields, same schema,
 * same save behaviour; only the visible label and presentation changed):
 * seller/buyer branching, required-field validation (gates the submit
 * button, never blocks typing), a double-submit lock owned by the parent
 * hook, and a success panel that shows the genuine server-issued reference
 * plus an explicit "Open enquiry" action. A failed submission never clears
 * anything the owner typed — this component's own field state is untouched
 * on error, and the mutation hook (see use-owner-lead-quick-add.ts) never
 * resets it either.
 *
 * This component now owns its own internal shell (scrollable fields region
 * + a static, non-sticky action footer) rather than relying on the whole
 * page to scroll — the exact same "header auto / body scrolls / footer
 * static sibling, never sticky-inside-scroll" architecture already fixed
 * for the public Get Quote Review step, applied here for the same reason:
 * a sticky-inside-scroll footer is what risks covering the final fields.
 */

/** Quote UI's current matte control recipe — solid `bg-navy-deep/95`, never a translucent glass tint, so a control stays readable on its own against the matte panel behind it. */
const INPUT_CLASS_NAME = "rounded-xl border-white/15 bg-navy-deep/95";

/**
 * CHECKPOINT C2M-A — the repository's own existing accessible Select
 * primitive (@/components/ui/select.tsx, Radix-based), matte-styled to
 * match every other Owner control — same recipe already established for
 * OwnerLeadFilters.tsx / OwnerLeadStatusControl.tsx. Replaces this form's
 * last remaining native `<select>` elements (unstylable OS options list).
 * No new dependency.
 */
const SELECT_TRIGGER_CLASS_NAME =
  "h-9 w-full min-w-0 rounded-xl border-white/15 bg-navy-deep/95 px-2.5 text-sm shadow-sm transition-colors hover:border-white/25 focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CONTENT_CLASS_NAME = "border-white/10 bg-navy-deep/95 text-foreground";
const SELECT_ITEM_CLASS_NAME =
  "text-foreground/85 focus:bg-copper/15 focus:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-copper-bright";
/** Radix Select never allows an item value of `""` (reserved for "no selection") — the two optional selects (unit, emirate) use this sentinel for their "—" placeholder option, translated back to an empty string in the same `update()` call the native version used. Filter/validation semantics are unchanged. */
const NONE_VALUE = "__none__";

export interface OwnerLeadQuickAddFormProps {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: OwnerLeadQuickAddFormValues) => Promise<OwnerLeadQuickAddOutcome>;
  readonly onClearError: () => void;
  readonly onOpenLead: (leadId: string) => void;
  /** Navigates back to the enquiries list without saving — used by both the top back-link and the footer's Cancel action, so this component never needs a real router import to stay trivially testable with plain fake props. */
  readonly onCancel: () => void;
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

/** Optional-field labels stay visually quieter than required ones — the established Quote UI convention (a muted, smaller "(optional)" suffix), so required fields carry the stronger hierarchy without needing their own extra marker. */
function FieldLabel({ htmlFor, children, optional }: { htmlFor: string; children: string; optional?: boolean }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground/90">
      {children}
      {optional ? <span className="ml-1 font-normal text-foreground/45">(optional)</span> : null}
    </Label>
  );
}

export function OwnerLeadQuickAddForm({ isSubmitting, error, onSubmit, onClearError, onOpenLead, onCancel }: OwnerLeadQuickAddFormProps) {
  const [fields, setFields] = useState<QuickAddFieldState>(INITIAL_FIELDS);
  const [success, setSuccess] = useState<{ leadId: string; reference: string } | null>(null);
  const fieldId = useId();

  function update<K extends keyof QuickAddFieldState>(key: K, value: QuickAddFieldState[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    onClearError();
  }

  const parsed = ownerLeadQuickAddFormValuesSchema.safeParse(toFormValues(fields));
  const canSubmit = parsed.success && !isSubmitting;
  const hasQuantity = fields.quantityValue.trim().length > 0;

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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-white/10 bg-navy-deep/95 px-6 py-7 text-center">
          <PlusCircle className="size-7 text-copper-bright" aria-hidden="true" />
          <div>
            <p className="font-display text-sm font-medium text-foreground">Enquiry recorded.</p>
            <p className="mt-1 font-mono text-sm text-foreground/70">{success.reference}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="brand" onClick={() => onOpenLead(success.leadId)}>
              Open enquiry
            </Button>
            <Button type="button" variant="outline" onClick={handleAddAnother}>
              Add another enquiry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <button
            type="button"
            onClick={onCancel}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to enquiries
          </button>

          <fieldset disabled={isSubmitting} className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-navy-deep/95 p-5 pb-8">
            <div className="flex flex-col gap-4">
              <p className="label-eyebrow text-copper-bright">Enquiry</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${fieldId}-intent`}>Enquiry type</FieldLabel>
                  <Select value={fields.intent} onValueChange={(value) => update("intent", value as QuickAddFieldState["intent"])}>
                    <SelectTrigger id={`${fieldId}-intent`} className={SELECT_TRIGGER_CLASS_NAME}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                      {OWNER_LEAD_INTENT_VALUES.map((value) => (
                        <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                          {OWNER_LEAD_INTENT_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${fieldId}-channel`}>How it came in</FieldLabel>
                  <Select value={fields.channel} onValueChange={(value) => update("channel", value as QuickAddFieldState["channel"])}>
                    <SelectTrigger id={`${fieldId}-channel`} className={SELECT_TRIGGER_CLASS_NAME}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                      {QUICK_ADD_CHANNEL_VALUES.map((value) => (
                        <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                          {OWNER_LEAD_CAPTURE_CHANNEL_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
              <p className="label-eyebrow text-copper-bright">Contact</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${fieldId}-contact-name`}>Contact name</FieldLabel>
                  <Input
                    className={INPUT_CLASS_NAME}
                    id={`${fieldId}-contact-name`}
                    value={fields.contactName}
                    onChange={(event) => update("contactName", event.target.value)}
                    placeholder="Full name"
                    maxLength={120}
                    autoCapitalize="words"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${fieldId}-contact-phone`}>Phone / WhatsApp number</FieldLabel>
                  <Input
                    className={INPUT_CLASS_NAME}
                    id={`${fieldId}-contact-phone`}
                    value={fields.contactPhone}
                    onChange={(event) => update("contactPhone", event.target.value)}
                    placeholder="+971 5X XXX XXXX"
                    inputMode="tel"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
              <p className="label-eyebrow text-copper-bright">Material &amp; quantity</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${fieldId}-material`}>Material</FieldLabel>
                  <Select value={fields.material} onValueChange={(value) => update("material", value as QuickAddFieldState["material"])}>
                    <SelectTrigger id={`${fieldId}-material`} className={SELECT_TRIGGER_CLASS_NAME}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                      {OWNER_LEAD_MATERIAL_VALUES.map((value) => (
                        <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                          {OWNER_LEAD_MATERIAL_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {fields.material === "other" ? (
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-material-other`}>Describe the material</FieldLabel>
                    <Input
                      className={INPUT_CLASS_NAME}
                      id={`${fieldId}-material-other`}
                      value={fields.materialOtherText}
                      onChange={(event) => update("materialOtherText", event.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                ) : null}
              </div>

              {/* Quantity + unit read as one logical field group: a single
                  inset sub-panel, rather than three independent grid cells,
                  so they visually belong together. The unit control (and its
                  label) dims until a quantity is actually entered — purely
                  presentational, never disabled — so an unrelated unit
                  selection can't appear meaningful while quantity is still
                  empty; validation semantics are unchanged (a unit alone
                  remains perfectly valid to save, exactly as before). */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="mb-3 text-xs font-medium text-foreground/60">Quantity</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-quantity-value`} optional>
                      Amount
                    </FieldLabel>
                    <Input
                      className={INPUT_CLASS_NAME}
                      id={`${fieldId}-quantity-value`}
                      type="number"
                      min={0}
                      step="any"
                      value={fields.quantityValue}
                      onChange={(event) => update("quantityValue", event.target.value)}
                    />
                  </div>
                  <div className={`flex flex-col gap-1.5 transition-opacity ${hasQuantity ? "" : "opacity-50"}`}>
                    <FieldLabel htmlFor={`${fieldId}-quantity-unit`}>Unit</FieldLabel>
                    <Select
                      value={fields.quantityUnit || NONE_VALUE}
                      onValueChange={(value) =>
                        update("quantityUnit", value === NONE_VALUE ? "" : (value as QuickAddFieldState["quantityUnit"]))
                      }
                    >
                      <SelectTrigger id={`${fieldId}-quantity-unit`} className={SELECT_TRIGGER_CLASS_NAME}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                        <SelectItem value={NONE_VALUE} className={SELECT_ITEM_CLASS_NAME}>
                          —
                        </SelectItem>
                        {QUICK_ADD_QUANTITY_UNIT_VALUES.map((value) => (
                          <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                            {UNIT_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {fields.quantityUnit === "other" ? (
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor={`${fieldId}-quantity-unit-other`}>Describe the unit</FieldLabel>
                      <Input
                        className={INPUT_CLASS_NAME}
                        id={`${fieldId}-quantity-unit-other`}
                        value={fields.quantityUnitOther}
                        onChange={(event) => update("quantityUnitOther", event.target.value)}
                        maxLength={60}
                        required
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {fields.intent === "sell" ? (
              <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
                <p className="label-eyebrow text-copper-bright">Location</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-seller-emirate`} optional>
                      Emirate
                    </FieldLabel>
                    <Select
                      value={fields.sellerEmirate || NONE_VALUE}
                      onValueChange={(value) =>
                        update("sellerEmirate", value === NONE_VALUE ? "" : (value as QuickAddFieldState["sellerEmirate"]))
                      }
                    >
                      <SelectTrigger id={`${fieldId}-seller-emirate`} className={SELECT_TRIGGER_CLASS_NAME}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                        <SelectItem value={NONE_VALUE} className={SELECT_ITEM_CLASS_NAME}>
                          —
                        </SelectItem>
                        {QUICK_ADD_EMIRATE_VALUES.map((value) => (
                          <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                            {EMIRATE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-seller-area`} optional>
                      Area
                    </FieldLabel>
                    <Input
                      className={INPUT_CLASS_NAME}
                      id={`${fieldId}-seller-area`}
                      value={fields.sellerArea}
                      onChange={(event) => update("sellerArea", event.target.value)}
                      maxLength={150}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
              <p className="label-eyebrow text-copper-bright">Internal note</p>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={`${fieldId}-notes`} optional>
                  Notes
                </FieldLabel>
                <Textarea
                  className={INPUT_CLASS_NAME}
                  id={`${fieldId}-notes`}
                  value={fields.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  rows={3}
                  maxLength={QUICK_ADD_NOTES_MAX_LENGTH}
                  aria-describedby={`${fieldId}-notes-hint`}
                />
                <p id={`${fieldId}-notes-hint`} className="text-xs text-foreground/50">
                  Use this for specifications, logistics or other details collected during the conversation.
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      {/* Static action footer — a plain sibling of the scrollable fields
          region above (never `position: sticky` inside it), so it can never
          end up covering the final fields or a validation error.
          paddingBottom is a floor (18px) plus the device's safe-area inset
          stacked on top — never the inset alone, which resolves to 0px on
          any non-notched device/browser and previously left the buttons
          flush against the viewport edge. */}
      <div
        className="flex shrink-0 items-center border-t border-white/10 bg-navy-deep/95 px-4 pt-[18px]"
        style={{ paddingBottom: "calc(18px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="min-h-4 text-xs">
            {error ? <p className="text-destructive">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!canSubmit} className="gap-1.5">
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isSubmitting ? "Saving…" : "Save enquiry"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
