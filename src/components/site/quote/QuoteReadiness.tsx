import { Check, Circle, CircleAlert, Sparkles } from "lucide-react";
import type { ReadinessItem } from "./quote-summary";

interface QuoteReadinessProps {
  items: ReadinessItem[];
  compact?: boolean;
  /** Display-only overrides keyed by `item.key` — never changes the underlying data. */
  labelOverrides?: Record<string, string> | undefined;
}

const STATE_ICON: Record<ReadinessItem["state"], typeof Check> = {
  complete: Check,
  needs_attention: CircleAlert,
  not_added_yet: Circle,
  recommended: Sparkles,
};

const STATE_STYLES: Record<ReadinessItem["state"], string> = {
  complete: "text-copper-bright",
  needs_attention: "text-foreground/60",
  not_added_yet: "text-foreground/35",
  recommended: "text-foreground/55",
};

const STATE_LABEL: Record<ReadinessItem["state"], string> = {
  complete: "Complete",
  needs_attention: "Needs attention",
  not_added_yet: "Not added yet",
  recommended: "Recommended",
};

export function QuoteReadiness({ items, compact = false, labelOverrides }: QuoteReadinessProps) {
  return (
    <div>
      <p className="label-eyebrow text-foreground/55">Quote Readiness</p>
      <ul className={compact ? "mt-2 flex flex-wrap gap-x-4 gap-y-1.5" : "mt-3 space-y-2"}>
        {items.map((item) => {
          const Icon = STATE_ICON[item.state];
          const label = labelOverrides?.[item.key] ?? item.label;
          return (
            <li key={item.key} className="flex items-center gap-2 text-xs">
              <Icon
                aria-hidden="true"
                strokeWidth={2.4}
                className={`h-3.5 w-3.5 shrink-0 ${STATE_STYLES[item.state]}`}
              />
              <span className="whitespace-nowrap text-foreground/80">{label}</span>
              {!compact && (
                <span
                  className={`ml-auto shrink-0 text-[0.68rem] font-medium whitespace-nowrap ${STATE_STYLES[item.state]}`}
                >
                  {STATE_LABEL[item.state]}
                </span>
              )}
              <span className="sr-only">{!compact ? "" : `: ${STATE_LABEL[item.state]}`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
