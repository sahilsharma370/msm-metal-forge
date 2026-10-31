export function YearsBadge({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="font-display text-2xl leading-none font-bold text-copper-metal sm:text-3xl">
        14+
      </div>
      <div className="mt-1 h-px w-12 bg-gradient-to-r from-copper to-transparent" />
      <div className="label-eyebrow mt-1.5 text-[0.6rem] text-[oklch(0.81_0.02_258)]">
        Years of Trust
      </div>
    </div>
  );
}