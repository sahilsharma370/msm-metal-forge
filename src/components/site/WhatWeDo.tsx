import { useEffect, useRef, useState } from "react";
import { DotGrid } from "./DotGrid";
import hexNut from "@/assets/hex-nut.png";

/** Clockwise order: Buy (top) → Export (right) → Sell (bottom) → Import (left).
 *  Each beam is a gently waving flame path from the hex nut out to its tag. */
const BEAMS = [
  {
    label: "Buy",
    d: "M250 152 C 258 128, 242 108, 250 72",
    pos: "top-1 left-1/2 -translate-x-1/2",
  },
  {
    label: "Export",
    d: "M348 250 C 372 258, 392 242, 428 250",
    pos: "right-0 top-1/2 -translate-y-1/2",
  },
  {
    label: "Sell",
    d: "M250 348 C 242 372, 258 392, 250 428",
    pos: "bottom-1 left-1/2 -translate-x-1/2",
  },
  {
    label: "Import",
    d: "M152 250 C 128 242, 108 258, 72 250",
    pos: "left-0 top-1/2 -translate-y-1/2",
  },
];

/** Layered strokes: wide soft flame body → warm mid glow → bright white-hot core. */
const FLAME_LAYERS = [
  { w: 18, o: 0.12, color: "url(#flameWarm)", blur: "url(#flameWobble)" },
  { w: 11, o: 0.28, color: "url(#flameWarm)", blur: "url(#flameWobble)" },
  { w: 5, o: 0.7, color: "url(#flameCore)", blur: "url(#flameSoft)" },
  { w: 1.8, o: 1, color: "#FFF3DC", blur: undefined },
];

export function WhatWeDo() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = (vh * 0.85 - rect.top) / (rect.height * 0.75);
      setProgress(Math.min(Math.max(raw, 0), 1));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section className="relative overflow-hidden bg-navy py-28">
      <DotGrid glow={0.9} />
      <div ref={sectionRef} className="relative mx-auto max-w-5xl px-6 text-center">
        <p className="label-eyebrow text-copper/90">Our Services</p>
        <h3 className="font-display mt-4 text-2xl font-bold sm:text-3xl">
          What We <span className="text-copper">Do</span>
        </h3>

        <div className="relative mx-auto mt-10 aspect-square w-full max-w-[500px]">
          <svg viewBox="0 0 500 500" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <radialGradient id="flameWarm" gradientUnits="userSpaceOnUse" cx="250" cy="250" r="220">
                <stop offset="0%" stopColor="#FFD9A0" />
                <stop offset="45%" stopColor="#E8871F" />
                <stop offset="100%" stopColor="#C1622E" />
              </radialGradient>
              <radialGradient id="flameCore" gradientUnits="userSpaceOnUse" cx="250" cy="250" r="220">
                <stop offset="0%" stopColor="#FFF6E4" />
                <stop offset="60%" stopColor="#FFC66B" />
                <stop offset="100%" stopColor="#F09030" />
              </radialGradient>
              <filter id="flameWobble" x="-60%" y="-60%" width="220%" height="220%">
                <feTurbulence type="fractalNoise" baseFrequency="0.022 0.05" numOctaves="2" seed="7">
                  <animate
                    attributeName="baseFrequency"
                    dur="7s"
                    values="0.022 0.05;0.034 0.062;0.022 0.05"
                    repeatCount="indefinite"
                  />
                </feTurbulence>
                <feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G" />
                <feGaussianBlur stdDeviation="4" />
              </filter>
              <filter id="flameSoft" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="2.2" />
              </filter>
              <radialGradient id="nutHalo" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#FFB864" stopOpacity="0.5" />
                <stop offset="70%" stopColor="#C1622E" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#C1622E" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx="250" cy="250" r="160" fill="url(#nutHalo)" />

            {BEAMS.map((beam, i) => {
              const local = Math.min(Math.max(progress * BEAMS.length - i, 0), 1);
              return (
                <g key={beam.label} opacity={local > 0.01 ? 1 : 0}>
                  {FLAME_LAYERS.map((layer) => (
                    <path
                      key={layer.w}
                      d={beam.d}
                      fill="none"
                      stroke={layer.color}
                      strokeOpacity={layer.o}
                      strokeWidth={layer.w}
                      strokeLinecap="round"
                      filter={layer.blur}
                      pathLength={1}
                      strokeDasharray="1"
                      strokeDashoffset={1 - local}
                      style={{
                        transition: "stroke-dashoffset 120ms linear",
                        animation:
                          layer.w > 2
                            ? `flame-flicker ${2.2 + layer.w * 0.12}s ease-in-out infinite`
                            : undefined,
                      }}
                    />
                  ))}
                </g>
              );
            })}
          </svg>

          <img
            src={hexNut}
            alt=""
            width={1024}
            height={1024}
            loading="lazy"
            className="absolute top-1/2 left-1/2 w-[42%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_18px_40px_oklch(0.12_0.05_265/0.8)]"
          />

          {BEAMS.map((beam, i) => {
            const local = Math.min(Math.max(progress * BEAMS.length - i, 0), 1);
            return (
              <div
                key={beam.label}
                className={`absolute ${beam.pos}`}
                style={{ opacity: local, transition: "opacity 300ms ease-out" }}
              >
                <div className="diagonal-tag font-display bg-copper px-8 py-2.5 text-xs font-semibold tracking-[0.18em] text-primary-foreground uppercase">
                  {beam.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}