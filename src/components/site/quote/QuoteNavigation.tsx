import type { ReactNode, Ref } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** C2Q-FINAL-V2 — the public Hero/Header "Get a Quote" CTA's own token
 * (--gradient-copper-cta) and hover/focus treatment, reused as-is (not
 * duplicated as new colour literals) for every primary Quote action:
 * Continue, Review Request, Submit Request and Retry Submission. At rest
 * there is no box-shadow glow (the previous permanent copper halo is
 * removed); hover/keyboard-focus only shift text to the public CTA's cream
 * (#EDE8D0) with its matching dark-navy text-shadow, plus a tiny brightness
 * lift and a motion-safe-gated scale nudge. Exported so ReviewStep's Submit
 * button can share the exact same surface without re-declaring it. */
const QUOTE_PRIMARY_CTA_ENABLED =
  "bg-[image:var(--gradient-copper-cta)] text-[#080A1D] transition-[color,filter,transform] duration-200 hover:text-[#EDE8D0] hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] hover:brightness-110 focus-visible:text-[#EDE8D0] focus-visible:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] focus-visible:brightness-110 motion-safe:hover:scale-[1.02] motion-safe:focus-visible:scale-[1.02]";
const QUOTE_PRIMARY_CTA_DISABLED = "cursor-not-allowed bg-white/8 text-foreground/35";

export function quotePrimaryCtaSurface(disabled: boolean) {
  return disabled ? QUOTE_PRIMARY_CTA_DISABLED : QUOTE_PRIMARY_CTA_ENABLED;
}

interface QuoteNavigationProps {
  step: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string | undefined;
  continueDisabled?: boolean;
  /** C2L-Q3 — "Start over" moved out of the header into this quiet, tertiary spot beside Back; shown only once there's something to lose. */
  onStartOver?: () => void;
  showStartOver?: boolean;
  startOverDisabled?: boolean;
  startOverButtonRef?: Ref<HTMLButtonElement>;
  /** C2L-Q (review scroll architecture fix) — when provided, replaces the
   * built-in Continue button with a caller-supplied primary action (Review's
   * Submit/Retry button), so this one shared, always-static footer serves
   * all five stages instead of Review owning a second, sticky one. */
  primaryAction?: ReactNode;
}

export function QuoteNavigation({
  step,
  totalSteps,
  onBack,
  onContinue,
  continueLabel,
  continueDisabled = false,
  onStartOver,
  showStartOver = false,
  startOverDisabled = false,
  startOverButtonRef,
  primaryAction,
}: QuoteNavigationProps) {
  return (
    <div className="flex min-h-[72px] items-center justify-between gap-3 border-t border-white/10 bg-navy-deep/95 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          disabled={step === 1}
          className="font-display inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold tracking-[0.12em] text-foreground/85 uppercase transition-colors hover:border-white/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-0"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back
        </button>
        {showStartOver && (
          <button
            ref={startOverButtonRef}
            type="button"
            onClick={onStartOver}
            disabled={startOverDisabled}
            aria-disabled={startOverDisabled}
            className="rounded text-xs font-semibold text-foreground/45 underline-offset-2 hover:text-foreground/75 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
          >
            Start over
          </button>
        )}
      </div>

      <div className="ml-auto flex justify-end">
        {primaryAction ?? (
          <button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled}
            aria-disabled={continueDisabled}
            className={cn(
              "font-display inline-flex items-center gap-2 rounded-full px-7 py-3 text-xs font-bold tracking-[0.12em] whitespace-nowrap uppercase",
              quotePrimaryCtaSurface(continueDisabled),
            )}
          >
            {continueLabel ?? (step === totalSteps ? "Submit" : "Continue")}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
