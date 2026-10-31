import { useEffect, useRef, useState } from "react";
import { Boxes, Import, Scale, Upload } from "lucide-react";
import { DotGrid } from "./DotGrid";
import truckImg from "@/assets/truck.png";

// Scroll-follow smoothing: how fast `progress` (and thus truck position)
// closes the gap to the raw scroll target each frame. Bumped from the
// previous 0.18 for tighter tracking — less lag/"floating" behind fast
// scroll input while still smoothing out raw scroll jitter.
const SCROLL_LERP = 0.26;

// Same easeInOutQuad used to both derive this frame's true pixel position
// (for velocity/acceleration below) and the render-time transform, so the
// two never drift apart.
function easeProgress(p: number) {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Below this magnitude the lean/suspension lerp is snapped exactly to 0
// rather than left to asymptotically approach it — guarantees a true rest
// state (no residual sub-pixel/sub-degree drift) once scrolling stops.
const SNAP_EPS = 0.05;
function snapToZero(value: number) {
  return Math.abs(value) < SNAP_EPS ? 0 : value;
}

// Chassis lean: driven by this frame's acceleration (change in velocity),
// not raw velocity — so it's ~0 at steady speed and only appears while
// speeding up or slowing down, settling back to 0 as acceleration decays.
const LEAN_GAIN = 0.22; // degrees per px/frame^2 of acceleration
const MAX_LEAN_DEG = 0.9;
const LEAN_LERP = 0.25;

// Suspension: a distance-linked sine wobble, gated by |velocity| so its
// amplitude collapses to 0 (and the lerp below settles it to exactly 0)
// as soon as scrolling stops — never a free-running/perpetual bounce.
const SUSPENSION_FREQ = 0.12; // radians per travelled px
const SUSPENSION_MAX_PX = 3;
const SUSPENSION_VELOCITY_GATE_PX = 1.5; // px/frame velocity for full amplitude
const SUSPENSION_LERP = 0.3;

const CARDS = [
  {
    label: "We Buy",
    copy: "Fair, transparent weighing for copper, aluminium, steel and lead scrap.",
    Icon: Scale,
  },
  {
    label: "We Sell",
    copy: "Sorted and graded metal scrap for local and bulk supply.",
    Icon: Boxes,
  },
  {
    label: "We Import",
    copy: "Reliable sourcing and import coordination for UAE requirements.",
    Icon: Import,
  },
  {
    label: "We Export",
    copy: "Containerized metal scrap supplied to international markets.",
    Icon: Upload,
  },
];

/** Truck position + per-card copper emphasis driven by scroll, smoothed with a rAF lerp. */
export function WhatWeDo() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const truckWrapRef = useRef<HTMLDivElement | null>(null);
  const target = useRef(0);
  const opacityTarget = useRef(1);
  const travelPx = useRef(0);
  const raf = useRef<number | null>(null);
  const lastXRef = useRef(0);
  const velocityRef = useRef(0);
  const prefersReducedMotionRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [truckOpacity, setTruckOpacity] = useState(1);
  const [leanDeg, setLeanDeg] = useState(0);
  const [suspensionY, setSuspensionY] = useState(0);

  useEffect(() => {
    prefersReducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the block enters the lower third, 1 once it clears the upper third.
      const raw = (vh * 0.82 - rect.top) / (rect.height + vh * 0.45);
      target.current = Math.min(Math.max(raw, 0), 1);

      // Independent full section scroll-through progress (0 entering -> 1
      // fully exited), used only to fade the truck out in the section's
      // final ~8% so it's gone before the section scrolls under the fixed
      // Header/Get Quote CTA — `target` above already saturates at 1 well
      // before that point, so it can't drive this on its own.
      const sectionRaw = (vh - rect.top) / (vh + rect.height);
      const sectionProgress = Math.min(Math.max(sectionRaw, 0), 1);
      opacityTarget.current =
        sectionProgress > 0.92 ? Math.max(0, 1 - (sectionProgress - 0.92) / 0.08) : 1;

      const lane = laneRef.current;
      const truckWrap = truckWrapRef.current;
      if (lane && truckWrap) {
        travelPx.current = Math.max(0, lane.clientWidth - truckWrap.offsetWidth);
      }
    };

    const tick = () => {
      let currentProgress = 0;
      setProgress((prev) => {
        const next = prev + (target.current - prev) * SCROLL_LERP;
        currentProgress = Math.abs(next - target.current) < 0.0005 ? target.current : next;
        return currentProgress;
      });
      setTruckOpacity((prev) => {
        const next = prev + (opacityTarget.current - prev) * 0.12;
        return Math.abs(next - opacityTarget.current) < 0.0025 ? opacityTarget.current : next;
      });

      // This frame's true pixel position (same formula the render uses),
      // so velocity/acceleration are derived from the truck's actual
      // travelled distance rather than raw scroll input.
      const currentX = easeProgress(currentProgress) * travelPx.current;
      const velocity = currentX - lastXRef.current;
      const acceleration = velocity - velocityRef.current;
      lastXRef.current = currentX;
      velocityRef.current = velocity;

      if (prefersReducedMotionRef.current) {
        setLeanDeg(0);
        setSuspensionY(0);
      } else {
        const leanTarget = clamp(-acceleration * LEAN_GAIN, -MAX_LEAN_DEG, MAX_LEAN_DEG);
        setLeanDeg((prev) => snapToZero(prev + (leanTarget - prev) * LEAN_LERP));

        const velocityGate = clamp(Math.abs(velocity) / SUSPENSION_VELOCITY_GATE_PX, 0, 1);
        const suspensionTarget =
          Math.sin(currentX * SUSPENSION_FREQ) * SUSPENSION_MAX_PX * velocityGate;
        setSuspensionY((prev) => snapToZero(prev + (suspensionTarget - prev) * SUSPENSION_LERP));
      }

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
  const eased = easeProgress(progress);

  return (
    <section
      id="services"
      // BATCH 5N-R3 — `min-h-screen` was unprefixed, forcing this section to
      // a full 100vh minimum and flex-centering its (shorter) mobile
      // content inside it, pushing the eyebrow down by the leftover slack
      // — the dominant cause of the large gap after Trust on mobile.
      // Desktop's exact py-16/min-h-screen composition is unchanged.
      className="relative flex flex-col justify-center overflow-hidden bg-[#080A1D] pt-10 pb-16 lg:min-h-screen lg:pt-16"
    >
      <DotGrid glow={0} />
      <div className="relative mx-auto max-w-7xl px-6 text-center">
        <p className="label-eyebrow text-copper-bright">Our Services</p>
        <h3 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl lg:text-4xl">
          Buying, selling and moving metal—across the UAE and beyond.
        </h3>

        <div ref={trackRef} className="relative mt-10">
          {/* Truck lane */}
          <div ref={laneRef} className="relative h-28 sm:h-40">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.62_0.13_50)]/45 to-transparent" />
            <div
              ref={truckWrapRef}
              className="absolute bottom-0 left-0 w-[39%] max-w-[330px] min-w-[180px] will-change-transform"
              style={{
                transform: `translate3d(${(eased * travelPx.current).toFixed(2)}px, 0, 0)`,
                opacity: truckOpacity,
              }}
            >
              {/* Ground-contact shadow — tracks only the wrapper's own
                  horizontal translate above (no lean/bounce of its own),
                  restrained and static in appearance. */}
              <div
                aria-hidden="true"
                className="absolute bottom-[-2px] left-1/2 h-4 w-[68%] -translate-x-1/2 rounded-full bg-black/45 blur-[6px]"
              />
              {/* Suspension (translateY) + chassis lean (rotate) live on
                  this inner wrapper only, pivoting from the wheel line
                  (bottom) so the lean reads as the chassis tilting on its
                  axles rather than the whole graphic sliding. */}
              <div
                className="will-change-transform"
                style={{
                  transform: `translate3d(0, ${suspensionY.toFixed(2)}px, 0) rotate(${leanDeg.toFixed(3)}deg)`,
                  transformOrigin: "50% 100%",
                }}
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
          </div>

          {/* Cards along the truck's path */}
          <div className="mt-12 grid grid-cols-2 gap-6 lg:grid-cols-4 lg:gap-8">
            {CARDS.map((card, i) => {
              const active = eased > (i + 0.55) / CARDS.length;
              return (
                <div
                  key={card.label}
                  className={`service-card-glass service-card-ring flex flex-col items-center rounded-2xl px-6 py-7 text-center transition-[box-shadow,border-color] duration-500 ${
                    active ? "service-card-active" : ""
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center">
                    <card.Icon
                      className={`h-6 w-6 transition-colors duration-500 ${
                        active ? "text-copper-bright" : "text-[oklch(0.62_0.13_50)]"
                      }`}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="font-display mt-4 text-lg font-bold tracking-[0.04em] text-foreground uppercase sm:text-xl">
                    {card.label}
                  </span>
                  <p className="font-display mt-2 text-sm leading-relaxed text-foreground/85">
                    {card.copy}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
