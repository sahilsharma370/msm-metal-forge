import { ArrowRight, Loader2, MessageCircle, Paperclip, Pencil } from "lucide-react";
import { isValidMapLink, type QuoteFormValues, type QuoteLocalFile } from "../quote-schema";
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
  formatDateForDisplay,
  formatPhoneForDisplay,
  isReadyForReview,
} from "../quote-summary";
import { outcomeBanner, progressPhaseText } from "../quote-submission-copy";
import type { QuoteSubmissionOutcome, QuoteSubmissionProgressEvent } from "../quote-submission-engine";
import { cn } from "@/lib/utils";

interface ReviewStepProps {
  values: QuoteFormValues;
  onEditStep: (step: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submissionPhase: QuoteSubmissionProgressEvent | null;
  submissionOutcome: QuoteSubmissionOutcome | null;
}

interface ReviewRow {
  label: string;
  value: string | undefined;
  /** Present only for a validated Maps link — renders `value` as a clickable link instead of plain text. */
  href?: string | undefined;
}

/** Fix 8: only ever a link after validation, and shows compact text rather than the raw URL. */
function mapLinkRow(label: string, raw: string | undefined): ReviewRow {
  const trimmed = raw?.trim();
  if (trimmed && isValidMapLink(trimmed)) {
    return { label, value: "Open in Google Maps", href: trimmed };
  }
  return { label, value: trimmed };
}

interface ReviewSection {
  step: number;
  title: string;
  rows: ReviewRow[];
  files?: QuoteLocalFile[];
}

function materialAndSubtype(v: QuoteFormValues): string | undefined {
  const label = v.material === "other" ? v.otherMaterialText?.trim() : getMaterialLabel(v.material);
  if (!label) return undefined;
  const subtypeLabel =
    v.subtype === "other" ? v.subtypeOtherText?.trim() : getSubtypeLabel(v.material, v.subtype);
  return subtypeLabel && subtypeLabel !== "Not sure" ? `${label} · ${subtypeLabel}` : label;
}

function compactQuantity(
  value: string | undefined,
  unit: QuoteFormValues["sellerQuantityUnit"],
  unitOther?: string,
): string | undefined {
  if (!value?.trim() || !unit) return undefined;
  const label = unit === "other" ? unitOther?.trim() || UNIT_LABELS.other : UNIT_LABELS[unit];
  return `${value.trim()} ${label}`;
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
            : compactQuantity(
                v.sellerQuantityValue,
                v.sellerQuantityUnit,
                v.sellerQuantityUnitOther,
              ),
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
        mapLinkRow("Maps link", v.sellerMapLink),
        {
          label: "Pickup required",
          value: v.sellerPickupRequired ? PICKUP_CHOICE_LABELS[v.sellerPickupRequired] : undefined,
        },
        {
          label: "Preferred pickup date",
          value:
            v.sellerPickupRequired === "yes" ? formatDateForDisplay(v.sellerPickupDate) : undefined,
        },
        {
          label: "Access and loading notes",
          value: v.sellerPickupRequired === "yes" ? v.sellerAccessNote : undefined,
        },
      ],
    },
    {
      step: 5,
      title: "Photos & Contact",
      files: v.sellerPhotos,
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
        { label: "Notes", value: v.sellerNotes },
        {
          label: "Photos",
          value:
            v.sellerPhotos.length > 0
              ? `${v.sellerPhotos.length} photo${v.sellerPhotos.length === 1 ? "" : "s"} attached`
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
      mapLinkRow("Maps link", v.buyerDestinationMapLink),
      {
        label: "Fulfilment",
        value: v.buyerFulfilment ? FULFILMENT_LABELS[v.buyerFulfilment] : undefined,
      },
    ];
  }
  if (v.buyerTradeRequirement === "import") {
    return [
      {
        label: "Final delivery emirate",
        value: v.buyerDestinationEmirate ? EMIRATE_LABELS[v.buyerDestinationEmirate] : undefined,
      },
      {
        label: "Preferred port",
        value:
          v.buyerPreferredPort === "other"
            ? v.buyerPreferredPortOther
            : v.buyerPreferredPort
              ? PREFERRED_PORT_LABELS[v.buyerPreferredPort]
              : undefined,
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
          value: compactQuantity(
            v.buyerQuantityValue,
            v.buyerQuantityUnit,
            v.buyerQuantityUnitOther,
          ),
        },
        {
          label: "Trade route",
          value: v.buyerTradeRequirement
            ? TRADE_REQUIREMENT_LABELS[v.buyerTradeRequirement]
            : undefined,
        },
        { label: "Needed by", value: formatDateForDisplay(v.buyerRequiredByDate) },
        { label: "Additional requirements", value: v.buyerAdditionalSpec },
      ],
    },
    { step: 4, title: "Location & Logistics", rows: buyerDestinationRows(v) },
    {
      step: 5,
      title: "Documents & Contact",
      files: v.buyerDocuments,
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
        { label: "Notes", value: v.buyerNotes },
        {
          label: "Documents",
          value:
            v.buyerDocuments.length > 0
              ? `${v.buyerDocuments.length} file${v.buyerDocuments.length === 1 ? "" : "s"} attached`
              : "No documents added — recommended for a faster review.",
        },
      ],
    },
  ];
}

