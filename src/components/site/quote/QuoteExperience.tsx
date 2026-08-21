import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, RefAttributes } from "react";
import { FormProvider, useForm } from "react-hook-form";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import msmLogo from "@/assets/msm-logo.svg";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { QuoteInitialContext } from "./quote-search";
import { buildDefaultQuoteValues, getStageSchema, type QuoteFormValues } from "./quote-schema";
import {
  clearQuoteDraft,
  loadQuoteDraft,
  loadSubmissionAttempt,
  saveQuoteDraft,
} from "./quote-storage";
import { QUOTE_TOTAL_STAGES, STAGE_ENTRY_STEP, stageOf } from "./quote-options";
import { QuoteProgress } from "./QuoteProgress";
import { QuoteNavigation, quotePrimaryCtaSurface } from "./QuoteNavigation";
import { cn } from "@/lib/utils";
import { IntentStep } from "./steps/IntentStep";
import { MaterialRequirementsStep } from "./steps/MaterialRequirementsStep";
import { LogisticsStep } from "./steps/LogisticsStep";
import { ContactEvidenceStep } from "./steps/ContactEvidenceStep";
import { ReviewStep, ReviewSubmitButton } from "./steps/ReviewStep";
import { QuoteConfirmation } from "./steps/QuoteConfirmation";
import { unresolvedFilenames } from "./quote-submission-copy";
import {
  createQuoteSubmissionEngine,
  type QuoteSubmissionEngine,
  type QuoteSubmissionOutcome,
  type QuoteSubmissionProgressEvent,
} from "./quote-submission-engine";
import { createFetchQuoteTransport, type QuoteTransport } from "./quote-submission-transport";
import {
  QuoteTurnstileWidget,
  type QuoteTurnstileWidgetHandle,
  type QuoteTurnstileWidgetProps,
} from "./QuoteTurnstileWidget";

/** Public build-time value — safe to expose in the client bundle by design (see QuoteTurnstileWidget's own doc comment). Empty in an environment without it configured, which fails closed: the widget never renders a usable challenge and Submit stays disabled forever, rather than silently skipping verification. */
const TURNSTILE_SITE_KEY = (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined) ?? "";

type TurnstileWidgetComponent = ComponentType<
  QuoteTurnstileWidgetProps & RefAttributes<QuoteTurnstileWidgetHandle>
>;

interface QuoteExperienceProps {
  mode: "overlay" | "standalone";
  initialContext: QuoteInitialContext;
  onClose: () => void;
  /**
   * Test-only injection point — production callers never pass this; the
   * real fetch-backed transport is used by default. Deliberately a
   * transport, not a whole engine: the component always builds its own
   * engine via createQuoteSubmissionEngine so onProgress stays wired to
   * this component's own state regardless of which transport is used,
   * exercising the real single-flight/outcome-mapping logic in tests too.
   */
  transport?: QuoteTransport;
  /**
   * CHECKPOINT C2G — test-only injection point mirroring `transport` above;
   * production callers never pass this. The real script-loading, network-
   * backed QuoteTurnstileWidget is used by default. Swapping the whole
   * component (rather than mocking `window.turnstile`'s async script load)
   * keeps tests deterministic without racing real timers.
   */
  turnstileWidget?: TurnstileWidgetComponent;
}

function revokeAllPreviews(values: QuoteFormValues) {
  for (const f of [...values.sellerPhotos, ...values.buyerDocuments]) {
    if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
  }
}

/** The lowest-numbered stage (1-4) whose own schema no longer validates against `values`, or null if every stage still passes — used to route a validation_error/server_rejected submission outcome back to the stage that actually needs fixing, mirroring handleContinue's own per-stage gate. Stage 5 (Review) has no schema of its own, so the loop never reaches it. */
function findFirstInvalidStage(
  values: QuoteFormValues,
  intent: QuoteFormValues["intent"],
): number | null {
  for (let stage = 1; stage < QUOTE_TOTAL_STAGES; stage += 1) {
    const schema = getStageSchema(stage, intent);
    if (schema && !schema.safeParse(values).success) return stage;
  }
  return null;
}

