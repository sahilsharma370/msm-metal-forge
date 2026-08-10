import { useEffect, useRef, useState } from "react";
import { DotGrid } from "./DotGrid";
import truckImg from "@/assets/truck.png";
import handshakeImg from "@/assets/handshake.png";

const CARDS = [
  {
    label: "Buy",
    copy: "Transparent weighing and market-based pricing for copper, aluminium, steel and lead scrap.",
  },
  {
    label: "Sell",
    copy: "Sorted, weighed and graded metal scrap, ready for local and bulk supply.",
  },
  { label: "Import", copy: "Reliable sourcing and import of metal scrap into the UAE." },
  { label: "Export", copy: "Containerized metal scrap supplied to international markets." },
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
    <section className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-[#080A1D] py-16">
      <DotGrid glow={0} />
      <div className="relative mx-auto max-w-7xl px-6 text-center">
        <p className="font-display text-3xl font-bold tracking-[0.21em] text-foreground uppercase sm:text-[45px] lg:text-[52px]">
          Our Services
        </p>
        <h3 className="font-display mt-5 text-2xl font-bold sm:text-3xl">
          What We <span className="text-[oklch(0.62_0.13_50)]">Do</span>
        </h3>

        <div ref={trackRef} className="relative mt-10">
          {/* Truck lane */}
          <div className="relative h-28 sm:h-40">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.62_0.13_50)]/45 to-transparent" />
            <div
              className="absolute bottom-0 left-0 w-[39%] max-w-[330px] min-w-[180px] will-change-transform"
              style={{ transform: `translate3d(${(eased * 285).toFixed(3)}%, 0, 0)` }}
            >
              <img
                src={truckImg}
                alt=""
                width={1108}
                height={511}
                loading="lazy"
                className="w-full drop-shadow-[0_18px_30px_oklch(0.12_0.05_265/0.75)]"
              />
            </div>
          </div>

          {/* Cards along the truck's path */}
          <div className="mt-12 grid grid-cols-2 gap-6 lg:grid-cols-4 lg:gap-8">
            {CARDS.map((card, i) => {
              const flipped = eased > (i + 0.55) / CARDS.length;
              return (
                <div key={card.label} className="[perspective:1400px]">
                  <div
                    className="relative mx-auto h-52 w-[280px] transition-transform duration-[900ms] [transform-style:preserve-3d]"
                    style={{
                      transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {/* Front */}
                    <div className="glass-panel glass-ring absolute inset-0 flex flex-col items-center justify-center rounded-2xl [backface-visibility:hidden]">
                      <span className="relative inline-block">
                        <img
                          src={handshakeImg}
                          alt=""
                          width={263}
                          height={159}
                          loading="lazy"
                          className="h-16 w-auto"
                        />
                      </span>
                      <span className="font-display mt-5 text-3xl font-bold tracking-[0.06em] text-foreground">
                        {card.label}
                      </span>
                    </div>

                    {/* Back */}
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-[image:var(--gradient-copper)] px-6 [backface-visibility:hidden]"
                      style={{ transform: "rotateY(180deg)" }}
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-16 w-[106px] bg-[#080A1D]"
                        style={{
                          maskImage: `url(${handshakeImg})`,
                          WebkitMaskImage: `url(${handshakeImg})`,
                          maskSize: "contain",
                          WebkitMaskSize: "contain",
                          maskRepeat: "no-repeat",
                          WebkitMaskRepeat: "no-repeat",
                          maskPosition: "center",
                          WebkitMaskPosition: "center",
                        }}
                      />
                      <span className="font-display mt-4 text-3xl font-bold tracking-[0.06em] text-[#080A1D]">
                        {card.label}
                      </span>
                      <p className="font-display mt-2 text-base font-medium text-[#080A1D]">
                        {card.copy}
                      </p>
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
