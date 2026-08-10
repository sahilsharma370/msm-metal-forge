import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import {
  CONDITIONS,
  CONDITION_LABELS,
  QUOTE_UNITS,
  UNIT_LABELS,
  TRADE_REQUIREMENT_LABELS,
} from "../quote-options";
import type { QuoteTradeRoute } from "../quote-search";
import { QuotePillGroup } from "../QuotePillGroup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const UNIT_OPTIONS = QUOTE_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }));
const CONDITION_OPTIONS = CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABELS[c] }));
const TRADE_REQUIREMENT_OPTIONS: { value: QuoteTradeRoute; label: string }[] = (
  ["local", "import", "export"] as const
).map((r) => ({ value: r, label: TRADE_REQUIREMENT_LABELS[r] }));

export function DetailsStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const errors = form.formState.errors;

  if (intent === "buy") {
    return (
      <div>
        <p className="label-eyebrow text-copper-bright">Material Details</p>
        <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
          Tell us what you need
        </h2>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <Label
              htmlFor="buyerQuantityValue"
              className="text-sm font-semibold text-foreground/90"
            >
              Required quantity
            </Label>
            <Input
              id="buyerQuantityValue"
              className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
              placeholder="e.g. 2"
              aria-invalid={!!errors.buyerQuantityValue}
              aria-describedby={errors.buyerQuantityValue ? "buyerQuantityValue-error" : undefined}
              {...form.register("buyerQuantityValue", {
                onChange: () => form.clearErrors("buyerQuantityValue"),
              })}
            />
            {errors.buyerQuantityValue && (
              <p
                id="buyerQuantityValue-error"
                role="alert"
                className="mt-1.5 text-[0.8rem] font-medium text-destructive"
              >
                {errors.buyerQuantityValue.message}
              </p>
            )}
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
              className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
              placeholder="e.g. bales, drums, m³"
              aria-invalid={!!errors.buyerQuantityUnitOther}
              aria-describedby={
                errors.buyerQuantityUnitOther ? "buyerQuantityUnitOther-error" : undefined
              }
              {...form.register("buyerQuantityUnitOther", {
                onChange: () => form.clearErrors("buyerQuantityUnitOther"),
              })}
            />
            {errors.buyerQuantityUnitOther && (
              <p
                id="buyerQuantityUnitOther-error"
                role="alert"
                className="mt-1.5 text-[0.8rem] font-medium text-destructive"
              >
                {errors.buyerQuantityUnitOther.message}
              </p>
            )}
          </div>
        )}

        <div className="mt-6">
          <QuotePillGroup
            label="Trade requirement"
            options={TRADE_REQUIREMENT_OPTIONS}
            value={form.watch("buyerTradeRequirement")}
            onChange={(v) => {
              const route = v as QuoteTradeRoute;
              form.setValue("buyerTradeRequirement", route, {
                shouldValidate: true,
                shouldDirty: true,
              });
              form.clearErrors("buyerTradeRequirement");
              // Drop fields exclusive to the branch being left so review/WhatsApp
              // can't surface a stale value from a route that's no longer selected.
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

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <Label
              htmlFor="buyerRequiredByDate"
              className="text-sm font-semibold text-foreground/90"
            >
              Needed by <span className="font-normal text-foreground/50">(optional)</span>
            </Label>
            <Input
              id="buyerRequiredByDate"
              type="date"
              className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
            {errors.buyerRequiredByDate && (
              <p
                id="buyerRequiredByDate-error"
                role="alert"
                className="mt-1.5 text-[0.8rem] font-medium text-destructive"
              >
                {errors.buyerRequiredByDate.message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <Label htmlFor="buyerAdditionalSpec" className="text-sm font-semibold text-foreground/90">
            Additional requirements{" "}
            <span className="font-normal text-foreground/50">
              {form.watch("material") === "other" ? "" : "(optional)"}
            </span>
          </Label>
          <Textarea
            id="buyerAdditionalSpec"
            className="mt-2 min-h-24 rounded-xl border-white/15 bg-white/5"
            placeholder="Dimensions, packing, acceptable alternatives or application"
            {...form.register("buyerAdditionalSpec")}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">Material Details</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Tell us about the material
      </h2>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <Label htmlFor="sellerQuantityValue" className="text-sm font-semibold text-foreground/90">
            Approximate quantity
          </Label>
          <Input
            id="sellerQuantityValue"
            className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
            placeholder="e.g. 500"
            disabled={!!form.watch("sellerQuantityUnsure")}
            aria-invalid={!!errors.sellerQuantityValue}
            aria-describedby={errors.sellerQuantityValue ? "sellerQuantityValue-error" : undefined}
            {...form.register("sellerQuantityValue", {
              onChange: () => form.clearErrors("sellerQuantityValue"),
            })}
          />
          {errors.sellerQuantityValue && (
            <p
              id="sellerQuantityValue-error"
              role="alert"
              className="mt-1.5 text-[0.8rem] font-medium text-destructive"
            >
              {errors.sellerQuantityValue.message}
            </p>
          )}
        </div>

        <QuotePillGroup
          label="Unit"
          options={UNIT_OPTIONS}
          value={form.watch("sellerQuantityUnit")}
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
            className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
            placeholder="e.g. bales, drums, m³"
            aria-invalid={!!errors.sellerQuantityUnitOther}
            aria-describedby={
              errors.sellerQuantityUnitOther ? "sellerQuantityUnitOther-error" : undefined
            }
            {...form.register("sellerQuantityUnitOther", {
              onChange: () => form.clearErrors("sellerQuantityUnitOther"),
            })}
          />
          {errors.sellerQuantityUnitOther && (
            <p
              id="sellerQuantityUnitOther-error"
              role="alert"
              className="mt-1.5 text-[0.8rem] font-medium text-destructive"
            >
              {errors.sellerQuantityUnitOther.message}
            </p>
          )}
        </div>
      )}

      <label className="mt-4 flex items-center gap-2.5">
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
        <span className="text-sm font-medium text-foreground/80">I'm not sure of the quantity</span>
      </label>

      <div className="mt-8">
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

      <div className="mt-8">
        <Label htmlFor="sellerDescription" className="text-sm font-semibold text-foreground/90">
          Short description <span className="font-normal text-foreground/50">(optional)</span>
        </Label>
        <Textarea
          id="sellerDescription"
          className="mt-2 min-h-24 rounded-xl border-white/15 bg-white/5"
          placeholder="Condition, dimensions, packaging or anything useful"
          {...form.register("sellerDescription")}
        />
      </div>
    </div>
  );
}
