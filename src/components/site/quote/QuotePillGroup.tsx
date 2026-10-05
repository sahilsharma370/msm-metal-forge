import type { ReactNode } from "react";
import { Check } from "lucide-react";

interface QuotePillOption {
  value: string;
  label: string;
  /** Tile variant only — plain pills never render an icon, matching the reference (Unit/Condition/Preferred contact stay text-only). */
  icon?: ReactNode;
}

interface QuotePillGroupProps {
  label: string;
  options: QuotePillOption[];
  value: string | undefined;
  onChange: (value: string) => void;
  ariaLabel?: string;
  error?: string | undefined;
  /** Disables every pill — used when an unrelated choice (e.g. "not sure of quantity") makes this group irrelevant, mirroring what validation already expects. */
  disabled?: boolean;
  /**
   * C2L-Q3 — opts a specific pill group into an even grid instead of the
   * default flex-wrap (which produces an awkward uneven last row for
   * option counts like Emirates' 7). Pass full responsive grid-cols
   * classes, e.g. "grid-cols-4 sm:grid-cols-7". Every other call site
   * omits this and keeps the original flex-wrap behaviour unchanged.
   */
  columnsClassName?: string;
  /**
   * Reference-pack addition — "tile" opts into the larger bordered-box
   * treatment the mockups use for Emirate/Pickup/Fulfilment/Trade-route
   * (bigger touch target, rounded-xl not rounded-full, a checkmark badge
   * on selection instead of just a colour/border shift, optional icon).
   * Defaults to "pill", which is byte-for-byte the original rendering —
   * every existing call site (Unit, Condition, Preferred contact) is
   * unaffected unless it explicitly opts in.
   */
  variant?: "pill" | "tile";
  /** Batch A — matches the underlying form field name (e.g. "sellerCondition"), so QuoteValidationSummary's field links can `document.getElementById(field)?.scrollIntoView(...)` for pill/tile-driven fields exactly like it already does for registered `<input>`s (which get their id from `id="..."` + `form.register(...)`). Omitted call sites are unaffected — no id, no change in behaviour. */
  id?: string;
}

/** Compact single-select pill group — the site's alternative to a generic radio list. */
export function QuotePillGroup({
  label,
  options,
  value,
  onChange,
  ariaLabel,
  error,
  disabled = false,
  columnsClassName,
  variant = "pill",
  id,
}: QuotePillGroupProps) {
  const isTile = variant === "tile";
  return (
    // Final correction pass — `min-w-0` so this never resists shrinking when
    // it's a grid/flex item next to another field (e.g. Step 3's Area +
    // Pickup row): no visual change on its own, it only stops this from
    // forcing a wider-than-viewport row when paired with one.
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground/90">{label}</p>
      <div
        id={id}
        className={
          columnsClassName ? `mt-2.5 grid gap-2 ${columnsClassName}` : "mt-2.5 flex flex-wrap gap-2"
        }
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        aria-disabled={disabled}
      >
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={
                isTile
                  ? `group font-display relative flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-center text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper disabled:cursor-not-allowed disabled:opacity-40 ${
                      selected
                        ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.12)] text-copper-bright"
                        : "border-white/12 bg-navy-deep/95 text-foreground/85 hover:border-copper/40"
                    }`
                  : `group font-display inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-center text-xs font-semibold tracking-[0.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:min-w-0 ${
                      selected
                        ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright shadow-[0_0_12px_-4px_oklch(0.583_0.135_45.5/0.5)]"
                        : "border-white/12 bg-navy-deep/95 text-foreground/75 hover:border-copper/40"
                    }`
              }
            >
              {opt.icon && (
                <span
                  className={
                    selected
                      ? "text-copper-bright"
                      : "text-foreground/85 transition-colors group-hover:text-foreground/95"
                  }
                >
                  {opt.icon}
                </span>
              )}
              {opt.label}
              {isTile && selected && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-copper text-[#080A1D]">
                  <Check aria-hidden="true" strokeWidth={3} className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[0.8rem] font-medium" style={{ color: "#C9655A" }}>
          {error}
        </p>
      )}
    </div>
  );
}
