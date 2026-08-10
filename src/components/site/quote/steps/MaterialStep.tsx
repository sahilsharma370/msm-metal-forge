import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import { MATERIAL_FAMILIES, getMaterialFamily } from "../quote-options";
import { QuoteOptionCard } from "../QuoteOptionCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MaterialStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const material = form.watch("material");
  const subtype = form.watch("subtype");
  const isSeller = intent === "sell";
  const family = getMaterialFamily(material);

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">Material</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        {isSeller ? "What material are you selling?" : "What material do you require?"}
      </h2>

      <div role="radiogroup" aria-label="Material" className="mt-8 grid gap-3 sm:grid-cols-3">
        {MATERIAL_FAMILIES.map((m) => (
          <QuoteOptionCard
            key={m.key}
            title={m.name}
            selected={material === m.key}
            className="p-4"
            onSelect={() => {
              form.setValue("material", m.key, { shouldValidate: true, shouldDirty: true });
              form.setValue("subtype", undefined, { shouldDirty: true });
              if (m.key !== "other")
                form.setValue("otherMaterialText", undefined, { shouldDirty: true });
              form.clearErrors(["material", "otherMaterialText"]);
            }}
          />
        ))}
      </div>
      {form.formState.errors.material && (
        <p role="alert" className="mt-3 text-[0.8rem] font-medium text-destructive">
          {form.formState.errors.material.message}
        </p>
      )}

      {material === "other" && (
        <div className="mt-6 max-w-md">
          <Label htmlFor="otherMaterialText" className="text-sm font-semibold text-foreground/90">
            Describe the material
          </Label>
          <Input
            id="otherMaterialText"
            className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
            placeholder="e.g. Brass fittings, stainless offcuts"
            {...form.register("otherMaterialText")}
          />
          {form.formState.errors.otherMaterialText && (
            <p role="alert" className="mt-1.5 text-[0.8rem] font-medium text-destructive">
              {form.formState.errors.otherMaterialText.message}
            </p>
          )}
        </div>
      )}

      {family && family.subtypes.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold text-foreground/90">
            Material type <span className="font-normal text-foreground/50">(if known)</span>
          </p>
          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            role="radiogroup"
            aria-label="Material subtype"
          >
            {/* B-01/B-02: known subtypes stay in the primary group; Other/Not sure form a
                visually separated fallback group at the right, Not sure always last. */}
            {family.subtypes
              .filter((s) => s.value !== "other" && s.value !== "not_sure")
              .map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={subtype === s.value}
                  onClick={() =>
                    form.setValue("subtype", subtype === s.value ? undefined : s.value, {
                      shouldDirty: true,
                    })
                  }
                  className={`font-display rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.04em] transition-colors ${
                    subtype === s.value
                      ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright"
                      : "glass-panel border-white/12 text-foreground/75 hover:border-copper/40"
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
                    form.setValue("subtype", subtype === s.value ? undefined : s.value, {
                      shouldDirty: true,
                    });
                    form.clearErrors("subtypeOtherText");
                  }}
                  className={`font-display rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.04em] transition-colors ${
                    subtype === s.value
                      ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright"
                      : "glass-panel border-white/12 text-foreground/75 hover:border-copper/40"
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
                className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                placeholder="e.g. Motor windings, cable offcuts"
                aria-invalid={!!form.formState.errors.subtypeOtherText}
                aria-describedby={
                  form.formState.errors.subtypeOtherText ? "subtypeOtherText-error" : undefined
                }
                {...form.register("subtypeOtherText", {
                  onChange: () => form.clearErrors("subtypeOtherText"),
                })}
              />
              {form.formState.errors.subtypeOtherText && (
                <p
                  id="subtypeOtherText-error"
                  role="alert"
                  className="mt-1.5 text-[0.8rem] font-medium text-destructive"
                >
                  {form.formState.errors.subtypeOtherText.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!isSeller && material && (
        <div className="mt-8 max-w-md">
          <Label htmlFor="materialSpec" className="text-sm font-semibold text-foreground/90">
            Specification / grade <span className="font-normal text-foreground/50">(optional)</span>
          </Label>
          <Input
            id="materialSpec"
            className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
            placeholder="e.g. alloy/grade, dimensions, coating or purity"
            {...form.register("materialSpec")}
          />
        </div>
      )}
    </div>
  );
}
