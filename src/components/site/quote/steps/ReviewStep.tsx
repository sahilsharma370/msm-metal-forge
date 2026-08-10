import { MessageCircle, Pencil } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import {
  CONDITION_LABELS,
  EMIRATE_LABELS,
  FULFILMENT_LABELS,
  PICKUP_CHOICE_LABELS,
  PREFERRED_CONTACT_LABELS,
  PREFERRED_PORT_LABELS,
  QUOTE_WHATSAPP_NUMBER_PROVISIONAL,
  TRADE_REQUIREMENT_LABELS,
  UNIT_LABELS,
  getMaterialLabel,
  getSubtypeLabel,
} from "../quote-options";
import {
  buildSmartBrief,
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  formatPhoneForDisplay,
  isReadyForReview,
} from "../quote-summary";
import { cn } from "@/lib/utils";

interface ReviewStepProps {
  values: QuoteFormValues;
  onEditStep: (step: number) => void;
  onPreviewConfirmation: () => void;
  isDev: boolean;
}

interface ReviewRow {
  label: string;
  value: string | undefined;
}

interface ReviewSection {
  step: number;
  title: string;
  rows: ReviewRow[];
}

function materialAndSubtype(v: QuoteFormValues): string | undefined {
  const label = v.material === "other" ? v.otherMaterialText?.trim() : getMaterialLabel(v.material);
  if (!label) return undefined;
  const subtype = getSubtypeLabel(v.material, v.subtype);
  return subtype && subtype !== "Not sure" ? `${label} · ${subtype}` : label;
}

function compactQuantity(
  value: string | undefined,
  unit: QuoteFormValues["sellerQuantityUnit"],
): string | undefined {
  if (!value?.trim() || !unit) return undefined;
  return `${value.trim()} ${UNIT_LABELS[unit]}`;
}

function buildSellerSections(v: QuoteFormValues): ReviewSection[] {
  return [
    { step: 1, title: "Enquiry Type", rows: [{ label: "Type", value: "Sell to MSM" }] },
    { step: 2, title: "Material", rows: [{ label: "Material", value: materialAndSubtype(v) }] },
    {
      step: 3,
      title: "Material Details",
      rows: [
        {
          label: "Quantity",
          value: v.sellerQuantityUnsure
            ? "Not sure"
            : compactQuantity(v.sellerQuantityValue, v.sellerQuantityUnit),
        },
        {
          label: "Condition",
          value: v.sellerCondition ? CONDITION_LABELS[v.sellerCondition] : undefined,
        },
        { label: "Description", value: v.sellerDescription },
      ],
    },
    {
      step: 4,
      title: "Location & Logistics",
      rows: [
        {
          label: "Location",
          value:
            [v.sellerArea, v.sellerEmirate ? EMIRATE_LABELS[v.sellerEmirate] : undefined]
              .filter(Boolean)
              .join(", ") || undefined,
        },
        {
          label: "Pickup required",
          value: v.sellerPickupRequired ? PICKUP_CHOICE_LABELS[v.sellerPickupRequired] : undefined,
        },
        { label: "Pickup date", value: v.sellerPickupDate },
      ],
    },
    {
      step: 5,
      title: "Photos & Contact",
      rows: [
        { label: "Name", value: v.sellerName },
        { label: "Phone", value: formatPhoneForDisplay(v.sellerPhone) },
        { label: "Company", value: v.sellerCompany },
        { label: "Email", value: v.sellerEmail },
        {
          label: "Preferred contact",
          value: v.sellerPreferredContact
            ? PREFERRED_CONTACT_LABELS[v.sellerPreferredContact]
            : undefined,
        },
        {
          label: "Photos",
          value:
            v.sellerPhotos.length > 0
              ? `${v.sellerPhotos.length} attached`
              : "No photos added — recommended for a faster review.",
        },
      ],
    },
  ];
}

function buyerDestinationRows(v: QuoteFormValues): ReviewRow[] {
  if (v.buyerTradeRequirement === "local") {
    return [
      {
        label: "Destination",
        value:
          [
            v.buyerDestinationArea,
            v.buyerDestinationEmirate ? EMIRATE_LABELS[v.buyerDestinationEmirate] : undefined,
          ]
            .filter(Boolean)
            .join(", ") || undefined,
      },
      {
        label: "Fulfilment",
        value: v.buyerFulfilment ? FULFILMENT_LABELS[v.buyerFulfilment] : undefined,
      },
    ];
  }
  if (v.buyerTradeRequirement === "import") {
    return [
      {
        label: "Arrival emirate",
        value: v.buyerDestinationEmirate ? EMIRATE_LABELS[v.buyerDestinationEmirate] : undefined,
      },
      {
        label: "Preferred port",
        value: v.buyerPreferredPort ? PREFERRED_PORT_LABELS[v.buyerPreferredPort] : undefined,
      },
      { label: "Origin preference", value: v.buyerOriginCountryPreference },
      {
        label: "Logistics requirement",
        value: v.buyerLogisticsRequirement
          ? FULFILMENT_LABELS[v.buyerLogisticsRequirement]
          : undefined,
      },
      { label: "Logistics note", value: v.buyerLogisticsNote },
    ];
  }
  if (v.buyerTradeRequirement === "export") {
    return [
      {
        label: "Destination",
        value:
          [v.buyerDestinationCityPort, v.buyerDestinationCountry].filter(Boolean).join(", ") ||
          undefined,
      },
      {
        label: "Logistics requirement",
        value: v.buyerLogisticsRequirement
          ? FULFILMENT_LABELS[v.buyerLogisticsRequirement]
          : undefined,
      },
      { label: "Logistics note", value: v.buyerLogisticsNote },
    ];
  }
  return [];
}

