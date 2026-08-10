import { QUOTE_STEP_NAMES, QUOTE_TOTAL_STEPS } from "./quote-options";

interface QuoteProgressProps {
  step: number;
  compact?: boolean;
  stepNameOverride?: string | undefined;
}

export function QuoteProgress({ step, compact = false, stepNameOverride }: QuoteProgressProps) {
  const currentName = stepNameOverride ?? QUOTE_STEP_NAMES[step - 1] ?? "";

  return (
    <div className={compact ? "" : "space-y-3"}>
      <div>
        <p className="label-eyebrow text-copper-bright">
          Step {step} of {QUOTE_TOTAL_STEPS}
        </p>
        {!compact && (
          <p className="font-display mt-1 text-sm font-semibold text-foreground/90">
            {currentName}
          </p>
        )}
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={QUOTE_TOTAL_STEPS}
        aria-valuenow={step}
      >
        {Array.from({ length: QUOTE_TOTAL_STEPS }, (_, i) => i + 1).map((segment) => (
          <span
            key={segment}
            aria-hidden="true"
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              segment <= step ? "bg-copper" : "bg-white/12"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
