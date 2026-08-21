import { useId, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OWNER_LEAD_MATERIAL_VALUES, type OwnerLeadIntent } from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_EDIT_QUANTITY_UNIT_VALUES,
  OWNER_LEAD_EDIT_EMIRATE_VALUES,
  OWNER_LEAD_EDIT_NOTES_MAX_LENGTH,
  ownerLeadEditFormValuesSchema,
  type OwnerLeadEditFormValues,
} from "@/lib/owner/owner-lead-detail-contract";
import { OWNER_LEAD_MATERIAL_LABELS } from "./owner-lead-format";
import { UNIT_LABELS, EMIRATE_LABELS } from "@/components/site/quote/quote-options";

/**
 * Owner "Edit enquiry" — a prefilled correction form for an existing lead's
 * editable business fields, following OwnerLeadQuickAddForm's own visual
 * language exactly (same matte-navy input/select recipe, same "header auto
 * / body scrolls / footer static sibling, never sticky-inside-scroll"
 * shell) but for a narrower, edit-only field set: no intent/channel (both
 * immutable here), and emirate/area only for a seller lead — see
 * update_lead_details_v1's own header comment for why buyer-branch
 * destination location stays out of scope, matching Quick Add's own
 * established precedent.
 *
 * Owns no submission identity/idempotency concerns of its own (unlike Quick
 * Add's requestId dance) — a straight correction has no "retry the same
 * logical attempt" concept beyond the parent hook's own synchronous
 * double-submit guard.
 */

const INPUT_CLASS_NAME = "rounded-xl border-white/15 bg-navy-deep/95";
const SELECT_TRIGGER_CLASS_NAME =
  "h-9 w-full min-w-0 rounded-xl border-white/15 bg-navy-deep/95 px-2.5 text-sm shadow-sm transition-colors hover:border-white/25 focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const SELECT_CONTENT_CLASS_NAME = "border-white/10 bg-navy-deep/95 text-foreground";
const SELECT_ITEM_CLASS_NAME =
  "text-foreground/85 focus:bg-copper/15 focus:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-copper-bright";
/** Radix Select never allows an item value of `""` (reserved for "no selection") — matches OwnerLeadQuickAddForm's own NONE_VALUE sentinel exactly. */
const NONE_VALUE = "__none__";

export interface OwnerLeadEditFieldState {
  contactName: string;
  contactPhone: string;
  material: (typeof OWNER_LEAD_MATERIAL_VALUES)[number];
  materialOtherText: string;
  quantityValue: string;
  quantityUnit: (typeof OWNER_LEAD_EDIT_QUANTITY_UNIT_VALUES)[number] | "";
  quantityUnitOther: string;
  emirate: (typeof OWNER_LEAD_EDIT_EMIRATE_VALUES)[number] | "";
  area: string;
  notes: string;
}

export function buildOwnerLeadEditFieldState(initial: {
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly material: (typeof OWNER_LEAD_MATERIAL_VALUES)[number];
  readonly materialOtherText: string | null;
  readonly quantityValue: number | null;
  readonly quantityUnit: string | null;
  readonly quantityUnitOther: string | null;
  readonly emirate: string | null;
  readonly area: string | null;
  readonly notes: string | null;
}): OwnerLeadEditFieldState {
  return {
    contactName: initial.contactName ?? "",
    contactPhone: initial.contactPhone ?? "",
    material: initial.material,
    materialOtherText: initial.materialOtherText ?? "",
    quantityValue: initial.quantityValue !== null ? String(initial.quantityValue) : "",
    quantityUnit: (initial.quantityUnit as OwnerLeadEditFieldState["quantityUnit"]) ?? "",
    quantityUnitOther: initial.quantityUnitOther ?? "",
    emirate: (initial.emirate as OwnerLeadEditFieldState["emirate"]) ?? "",
    area: initial.area ?? "",
    notes: initial.notes ?? "",
  };
}

function toFormValues(fields: OwnerLeadEditFieldState, intent: OwnerLeadIntent): unknown {
  return {
    contactName: fields.contactName,
    contactPhone: fields.contactPhone,
    material: fields.material,
    materialOtherText: fields.materialOtherText.trim() || undefined,
    quantityValue: fields.quantityValue.trim() ? Number(fields.quantityValue) : undefined,
    quantityUnit: fields.quantityUnit || undefined,
    quantityUnitOther: fields.quantityUnitOther.trim() || undefined,
    emirate: intent === "sell" ? fields.emirate || undefined : undefined,
    area: intent === "sell" ? fields.area.trim() || undefined : undefined,
    notes: fields.notes.trim() || undefined,
  };
}

/** Field-by-field comparison against the prefilled snapshot — the Save button's real "genuinely changed" gate. Compares the same normalized shape validation itself parses from, so a value that round-trips identically (e.g. re-typing the same name) is correctly seen as unchanged. */
function isDirty(fields: OwnerLeadEditFieldState, initial: OwnerLeadEditFieldState, intent: OwnerLeadIntent): boolean {
  if (fields.contactName.trim() !== initial.contactName.trim()) return true;
  if (fields.contactPhone.trim() !== initial.contactPhone.trim()) return true;
  if (fields.material !== initial.material) return true;
  if (fields.materialOtherText.trim() !== initial.materialOtherText.trim()) return true;
  if (fields.quantityValue.trim() !== initial.quantityValue.trim()) return true;
  if (fields.quantityUnit !== initial.quantityUnit) return true;
  if (fields.quantityUnitOther.trim() !== initial.quantityUnitOther.trim()) return true;
  if (fields.notes.trim() !== initial.notes.trim()) return true;
  if (intent === "sell") {
    if (fields.emirate !== initial.emirate) return true;
    if (fields.area.trim() !== initial.area.trim()) return true;
  }
  return false;
}

