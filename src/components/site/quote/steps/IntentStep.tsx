import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import { QuoteOptionCard } from "../QuoteOptionCard";

export function IntentStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">Get a Quote</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        What would you like to do?
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed font-normal text-foreground/70">
        Choose the option that best matches your enquiry. You can review all details before
        submitting.
      </p>

      <div role="radiogroup" aria-label="Enquiry type" className="mt-8 grid gap-4 sm:grid-cols-2">
        <QuoteOptionCard
          eyebrow="Sell to Us"
          title="Sell Scrap to MSM"
          description="I have metal scrap or surplus material to sell."
          selected={intent === "sell"}
          onSelect={() => {
            form.setValue("intent", "sell", { shouldValidate: true, shouldDirty: true });
            form.clearErrors("intent");
          }}
        />
        <QuoteOptionCard
          eyebrow="Buy from Us"
          title="Buy Scrap from MSM"
          description="I need metal scrap or bulk material supply."
          selected={intent === "buy"}
          onSelect={() => {
            form.setValue("intent", "buy", { shouldValidate: true, shouldDirty: true });
            form.clearErrors("intent");
          }}
        />
      </div>

      {form.formState.errors.intent && (
        <p role="alert" className="mt-4 text-[0.8rem] font-medium text-destructive">
          {form.formState.errors.intent.message}
        </p>
      )}
    </div>
  );
}
