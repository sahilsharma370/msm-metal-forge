import { useEffect, useState } from "react";

/** One-time metal-slice entrance: two blades shear past each other along a diagonal cut. */
export function HeroIntro() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGone(true), 2200);
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
          animation: "slice-shear-a 1.35s cubic-bezier(0.7, 0, 0.2, 1) 0.4s both",
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
          animation: "slice-shear-b 1.35s cubic-bezier(0.7, 0, 0.2, 1) 0.4s both",
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

      {/* Bright cut-line highlight along the diagonal seam */}
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="h-[3px] w-[200vmax] origin-center"
          style={{
            background:
              "linear-gradient(90deg, transparent, oklch(0.95 0.06 70 / 0.9) 18%, oklch(1 0 0 / 1) 50%, oklch(0.95 0.06 70 / 0.9) 82%, transparent)",
            boxShadow: "0 0 26px 6px oklch(0.85 0.12 62 / 0.55)",
            filter: "blur(0.4px)",
            animation: "seam-flash 1.5s cubic-bezier(0.7, 0, 0.2, 1) 0.35s both",
          }}
        />
      </div>
    </div>
  );
}