export interface OwnerLeadEditFormProps {
  readonly intent: OwnerLeadIntent;
  readonly reference: string;
  readonly initialFields: OwnerLeadEditFieldState;
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: OwnerLeadEditFormValues) => Promise<{ readonly ok: boolean }>;
  readonly onClearError: () => void;
  readonly onCancel: () => void;
}

function FieldLabel({ htmlFor, children, optional }: { htmlFor: string; children: string; optional?: boolean }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground/90">
      {children}
      {optional ? <span className="ml-1 font-normal text-foreground/45">(optional)</span> : null}
    </Label>
  );
}

export function OwnerLeadEditForm({ intent, reference, initialFields, isSubmitting, error, onSubmit, onClearError, onCancel }: OwnerLeadEditFormProps) {
  const [fields, setFields] = useState<OwnerLeadEditFieldState>(initialFields);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const fieldId = useId();

  function update<K extends keyof OwnerLeadEditFieldState>(key: K, value: OwnerLeadEditFieldState[K]) {
    setFields((previous) => ({ ...previous, [key]: value }));
    onClearError();
  }

  const parsed = ownerLeadEditFormValuesSchema.safeParse(toFormValues(fields, intent));
  const dirty = isDirty(fields, initialFields, intent);
  const canSubmit = parsed.success && dirty && !isSubmitting;
  const hasQuantity = fields.quantityValue.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed.success || !dirty || isSubmitting) return;
    await onSubmit(parsed.data);
  }

  function handleCancelClick() {
    if (dirty) {
      setDiscardDialogOpen(true);
      return;
    }
    onCancel();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          <button
            type="button"
            onClick={handleCancelClick}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to enquiry
          </button>

          <fieldset disabled={isSubmitting} className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-navy-deep/95 p-5 pb-8">
            <div className="flex flex-col gap-1">
              <p className="label-eyebrow text-copper-bright">Editing</p>
              <p className="font-mono text-xs text-muted-foreground">{reference}</p>
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
                  <Select value={fields.material} onValueChange={(value) => update("material", value as OwnerLeadEditFieldState["material"])}>
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
                        update("quantityUnit", value === NONE_VALUE ? "" : (value as OwnerLeadEditFieldState["quantityUnit"]))
                      }
                    >
                      <SelectTrigger id={`${fieldId}-quantity-unit`} className={SELECT_TRIGGER_CLASS_NAME}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                        <SelectItem value={NONE_VALUE} className={SELECT_ITEM_CLASS_NAME}>
                          —
                        </SelectItem>
                        {OWNER_LEAD_EDIT_QUANTITY_UNIT_VALUES.map((value) => (
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

            {intent === "sell" ? (
              <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
                <p className="label-eyebrow text-copper-bright">Location</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-emirate`} optional>
                      Emirate
                    </FieldLabel>
                    <Select
                      value={fields.emirate || NONE_VALUE}
                      onValueChange={(value) => update("emirate", value === NONE_VALUE ? "" : (value as OwnerLeadEditFieldState["emirate"]))}
                    >
                      <SelectTrigger id={`${fieldId}-emirate`} className={SELECT_TRIGGER_CLASS_NAME}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
                        <SelectItem value={NONE_VALUE} className={SELECT_ITEM_CLASS_NAME}>
                          —
                        </SelectItem>
                        {OWNER_LEAD_EDIT_EMIRATE_VALUES.map((value) => (
                          <SelectItem key={value} value={value} className={SELECT_ITEM_CLASS_NAME}>
                            {EMIRATE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={`${fieldId}-area`} optional>
                      Area
                    </FieldLabel>
                    <Input
                      className={INPUT_CLASS_NAME}
                      id={`${fieldId}-area`}
                      value={fields.area}
                      onChange={(event) => update("area", event.target.value)}
                      maxLength={150}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6">
              <p className="label-eyebrow text-copper-bright">Notes</p>
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
                  maxLength={OWNER_LEAD_EDIT_NOTES_MAX_LENGTH}
                  aria-describedby={`${fieldId}-notes-hint`}
                />
                <p id={`${fieldId}-notes-hint`} className="text-xs text-foreground/50">
                  Specifications, logistics or other details collected about this enquiry.
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      </div>

      {/* paddingBottom is a floor (18px) plus the device's safe-area inset
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
            <Button type="button" variant="outline" onClick={handleCancelClick} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!canSubmit} className="gap-1.5">
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <AlertDialogContent className="border-white/10 bg-navy-deep/95 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/70">
              You've made changes to this enquiry that haven't been saved. Leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
              onClick={(event) => {
                event.preventDefault();
                setDiscardDialogOpen(false);
                onCancel();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
