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
}

/** Compact single-select pill group — the site's alternative to a generic radio list. */
export function QuotePillGroup({
  label,
  options,
  value,
  onChange,
  ariaLabel,
  error,
}: QuotePillGroupProps) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground/90">{label}</p>
      <div
        className="mt-2.5 flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={ariaLabel ?? label}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`font-display rounded-full border px-4 py-2 text-xs font-semibold tracking-[0.04em] transition-colors ${
              value === opt.value
                ? "border-copper/70 bg-[oklch(0.583_0.135_45.5/0.16)] text-copper-bright"
                : "glass-panel border-white/12 text-foreground/75 hover:border-copper/40"
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
