import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import { QuoteOptionCard } from "../QuoteOptionCard";

/** Fix 6: fields that only ever apply to the seller branch. */
const SELLER_ONLY_FIELDS: (keyof QuoteFormValues)[] = [
  "sellerQuantityValue",
  "sellerQuantityUnit",
  "sellerQuantityUnitOther",
  "sellerQuantityUnsure",
  "sellerCondition",
  "sellerDescription",
  "sellerEmirate",
  "sellerArea",
  "sellerMapLink",
  "sellerPickupRequired",
  "sellerPickupDate",
  "sellerAccessNote",
  "sellerName",
  "sellerPhone",
  "sellerCompany",
  "sellerEmail",
  "sellerPreferredContact",
  "sellerNotes",
];

/** Fields that only ever apply to the buyer branch (`materialSpec` is buyer-only — see MaterialStep). */
const BUYER_ONLY_FIELDS: (keyof QuoteFormValues)[] = [
  "buyerQuantityValue",
  "buyerQuantityUnit",
  "buyerQuantityUnitOther",
  "buyerTradeRequirement",
  "buyerRequiredByDate",
  "buyerAdditionalSpec",
  "materialSpec",
  "buyerDestinationEmirate",
  "buyerDestinationArea",
  "buyerDestinationMapLink",
  "buyerFulfilment",
  "buyerDestinationCountry",
  "buyerDestinationCityPort",
  "buyerPreferredPort",
  "buyerPreferredPortOther",
  "buyerOriginCountryPreference",
  "buyerLogisticsRequirement",
  "buyerLogisticsNote",
  "buyerCompany",
  "buyerContactPerson",
  "buyerPhone",
  "buyerEmail",
  "buyerPreferredContact",
  "buyerNotes",
];

export function IntentStep() {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");

  function selectIntent(next: "sell" | "buy") {
    const previous = form.getValues("intent");
    form.setValue("intent", next, { shouldValidate: true, shouldDirty: true });
    form.clearErrors("intent");

    // Only an explicit change to a *different* intent clears the other
    // branch — merely re-selecting the same card, or navigating Back/Continue
    // (which never calls this handler at all), must never touch stored values.
    if (!previous || previous === next) return;

    const staleFileField = next === "sell" ? "buyerDocuments" : "sellerPhotos";
    for (const f of form.getValues(staleFileField)) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
    form.setValue(staleFileField, [], { shouldDirty: true });

    const staleFields = next === "sell" ? BUYER_ONLY_FIELDS : SELLER_ONLY_FIELDS;
    for (const field of staleFields) {
      form.setValue(field, undefined, { shouldDirty: true });
    }
    form.clearErrors(staleFields);
  }

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
          onSelect={() => selectIntent("sell")}
        />
        <QuoteOptionCard
          eyebrow="Buy from Us"
          title="Buy Scrap from MSM"
          description="I need metal scrap or bulk material supply."
          selected={intent === "buy"}
          onSelect={() => selectIntent("buy")}
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
