import { QUOTE_STAGE_NAMES, QUOTE_TOTAL_STAGES } from "./quote-options";

interface QuoteProgressProps {
  /** The current STAGE (1-5) — the customer-facing 5-stage presentation, not the internal wizard step. */
  step: number;
  compact?: boolean;
}

/**
 * C2L-Q2/Q3 — the compact top-header progress control that replaces the
 * former left sidebar entirely. Desktop shows all 5 short labels under the
 * segments, so the eyebrow there is just "Step X of 5" — repeating the
 * current stage name in both places was exactly the duplication C2L-Q3
 * removed. Mobile hides that label row (no room), so the eyebrow keeps its
 * "· <label>" suffix there — the only place the current stage name is
 * legible on small screens. Completed/current/upcoming states are
 * distinguished by weight/underline as well as colour, not colour alone —
 * C2Q-FINAL also tiers the segment bar itself: current = full-opacity
 * copper, completed = a restrained 65%-opacity copper (a quieter
 * "confirmed" treatment, not identical to the active segment), pending =
 * muted white.
 *
 * C2Q-FINAL-V2 — segments and their labels now share one 5-column grid (one
 * column per stage) instead of a flex segment row plus a separately
 * `justify-between` label row: `justify-between` pins the first and last
 * labels flush to the row's own edges, while a grid column centres each
 * label under its own segment and leaves it inset from the shell edge by
 * however much narrower the label text is than its column — exactly once,
 * from one shared source, rather than two rows that merely happen to line
 * up.
 */
export function QuoteProgress({ step, compact = false }: QuoteProgressProps) {
  const currentName = QUOTE_STAGE_NAMES[step - 1] ?? "";

  return (
    <div className="space-y-1.5">
      <p className="label-eyebrow text-copper-bright">
        Step {step} of {QUOTE_TOTAL_STAGES}
        <span className="sm:hidden"> · {currentName}</span>
      </p>
      <div
        className="grid grid-cols-5 gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={QUOTE_TOTAL_STAGES}
        aria-valuenow={step}
      >
        {QUOTE_STAGE_NAMES.map((name, i) => {
          const segment = i + 1;
          const isCurrent = segment === step;
          const isComplete = segment < step;
          return (
            <div key={name} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1 w-full rounded-full transition-colors duration-300 ${
                  isCurrent ? "bg-copper" : isComplete ? "bg-copper/65" : "bg-white/12"
                }`}
              />
              {!compact && (
                <span
                  className={`hidden text-center text-[0.68rem] font-semibold tracking-[0.02em] sm:block ${
                    isCurrent
                      ? "text-copper-bright underline underline-offset-4"
                      : isComplete
                        ? "text-foreground/60"
                        : "text-foreground/40"
                  }`}
                >
                  {name}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
