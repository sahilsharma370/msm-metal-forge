import { useEffect, useRef, useState } from "react";
import { DotGrid } from "./DotGrid";

/** Clockwise order: Buy (top) → Export (right) → Sell (bottom) → Import (left) */
const BEAMS = [
  { label: "Buy", x1: 250, y1: 150, x2: 250, y2: 70, pos: "top-1 left-1/2 -translate-x-1/2" },
  { label: "Export", x1: 350, y1: 250, x2: 430, y2: 250, pos: "right-0 top-1/2 -translate-y-1/2" },
  { label: "Sell", x1: 250, y1: 350, x2: 250, y2: 430, pos: "bottom-1 left-1/2 -translate-x-1/2" },
  { label: "Import", x1: 150, y1: 250, x2: 70, y2: 250, pos: "left-0 top-1/2 -translate-y-1/2" },
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
        <h2 className="font-display mt-4 text-3xl font-semibold tracking-[0.02em] uppercase sm:text-4xl">
          A full-cycle scrap trading partner
        </h2>

        <h3 className="font-display mt-16 text-2xl font-bold sm:text-3xl">
          What We <span className="text-copper">Do</span>
        </h3>

        <div className="relative mx-auto mt-10 aspect-square w-full max-w-[500px]">
          <svg viewBox="0 0 500 500" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <radialGradient id="filament" gradientUnits="userSpaceOnUse" cx="250" cy="250" r="200">
                <stop offset="0%" stopColor="#FBE6CC" />
                <stop offset="55%" stopColor="#E08B3F" />
                <stop offset="100%" stopColor="#C1622E" />
              </radialGradient>
              <filter
                id="filamentGlow"
                filterUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="500"
                height="500"
              >
                <feGaussianBlur stdDeviation="5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="boltFace" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#E8EDF6" />
                <stop offset="28%" stopColor="#8E9AB2" />
                <stop offset="52%" stopColor="#2A3652" />
                <stop offset="74%" stopColor="#B0742F" />
                <stop offset="100%" stopColor="#5C4326" />
              </linearGradient>
              <linearGradient id="boltBevel" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#141F38" />
                <stop offset="45%" stopColor="#C1622E" />
                <stop offset="100%" stopColor="#F2E2D2" />
              </linearGradient>
              <radialGradient id="boltHole" cx="50%" cy="42%" r="60%">
                <stop offset="0%" stopColor="#0B1224" />
                <stop offset="100%" stopColor="#38414F" />
              </radialGradient>
            </defs>

            <g transform="translate(250 250)">
              <polygon
                points="0,-92 80,-46 80,46 0,92 -80,46 -80,-46"
                fill="url(#boltBevel)"
                opacity="0.9"
              />
              <polygon points="0,-80 69,-40 69,40 0,80 -69,40 -69,-40" fill="url(#boltFace)" />
              <polygon
                points="0,-80 69,-40 69,40 0,80 -69,40 -69,-40"
                fill="none"
                stroke="#F3E4D3"
                strokeOpacity="0.35"
              />
              <circle cx="0" cy="0" r="34" fill="url(#boltHole)" />
              <circle cx="0" cy="0" r="34" fill="none" stroke="#0A1020" strokeOpacity="0.6" />
              <circle
                cx="0"
                cy="0"
                r="40"
                fill="none"
                stroke="#F6D2A8"
                strokeOpacity="0.25"
                strokeWidth="2"
              />
            </g>

            {BEAMS.map((beam, i) => {
              const local = Math.min(Math.max(progress * BEAMS.length - i, 0), 1);
              return (
                <line
                  key={beam.label}
                  x1={beam.x1}
                  y1={beam.y1}
                  x2={beam.x2}
                  y2={beam.y2}
                  stroke="url(#filament)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  filter="url(#filamentGlow)"
                  pathLength={1}
                  strokeDasharray="1"
                  strokeDashoffset={1 - local}
                  opacity={local > 0.01 ? 1 : 0}
                  style={{ transition: "stroke-dashoffset 120ms linear" }}
                />
              );
            })}
          </svg>

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