/** Fix 7: images stay square thumbnails; PDFs/other non-image files get a compact chip with a safely-rendered (plain JSX text, never HTML) truncated filename. */
function FileThumbnails({ files }: { files: QuoteLocalFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 sm:col-span-2">
      {files.map((f) =>
        f.previewUrl ? (
          <div
            key={f.id}
            className="h-14 w-14 overflow-hidden rounded-lg border border-white/12 bg-white/5"
            title={f.name}
          >
            <img
              src={f.previewUrl}
              alt={`Preview of ${f.name}`}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div
            key={f.id}
            title={f.name}
            className="flex h-14 max-w-[140px] items-center gap-1.5 rounded-lg border border-white/12 bg-white/5 px-2.5"
          >
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
            <span className="truncate text-[0.68rem] text-foreground/70">{f.name}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function ReviewStep({
  values,
  onEditStep,
  onSubmit,
  isSubmitting,
  submissionPhase,
  submissionOutcome,
}: ReviewStepProps) {
  const sections =
    values.intent === "buy" ? buildBuyerSections(values) : buildSellerSections(values);
  const ready = isReadyForReview(values);
  const whatsappUrl = buildWhatsAppUrl(
    QUOTE_WHATSAPP_NUMBER_PROVISIONAL,
    buildWhatsAppMessage(values),
  );
  const banner = submissionOutcome ? outcomeBanner(submissionOutcome) : null;
  const statusText = isSubmitting ? progressPhaseText(submissionPhase) : (banner?.message ?? "");
  const submitDisabled = !ready || isSubmitting;

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
                      {row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-copper-bright underline-offset-2 hover:text-copper hover:underline"
                        >
                          {row.value}
                        </a>
                      ) : (
                        row.value
                      )}
                    </dd>
                  </div>
                ))}
              {section.rows.every((row) => !row.value) &&
                (!section.files || section.files.length === 0) && (
                  <p className="text-[0.8rem] text-foreground/45">Not provided.</p>
                )}
            </dl>
            {section.files && <FileThumbnails files={section.files} />}
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

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitDisabled}
          aria-disabled={submitDisabled}
          aria-busy={isSubmitting}
          className={cn(
            "font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3 text-xs font-bold tracking-[0.1em] whitespace-nowrap uppercase transition-transform",
            submitDisabled
              ? "cursor-not-allowed bg-white/8 text-foreground/35"
              : "bg-[image:var(--gradient-copper)] text-[#080A1D] shadow-[0_10px_30px_-10px_oklch(0.583_0.135_45.5/0.9)] hover:scale-[1.02]",
          )}
        >
          {isSubmitting ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {isSubmitting ? "Submitting…" : banner?.showRetry ? "Retry Submission" : "Submit Request"}
        </button>
      </div>

      {/* Truthful, screen-reader-announced status: progress while submitting, or the
          last outcome's customer-safe message once settled. Always mounted (never
          conditionally rendered in/out) so assistive tech reliably picks up updates. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 min-h-[1.25rem]">
        {statusText && (
          <p
            className={cn(
              "rounded-xl border px-4 py-2.5 text-xs leading-relaxed",
              banner?.tone === "terminal" || banner?.tone === "conflict"
                ? "border-destructive/30 bg-destructive/10 text-foreground/85"
                : "border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] text-foreground/75",
            )}
          >
            {statusText}
          </p>
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
