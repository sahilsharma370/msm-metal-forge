import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, Loader2, Paperclip, Pencil } from "lucide-react";
import { isValidMapLink, type QuoteFormValues, type QuoteLocalFile } from "../quote-schema";
import {
  CONDITION_LABELS,
  EMIRATE_LABELS,
  FULFILMENT_LABELS,
  PICKUP_CHOICE_LABELS,
  PREFERRED_CONTACT_LABELS,
  PREFERRED_PORT_LABELS,
  TRADE_REQUIREMENT_LABELS,
  UNIT_LABELS,
  getMaterialLabel,
  getStageEyebrow,
  getSubtypeLabel,
} from "../quote-options";
import {
  buildReviewHeadline,
  formatDateForDisplay,
  formatPhoneForDisplay,
  isReadyForReview,
} from "../quote-summary";
import { quotePrimaryCtaSurface } from "../QuoteNavigation";
import { outcomeBanner, progressPhaseText } from "../quote-submission-copy";
import type {
  QuoteSubmissionOutcome,
  QuoteSubmissionProgressEvent,
} from "../quote-submission-engine";
import { cn } from "@/lib/utils";

interface ReviewStepProps {
  values: QuoteFormValues;
  onEditStep: (step: number) => void;
  isSubmitting: boolean;
  submissionPhase: QuoteSubmissionProgressEvent | null;
  submissionOutcome: QuoteSubmissionOutcome | null;
  /** CHECKPOINT C2G — the rendered Turnstile widget itself, owned and wired by QuoteExperience so this component stays widget-implementation-agnostic. */
  turnstileWidget: ReactNode;
}

interface ReviewSubmitButtonProps {
  values: QuoteFormValues;
  onSubmit: () => void;
  isSubmitting: boolean;
  submissionOutcome: QuoteSubmissionOutcome | null;
  /** CHECKPOINT C2G — whether a fresh, as-yet-unconsumed Turnstile token is currently held; Submit stays disabled until this is true. */
  turnstileReady: boolean;
}

/** C2L-Q (review scroll architecture fix) — the single primary CTA, rendered
 * by QuoteExperience through the same static QuoteNavigation footer shared
 * by every other stage (never a second, Review-owned sticky footer). Kept
 * in this file, not QuoteExperience.tsx, so it stays next to the exact
 * banner/ready/disabled logic it depends on. */
