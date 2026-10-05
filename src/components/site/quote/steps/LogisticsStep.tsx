import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import {
  EMIRATES,
  EMIRATE_LABELS,
  FULFILMENT_CHOICES,
  FULFILMENT_DISPLAY_EXPORT,
  FULFILMENT_DISPLAY_LOCAL_IMPORT,
  PICKUP_CHOICES,
  PREFERRED_PORTS,
  PREFERRED_PORT_LABELS,
  getStageEyebrow,
} from "../quote-options";
import { QuotePillGroup } from "../QuotePillGroup";
import { QuoteOptionalSection } from "../QuoteOptionalSection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMIRATE_OPTIONS = EMIRATES.map((e) => ({ value: e, label: EMIRATE_LABELS[e] }));
const PICKUP_OPTIONS: { value: (typeof PICKUP_CHOICES)[number]; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];
const FULFILMENT_LOCAL_IMPORT_OPTIONS = FULFILMENT_CHOICES.map((f) => ({
  value: f,
  label: FULFILMENT_DISPLAY_LOCAL_IMPORT[f],
}));
/** Buyer Within-UAE/Import polish pass — the Fulfilment/Logistics
 * choice-card label only. "MSM-arranged delivery" wraps onto two lines
 * here while its siblings stay on one; shortened to "MSM delivery" for
 * this card's visible text on both the Within-UAE "Fulfilment" card and
 * the Import "Logistics" card (they already share the same underlying
 * FULFILMENT_LOCAL_IMPORT_OPTIONS base). Export's own "Logistics" card
 * uses a separate array (FULFILMENT_EXPORT_OPTIONS) and keeps its
 * existing wording, untouched. The stored value (buyerFulfilment/
 * buyerLogisticsRequirement's shared enum) and Review/confirmation/owner
 * copy (all driven by the separate, untouched FULFILMENT_LABELS in
 * quote-options.ts, which still reads "MSM-arranged delivery") are
 * unaffected — this only overrides the one display string on these
 * cards. */
const FULFILMENT_LOCAL_IMPORT_SHORT_OPTIONS = FULFILMENT_LOCAL_IMPORT_OPTIONS.map((opt) =>
  opt.value === "delivery" ? { ...opt, label: "MSM delivery" } : opt,
);
const FULFILMENT_EXPORT_OPTIONS = FULFILMENT_CHOICES.map((f) => ({
  value: f,
  label: FULFILMENT_DISPLAY_EXPORT[f],
}));
const PORT_OPTIONS = PREFERRED_PORTS.map((p) => ({ value: p, label: PREFERRED_PORT_LABELS[p] }));

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[0.8rem] font-medium" style={{ color: "#C9655A" }}>
      {message}
    </p>
  );
}

