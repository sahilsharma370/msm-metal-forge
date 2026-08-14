import type { QuoteSubmissionOutcome, QuoteSubmissionProgressEvent } from "./quote-submission-engine";

/**
 * CHECKPOINT C2F-E/F: pure outcome/progress -> customer-safe copy mapping.
 * Kept separate from any component so every one of the engine's outcome
 * kinds is exhaustively handled (a missing `case` is a TypeScript error,
 * not a silently-blank banner) and independently unit-testable without
 * rendering anything. Every message here is static, hand-written copy —
 * never the server's own error.message, never a field path, never an id.
 */

export function progressPhaseText(phase: QuoteSubmissionProgressEvent | null): string {
  if (!phase) return "";
  switch (phase.phase) {
    case "computing_identity":
      return "Validating details…";
    case "initiating":
      return "Creating or recovering your enquiry…";
    case "resolving_slots":
      return "Preparing your files…";
    case "uploading":
      return `Uploading file ${phase.uploadedCount + 1} of ${phase.totalCount}…`;
    case "completing":
      return "Finalizing your enquiry…";
  }
}

export type SubmissionBannerTone = "retryable" | "terminal" | "conflict";

export interface SubmissionBanner {
  readonly tone: SubmissionBannerTone;
  readonly message: string;
  readonly showRetry: boolean;
}

/**
 * Review-step banner for outcomes that stay on (or return to) Review.
 * Returns null for outcomes handled entirely elsewhere: `success` (the
 * confirmation screen replaces Review outright), `aborted` (an intentional
 * user cancellation is never shown as an error), and
 * `needs_reselection`/`content_mismatch` (those navigate to the
 * Photos/Documents step, where a more specific, field-aware notice is
 * shown instead).
 *
 * `validation_error`/`server_rejected` DO return a banner here — normally
 * QuoteExperience navigates the customer straight to the earliest step
 * whose own schema still disagrees (findFirstInvalidStep), and that step's
 * own per-field errors are what's actually visible, so this banner is
 * usually not seen. It exists as the fallback for the one edge case where
 * every individual step schema happens to already pass locally but the
 * server still rejected the request — no field to point at, so a Review
 * banner is the only honest place left to say something rather than
 * silently doing nothing.
 */
export function outcomeBanner(outcome: QuoteSubmissionOutcome): SubmissionBanner | null {
  switch (outcome.kind) {
    case "success":
    case "aborted":
    case "needs_reselection":
    case "content_mismatch":
      return null;
    case "validation_error":
    case "server_rejected":
      return {
        tone: "retryable",
        message: "A few details couldn't be validated — please review your answers and try again.",
        showRetry: false,
      };
    case "upload_in_progress":
      return {
        tone: "retryable",
        message: "One of your files is still being processed. Please wait a moment and try again.",
        showRetry: true,
      };
    case "network_error":
      return {
        tone: "retryable",
        message: "We couldn't reach MSM Scrap — please check your connection and try again.",
        showRetry: true,
      };
    case "server_error":
      return {
        tone: "retryable",
        message: "Something went wrong on our end. Please try again.",
        showRetry: true,
      };
    case "not_ready":
      return {
        tone: "retryable",
        message: "Your files are still finishing up — please try again in a moment.",
        showRetry: true,
      };
    case "upload_failed":
      return {
        tone: "retryable",
        message: "One of your files couldn't be uploaded. Please try again.",
        showRetry: true,
      };
    case "idempotency_conflict":
      return {
        tone: "conflict",
        message:
          "This request couldn't be confirmed automatically. Please contact us on WhatsApp so we can help directly.",
        showRetry: false,
      };
    case "restart_required":
      return {
        tone: "terminal",
        message:
          "This enquiry couldn't be completed with the files provided. Please contact us on WhatsApp, or start over to submit it as a new enquiry.",
        showRetry: false,
      };
  }
}

/** Filenames the customer needs to (re)add — used to jump to and annotate the Photos/Documents step. */
export function unresolvedFilenames(outcome: QuoteSubmissionOutcome, mismatchFilename?: string): readonly string[] {
  if (outcome.kind === "needs_reselection") {
    return outcome.slots.map((s) => s.declaration.originalFilename);
  }
  if (outcome.kind === "content_mismatch" && mismatchFilename) {
    return [mismatchFilename];
  }
  return [];
}
