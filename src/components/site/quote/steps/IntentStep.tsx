import { useFormContext } from "react-hook-form";
import { Clock } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { getStageEyebrow } from "../quote-options";
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
      <p className="label-eyebrow text-copper-bright">{getStageEyebrow(1, intent)}</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Would you like to sell or buy scrap?
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed font-normal text-foreground/70">
        Choose one to continue. You can review everything before sending.
      </p>
      {/* CHECKPOINT C2J-E — a restrained trust chip (matte navy pill, matching
          the pill/chip treatment used elsewhere in Quote UI) instead of
          plain low-contrast text, so the "quick, no account needed"
          reassurance is clearly visible without competing with the copper
          CTAs below it. */}
      <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-navy-deep/95 px-3 py-1.5 text-xs font-semibold text-foreground/75">
        <Clock aria-hidden="true" className="h-3.5 w-3.5 text-copper-bright" />
        Takes about 2 minutes · No account needed
      </p>

      <div role="radiogroup" aria-label="Enquiry type" className="mt-6 grid gap-3 sm:grid-cols-2">
        <QuoteOptionCard
          eyebrow="Sell to Us"
          title="Sell Scrap to MSM"
          description="I have metal scrap or surplus material to sell."
          selected={intent === "sell"}
          onSelect={() => selectIntent("sell")}
          className="gap-1.5 p-3.5"
        />
        <QuoteOptionCard
          eyebrow="Buy from Us"
          title="Buy Scrap from MSM"
          description="I need metal scrap or bulk material supply."
          selected={intent === "buy"}
          onSelect={() => selectIntent("buy")}
          className="gap-1.5 p-3.5"
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
