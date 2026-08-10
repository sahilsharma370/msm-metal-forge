import { useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { X } from "lucide-react";
import msmLogo from "@/assets/msm-logo.svg";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { QuoteInitialContext } from "./quote-search";
import { buildDefaultQuoteValues, getStepSchema, type QuoteFormValues } from "./quote-schema";
import { clearQuoteDraft, loadQuoteDraft, saveQuoteDraft } from "./quote-storage";
import { getReadiness } from "./quote-summary";
import { QUOTE_TOTAL_STEPS } from "./quote-options";
import { QuoteProgress } from "./QuoteProgress";
import { QuoteReadiness } from "./QuoteReadiness";
import { QuoteNavigation } from "./QuoteNavigation";
import { IntentStep } from "./steps/IntentStep";
import { MaterialStep } from "./steps/MaterialStep";
import { DetailsStep } from "./steps/DetailsStep";
import { LogisticsStep } from "./steps/LogisticsStep";
import { ContactEvidenceStep } from "./steps/ContactEvidenceStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ConfirmationPreview } from "./steps/ConfirmationPreview";

interface QuoteExperienceProps {
  mode: "overlay" | "standalone";
  initialContext: QuoteInitialContext;
  onClose: () => void;
}

const isDev = import.meta.env.DEV;

/** Compact display-only label for the desktop rail so it never wraps at 232px — the underlying readiness key/data is untouched. */
const RAIL_LABEL_OVERRIDES: Record<string, string> = {
  destination: "Destination",
};

function nextPreviewReference(): string {
  if (typeof window === "undefined") return "MSM-PREVIEW-001";
  const key = "msm-quote-preview-ref-counter";
  const current = Number(window.sessionStorage.getItem(key) ?? "0") + 1;
  try {
    window.sessionStorage.setItem(key, String(current));
  } catch {
    // Non-fatal — the reference is still shown, just won't increment next time.
  }
  return `MSM-PREVIEW-${String(current).padStart(3, "0")}`;
}

function revokeAllPreviews(values: QuoteFormValues) {
  for (const f of [...values.sellerPhotos, ...values.buyerDocuments]) {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
  }
}

export function QuoteExperience({ mode, initialContext, onClose }: QuoteExperienceProps) {
  const draft = useMemo(() => loadQuoteDraft(), []);

  const [step, setStep] = useState(draft?.step ?? 1);
  const [furthestStep, setFurthestStep] = useState(draft?.step ?? 1);
  const [attemptedSteps, setAttemptedSteps] = useState<ReadonlySet<number>>(new Set());
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [confirmationRef, setConfirmationRef] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const form = useForm<QuoteFormValues>({
    defaultValues: draft
      ? {
          ...buildDefaultQuoteValues(initialContext),
          ...draft.values,
          sellerPhotos: [],
          buyerDocuments: [],
        }
      : buildDefaultQuoteValues(initialContext),
    mode: "onSubmit",
  });

  const intent = form.watch("intent");
  const values = form.watch();
  const readiness = getReadiness(values, step, furthestStep, attemptedSteps);
  const restoredFilesNotice =
    !!draft && (intent === "buy" ? draft.hadBuyerDocuments : draft.hadSellerPhotos);
  const hasMeaningfulProgress = !!intent;
  const step5Name = intent === "buy" ? "Documents & Contact" : "Photos & Contact";

  useEffect(() => {
    saveQuoteDraft(step, form.getValues());
    setFurthestStep((f) => Math.max(f, step));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step, confirmationRef]);

  useEffect(() => {
    const sub = form.watch(() => {
      saveQuoteDraft(step, form.getValues());
    });
    return () => sub.unsubscribe();
  }, [form, step]);

  useEffect(() => {
    return () => revokeAllPreviews(form.getValues());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleContinue() {
    const schema = getStepSchema(step, form.getValues("intent"));
    if (schema) {
      const result = schema.safeParse(form.getValues());
      if (!result.success) {
        setAttemptedSteps((prev) => new Set(prev).add(step));
        form.clearErrors();
        let firstField: keyof QuoteFormValues | null = null;
        for (const issue of result.error.issues) {
          const fieldName = issue.path[0];
          if (typeof fieldName === "string") {
            form.setError(fieldName as keyof QuoteFormValues, {
              type: "manual",
              message: issue.message,
            });
            firstField ??= fieldName as keyof QuoteFormValues;
          }
        }
        // Only registered text/textarea fields have a DOM ref to focus — pill/card
        // selections have no such ref, so this is a best-effort focus move.
        if (firstField) form.setFocus(firstField);
        return;
      }
    }
    form.clearErrors();
    setStep((s) => Math.min(s + 1, QUOTE_TOTAL_STEPS));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  function handleEditStep(target: number) {
    setStep(target);
  }

  function handleStartOver() {
    revokeAllPreviews(form.getValues());
    clearQuoteDraft();
    form.reset(buildDefaultQuoteValues(initialContext));
    setStep(1);
    setFurthestStep(1);
    setAttemptedSteps(new Set());
    setConfirmationRef(null);
    setShowCloseConfirm(false);
  }

  function requestClose() {
    if (!hasMeaningfulProgress) {
      onClose();
      return;
    }
    setShowCloseConfirm(true);
  }

  const continueDisabled = step === 1 && !intent;

  let stepContent;
  if (confirmationRef) {
    stepContent = (
      <ConfirmationPreview
        values={form.getValues()}
        reference={confirmationRef}
        onReturnToWebsite={() => {
          revokeAllPreviews(form.getValues());
          clearQuoteDraft();
          onClose();
        }}
      />
    );
  } else {
    switch (step) {
      case 1:
        stepContent = <IntentStep />;
        break;
      case 2:
        stepContent = <MaterialStep />;
        break;
      case 3:
        stepContent = <DetailsStep />;
        break;
      case 4:
        stepContent = <LogisticsStep />;
        break;
      case 5:
        stepContent = <ContactEvidenceStep restoredFilesNotice={restoredFilesNotice} />;
        break;
      default:
        stepContent = (
          <ReviewStep
            values={form.getValues()}
            onEditStep={handleEditStep}
            isDev={isDev}
            onPreviewConfirmation={() => setConfirmationRef(nextPreviewReference())}
          />
        );
    }
  }

  const shell = (
    <FormProvider {...form}>
      <div className="relative flex h-full min-h-0 flex-1 max-h-[inherit] flex-col md:flex-row">
        {showCloseConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-navy-deep/92 p-6 backdrop-blur-sm">
            <div className="glass-panel glass-ring w-full max-w-sm rounded-2xl p-6 text-center">
              <p className="font-display text-base font-bold text-foreground">Leave this quote?</p>
              <p className="mt-2 text-sm text-foreground/70">
                Your progress is saved in this browser for this session.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="font-display rounded-full bg-[image:var(--gradient-copper)] px-5 py-2.5 text-xs font-bold tracking-[0.1em] text-[#080A1D] uppercase"
                >
                  Save & close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCloseConfirm(false);
                    closeButtonRef.current?.focus();
                  }}
                  className="font-display rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold tracking-[0.1em] text-foreground/85 uppercase hover:border-white/35"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleStartOver();
                    onClose();
                  }}
                  className="text-xs font-semibold text-foreground/45 underline-offset-2 hover:text-destructive hover:underline"
                >
                  Discard and close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Desktop left rail */}
        <aside className="hidden h-full w-[232px] shrink-0 flex-col border-r border-white/10 bg-navy-deep/50 px-5 py-6 md:flex">
          <div className="shrink-0">
            <div className="flex items-center justify-between">
              <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-7 w-auto" />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={requestClose}
                aria-label="Close quote experience"
                className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center">
            <div className="w-full space-y-8">
              <QuoteProgress
                step={confirmationRef ? QUOTE_TOTAL_STEPS : step}
                stepNameOverride={step === 5 && !confirmationRef ? step5Name : undefined}
              />
              <QuoteReadiness items={readiness} labelOverrides={RAIL_LABEL_OVERRIDES} />
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleStartOver}
              className="rounded text-xs font-semibold text-foreground/60 underline-offset-2 hover:text-foreground/85 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
            >
              Start over
            </button>
          </div>
        </aside>

        {/* Mobile sticky header */}
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5 md:hidden"
          style={{ paddingTop: "max(0.875rem, env(safe-area-inset-top))" }}
        >
          <img
            src={msmLogo}
            alt="MSM Scrap"
            width={1174}
            height={417}
            className="h-6 w-auto shrink-0"
          />
          <div className="min-w-0 flex-1">
            <QuoteProgress
              step={confirmationRef ? QUOTE_TOTAL_STEPS : step}
              stepNameOverride={step === 5 && !confirmationRef ? step5Name : undefined}
              compact
            />
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close quote experience"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/60 hover:bg-white/10 hover:text-foreground"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Main column */}
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#080A1D]">
          <div
            ref={scrollRef}
            className="quote-scroll relative min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8 md:px-12 md:py-10"
          >
            <div className="mb-6 md:hidden">
              <QuoteReadiness items={readiness} compact />
            </div>
            {stepContent}
          </div>
          {!confirmationRef && step < QUOTE_TOTAL_STEPS && (
            <div className="shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              <QuoteNavigation
                step={step}
                totalSteps={QUOTE_TOTAL_STEPS}
                onBack={handleBack}
                onContinue={handleContinue}
                continueLabel={step === 5 ? "Review Request" : undefined}
                continueDisabled={continueDisabled}
              />
            </div>
          )}
        </div>
      </div>
    </FormProvider>
  );

  if (mode === "standalone") {
    return (
      <div className="min-h-dvh bg-[#080A1D] md:flex md:items-center md:justify-center md:p-6">
        <h1 className="sr-only">Get a Quote — MSM Scrap</h1>
        <p className="sr-only">
          Guided multi-step form to request a quote to sell or buy metal scrap.
        </p>
        <div className="glass-panel glass-ring flex h-dvh flex-col overflow-hidden rounded-none md:h-[min(78dvh,620px)] md:w-[min(94vw,1280px)] md:rounded-3xl">
          {shell}
        </div>
      </div>
    );
  }

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        overlayClassName="bg-[#080A1D]/95 backdrop-blur-sm"
        className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none md:h-[min(78dvh,620px)] md:max-h-[min(78dvh,620px)] md:w-[min(94vw,1280px)] md:max-w-[min(94vw,1280px)] md:rounded-3xl [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Get a Quote — MSM Scrap</DialogTitle>
        <DialogDescription className="sr-only">
          Guided multi-step form to request a quote to sell or buy metal scrap.
        </DialogDescription>
        <div className="glass-panel glass-ring flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
          {shell}
        </div>
      </DialogContent>
    </Dialog>
  );
}
