import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuoteNavigationProps {
  step: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string | undefined;
  continueDisabled?: boolean;
}

export function QuoteNavigation({
  step,
  totalSteps,
  onBack,
  onContinue,
  continueLabel,
  continueDisabled = false,
}: QuoteNavigationProps) {
  return (
    <div className="flex min-h-[80px] items-center justify-between gap-3 border-t border-white/10 bg-navy-deep/70 px-5 py-5 backdrop-blur-md sm:px-8">
      <button
        type="button"
        onClick={onBack}
        disabled={step === 1}
        className="font-display inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-xs font-bold tracking-[0.12em] text-foreground/85 uppercase transition-colors hover:border-white/35 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-0"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        Back
      </button>

      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        aria-disabled={continueDisabled}
        className={cn(
          "font-display inline-flex items-center gap-2 rounded-full px-7 py-3 text-xs font-bold tracking-[0.12em] whitespace-nowrap uppercase transition-transform",
          continueDisabled
            ? "cursor-not-allowed bg-white/8 text-foreground/35"
            : "bg-[image:var(--gradient-copper)] text-[#080A1D] shadow-[0_10px_30px_-10px_oklch(0.583_0.135_45.5/0.9)] hover:scale-[1.02]",
        )}
      >
        {continueLabel ?? (step === totalSteps ? "Submit" : "Continue")}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
