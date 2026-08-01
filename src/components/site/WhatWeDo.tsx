import { useEffect, useRef, useState } from "react";
import { DotGrid } from "./DotGrid";
import truckImg from "@/assets/truck.png";
import handshakeImg from "@/assets/handshake.png";

const CARDS = [
  { label: "Buy", copy: "Competitive live rates for all grades of scrap." },
  { label: "Sell", copy: "Sorted, weighed and graded stock ready to move." },
  { label: "Import", copy: "Reliable inbound sourcing into the UAE." },
  { label: "Export", copy: "Container loads shipped worldwide." },
];

/** Truck position + per-card flip driven by scroll, smoothed with a rAF lerp. */
export function WhatWeDo() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const target = useRef(0);
  const raf = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the block enters the lower third, 1 once it clears the upper third.
      const raw = (vh * 0.82 - rect.top) / (rect.height + vh * 0.45);
      target.current = Math.min(Math.max(raw, 0), 1);
    };

    const tick = () => {
      setProgress((prev) => {
        const next = prev + (target.current - prev) * 0.075;
        return Math.abs(next - target.current) < 0.0005 ? target.current : next;
      });
      raf.current = requestAnimationFrame(tick);
    };

    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    raf.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  // Ease the raw progress so the truck starts and settles softly.
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;

  return (
    <section className="relative overflow-hidden bg-navy py-28">
      <DotGrid glow={0.9} />
      <div className="relative mx-auto max-w-6xl px-6 text-center">
        <p className="font-display text-sm font-bold tracking-[0.28em] text-foreground uppercase sm:text-base">
          Our Services
        </p>
        <h3 className="font-display mt-4 text-2xl font-bold sm:text-3xl">
          What We <span className="text-copper">Do</span>
        </h3>

        <div ref={trackRef} className="relative mt-16">
          {/* Truck lane */}
          <div className="relative h-24 sm:h-32">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-copper/45 to-transparent" />
            <div
              className="absolute bottom-0 left-0 w-[26%] max-w-[220px] min-w-[130px] will-change-transform"
              style={{
                transform: `translate3d(calc(${(eased * 100).toFixed(3)}% * (100vw / 100) * 0), 0, 0)`,
                left: `calc(${(eased * 100).toFixed(3)}% - ${(eased * 100).toFixed(3)}% * 0.26)`,
              }}
            >
              <img
                src={truckImg}
                alt=""
                width={1024}
                height={576}
                loading="lazy"
                className="w-full drop-shadow-[0_18px_30px_oklch(0.12_0.05_265/0.75)]"
              />
            </div>
          </div>

          {/* Cards along the truck's path */}
          <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-4">
            {CARDS.map((card, i) => {
              const flipped = eased > (i + 0.55) / CARDS.length;
              return (
                <div key={card.label} className="[perspective:1400px]">
                  <div
                    className="relative h-52 w-full transition-transform duration-[900ms] [transform-style:preserve-3d]"
                    style={{
                      transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {/* Front */}
                    <div className="glass-panel glass-ring absolute inset-0 flex flex-col items-center justify-center rounded-2xl [backface-visibility:hidden]">
                      <span className="icon-shine relative inline-block">
                        <img
                          src={handshakeImg}
                          alt=""
                          width={263}
                          height={159}
                          loading="lazy"
                          className="h-12 w-auto"
                        />
                      </span>
                      <span className="font-display mt-5 text-xl font-bold tracking-[0.06em] text-foreground">
                        {card.label}
                      </span>
                    </div>

                    {/* Back */}
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-copper px-6 [backface-visibility:hidden]"
                      style={{ transform: "rotateY(180deg)" }}
                    >
                      <span className="icon-shine relative inline-block">
                        <img
                          src={handshakeImg}
                          alt=""
                          width={263}
                          height={159}
                          loading="lazy"
                          className="h-12 w-auto brightness-0 invert"
                        />
                      </span>
                      <span className="font-display mt-4 text-xl font-bold tracking-[0.06em] text-primary-foreground">
                        {card.label}
                      </span>
                      <p className="mt-2 text-xs text-primary-foreground/85">{card.copy}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
