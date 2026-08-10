import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuoteOptionCardProps {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}

/** Shared selectable-card look for Step 1 (intent) and Step 2 (material). */
export function QuoteOptionCard({
  eyebrow,
  title,
  description,
  icon,
  selected,
  onSelect,
  className,
}: QuoteOptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "glass-panel relative flex w-full flex-col items-start gap-2 rounded-2xl border border-white/10 p-5 text-left transition-[border-color,background-color,box-shadow] duration-300 hover:border-copper/45",
        selected &&
          "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.12)] shadow-[0_0_0_1px_oklch(0.583_0.135_45.5/0.35)]",
        className,
      )}
    >
      {selected && (
        <span className="absolute top-4 right-4 flex h-5 w-5 items-center justify-center rounded-full bg-copper text-[#080A1D]">
          <Check aria-hidden="true" strokeWidth={3} className="h-3 w-3" />
        </span>
      )}
      {icon}
      {eyebrow && <p className="label-eyebrow text-copper-bright text-[0.65rem]">{eyebrow}</p>}
      <p className="font-display text-lg font-bold text-foreground">{title}</p>
      {description && (
        <p className="text-sm leading-relaxed font-normal text-foreground/70">{description}</p>
      )}
    </button>
  );
}
