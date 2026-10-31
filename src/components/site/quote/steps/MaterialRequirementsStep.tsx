import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import {
  CONDITIONS,
  CONDITION_LABELS,
  MATERIAL_FAMILIES,
  QUOTE_UNITS,
  TRADE_REQUIREMENT_DISPLAY_LABELS,
  UNIT_LABELS,
  getMaterialFamily,
  getStageEyebrow,
} from "../quote-options";
import type { QuoteTradeRoute } from "../quote-search";
import { QuoteOptionCard } from "../QuoteOptionCard";
import { QuotePillGroup } from "../QuotePillGroup";
import { QuoteOptionalSection } from "../QuoteOptionalSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const UNIT_OPTIONS = QUOTE_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }));
const CONDITION_OPTIONS = CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }));
const SUPPLY_ROUTE_OPTIONS: { value: QuoteTradeRoute; label: string }[] = (
  ["local", "import", "export"] as const
).map((r) => ({ value: r, label: TRADE_REQUIREMENT_DISPLAY_LABELS[r] }));

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[0.8rem] font-medium text-destructive">
      {message}
    </p>
  );
}

/**
 * C2L-Q1 stage 2 — "Material & Requirements", merging the former separate
 * Material and Material Details screens into one. One Continue on this
 * screen validates both former step schemas together via
 * `getStage2Schema`/`getStageSchema(2, intent)` in quote-schema.ts; nothing
 * about the underlying fields, their names or their validation rules
 * changed here — only presentation.
 */