/** The originally-declared filename for one upload slot, read from the persisted (storagePath-free) attempt — used only to tell the customer which file to reselect after a content_mismatch, never to infer success/verification. */
function findSlotFilename(slotId: string): string | undefined {
  const attempt = loadSubmissionAttempt();
  if (attempt.kind !== "initiated") return undefined;
  return attempt.uploadSlots.find((s) => s.slotId === slotId)?.originalFilename;
}

interface ConfirmationState {
  readonly reference: string;
}

export function QuoteExperience({
  mode,
  initialContext,
  onClose,
  transport: transportProp,
  turnstileWidget: TurnstileWidgetProp,
}: QuoteExperienceProps) {
  const draft = useMemo(() => loadQuoteDraft(), []);
  const TurnstileWidget = TurnstileWidgetProp ?? QuoteTurnstileWidget;

  const [step, setStep] = useState(draft?.step ?? 1);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);
  const [showSubmitCloseGuard, setShowSubmitCloseGuard] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<QuoteSubmissionProgressEvent | null>(null);
  const [submissionOutcome, setSubmissionOutcome] = useState<QuoteSubmissionOutcome | null>(null);
  /** CHECKPOINT C2G — a fresh, single-use Turnstile token held only in memory: never written to sessionStorage/localStorage/Supabase, never logged. Cleared the instant a submit attempt consumes it. */
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileWidgetRef = useRef<QuoteTurnstileWidgetHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepContentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const startOverButtonRef = useRef<HTMLButtonElement>(null);
  const keepEditingButtonRef = useRef<HTMLButtonElement>(null);
  const continueSubmittingButtonRef = useRef<HTMLButtonElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const submitPromiseRef = useRef<Promise<QuoteSubmissionOutcome> | null>(null);

  // CHECKPOINT C2F-E/F: exactly one engine instance for the lifetime of this
  // mounted component — React's lazy useState initializer runs createFetchQuoteTransport()/
  // createQuoteSubmissionEngine() only on the very first render, never on every
  // render or inside a click handler, so its own single-flight guard is
  // meaningful across repeated submit() calls from this one form. onProgress
  // closes over setSubmissionPhase, whose identity React guarantees stable
  // across renders, so this one-time construction stays correctly wired for
  // the component's whole lifetime.
  const [engine] = useState<QuoteSubmissionEngine>(() =>
    createQuoteSubmissionEngine({
      transport: transportProp ?? createFetchQuoteTransport(),
      onProgress: (event) => setSubmissionPhase(event),
    }),
  );

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
  const stage = confirmation ? QUOTE_TOTAL_STAGES : stageOf(step);
  const restoredFilesNotice =
    !!draft && (intent === "buy" ? draft.hadBuyerDocuments : draft.hadSellerPhotos);
  const hasMeaningfulProgress = !!intent;
  const unresolvedFiles = submissionOutcome
    ? unresolvedFilenames(
        submissionOutcome,
        submissionOutcome.kind === "content_mismatch"
          ? findSlotFilename(submissionOutcome.slotId)
          : undefined,
      )
    : [];

  useEffect(() => {
    saveQuoteDraft(step, form.getValues());
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    // C2L-Q1 — move focus into the new stage's content on every stage
    // change (Continue/Back/Edit/hydration), so screen-reader/keyboard users
    // land on the new heading instead of a stale focus target. The stage
    // container itself (not a specific heading ref threaded through every
    // step component) is the smallest safe hook available here.
    stepContentRef.current?.focus();
  }, [step, confirmation]);

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

  /** Applies one stage schema's validation issues exactly like handleContinue: sets field errors, marks the stage attempted, and best-effort focuses the first invalid registered field. Works identically for stage 2's combined (Material+Details) intersection schema — a ZodIntersection failure carries the union of both sides' issues, each with its original field path intact. */
  function applyStageValidationIssues(targetStage: number, values: QuoteFormValues): boolean {
    const schema = getStageSchema(targetStage, values.intent);
    if (!schema) return true;
    const result = schema.safeParse(values);
    if (result.success) return true;
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
    if (firstField) form.setFocus(firstField);
    return false;
  }

  function handleContinue() {
    const currentStage = stageOf(step);
    if (applyStageValidationIssues(currentStage, form.getValues())) {
      form.clearErrors();
      const nextStage = Math.min(currentStage + 1, QUOTE_TOTAL_STAGES);
      setStep(STAGE_ENTRY_STEP[nextStage]!);
    }
  }

  function handleBack() {
    // C2L-Q (review scroll architecture fix) — Review now has a real Back
    // button too (the shared footer, not a Review-only affordance), so this
    // guard — already applied to Edit-section jumps below — now also has to
    // cover the one stage where a submission can actually be in flight.
    if (isSubmitting) return;
    const currentStage = stageOf(step);
    const prevStage = Math.max(currentStage - 1, 1);
    setStep(STAGE_ENTRY_STEP[prevStage]!);
  }

  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);
  const handleTurnstileUnusable = useCallback(() => setTurnstileToken(null), []);

  /** `target` is a STAGE number (1-4) — every ReviewStep section's Edit action and stage-jump target now speak the same 5-stage numbering. */
  function handleEditStep(target: number) {
    if (isSubmitting) return;
    setStep(STAGE_ENTRY_STEP[target] ?? 1);
  }

  function handleStartOver() {
    revokeAllPreviews(form.getValues());
    clearQuoteDraft();
    form.reset(buildDefaultQuoteValues(initialContext));
    setStep(1);
    setConfirmation(null);
    setSubmissionOutcome(null);
    setShowCloseConfirm(false);
    setShowStartOverConfirm(false);
  }

  /**
   * CHECKPOINT C2F-E/F: the one call site that ever reaches the real
   * initiate -> upload -> complete pipeline. Safe to call again for Retry —
   * the engine's own idempotency-key resolution reuses the same in-flight
   * identity whenever the payload hash is unchanged, and its single-flight
   * guard makes a concurrent duplicate call share this exact run rather than
   * starting a second one.
   */
  async function handleSubmit() {
    if (isSubmitting || !turnstileToken) return;
    const tokenToUse = turnstileToken;
    setSubmissionOutcome(null);
    setIsSubmitting(true);
    setSubmissionPhase(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const promise = engine.submit({
      values: form.getValues(),
      context: initialContext,
      turnstileToken: tokenToUse,
      signal: controller.signal,
    });
    submitPromiseRef.current = promise;

    let outcome: QuoteSubmissionOutcome;
    try {
      outcome = await promise;
    } finally {
      submitPromiseRef.current = null;
      abortControllerRef.current = null;
      setIsSubmitting(false);
      // CHECKPOINT C2G — the token above was submitted (or the attempt was
      // aborted before/after it could be); either way it must never be
      // reused. Clearing it disables Submit again until the widget's reset
      // delivers a brand-new challenge token, satisfying "fresh token every
      // retry" without the caller having to remember to ask for one.
      setTurnstileToken(null);
      turnstileWidgetRef.current?.reset();
    }

    switch (outcome.kind) {
      case "success": {
        const currentValues = form.getValues();
        revokeAllPreviews(currentValues);
        clearQuoteDraft();
        setSubmissionOutcome(null);
        setConfirmation({ reference: outcome.reference });
        break;
      }
      case "aborted": {
        // Intentional cancellation — never shown as an error, recovery state left untouched.
        setSubmissionOutcome(null);
        break;
      }
      case "needs_reselection":
      case "content_mismatch": {
        setSubmissionOutcome(outcome);
        setStep(5);
        break;
      }
      case "validation_error":
      case "server_rejected": {
        const invalidStage = findFirstInvalidStage(form.getValues(), form.getValues("intent"));
        if (invalidStage) {
          applyStageValidationIssues(invalidStage, form.getValues());
          setStep(STAGE_ENTRY_STEP[invalidStage]!);
        }
        setSubmissionOutcome(outcome);
        break;
      }
      default:
        // restart_required, upload_in_progress, content mismatch handled above,
        // idempotency_conflict, not_ready, network_error, server_error, upload_failed
        setSubmissionOutcome(outcome);
    }
  }

  function requestClose() {
    if (isSubmitting) {
      setShowSubmitCloseGuard(true);
      return;
    }
    if (!hasMeaningfulProgress) {
      onClose();
      return;
    }
    setShowCloseConfirm(true);
  }

  /** Fix 10: Start Over must not immediately destroy progress once something meaningful exists. */
  function requestStartOver() {
    if (isSubmitting) return;
    if (!hasMeaningfulProgress) {
      handleStartOver();
      return;
    }
    setShowStartOverConfirm(true);
  }

  async function handleStopAndClose() {
    abortControllerRef.current?.abort();
    if (submitPromiseRef.current) {
      await submitPromiseRef.current;
    }
    setShowSubmitCloseGuard(false);
    onClose();
  }

  const continueDisabled = stage === 1 && !intent;

  let stepContent;
  if (confirmation) {
    stepContent = (
      <QuoteConfirmation
        values={form.getValues()}
        reference={confirmation.reference}
        onReturnToWebsite={onClose}
      />
    );
  } else {
    switch (stage) {
      case 1:
        stepContent = <IntentStep />;
        break;
      case 2:
        stepContent = <MaterialRequirementsStep />;
        break;
      case 3:
        stepContent = <LogisticsStep />;
        break;
      case 4:
        stepContent = (
          <ContactEvidenceStep
            restoredFilesNotice={restoredFilesNotice}
            unresolvedFilenames={unresolvedFiles}
          />
        );
        break;
      default:
        stepContent = (
          <ReviewStep
            values={form.getValues()}
            onEditStep={handleEditStep}
            isSubmitting={isSubmitting}
            submissionPhase={submissionPhase}
            submissionOutcome={submissionOutcome}
            turnstileWidget={
              <TurnstileWidget
                ref={turnstileWidgetRef}
                siteKey={TURNSTILE_SITE_KEY}
                onToken={handleTurnstileToken}
                onUnusable={handleTurnstileUnusable}
              />
            }
          />
        );
    }
  }

  const shell = (
    <FormProvider {...form}>
      {/* C2L-Q (review scroll architecture fix) — a real 3-row grid: header/
          progress (auto), the one scrollable body (minmax(0,1fr)), and the
          action footer (auto) as its static sibling, shared by all 5 stages.
          The AlertDialog overlays below are absolutely positioned, so grid
          vs. flex on this container doesn't affect them. */}
      <div className="relative grid h-full min-h-0 flex-1 max-h-[inherit] grid-rows-[auto_minmax(0,1fr)_auto]">
        {showCloseConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-navy-deep/92 p-6 backdrop-blur-sm">
            {/* CHECKPOINT OWNER/QUOTE MATTE PASS — matte navy card (same
                surface family as Review/choice cards, see quote-modal-matte),
                not glass-panel's glossy gradient/shine. Action hierarchy
                corrected: Keep editing (the safe/default action) is now the
                primary copper CTA — the exact quotePrimaryCtaSurface used by
                Continue/Submit — Save & close is the secondary outlined
                action, Discard and close stays the quiet destructive text
                action. Only the visual treatment and button order changed;
                every onClick handler below is unchanged from before this
                pass, so save-and-close, keep-editing and discard behavior
                are all identical to what they were. */}
            <div className="quote-modal-matte w-full max-w-sm rounded-2xl p-6 text-center">
              <p className="font-display text-base font-bold text-foreground">Leave this quote?</p>
              <p className="mt-2 text-sm text-foreground/70">
                Your progress is saved in this browser for this session.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCloseConfirm(false);
                    closeButtonRef.current?.focus();
                  }}
                  className={cn(
                    "font-display rounded-full px-5 py-2.5 text-xs font-bold tracking-[0.1em] uppercase",
                    quotePrimaryCtaSurface(false),
                  )}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="font-display rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold tracking-[0.1em] text-foreground/85 uppercase transition-colors hover:border-white/35"
                >
                  Save & close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleStartOver();
                    onClose();
                  }}
                  className="rounded text-xs font-semibold text-foreground/45 underline-offset-2 transition-colors hover:text-destructive hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive"
                >
                  Discard and close
                </button>
              </div>
            </div>
          </div>
        )}

        {/*
          Radix AlertDialog primitives (deliberately not the shared shadcn
          AlertDialogContent wrapper, which bakes in its own Portal/Overlay/
          positioning) drive the accessibility contract here — role="alertdialog",
          a focus trap, Escape isolated to only this layer (verified against
          the installed DismissableLayer: only the topmost registered layer
          reacts to Escape, so the outer Quote Experience Dialog is untouched),
          and auto-wired aria-labelledby/aria-describedby from Title/Description.
          No Portal is used, so this still renders in place as a plain
          absolutely-positioned overlay inside the shell — visual output is
          unchanged from the previous plain <div> version.
        */}
        <AlertDialogPrimitive.Root
          open={showStartOverConfirm}
          onOpenChange={(open) => {
            if (!open) {
              setShowStartOverConfirm(false);
              startOverButtonRef.current?.focus();
            }
          }}
        >
          <AlertDialogPrimitive.Content
            aria-modal="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              keepEditingButtonRef.current?.focus();
            }}
            className="absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-navy-deep/92 p-6 backdrop-blur-sm outline-none"
          >
            {/* CHECKPOINT OWNER/QUOTE MATTE PASS — same matte card + copper
                CTA token as the "Leave this quote?" dialog above; this one
                was missed in that pass (still glass-panel + the old
                --gradient-copper button), which is exactly why "Start over"
                looked unchanged. */}
            <div className="quote-modal-matte w-full max-w-sm rounded-2xl p-6 text-center">
              <AlertDialogPrimitive.Title className="font-display text-base font-bold text-foreground">
                Start over?
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-2 text-sm text-foreground/70">
                This clears everything you've entered and returns to Step 1.
              </AlertDialogPrimitive.Description>
              <div className="mt-5 flex flex-col gap-2">
                <AlertDialogPrimitive.Cancel asChild>
                  <button
                    ref={keepEditingButtonRef}
                    type="button"
                    className={cn(
                      "font-display rounded-full px-5 py-2.5 text-xs font-bold tracking-[0.1em] uppercase",
                      quotePrimaryCtaSurface(false),
                    )}
                  >
                    Keep editing
                  </button>
                </AlertDialogPrimitive.Cancel>
                <button
                  type="button"
                  onClick={() => {
                    handleStartOver();
                    startOverButtonRef.current?.focus();
                  }}
                  className="rounded text-xs font-semibold text-foreground/45 underline-offset-2 transition-colors hover:text-destructive hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive"
                >
                  Discard and start over
                </button>
              </div>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Root>

        {/* CHECKPOINT C2F-E/F: the active-submission close/Escape/overlay guard —
            same Radix AlertDialog mechanism as Start-over above (focus trap,
            isolated Escape, auto-wired labelling), triggered only while a real
            submission is in flight (see requestClose). */}
        <AlertDialogPrimitive.Root
          open={showSubmitCloseGuard}
          onOpenChange={(open) => {
            if (!open) setShowSubmitCloseGuard(false);
          }}
        >
          <AlertDialogPrimitive.Content
            aria-modal="true"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              continueSubmittingButtonRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              // Explicit, not Radix's own default restore-to-trigger behavior —
              // there is no registered Trigger for this manually-controlled
              // dialog, so this is the one place focus return is decided,
              // mirroring onOpenAutoFocus's own pattern above.
              event.preventDefault();
              closeButtonRef.current?.focus();
            }}
            className="absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-navy-deep/92 p-6 backdrop-blur-sm outline-none"
          >
            {/* CHECKPOINT OWNER/QUOTE MATTE PASS — same matte card + copper
                CTA token as the other two Quote dialogs, for consistency. */}
            <div className="quote-modal-matte w-full max-w-sm rounded-2xl p-6 text-center">
              <AlertDialogPrimitive.Title className="font-display text-base font-bold text-foreground">
                Still submitting your request
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-2 text-sm text-foreground/70">
                Closing now will stop the submission before it finishes. Your answers stay saved
                either way.
              </AlertDialogPrimitive.Description>
              <div className="mt-5 flex flex-col gap-2">
                <AlertDialogPrimitive.Cancel asChild>
                  <button
                    ref={continueSubmittingButtonRef}
                    type="button"
                    className={cn(
                      "font-display rounded-full px-5 py-2.5 text-xs font-bold tracking-[0.1em] uppercase",
                      quotePrimaryCtaSurface(false),
                    )}
                  >
                    Continue submitting
                  </button>
                </AlertDialogPrimitive.Cancel>
                <button
                  type="button"
                  onClick={handleStopAndClose}
                  className="rounded text-xs font-semibold text-foreground/45 underline-offset-2 transition-colors hover:text-destructive hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive"
                >
                  Stop and close
                </button>
              </div>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Root>

        {/* Row 1 — header/progress, auto height. C2L-Q3: leaner top header,
            just logo + close; "Start over" lives in the footer beside Back;
            the progress row no longer repeats the current stage name on
            desktop (QuoteProgress's own label row already shows it). */}
        <div
          className="border-b border-white/10 bg-navy-deep/50 px-5 py-2.5 sm:px-8"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center justify-between gap-4">
            <img
              src={msmLogo}
              alt="MSM Scrap"
              width={1174}
              height={417}
              className="h-6 w-auto shrink-0"
            />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={requestClose}
              aria-label="Close quote experience"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2">
            <QuoteProgress step={stage} />
          </div>
        </div>

        {/* Row 2 — the ONE scrollable region (minmax(0,1fr)): min-h-0 lets
            the grid track shrink below its content's natural height so
            overflow-y-auto actually engages instead of the row growing to
            fit everything; overscroll-contain stops scroll chaining to the
            page behind the shell. */}
        <div
          ref={scrollRef}
          className="quote-scroll min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-[#080A1D] px-5 py-6 sm:px-8 lg:px-12"
        >
          <div
            ref={stepContentRef}
            tabIndex={-1}
            className={`mx-auto w-full max-w-2xl outline-none lg:max-w-[1140px] ${
              // C2L-Q5 — Request (stage 1) is the one short stage whose
              // content never overflows the viewport, so vertically
              // centering it here is safe (no risk of scrolling past the
              // top of taller content, which this is deliberately never
              // applied to). Every other stage keeps its normal top-
              // aligned flow — shell/header/footer geometry is untouched.
              !confirmation && stage === 1 ? "flex min-h-full flex-col justify-center" : ""
            }`}
          >
            {stepContent}
          </div>
        </div>

        {/* Row 3 — action footer, auto height, a plain static sibling of
            the scroll body (never sticky/fixed/absolute). C2L-Q (review
            scroll architecture fix): this is now the ONE shared footer for
            all 5 stages, not just 1-4 — Review's primary action renders
            here via primaryAction instead of Review owning its own second,
            sticky footer inside the scroll body. */}
        {!confirmation && (
          <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <QuoteNavigation
              step={stage}
              totalSteps={QUOTE_TOTAL_STAGES}
              onBack={handleBack}
              onContinue={handleContinue}
              continueLabel={stage === 4 ? "Review Request" : undefined}
              continueDisabled={continueDisabled}
              onStartOver={requestStartOver}
              showStartOver={hasMeaningfulProgress}
              startOverDisabled={isSubmitting}
              startOverButtonRef={startOverButtonRef}
              primaryAction={
                stage === QUOTE_TOTAL_STAGES ? (
                  <ReviewSubmitButton
                    values={form.getValues()}
                    onSubmit={handleSubmit}
                    isSubmitting={isSubmitting}
                    submissionOutcome={submissionOutcome}
                    turnstileReady={!!turnstileToken}
                  />
                ) : undefined
              }
            />
          </div>
        )}
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
        <div className="glass-panel glass-ring flex h-dvh flex-col overflow-hidden rounded-none md:h-[min(74dvh,620px)] md:w-[min(86vw,1360px)] md:rounded-3xl">
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
        className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none md:h-[min(74dvh,620px)] md:max-h-[min(74dvh,620px)] md:w-[min(86vw,1360px)] md:max-w-[min(86vw,1360px)] md:rounded-3xl [&>button]:hidden"
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
