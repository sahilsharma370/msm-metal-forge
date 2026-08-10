import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import {
  EMIRATES,
  EMIRATE_LABELS,
  FULFILMENT_CHOICES,
  FULFILMENT_LABELS,
  PICKUP_CHOICES,
  PICKUP_CHOICE_LABELS,
  PREFERRED_PORTS,
  PREFERRED_PORT_LABELS,
} from "../quote-options";
import { QuotePillGroup } from "../QuotePillGroup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMIRATE_OPTIONS = EMIRATES.map((e) => ({ value: e, label: EMIRATE_LABELS[e] }));
const PICKUP_OPTIONS = PICKUP_CHOICES.map((p) => ({ value: p, label: PICKUP_CHOICE_LABELS[p] }));
const FULFILMENT_OPTIONS = FULFILMENT_CHOICES.map((f) => ({
  value: f,
  label: FULFILMENT_LABELS[f],
}));
const PORT_OPTIONS = PREFERRED_PORTS.map((p) => ({ value: p, label: PREFERRED_PORT_LABELS[p] }));

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[0.8rem] font-medium text-destructive">
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
          <p className="label-eyebrow text-copper-bright">Import Requirements</p>
          <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
            Where should the imported material arrive?
          </h2>

          <div className="mt-8 space-y-6">
            <QuotePillGroup
              label="Final delivery emirate"
              options={EMIRATE_OPTIONS}
              value={form.watch("buyerDestinationEmirate")}
              onChange={(v) => {
                form.setValue(
                  "buyerDestinationEmirate",
                  v as QuoteFormValues["buyerDestinationEmirate"],
                  {
                    shouldValidate: true,
                    shouldDirty: true,
                  },
                );
                form.clearErrors("buyerDestinationEmirate");
              }}
              error={errors.buyerDestinationEmirate?.message}
            />

            <QuotePillGroup
              label="Preferred UAE arrival port (optional)"
              options={PORT_OPTIONS}
              value={form.watch("buyerPreferredPort")}
              onChange={(v) => {
                form.setValue("buyerPreferredPort", v as QuoteFormValues["buyerPreferredPort"], {
                  shouldDirty: true,
                });
                if (v !== "other") form.setValue("buyerPreferredPortOther", undefined);
                form.clearErrors("buyerPreferredPortOther");
              }}
            />

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
                  className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
                className="text-sm font-semibold text-foreground/90"
              >
                Origin country preference{" "}
                <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Input
                id="buyerOriginCountryPreference"
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                placeholder="e.g. China, Germany — leave blank if open"
                {...form.register("buyerOriginCountryPreference")}
              />
            </div>

            <QuotePillGroup
              label="Logistics requirement"
              options={FULFILMENT_OPTIONS}
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

            <div>
              <Label
                htmlFor="buyerLogisticsNote"
                className="text-sm font-semibold text-foreground/90"
              >
                Logistics note <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Textarea
                id="buyerLogisticsNote"
                className="mt-2 min-h-20 rounded-xl border-white/15 bg-white/5"
                placeholder="Incoterm, container preference, target sailing date or delivery requirement"
                {...form.register("buyerLogisticsNote")}
              />
            </div>
          </div>
        </div>
      );
    }

    if (tradeRequirement === "export") {
      return (
        <div>
          <p className="label-eyebrow text-copper-bright">Export Requirements</p>
          <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
            Where should we export the material?
          </h2>

          <div className="mt-8 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <Label
                  htmlFor="buyerDestinationCountry"
                  className="text-sm font-semibold text-foreground/90"
                >
                  Destination country
                </Label>
                <Input
                  id="buyerDestinationCountry"
                  className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
                  className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
              label="Logistics requirement"
              options={FULFILMENT_OPTIONS}
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

            <div>
              <Label
                htmlFor="buyerLogisticsNote"
                className="text-sm font-semibold text-foreground/90"
              >
                Logistics note <span className="font-normal text-foreground/50">(optional)</span>
              </Label>
              <Textarea
                id="buyerLogisticsNote"
                className="mt-2 min-h-20 rounded-xl border-white/15 bg-white/5"
                placeholder="Incoterm, container preference, target sailing date or delivery requirement"
                {...form.register("buyerLogisticsNote")}
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <p className="label-eyebrow text-copper-bright">Location & Logistics</p>
        <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
          Where should the material go?
        </h2>

        <div className="mt-8 space-y-6">
          <QuotePillGroup
            label="Destination emirate"
            options={EMIRATE_OPTIONS}
            value={form.watch("buyerDestinationEmirate")}
            onChange={(v) => {
              const prev = form.getValues("buyerDestinationEmirate");
              form.setValue(
                "buyerDestinationEmirate",
                v as QuoteFormValues["buyerDestinationEmirate"],
                {
                  shouldValidate: true,
                  shouldDirty: true,
                },
              );
              // C-02/D-10: an Emirate change invalidates any Area/Maps link entered for the previous one.
              if (prev && prev !== v) {
                form.setValue("buyerDestinationArea", undefined);
                form.setValue("buyerDestinationMapLink", undefined);
              }
              form.clearErrors(["buyerDestinationEmirate", "buyerDestinationArea"]);
            }}
            error={errors.buyerDestinationEmirate?.message}
          />
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <Label
                htmlFor="buyerDestinationArea"
                className="text-sm font-semibold text-foreground/90"
              >
                Area
              </Label>
              <Input
                id="buyerDestinationArea"
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
            <div>
              <Label
                htmlFor="buyerDestinationMapLink"
                className="text-sm font-semibold text-foreground/90"
              >
                Google Maps link
              </Label>
              <Input
                id="buyerDestinationMapLink"
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                placeholder="Paste a maps link"
                aria-invalid={!!errors.buyerDestinationMapLink}
                aria-describedby={
                  errors.buyerDestinationMapLink ? "buyerDestinationMapLink-error" : undefined
                }
                {...form.register("buyerDestinationMapLink", {
                  onChange: () => form.clearErrors("buyerDestinationMapLink"),
                })}
              />
              <p className="mt-1.5 text-xs text-foreground/50">
                Optional — paste the shared location link from Google Maps.
              </p>
              <FieldError
                id="buyerDestinationMapLink-error"
                message={errors.buyerDestinationMapLink?.message}
              />
            </div>
          </div>
          <QuotePillGroup
            label="Fulfilment"
            options={FULFILMENT_OPTIONS}
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
      </div>
    );
  }

  const pickupRequired = form.watch("sellerPickupRequired");

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">Location & Logistics</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Where is the material located?
      </h2>

      <div className="mt-8 space-y-6">
        <QuotePillGroup
          label="Emirate"
          options={EMIRATE_OPTIONS}
          value={form.watch("sellerEmirate")}
          onChange={(v) => {
            const prev = form.getValues("sellerEmirate");
            form.setValue("sellerEmirate", v as QuoteFormValues["sellerEmirate"], {
              shouldValidate: true,
              shouldDirty: true,
            });
            // C-02: an Emirate change invalidates any Area/Maps link entered for the previous one.
            if (prev && prev !== v) {
              form.setValue("sellerArea", undefined);
              form.setValue("sellerMapLink", undefined);
            }
            form.clearErrors(["sellerEmirate", "sellerArea"]);
          }}
          error={errors.sellerEmirate?.message}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <Label htmlFor="sellerArea" className="text-sm font-semibold text-foreground/90">
              Area
            </Label>
            <Input
              id="sellerArea"
              className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
              placeholder="e.g. Industrial Area 10"
              aria-invalid={!!errors.sellerArea}
              aria-describedby={errors.sellerArea ? "sellerArea-error" : undefined}
              {...form.register("sellerArea", { onChange: () => form.clearErrors("sellerArea") })}
            />
            <FieldError id="sellerArea-error" message={errors.sellerArea?.message} />
          </div>
          <div>
            <Label htmlFor="sellerMapLink" className="text-sm font-semibold text-foreground/90">
              Google Maps link
            </Label>
            <Input
              id="sellerMapLink"
              className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
              placeholder="Paste a maps link"
              aria-invalid={!!errors.sellerMapLink}
              aria-describedby={errors.sellerMapLink ? "sellerMapLink-error" : undefined}
              {...form.register("sellerMapLink", {
                onChange: () => form.clearErrors("sellerMapLink"),
              })}
            />
            <p className="mt-1.5 text-xs text-foreground/50">
              Optional — paste the shared location link from Google Maps.
            </p>
            <FieldError id="sellerMapLink-error" message={errors.sellerMapLink?.message} />
          </div>
        </div>

        <QuotePillGroup
          label="Pickup required"
          options={PICKUP_OPTIONS}
          value={pickupRequired}
          onChange={(v) => {
            form.setValue("sellerPickupRequired", v as QuoteFormValues["sellerPickupRequired"], {
              shouldValidate: true,
              shouldDirty: true,
            });
            // C-09: Yes-only fields can't silently survive a switch to No/Not sure.
            if (v !== "yes") {
              form.setValue("sellerPickupDate", undefined);
              form.setValue("sellerAccessNote", undefined);
            }
            form.clearErrors(["sellerPickupRequired", "sellerPickupDate"]);
          }}
          error={errors.sellerPickupRequired?.message}
        />

        {pickupRequired === "yes" && (
          <div className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-2">
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
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                aria-invalid={!!errors.sellerPickupDate}
                aria-describedby={errors.sellerPickupDate ? "sellerPickupDate-error" : undefined}
                {...form.register("sellerPickupDate", {
                  onChange: () => form.clearErrors("sellerPickupDate"),
                })}
              />
              <p className="mt-1.5 text-xs text-foreground/50">Subject to MSM confirmation.</p>
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
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                placeholder="Gate access, equipment needed, timing or site restrictions"
                {...form.register("sellerAccessNote")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
