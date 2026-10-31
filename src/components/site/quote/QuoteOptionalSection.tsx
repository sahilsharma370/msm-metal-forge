import { useState } from "react";
import { Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface QuoteOptionalSectionProps {
  /** e.g. "Add more details (optional)" — shown on the trigger button. */
  label: string;
  children: React.ReactNode;
  /** Starts expanded when the field(s) inside already carry a saved value (e.g. from a restored draft) or an error — never hides an already-answered or invalid field behind a closed toggle. */
  defaultOpen?: boolean;
}

/**
 * C2L-Q1 — the shared "+ Add X (optional)" disclosure used across every
 * stage to defer already-optional fields. A real button (Radix
 * CollapsibleTrigger) with `aria-expanded`, keyboard-operable, no new
 * dependency (@radix-ui/react-collapsible was already installed).
 */
export function QuoteOptionalSection({
  label,
  children,
  defaultOpen = false,
}: QuoteOptionalSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6">
      <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-foreground/70 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">
        <Plus
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-45" : ""}`}
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