export function MaterialRequirementsStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const material = form.watch("material");
  const subtype = form.watch("subtype");
  const isSeller = intent === "sell";
  const family = getMaterialFamily(material);
  const errors = form.formState.errors;

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">{getStageEyebrow(2, intent)}</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        {isSeller ? "What material are you selling?" : "What material do you need?"}
      </h2>

      <div className="mt-6">
        <div
          role="radiogroup"
          aria-label="Material"
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          {MATERIAL_FAMILIES.map((m) => (
            <QuoteOptionCard
              key={m.key}
              title={m.name}
              selected={material === m.key}
              className="p-3"
              onSelect={() => {
                form.setValue("material", m.key, { shouldValidate: true, shouldDirty: true });
                form.setValue("subtype", undefined, { shouldDirty: true });
                form.setValue("subtypeOtherText", undefined, { shouldDirty: true });
                if (m.key !== "other")
                  form.setValue("otherMaterialText", undefined, { shouldDirty: true });
                form.clearErrors(["material", "otherMaterialText", "subtypeOtherText"]);
              }}
            />
          ))}
        </div>
        {errors.material && (
          <p role="alert" className="mt-3 text-[0.8rem] font-medium text-destructive">
            {errors.material.message}
          </p>
        )}

        {material === "other" && (
          <div className="mt-6 max-w-md">
            <Label htmlFor="otherMaterialText" className="text-sm font-semibold text-foreground/90">
              Describe the material
            </Label>
            <Input
              id="otherMaterialText"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="e.g. Brass fittings, stainless offcuts"
              {...form.register("otherMaterialText")}
            />
            <FieldError id="otherMaterialText-error" message={errors.otherMaterialText?.message} />
          </div>
        )}

        {family && family.subtypes.length > 0 && (
          <QuoteOptionalSection
            label="Add material form (optional)"
            defaultOpen={!!subtype || !!errors.subtypeOtherText}
          >
            <div
              role="radiogroup"
              aria-label="Material subtype"
              className="flex flex-wrap items-center gap-2"
            >
              {family.subtypes
                .filter((s) => s.value !== "other" && s.value !== "not_sure")
                .map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={subtype === s.value}
                    onClick={() => {
                      const next = subtype === s.value ? undefined : s.value;
                      form.setValue("subtype", next, { shouldDirty: true });
                      if (next !== "other") {
                        form.setValue("subtypeOtherText", undefined, { shouldDirty: true });
                        form.clearErrors("subtypeOtherText");
                      }
                    }}
                    className={`font-display rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.04em] transition-colors ${
                      subtype === s.value
                        ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright shadow-[0_0_12px_-4px_oklch(0.583_0.135_45.5/0.5)]"
                        : "border-white/12 bg-navy-deep/95 text-foreground/75 hover:border-copper/40"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              <span
                aria-hidden="true"
                className="mx-1 hidden h-5 w-px self-center bg-white/15 sm:block"
              />
              {family.subtypes
                .filter((s) => s.value === "other" || s.value === "not_sure")
                .map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={subtype === s.value}
                    onClick={() => {
                      const next = subtype === s.value ? undefined : s.value;
                      form.setValue("subtype", next, { shouldDirty: true });
                      if (next !== "other") {
                        form.setValue("subtypeOtherText", undefined, { shouldDirty: true });
                      }
                      form.clearErrors("subtypeOtherText");
                    }}
                    className={`font-display rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.04em] transition-colors ${
                      subtype === s.value
                        ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright shadow-[0_0_12px_-4px_oklch(0.583_0.135_45.5/0.5)]"
                        : "border-white/12 bg-navy-deep/95 text-foreground/75 hover:border-copper/40"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
            </div>

            {subtype === "other" && (
              <div className="mt-4 max-w-md">
                <Label
                  htmlFor="subtypeOtherText"
                  className="text-sm font-semibold text-foreground/90"
                >
                  Describe the material type
                </Label>
                <Input
                  id="subtypeOtherText"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                  placeholder="e.g. Motor windings, cable offcuts"
                  aria-invalid={!!errors.subtypeOtherText}
                  aria-describedby={errors.subtypeOtherText ? "subtypeOtherText-error" : undefined}
                  {...form.register("subtypeOtherText", {
                    onChange: () => form.clearErrors("subtypeOtherText"),
                  })}
                />
                <FieldError
                  id="subtypeOtherText-error"
                  message={errors.subtypeOtherText?.message}
                />
              </div>
            )}
          </QuoteOptionalSection>
        )}
      </div>

      {isSeller ? (
        <div className="mt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label
                htmlFor="sellerQuantityValue"
                className="text-sm font-semibold text-foreground/90"
              >
                Approximate quantity
              </Label>
              <Input
                id="sellerQuantityValue"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. 500"
                disabled={!!form.watch("sellerQuantityUnsure")}
                aria-invalid={!!errors.sellerQuantityValue}
                aria-describedby={
                  errors.sellerQuantityValue ? "sellerQuantityValue-error" : undefined
                }
                {...form.register("sellerQuantityValue", {
                  onChange: () => form.clearErrors("sellerQuantityValue"),
                })}
              />
              <FieldError
                id="sellerQuantityValue-error"
                message={errors.sellerQuantityValue?.message}
              />
            </div>

            <QuotePillGroup
              label="Unit"
              options={UNIT_OPTIONS}
              value={form.watch("sellerQuantityUnit")}
              disabled={!!form.watch("sellerQuantityUnsure")}
              onChange={(v) => {
                form.setValue("sellerQuantityUnit", v as QuoteFormValues["sellerQuantityUnit"], {
                  shouldValidate: true,
                });
                form.clearErrors("sellerQuantityUnit");
                if (v !== "other") form.setValue("sellerQuantityUnitOther", undefined);
              }}
              error={errors.sellerQuantityUnit?.message}
            />
          </div>

          {form.watch("sellerQuantityUnit") === "other" && !form.watch("sellerQuantityUnsure") && (
            <div className="mt-4 max-w-xs">
              <Label
                htmlFor="sellerQuantityUnitOther"
                className="text-sm font-semibold text-foreground/90"
              >
                Specify unit
              </Label>
              <Input
                id="sellerQuantityUnitOther"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. bales, drums, m³"
                aria-invalid={!!errors.sellerQuantityUnitOther}
                aria-describedby={
                  errors.sellerQuantityUnitOther ? "sellerQuantityUnitOther-error" : undefined
                }
                {...form.register("sellerQuantityUnitOther", {
                  onChange: () => form.clearErrors("sellerQuantityUnitOther"),
                })}
              />
              <FieldError
                id="sellerQuantityUnitOther-error"
                message={errors.sellerQuantityUnitOther?.message}
              />
            </div>
          )}

          <label className="mt-3 flex items-center gap-2.5">
            <Checkbox
              checked={!!form.watch("sellerQuantityUnsure")}
              onCheckedChange={(checked) => {
                form.setValue("sellerQuantityUnsure", checked === true, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                if (checked === true) {
                  form.setValue("sellerQuantityValue", undefined);
                  form.setValue("sellerQuantityUnit", undefined);
                  form.setValue("sellerQuantityUnitOther", undefined);
                  form.clearErrors([
                    "sellerQuantityValue",
                    "sellerQuantityUnit",
                    "sellerQuantityUnitOther",
                  ]);
                }
              }}
            />
            <span className="text-sm font-medium text-foreground/80">
              I'm not sure of the quantity
            </span>
          </label>

          <div className="mt-6">
            <QuotePillGroup
              label="Condition"
              options={CONDITION_OPTIONS}
              value={form.watch("sellerCondition")}
              onChange={(v) =>
                form.setValue("sellerCondition", v as QuoteFormValues["sellerCondition"], {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              error={errors.sellerCondition?.message}
            />
          </div>

          <QuoteOptionalSection
            label="Add more details (optional)"
            defaultOpen={!!form.watch("sellerDescription")}
          >
            <Label htmlFor="sellerDescription" className="text-sm font-semibold text-foreground/90">
              Description
            </Label>
            <Textarea
              id="sellerDescription"
              className="mt-2 min-h-24 rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="Grade, dimensions, packaging, or anything else useful."
              {...form.register("sellerDescription")}
            />
          </QuoteOptionalSection>
        </div>
      ) : (
        <div className="mt-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label
                htmlFor="buyerQuantityValue"
                className="text-sm font-semibold text-foreground/90"
              >
                Required quantity
              </Label>
              <Input
                id="buyerQuantityValue"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. 2"
                aria-invalid={!!errors.buyerQuantityValue}
                aria-describedby={
                  errors.buyerQuantityValue ? "buyerQuantityValue-error" : undefined
                }
                {...form.register("buyerQuantityValue", {
                  onChange: () => form.clearErrors("buyerQuantityValue"),
                })}
              />
              <FieldError
                id="buyerQuantityValue-error"
                message={errors.buyerQuantityValue?.message}
              />
            </div>

            <QuotePillGroup
              label="Unit"
              options={UNIT_OPTIONS}
              value={form.watch("buyerQuantityUnit")}
              onChange={(v) => {
                form.setValue("buyerQuantityUnit", v as QuoteFormValues["buyerQuantityUnit"], {
                  shouldValidate: true,
                });
                form.clearErrors("buyerQuantityUnit");
                if (v !== "other") form.setValue("buyerQuantityUnitOther", undefined);
              }}
              error={errors.buyerQuantityUnit?.message}
            />
          </div>

          {form.watch("buyerQuantityUnit") === "other" && (
            <div className="mt-4 max-w-xs">
              <Label
                htmlFor="buyerQuantityUnitOther"
                className="text-sm font-semibold text-foreground/90"
              >
                Specify unit
              </Label>
              <Input
                id="buyerQuantityUnitOther"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. bales, drums, m³"
                aria-invalid={!!errors.buyerQuantityUnitOther}
                aria-describedby={
                  errors.buyerQuantityUnitOther ? "buyerQuantityUnitOther-error" : undefined
                }
                {...form.register("buyerQuantityUnitOther", {
                  onChange: () => form.clearErrors("buyerQuantityUnitOther"),
                })}
              />
              <FieldError
                id="buyerQuantityUnitOther-error"
                message={errors.buyerQuantityUnitOther?.message}
              />
            </div>
          )}

          <div className="mt-6">
            <QuotePillGroup
              label="Supply route"
              options={SUPPLY_ROUTE_OPTIONS}
              value={form.watch("buyerTradeRequirement")}
              onChange={(v) => {
                const route = v as QuoteTradeRoute;
                form.setValue("buyerTradeRequirement", route, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                form.clearErrors("buyerTradeRequirement");
                if (route !== "local") {
                  form.setValue("buyerDestinationArea", undefined);
                  form.setValue("buyerFulfilment", undefined);
                }
                if (route !== "import") {
                  form.setValue("buyerPreferredPort", undefined);
                  form.setValue("buyerOriginCountryPreference", undefined);
                }
                if (route !== "export") {
                  form.setValue("buyerDestinationCountry", undefined);
                  form.setValue("buyerDestinationCityPort", undefined);
                }
                if (route === "export") {
                  form.setValue("buyerDestinationEmirate", undefined);
                }
                form.clearErrors([
                  "buyerDestinationArea",
                  "buyerFulfilment",
                  "buyerDestinationEmirate",
                  "buyerDestinationCountry",
                  "buyerDestinationCityPort",
                ]);
              }}
              error={errors.buyerTradeRequirement?.message}
            />
          </div>

          <QuoteOptionalSection
            label="Add specification / grade (optional)"
            defaultOpen={!!form.watch("materialSpec")}
          >
            <Label htmlFor="materialSpec" className="text-sm font-semibold text-foreground/90">
              Specification / grade
            </Label>
            <Input
              id="materialSpec"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="e.g. alloy/grade, dimensions, coating or purity"
              {...form.register("materialSpec")}
            />
          </QuoteOptionalSection>

          <div className="mt-6 max-w-xs">
            <Label
              htmlFor="buyerRequiredByDate"
              className="text-sm font-semibold text-foreground/90"
            >
              When do you need it?{" "}
              <span className="font-normal text-foreground/50">(optional)</span>
            </Label>
            <Input
              id="buyerRequiredByDate"
              type="date"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              aria-invalid={!!errors.buyerRequiredByDate}
              aria-describedby={
                errors.buyerRequiredByDate ? "buyerRequiredByDate-error" : undefined
              }
              {...form.register("buyerRequiredByDate", {
                onChange: () => form.clearErrors("buyerRequiredByDate"),
              })}
            />
            <p className="mt-1.5 text-xs text-foreground/50">
              Subject to availability and logistics confirmation.
            </p>
            <FieldError
              id="buyerRequiredByDate-error"
              message={errors.buyerRequiredByDate?.message}
            />
          </div>

          <QuoteOptionalSection
            label="Add more requirements (optional)"
            defaultOpen={!!form.watch("buyerAdditionalSpec")}
          >
            <Label
              htmlFor="buyerAdditionalSpec"
              className="text-sm font-semibold text-foreground/90"
            >
              Additional requirements
            </Label>
            <Textarea
              id="buyerAdditionalSpec"
              className="mt-2 min-h-24 rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="Dimensions, packing, acceptable alternatives or application"
              {...form.register("buyerAdditionalSpec")}
            />
          </QuoteOptionalSection>
        </div>
      )}
    </div>
  );
}