function buildBuyerSections(v: QuoteFormValues): ReviewSection[] {
  return [
    { step: 1, title: "Enquiry Type", rows: [{ label: "Type", value: "Buy from MSM" }] },
    {
      step: 2,
      title: "Material",
      rows: [
        { label: "Material", value: materialAndSubtype(v) },
        { label: "Specification", value: v.materialSpec },
      ],
    },
    {
      step: 3,
      title: "Material Details",
      rows: [
        {
          label: "Required quantity",
          value: compactQuantity(v.buyerQuantityValue, v.buyerQuantityUnit),
        },
        {
          label: "Trade route",
          value: v.buyerTradeRequirement
            ? TRADE_REQUIREMENT_LABELS[v.buyerTradeRequirement]
            : undefined,
        },
        { label: "Required by", value: v.buyerRequiredByDate },
        { label: "Additional spec", value: v.buyerAdditionalSpec },
      ],
    },
    { step: 4, title: "Location & Logistics", rows: buyerDestinationRows(v) },
    {
      step: 5,
      title: "Documents & Contact",
      rows: [
        { label: "Contact person", value: v.buyerContactPerson },
        { label: "Phone", value: formatPhoneForDisplay(v.buyerPhone) },
        { label: "Company", value: v.buyerCompany },
        { label: "Email", value: v.buyerEmail },
        {
          label: "Preferred contact",
          value: v.buyerPreferredContact
            ? PREFERRED_CONTACT_LABELS[v.buyerPreferredContact]
            : undefined,
        },
        {
          label: "Documents",
          value:
            v.buyerDocuments.length > 0
              ? `${v.buyerDocuments.length} attached`
              : "No documents added — recommended for a faster review.",
        },
      ],
    },
  ];
}

export function ReviewStep({ values, onEditStep, onPreviewConfirmation, isDev }: ReviewStepProps) {
  const sections =
    values.intent === "buy" ? buildBuyerSections(values) : buildSellerSections(values);
  const ready = isReadyForReview(values);
  const whatsappUrl = buildWhatsAppUrl(
    QUOTE_WHATSAPP_NUMBER_PROVISIONAL,
    buildWhatsAppMessage(values),
  );

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">Review Request</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Review your request
      </h2>

      <p className="font-display mt-4 rounded-2xl border border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] px-5 py-4 text-sm font-semibold text-foreground/90">
        {buildSmartBrief(values)}
      </p>

      <div className="mt-6 space-y-3">
        {sections.map((section) => (
          <div
            key={section.step}
            className="glass-panel rounded-xl border border-white/10 px-4 py-3.5"
          >
            <div className="flex items-center justify-between">
              <p className="text-[0.8rem] font-bold tracking-[0.02em] text-foreground/85">
                {section.title}
              </p>
              <button
                type="button"
                onClick={() => onEditStep(section.step)}
                className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-copper-bright hover:text-copper focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
              >
                <Pencil aria-hidden="true" className="h-3 w-3" />
                Edit
              </button>
            </div>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {section.rows
                .filter((row) => row.value)
                .map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between gap-3 text-[0.8rem] sm:justify-start"
                  >
                    <dt className="text-foreground/50">{row.label}</dt>
                    <dd className="text-right font-medium text-foreground/90 sm:text-left">
                      {row.value}
                    </dd>
                  </div>
                ))}
              {section.rows.every((row) => !row.value) && (
                <p className="text-[0.8rem] text-foreground/45">Not provided.</p>
              )}
            </dl>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-foreground/55">
        Final price or availability is confirmed after MSM reviews the material details, grade,
        weight or quantity, condition and logistics.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#25D366]/50 px-6 py-3 text-xs font-bold tracking-[0.1em] text-[#25D366] uppercase transition-colors hover:border-[#25D366] hover:bg-[#25D366]/10"
        >
          <MessageCircle aria-hidden="true" className="h-4 w-4" />
          Continue on WhatsApp
        </a>

        {isDev && (
          <button
            type="button"
            onClick={onPreviewConfirmation}
            disabled={!ready}
            aria-disabled={!ready}
            className={cn(
              "font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3 text-xs font-bold tracking-[0.1em] whitespace-nowrap uppercase transition-colors",
              ready
                ? "bg-white/8 text-foreground/70 hover:bg-white/14"
                : "cursor-not-allowed bg-white/5 text-foreground/30",
            )}
          >
            Preview confirmation (dev only)
          </button>
        )}
      </div>

      {values.sellerPhotos.length > 0 || values.buyerDocuments.length > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-foreground/50">
          WhatsApp can't carry your attached files automatically — please attach them again inside
          the chat.
        </p>
      ) : null}
    </div>
  );
}
