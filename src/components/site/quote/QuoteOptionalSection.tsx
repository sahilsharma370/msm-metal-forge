import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface QuoteOptionalSectionProps {
  /** e.g. "Add more details (optional)" — shown on the trigger button. */
  label: string;
  children: React.ReactNode;
  /** Starts expanded when the field(s) inside already carry a saved value (e.g. from a restored draft) or an error — never hides an already-answered or invalid field behind a closed toggle. */
  defaultOpen?: boolean;
  /** BATCH E2 — defaults to the original plus-rotated-45-to-× look (every
   * existing call site keeps that exact behaviour unchanged); Step 2 opts
   * into "minus" so the expanded state never reads as "delete this". */
  expandedIcon?: "x" | "minus";
}

/**
 * C2L-Q1 — the shared "+ Add X (optional)" disclosure used across every
 * stage to defer already-optional fields. A real button (Radix
 * CollapsibleTrigger) with `aria-expanded`, keyboard-operable, no new
 * dependency (@radix-ui/react-collapsible was already installed).
 *
 * Reference-pack update — the trigger is now the same bordered, full-width
 * row used everywhere in the approved mockups (Material/Logistics/Contact
 * all show "+ Add X (optional)" as one consistent quiet row, not a plain
 * text link), matching what ContactEvidenceStep's own Photos/Documents
 * disclosure already hand-rolled. This is the one shared component behind
 * every optional-section trigger in the wizard, so the change is uniform
 * across every stage without touching each call site.
 */
export function QuoteOptionalSection({
  label,
  children,
  defaultOpen = false,
  expandedIcon = "x",
}: QuoteOptionalSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4 sm:mt-6">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-navy-deep/95 px-4 py-3 text-left text-sm font-semibold text-foreground/85 transition-colors hover:border-copper/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">
        {expandedIcon === "minus" ? (
          open ? (
            <Minus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
          ) : (
            <Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
          )
        ) : (
          <Plus
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-foreground/60 transition-transform ${open ? "rotate-45" : ""}`}
          />
        )}
        <span className="truncate">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
