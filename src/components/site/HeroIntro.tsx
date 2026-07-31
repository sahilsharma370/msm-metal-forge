import { useEffect, useState } from "react";

/** One-time brushed-metal diagonal panel wipe on initial page load. */
export function HeroIntro() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGone(true), 2000);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(0 0, 100% 0, 0 100%)",
          background:
            "linear-gradient(120deg, oklch(0.17 0.05 265) 0%, oklch(0.30 0.07 265) 42%, oklch(0.40 0.06 264) 55%, oklch(0.20 0.055 265) 100%)",
          animation: "panel-wipe-left 1.15s cubic-bezier(0.76, 0, 0.24, 1) 0.45s both",
        }}
      >
        <div
          className="absolute inset-y-[-40%] left-0 w-1/3 opacity-70"
          style={{
            background:
              "linear-gradient(90deg, transparent, oklch(0.85 0.03 260 / 0.35), transparent)",
            animation: "sheen-sweep 1.5s ease-in-out 0.15s both",
          }}
        />
      </div>

      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(100% 0, 100% 100%, 0 100%)",
          background:
            "linear-gradient(120deg, oklch(0.40 0.10 42) 0%, oklch(0.60 0.135 46) 40%, oklch(0.80 0.09 62) 54%, oklch(0.45 0.11 42) 100%)",
          animation: "panel-wipe-right 1.15s cubic-bezier(0.76, 0, 0.24, 1) 0.45s both",
        }}
      >
        <div
          className="absolute inset-y-[-40%] left-0 w-1/3 opacity-70"
          style={{
            background:
              "linear-gradient(90deg, transparent, oklch(0.95 0.05 75 / 0.45), transparent)",
            animation: "sheen-sweep 1.5s ease-in-out 0.15s both",
          }}
        />
      </div>
    </div>
  );
}