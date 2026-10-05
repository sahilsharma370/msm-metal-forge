import { useFormContext } from "react-hook-form";
import { Clock } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { getStageEyebrow } from "../quote-options";
import { QuoteOptionCard } from "../QuoteOptionCard";
import { BuyDollyIcon, StackedIngotsIcon } from "../quote-icons";

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
      {/* Reference-pack update — the reassurance chip now sits beside the
          heading block on wider viewports (a two-column header row)
          instead of stacking directly underneath it, matching the
          approved mockup; it drops back under the subtext on narrow
          screens via `flex-col sm:flex-row`, so mobile is untouched.
          Mobile-only fit pass (gap-2/mt-2/chip py-1, all `sm:`-restored to
          the exact original gap-3/mt-3/py-1.5): Step 1's question block +
          both option cards needed to scroll to see the Buy card on a
          normal phone viewport with the toolbar visible — this trims the
          vertical rhythm between blocks, not any text or font size. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div>
          <p className="label-eyebrow text-copper-bright">{getStageEyebrow(1, intent)}</p>
          <h2 className="font-display mt-2 text-2xl font-bold text-foreground sm:mt-3 sm:text-3xl">
            Would you like to sell or buy scrap?
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed font-normal text-foreground/70">
            Choose one to continue. You can review everything before sending.
          </p>
        </div>
        {/* CHECKPOINT C2J-E — a restrained trust chip (matte navy pill,
            matching the pill/chip treatment used elsewhere in Quote UI)
            instead of plain low-contrast text, so the "quick, no account
            needed" reassurance is clearly visible without competing with
            the copper CTAs below it. */}
        <p className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 bg-navy-deep/95 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-foreground/75 sm:px-3 sm:py-1.5">
          <Clock aria-hidden="true" className="h-3.5 w-3.5 text-copper-bright" />
          Takes about 2 minutes · No account needed
        </p>
      </div>

      {/* Mobile-only fit pass continued: mt-4/gap-2 (restored to the
          original mt-6/gap-3 at sm+), and each card's own p-4 + h-7 w-7
          icon (restored to p-5 + h-8 w-8 at sm+) — card content/type size
          and the internal gap-2 between icon/eyebrow/title/description are
          untouched, so the cards stay exactly as readable, just less
          padded around that unchanged content. */}
      <div
        id="intent"
        role="radiogroup"
        aria-label="Enquiry type"
        className="mt-4 grid gap-2 sm:mt-6 sm:grid-cols-2 sm:gap-3"
      >
        <QuoteOptionCard
          eyebrow="Sell to Us"
          title="Sell Scrap to MSM"
          description="I have metal scrap or surplus material to sell."
          icon={<StackedIngotsIcon aria-hidden="true" className="h-7 w-7 sm:h-8 sm:w-8" />}
          selected={intent === "sell"}
          onSelect={() => selectIntent("sell")}
          showArrowWhenSelected
          className="gap-2 p-4 sm:p-5"
        />
        <QuoteOptionCard
          eyebrow="Buy from Us"
          title="Buy Scrap from MSM"
          description="I need metal scrap or bulk material supply."
          icon={<BuyDollyIcon aria-hidden="true" className="h-7 w-7 sm:h-8 sm:w-8" />}
          selected={intent === "buy"}
          onSelect={() => selectIntent("buy")}
          showArrowWhenSelected
          className="gap-2 p-4 sm:p-5"
        />
      </div>

      {form.formState.errors.intent && (
        <p role="alert" className="mt-4 text-[0.8rem] font-medium" style={{ color: "#C9655A" }}>
          {form.formState.errors.intent.message}
        </p>
      )}
    </div>
  );
}
