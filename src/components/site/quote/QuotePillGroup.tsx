interface QuotePillOption {
  value: string;
  label: string;
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
}: QuotePillGroupProps) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground/90">{label}</p>
      <div
        className={
          columnsClassName ? `mt-2.5 grid gap-2 ${columnsClassName}` : "mt-2.5 flex flex-wrap gap-2"
        }
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        aria-disabled={disabled}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`font-display rounded-full border px-3 py-2 text-center text-xs font-semibold tracking-[0.04em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              value === opt.value
                ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright shadow-[0_0_12px_-4px_oklch(0.583_0.135_45.5/0.5)]"
                : "border-white/12 bg-navy-deep/95 text-foreground/75 hover:border-copper/40"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[0.8rem] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