export function ReviewSubmitButton({
  values,
  onSubmit,
  isSubmitting,
  submissionOutcome,
  turnstileReady,
}: ReviewSubmitButtonProps) {
  const ready = isReadyForReview(values);
  const banner = submissionOutcome ? outcomeBanner(submissionOutcome) : null;
  const submitDisabled = !ready || isSubmitting || !turnstileReady;

  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={submitDisabled}
      aria-disabled={submitDisabled}
      aria-busy={isSubmitting}
      className={cn(
        "font-display inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-xs font-bold tracking-[0.1em] whitespace-nowrap uppercase",
        quotePrimaryCtaSurface(submitDisabled),
      )}
    >
      {isSubmitting ? (
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {isSubmitting ? "Submitting…" : banner?.showRetry ? "Retry Submission" : "Submit Request"}
    </button>
  );
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
    { step: 1, title: "Request", rows: [{ label: "Type", value: "Sell to MSM" }] },
    {
      step: 2,
      title: "Material",
      rows: [
        { label: "Material", value: materialAndSubtype(v) },
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
      step: 3,
      title: "Logistics",
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
      step: 4,
      title: "Contact",
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
    { step: 1, title: "Request", rows: [{ label: "Type", value: "Buy from MSM" }] },
    {
      step: 2,
      title: "Material",
      rows: [
        { label: "Material", value: materialAndSubtype(v) },
        { label: "Specification", value: v.materialSpec },
        {
          label: "Required quantity",
          value: compactQuantity(
            v.buyerQuantityValue,
            v.buyerQuantityUnit,
            v.buyerQuantityUnitOther,
          ),
        },
        {
          label: "Supply route",
          value: v.buyerTradeRequirement
            ? TRADE_REQUIREMENT_LABELS[v.buyerTradeRequirement]
            : undefined,
        },
        { label: "Needed by", value: formatDateForDisplay(v.buyerRequiredByDate) },
        { label: "Additional requirements", value: v.buyerAdditionalSpec },
      ],
    },
    { step: 3, title: "Logistics", rows: buyerDestinationRows(v) },
    {
      step: 4,
      title: "Contact",
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
  isSubmitting,
  submissionPhase,
  submissionOutcome,
  turnstileWidget,
}: ReviewStepProps) {
  const sections =
    values.intent === "buy" ? buildBuyerSections(values) : buildSellerSections(values);
  const banner = submissionOutcome ? outcomeBanner(submissionOutcome) : null;
  const statusText = isSubmitting ? progressPhaseText(submissionPhase) : (banner?.message ?? "");
  const isErrorTone = banner?.tone === "terminal" || banner?.tone === "conflict";
  const statusRef = useRef<HTMLDivElement>(null);

  // C2L (review scroll architecture fix) — after a failed submission, move
  // focus (and therefore scroll) onto the inline error. The scroll body is
  // now the ONLY scrollable region and the action footer is a plain static
  // sibling of it (never sticky/fixed/absolute), so bringing this element
  // into view can no longer land it behind anything.
  useEffect(() => {
    if (isErrorTone) {
      statusRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionOutcome]);

  return (
    <div className="pb-8">
      <p className="label-eyebrow text-copper-bright">{getStageEyebrow(5, values.intent)}</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Review and send your request
      </h2>

      <p className="font-display mt-4 rounded-2xl border border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] px-5 py-3.5 text-sm font-semibold text-foreground/90">
        {buildReviewHeadline(values)}
      </p>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {sections.map((section) => (
          <div
            key={section.step}
            className="rounded-xl border border-white/10 bg-navy-deep/95 px-4 py-3.5"
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

      {/* C2L-Q (review scroll architecture fix) — Turnstile verification,
          plain document flow: no absolute/fixed/sticky positioning,
          negative margins or transforms over the summary cards above. This
          is the required Review order: banner -> cards -> price disclaimer
          -> Turnstile -> inline error/status; the single primary CTA lives
          in the shared static QuoteNavigation footer below the scroll body
          (see ReviewSubmitButton, rendered by QuoteExperience), not here.
          "Continue on WhatsApp" is deliberately absent here (C2L-Q1) — it
          must never appear as an equal, pre-submission alternative to
          actually submitting (it sends nothing to MSM's system and can't
          carry attachments). WhatsApp is offered again only after a
          genuine success, on QuoteConfirmation, using the server's own
          reference. */}
      <div className="mt-6">{turnstileWidget}</div>

      {/* Inline error/status — also plain flow. Errors use role="alert"/
          aria-live="assertive" so they interrupt assistive tech immediately
          and are moved into focus (see the effect above), not left
          off-screen; benign progress/success messages stay role="status"/
          "polite" so they announce without stealing focus. Always mounted
          (never conditionally rendered in/out) so assistive tech reliably
          picks up updates. Nothing here can end up behind the header or
          footer: both are static grid rows, and the scroll body between
          them is the only element that ever scrolls. */}
      <div
        ref={statusRef}
        role={isErrorTone ? "alert" : "status"}
        aria-live={isErrorTone ? "assertive" : "polite"}
        aria-atomic="true"
        tabIndex={-1}
        className="mt-3 min-h-[1.25rem] outline-none"
      >
        {statusText && (
          <p
            className={cn(
              "rounded-xl border px-4 py-2.5 text-xs leading-relaxed",
              isErrorTone
                ? "border-destructive/30 bg-destructive/10 text-foreground/85"
                : "border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] text-foreground/75",
            )}
          >
            {statusText}
          </p>
        )}
      </div>
    </div>
  );
}