export function LogisticsStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const errors = form.formState.errors;

  if (intent === "buy") {
    const tradeRequirement = form.watch("buyerTradeRequirement");

    if (tradeRequirement === "import") {
      return (
        <div>
          <p className="label-eyebrow text-copper-bright">{getStageEyebrow(3, intent)}</p>
          <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
            Where should the imported material arrive?
          </h2>

          <div className="mt-5 space-y-5 sm:mt-8 sm:space-y-6">
            <QuotePillGroup
              id="buyerDestinationEmirate"
              label="Final delivery emirate"
              options={EMIRATE_OPTIONS}
              value={form.watch("buyerDestinationEmirate")}
              onChange={(v) => {
                form.setValue(
                  "buyerDestinationEmirate",
                  v as QuoteFormValues["buyerDestinationEmirate"],
                  { shouldValidate: true, shouldDirty: true },
                );
                form.clearErrors("buyerDestinationEmirate");
              }}
              error={errors.buyerDestinationEmirate?.message}
              columnsClassName="grid-cols-2 sm:grid-cols-4"
              variant="tile"
            />

            <div>
              <Label
                htmlFor="buyerPreferredPort"
                className="text-sm font-semibold text-foreground/90"
              >
                Preferred port <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Select
                value={form.watch("buyerPreferredPort") ?? ""}
                onValueChange={(v) => {
                  form.setValue("buyerPreferredPort", v as QuoteFormValues["buyerPreferredPort"], {
                    shouldDirty: true,
                  });
                  if (v !== "other") form.setValue("buyerPreferredPortOther", undefined);
                  form.clearErrors("buyerPreferredPortOther");
                }}
              >
                <SelectTrigger
                  id="buyerPreferredPort"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95 text-sm"
                >
                  <SelectValue placeholder="Select port" />
                </SelectTrigger>
                {/* Premium port-dropdown polish — scoped to this one
                    SelectContent/SelectItem instance via className
                    overrides only; the shared ui/select.tsx primitive
                    (also used by Owner Dashboard) is untouched. Compact,
                    independently-sized panel instead of the default
                    trigger-width viewport; a restrained translucent
                    copper tint (not the shared --accent solid-copper
                    focus fill) for hover and for the currently selected
                    row. Position/collision/portal behaviour is all
                    unchanged Radix defaults. */}
                <SelectContent className="w-[min(480px,calc(100vw-2rem))] rounded-xl border-white/12 bg-navy-deep p-1 shadow-[0_12px_28px_-12px_oklch(0.1_0.04_265/0.5)]">
                  {PORT_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="min-h-11 rounded-lg py-2 pl-3 focus:bg-[oklch(0.583_0.135_45.5/0.08)] focus:text-foreground data-[state=checked]:bg-[oklch(0.583_0.135_45.5/0.14)] data-[state=checked]:text-copper-bright"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.watch("buyerPreferredPort") === "other" && (
              <div className="max-w-xs">
                <Label
                  htmlFor="buyerPreferredPortOther"
                  className="text-sm font-semibold text-foreground/90"
                >
                  Port name
                </Label>
                <Input
                  id="buyerPreferredPortOther"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                  placeholder="e.g. Hamriyah Port"
                  aria-invalid={!!errors.buyerPreferredPortOther}
                  aria-describedby={
                    errors.buyerPreferredPortOther ? "buyerPreferredPortOther-error" : undefined
                  }
                  {...form.register("buyerPreferredPortOther", {
                    onChange: () => form.clearErrors("buyerPreferredPortOther"),
                  })}
                />
                <FieldError
                  id="buyerPreferredPortOther-error"
                  message={errors.buyerPreferredPortOther?.message}
                />
              </div>
            )}

            <div className="max-w-md">
              <Label
                htmlFor="buyerOriginCountryPreference"
                className="text-xs font-medium text-foreground/60"
              >
                Origin country preference{" "}
                <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Input
                id="buyerOriginCountryPreference"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. China, Germany — leave blank if open"
                {...form.register("buyerOriginCountryPreference")}
              />
            </div>

            <QuotePillGroup
              id="buyerLogisticsRequirement"
              label="Logistics"
              variant="tile"
              columnsClassName="grid-cols-1 sm:grid-cols-3"
              options={FULFILMENT_LOCAL_IMPORT_SHORT_OPTIONS}
              value={form.watch("buyerLogisticsRequirement")}
              onChange={(v) => {
                form.setValue(
                  "buyerLogisticsRequirement",
                  v as QuoteFormValues["buyerLogisticsRequirement"],
                  { shouldValidate: true, shouldDirty: true },
                );
                form.clearErrors("buyerLogisticsRequirement");
              }}
              error={errors.buyerLogisticsRequirement?.message}
            />

            <QuoteOptionalSection
              label="Add logistics details (optional)"
              defaultOpen={!!form.watch("buyerLogisticsNote")}
            >
              <Label
                htmlFor="buyerLogisticsNote"
                className="text-sm font-semibold text-foreground/90"
              >
                Logistics note
              </Label>
              <Textarea
                id="buyerLogisticsNote"
                className="mt-2 min-h-20 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="Incoterm, container preference, target sailing date or delivery requirement"
                {...form.register("buyerLogisticsNote")}
              />
            </QuoteOptionalSection>
          </div>
        </div>
      );
    }

    if (tradeRequirement === "export") {
      return (
        <div>
          <p className="label-eyebrow text-copper-bright">{getStageEyebrow(3, intent)}</p>
          <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
            Where should MSM export the material?
          </h2>

          <div className="mt-5 space-y-5 sm:mt-8 sm:space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
              <div>
                <Label
                  htmlFor="buyerDestinationCountry"
                  className="text-sm font-semibold text-foreground/90"
                >
                  Destination country
                </Label>
                <Input
                  id="buyerDestinationCountry"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                  placeholder="e.g. Vietnam"
                  aria-invalid={!!errors.buyerDestinationCountry}
                  aria-describedby={
                    errors.buyerDestinationCountry ? "buyerDestinationCountry-error" : undefined
                  }
                  {...form.register("buyerDestinationCountry", {
                    onChange: () => form.clearErrors("buyerDestinationCountry"),
                  })}
                />
                <FieldError
                  id="buyerDestinationCountry-error"
                  message={errors.buyerDestinationCountry?.message}
                />
              </div>
              <div>
                <Label
                  htmlFor="buyerDestinationCityPort"
                  className="text-sm font-semibold text-foreground/90"
                >
                  Destination city or port
                </Label>
                <Input
                  id="buyerDestinationCityPort"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                  placeholder="e.g. Nhava Sheva"
                  aria-invalid={!!errors.buyerDestinationCityPort}
                  aria-describedby={
                    errors.buyerDestinationCityPort ? "buyerDestinationCityPort-error" : undefined
                  }
                  {...form.register("buyerDestinationCityPort", {
                    onChange: () => form.clearErrors("buyerDestinationCityPort"),
                  })}
                />
                <FieldError
                  id="buyerDestinationCityPort-error"
                  message={errors.buyerDestinationCityPort?.message}
                />
              </div>
            </div>

            <QuotePillGroup
              id="buyerLogisticsRequirement"
              label="Logistics"
              variant="tile"
              columnsClassName="grid-cols-1 sm:grid-cols-3"
              options={FULFILMENT_EXPORT_OPTIONS}
              value={form.watch("buyerLogisticsRequirement")}
              onChange={(v) => {
                form.setValue(
                  "buyerLogisticsRequirement",
                  v as QuoteFormValues["buyerLogisticsRequirement"],
                  { shouldValidate: true, shouldDirty: true },
                );
                form.clearErrors("buyerLogisticsRequirement");
              }}
              error={errors.buyerLogisticsRequirement?.message}
            />

            <QuoteOptionalSection
              label="Add shipping details (optional)"
              defaultOpen={!!form.watch("buyerLogisticsNote")}
            >
              <Label
                htmlFor="buyerLogisticsNote"
                className="text-sm font-semibold text-foreground/90"
              >
                Logistics note
              </Label>
              <Textarea
                id="buyerLogisticsNote"
                className="mt-2 min-h-20 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="Incoterm, container preference, target sailing date or delivery requirement"
                {...form.register("buyerLogisticsNote")}
              />
            </QuoteOptionalSection>
          </div>
        </div>
      );
    }

    return (
      <div>
        <p className="label-eyebrow text-copper-bright">{getStageEyebrow(3, intent)}</p>
        <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
          Where should the material go?
        </h2>

        <div className="mt-5 space-y-5 sm:mt-8 sm:space-y-6">
          <QuotePillGroup
            id="buyerDestinationEmirate"
            label="Destination emirate"
            options={EMIRATE_OPTIONS}
            value={form.watch("buyerDestinationEmirate")}
            onChange={(v) => {
              const prev = form.getValues("buyerDestinationEmirate");
              form.setValue(
                "buyerDestinationEmirate",
                v as QuoteFormValues["buyerDestinationEmirate"],
                { shouldValidate: true, shouldDirty: true },
              );
              if (prev && prev !== v) {
                form.setValue("buyerDestinationArea", undefined);
                form.setValue("buyerDestinationMapLink", undefined);
              }
              form.clearErrors(["buyerDestinationEmirate", "buyerDestinationArea"]);
            }}
            error={errors.buyerDestinationEmirate?.message}
            columnsClassName="grid-cols-2 sm:grid-cols-4"
            variant="tile"
          />

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <div>
              <Label
                htmlFor="buyerDestinationArea"
                className="text-sm font-semibold text-foreground/90"
              >
                Area
              </Label>
              <Input
                id="buyerDestinationArea"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="e.g. Al Quoz Industrial"
                aria-invalid={!!errors.buyerDestinationArea}
                aria-describedby={
                  errors.buyerDestinationArea ? "buyerDestinationArea-error" : undefined
                }
                {...form.register("buyerDestinationArea", {
                  onChange: () => form.clearErrors("buyerDestinationArea"),
                })}
              />
              <FieldError
                id="buyerDestinationArea-error"
                message={errors.buyerDestinationArea?.message}
              />
            </div>

            <QuotePillGroup
              id="buyerFulfilment"
              label="Fulfilment"
              variant="tile"
              columnsClassName="grid-cols-1 sm:grid-cols-3"
              options={FULFILMENT_LOCAL_IMPORT_SHORT_OPTIONS}
              value={form.watch("buyerFulfilment")}
              onChange={(v) => {
                form.setValue("buyerFulfilment", v as QuoteFormValues["buyerFulfilment"], {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                form.clearErrors("buyerFulfilment");
              }}
              error={errors.buyerFulfilment?.message}
            />
          </div>

          <QuoteOptionalSection
            label="Add precise map location (optional)"
            defaultOpen={!!form.watch("buyerDestinationMapLink")}
          >
            <Label
              htmlFor="buyerDestinationMapLink"
              className="text-sm font-semibold text-foreground/90"
            >
              Google Maps link
            </Label>
            <Input
              id="buyerDestinationMapLink"
              className="mt-2 h-11 max-w-md rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="Paste a maps link"
              aria-invalid={!!errors.buyerDestinationMapLink}
              aria-describedby={
                errors.buyerDestinationMapLink ? "buyerDestinationMapLink-error" : undefined
              }
              {...form.register("buyerDestinationMapLink", {
                onChange: () => form.clearErrors("buyerDestinationMapLink"),
              })}
            />
            <FieldError
              id="buyerDestinationMapLink-error"
              message={errors.buyerDestinationMapLink?.message}
            />
          </QuoteOptionalSection>
        </div>
      </div>
    );
  }

  const pickupRequired = form.watch("sellerPickupRequired");

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">{getStageEyebrow(3, intent)}</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Where is the material located?
      </h2>

      <div className="mt-5 space-y-5 sm:mt-8 sm:space-y-6">
        <QuotePillGroup
          id="sellerEmirate"
          label="Emirate"
          options={EMIRATE_OPTIONS}
          value={form.watch("sellerEmirate")}
          onChange={(v) => {
            const prev = form.getValues("sellerEmirate");
            form.setValue("sellerEmirate", v as QuoteFormValues["sellerEmirate"], {
              shouldValidate: true,
              shouldDirty: true,
            });
            if (prev && prev !== v) {
              form.setValue("sellerArea", undefined);
              form.setValue("sellerMapLink", undefined);
            }
            form.clearErrors(["sellerEmirate", "sellerArea"]);
          }}
          error={errors.sellerEmirate?.message}
          columnsClassName="grid-cols-2 sm:grid-cols-4"
          variant="tile"
        />

        {/* Final correction pass — explicit `grid-cols-1` (not just bare
            `grid`, relying on an implicit auto-sized track) at the base
            breakpoint: Tailwind's `grid-cols-N` utilities use
            `minmax(0,1fr)` tracks, which let a wide child (the Area input)
            shrink instead of forcing the whole row — and this scroll
            container — wider than the viewport. Bare `grid` has no such
            protection. `lg:grid-cols-2` is unchanged. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <div className="min-w-0">
            <Label htmlFor="sellerArea" className="text-sm font-semibold text-foreground/90">
              Area
            </Label>
            <Input
              id="sellerArea"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              placeholder="e.g. Industrial Area 10"
              aria-invalid={!!errors.sellerArea}
              aria-describedby={errors.sellerArea ? "sellerArea-error" : undefined}
              {...form.register("sellerArea", { onChange: () => form.clearErrors("sellerArea") })}
            />
            <FieldError id="sellerArea-error" message={errors.sellerArea?.message} />
          </div>

          <QuotePillGroup
            id="sellerPickupRequired"
            label="Do you need MSM to collect the material?"
            variant="tile"
            columnsClassName="grid-cols-1 sm:grid-cols-3"
            options={PICKUP_OPTIONS}
            value={pickupRequired}
            onChange={(v) => {
              form.setValue("sellerPickupRequired", v as QuoteFormValues["sellerPickupRequired"], {
                shouldValidate: true,
                shouldDirty: true,
              });
              if (v !== "yes") {
                form.setValue("sellerPickupDate", undefined);
                form.setValue("sellerAccessNote", undefined);
              }
              form.clearErrors(["sellerPickupRequired", "sellerPickupDate"]);
            }}
            error={errors.sellerPickupRequired?.message}
          />
        </div>

        {pickupRequired === "yes" && (
          <div className="grid gap-4 rounded-2xl border border-white/10 bg-navy-deep/95 p-4 sm:grid-cols-2 sm:gap-6 sm:p-5">
            <div>
              <Label
                htmlFor="sellerPickupDate"
                className="text-sm font-semibold text-foreground/90"
              >
                Preferred pickup date{" "}
                <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Input
                id="sellerPickupDate"
                type="date"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                aria-invalid={!!errors.sellerPickupDate}
                aria-describedby={errors.sellerPickupDate ? "sellerPickupDate-error" : undefined}
                {...form.register("sellerPickupDate", {
                  onChange: () => form.clearErrors("sellerPickupDate"),
                })}
              />
              <p className="mt-1.5 text-xs text-foreground/60">Subject to MSM confirmation.</p>
              <FieldError id="sellerPickupDate-error" message={errors.sellerPickupDate?.message} />
            </div>
            <div>
              <Label
                htmlFor="sellerAccessNote"
                className="text-sm font-semibold text-foreground/90"
              >
                Access and loading notes{" "}
                <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Input
                id="sellerAccessNote"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="Gate access, equipment needed, timing or site restrictions"
                {...form.register("sellerAccessNote")}
              />
            </div>
          </div>
        )}

        <QuoteOptionalSection
          label="Add precise map location (optional)"
          defaultOpen={!!form.watch("sellerMapLink")}
        >
          <Label htmlFor="sellerMapLink" className="text-sm font-semibold text-foreground/90">
            Google Maps link
          </Label>
          <Input
            id="sellerMapLink"
            className="mt-2 h-11 max-w-md rounded-xl border-white/15 bg-navy-deep/95"
            placeholder="Paste a maps link"
            aria-invalid={!!errors.sellerMapLink}
            aria-describedby={errors.sellerMapLink ? "sellerMapLink-error" : undefined}
            {...form.register("sellerMapLink", {
              onChange: () => form.clearErrors("sellerMapLink"),
            })}
          />
          <FieldError id="sellerMapLink-error" message={errors.sellerMapLink?.message} />
        </QuoteOptionalSection>
      </div>
    </div>
  );
}
