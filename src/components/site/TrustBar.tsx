import { forwardRef, useEffect, useRef, useState } from "react";
import { Scale, ShieldCheck, Truck, Users } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import craneBackground from "@/assets/trust-industrial-crane.webp";

type CounterStat = {
  kind: "counter";
  value: number;
  suffix: string;
  label: string;
  Icon: typeof ShieldCheck;
  delayMs: number;
  durationMs: number;
};
type TextStat = {
  kind: "text";
  value: string;
  label: string;
  Icon: typeof ShieldCheck;
  delayMs: number;
  durationMs: number;
};
type Stat = CounterStat | TextStat;

/**
 * CHECKPOINT C2L (track record choreography lock) — each card's delay/
 * duration is an explicit, approved value here, not inferred from the
 * stat's numeric magnitude: 14+/7/TRANSPARENT are staggered 0/80/160ms so
 * they settle together, and 500+ starts last (240ms) with the longest
 * duration (950ms) so it lands at ~1190ms as the final trust beat.
 */
const STATS: Stat[] = [
  { kind: "counter", value: 14, suffix: "+", label: "Years Established", Icon: ShieldCheck, delayMs: 0, durationMs: 850 },
  { kind: "counter", value: 7, suffix: "", label: "Emirates Covered", Icon: Truck, delayMs: 80, durationMs: 750 },
  { kind: "text", value: "TRANSPARENT", label: "Weighing", Icon: Scale, delayMs: 160, durationMs: 700 },
  { kind: "counter", value: 500, suffix: "+", label: "Clients Served", Icon: Users, delayMs: 240, durationMs: 950 },
];

/** Mobile-only Load Line copy — kept separate from STATS above since the
    wording differs from the desktop cards; the underlying facts are the
    same. Transparent Weighing is the rail's endpoint/seal, not part of
    this alternating list. */
type TrackPoint = { value: string; label: string; align: "left" | "right"; index: string };
const TRACK_POINTS: TrackPoint[] = [
  { value: "14+", label: "Years Trading", align: "right", index: "01 / 04" },
  { value: "7", label: "Emirates Served", align: "left", index: "02 / 04" },
  { value: "500+", label: "Clients Served", align: "right", index: "03 / 04" },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Dispatches "trustbar:settled" once the observed element is sufficiently
    visible, then disconnects — gates the desktop counters' start. */
function useSettledOnVisible<T extends HTMLElement>(threshold: number) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          window.dispatchEvent(new Event("trustbar:settled"));
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/**
 * Hidden (opacity-0, space reserved) until `run` flips true. Counts 0 -> to
 * as a single continuous tween (one duration, one ease — no discrete
 * "steps()" easing, which produced visible plateaus on the old two-stage
 * timeline). The whole timeline (reveal fade + count) is offset by the
 * card's own approved `delayMs`, so number reveal and counting begin
 * together at that delay. onComplete forces the exact target in case the
 * last onUpdate tick rounds a hair short. Opacity/scale are owned entirely
 * by GSAP on the ref (never by React's style prop) so the reveal fade can't
 * fight a React re-render triggered by the same tick's setDisplay call.
 */
function Counter({
  to,
  suffix,
  run,
  reduced,
  delayMs,
  durationMs,
}: {
  to: number;
  suffix: string;
  run: boolean;
  reduced: boolean;
  delayMs: number;
  durationMs: number;
}) {
  const [display, setDisplay] = useState(to);
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (reduced) {
      setDisplay(to);
      if (spanRef.current) gsap.set(spanRef.current, { opacity: 1, scale: 1 });
      return;
    }
    if (!run || startedRef.current) return;
    startedRef.current = true;
    setDisplay(0);
    const counter = { val: 0 };
    const el = spanRef.current;
    const tl = gsap.timeline({ delay: delayMs / 1000 });
    if (el) {
      tl.fromTo(el, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, 0);
    }
    tl.to(
      counter,
      {
        val: to,
        duration: durationMs / 1000,
        ease: "power2.out",
        onUpdate: () => setDisplay(Math.round(counter.val)),
        onComplete: () => setDisplay(to),
      },
      0,
    );
    return () => {
      tl.kill();
    };
  }, [run, to, reduced, delayMs, durationMs]);

  return (
    <span ref={spanRef} className="inline-block opacity-0">
      {display}
      {suffix}
    </span>
  );
}

/**
 * Restrained reveal for the non-numeric "TRANSPARENT" stat: opacity 0->1
 * plus a 6px upward settle at the card's own approved delay/duration, no
 * scale/bounce/shimmer/glow — a qualitative trust proof, not a counter, so
 * it should read calmer than the numbers.
 */
function FadeUpReveal({
  text,
  run,
  reduced,
  delayMs,
  durationMs,
}: {
  text: string;
  run: boolean;
  reduced: boolean;
  delayMs: number;
  durationMs: number;
}) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    if (reduced) {
      gsap.set(el, { opacity: 1, y: 0 });
      return;
    }
    if (!run || startedRef.current) return;
    startedRef.current = true;
    const tween = gsap.fromTo(
      el,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: durationMs / 1000, delay: delayMs / 1000, ease: "power2.out" },
    );
    return () => {
      tween.kill();
    };
  }, [run, reduced, delayMs, durationMs]);

  return (
    <span ref={spanRef} className="inline-block opacity-0">
      {text}
    </span>
  );
}

function StatCard({
  stat,
  run,
  reduced,
  cardRef,
}: {
  stat: (typeof STATS)[number];
  run: boolean;
  reduced: boolean;
  cardRef?: React.Ref<HTMLDivElement> | undefined;
}) {
  return (
    <div
      ref={cardRef}
      // CHECKPOINT C2L (trust composition lock) — py-9->py-6 plus tightened
      // internal rhythm (mt-5->mt-4, mt-3->mt-2, mt-5->mt-4) trims overall
      // rendered height ~16-18% via spacing only; icon/text sizes untouched.
      // CHECKPOINT C2L (regression correction) — min-w-0 overrides the flex
      // item default of min-width:auto, which was letting "TRANSPARENT"'s
      // unbreakable min-content width win over the flex-1/basis-0 equal
      // split and widen that card at its siblings' expense.
      className="trust-card-glass trust-card-ring flex min-w-0 flex-col items-center rounded-2xl px-6 py-6 text-center lg:flex-1 lg:basis-0"
    >
      <stat.Icon className="h-6 w-6 text-[oklch(0.62_0.13_50)]" strokeWidth={1.5} aria-hidden="true" />
      <div
        className={
          stat.kind === "counter"
            ? "font-display mt-4 text-3xl font-bold sm:text-4xl"
            : "font-display mt-4 text-[clamp(1.5rem,1.65vw,2rem)] font-bold whitespace-nowrap"
        }
      >
        {stat.kind === "counter" ? (
          <Counter
            to={stat.value}
            suffix={stat.suffix}
            run={run}
            reduced={reduced}
            delayMs={stat.delayMs}
            durationMs={stat.durationMs}
          />
        ) : (
          <FadeUpReveal
            text={stat.value}
            run={run}
            reduced={reduced}
            delayMs={stat.delayMs}
            durationMs={stat.durationMs}
          />
        )}
      </div>
      <div className="label-eyebrow mt-2 text-[0.65rem] text-muted-foreground">{stat.label}</div>
    </div>
  );
}

/** One Load Line row: index / number / label, alternating either side of
    the central rail corridor. Ordinary document-flow content — the corridor
    tick doubles as the connector, and the row itself never touches opacity,
    so it's always fully readable even if GSAP never runs. */
function LoadLineRow({
  point,
  numberRef,
  tickRef,
}: {
  point: TrackPoint;
  numberRef?: React.Ref<HTMLDivElement> | undefined;
  tickRef?: React.Ref<HTMLDivElement> | undefined;
}) {
  const onLeft = point.align === "left";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_30px_minmax(0,1fr)] items-center">
      <div className={onLeft ? "min-w-0 text-right" : ""}>
        {onLeft && <Callout point={point} calloutRef={numberRef} align="left" />}
      </div>
      <div ref={tickRef} aria-hidden="true" className="h-px bg-copper/35" />
      <div className={onLeft ? "" : "min-w-0 text-left"}>
        {!onLeft && <Callout point={point} calloutRef={numberRef} align="right" />}
      </div>
    </div>
  );
}

function Callout({
  point,
  align,
  calloutRef,
}: {
  point: TrackPoint;
  align: "left" | "right";
  calloutRef?: React.Ref<HTMLDivElement> | undefined;
}) {
  return (
    <div ref={calloutRef} className="inline-block min-w-0 max-w-full py-6">
      <div className="text-[10px] font-semibold tracking-[0.1em] text-copper/75">{point.index}</div>
      <div className="font-display mt-1 text-[clamp(2.25rem,11vw,3rem)] leading-[0.95] font-bold text-foreground">
        {point.value}
      </div>
      <div className="mt-1 text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {point.label}
      </div>
      <div className={`mt-2 h-px w-8 bg-copper/40 ${align === "left" ? "ml-auto" : ""}`} />
    </div>
  );
}

export const TrustBar = forwardRef<HTMLElement>(function TrustBar(_props, forwardedRef) {
  const reduced = usePrefersReducedMotion();
  const [settled, setSettled] = useState(false);
  const desktopCardsRowRef = useSettledOnVisible<HTMLDivElement>(0.9);

  useEffect(() => {
    const onSettled = () => setSettled(true);
    window.addEventListener("trustbar:settled", onSettled, { once: true });
    return () => window.removeEventListener("trustbar:settled", onSettled);
  }, []);

  // Mobile Load Line — ordinary document flow throughout (no sticky, no
  // pin, no fixed-height wrapper, desktop's pin/cover stays desktop-only
  // via ScrollStack's own <1024px gate). ScrollTrigger only ties the
  // rail's `scaleY` draw + leading node to the natural scroll position of
  // its own in-flow container, and gives each row a small settle-in;
  // nothing here is pinned and nothing controls layout. Base render (rail
  // fully drawn, rows at rest) is already correct HTML/CSS, so a JS
  // failure or a page load that lands mid-section never hides content.
  const railWrapperRef = useRef<HTMLDivElement | null>(null);
  const railDrawRef = useRef<HTMLDivElement | null>(null);
  const railGlowRef = useRef<HTMLDivElement | null>(null);
  const numberRefs = useRef<Array<HTMLDivElement | null>>([]);
  const tickRefs = useRef<Array<HTMLDivElement | null>>([]);
  const sealNodeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const wrapper = railWrapperRef.current;
    if (!wrapper) return;

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      if (railDrawRef.current) {
        gsap.fromTo(
          railDrawRef.current,
          { scaleY: 0, transformOrigin: "top" },
          {
            scaleY: 1,
            transformOrigin: "top",
            ease: "none",
            scrollTrigger: {
              trigger: wrapper,
              start: "top 80%",
              end: "bottom 85%",
              scrub: 0.3,
              onUpdate: (self) => {
                const glow = railGlowRef.current;
                if (!glow) return;
                glow.style.top = `${self.progress * 100}%`;
                glow.style.opacity = self.progress > 0.02 && self.progress < 0.98 ? "1" : "0";
              },
            },
          },
        );
      }

      numberRefs.current.forEach((el, i) => {
        if (!el) return;
        gsap.from(el, {
          y: 10,
          duration: 0.5,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none none" },
        });
        const tick = tickRefs.current[i];
        if (tick) {
          gsap.fromTo(
            tick,
            { backgroundColor: "oklch(0.583 0.135 45.5 / 0.15)" },
            {
              backgroundColor: "oklch(0.583 0.135 45.5 / 0.5)",
              duration: 0.5,
              ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none none" },
            },
          );
        }
      });

      // Restrained one-time halo as the rail reaches the final seal — never
      // a constant pulse, plays once and settles.
      if (sealNodeRef.current) {
        gsap.fromTo(
          sealNodeRef.current,
          { boxShadow: "0 0 0 0 oklch(0.62 0.13 50 / 0)" },
          {
            boxShadow: "0 0 18px 3px oklch(0.62 0.13 50 / 0.35)",
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: { trigger: sealNodeRef.current, start: "top 90%", toggleActions: "play none none none" },
          },
        );
      }
    }, wrapper);

    return () => ctx.revert();
  }, [reduced]);

  return (
    <section ref={forwardedRef} className="relative overflow-hidden bg-[#080A1D] lg:min-h-screen">
      {/* Desktop composition — hard-locked, unchanged. `hidden lg:contents`
          removes this whole block from mobile layout/rendering while
          leaving every desktop class/position identical (the wrapper never
          participates in the box model at lg+, so the `absolute inset-0`
          layers below still size against the section exactly as before). */}
      <div className="hidden lg:contents">
        <img
          src={craneBackground}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          width={1672}
          height={941}
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#080A1D]/25 via-[#080A1D]/10 to-[#080A1D]/25" />
        <div
          className="absolute inset-x-0 top-0 h-[190px]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(8, 10, 29, 0.25) 0px, rgba(8, 10, 29, 0.15) 87px, rgba(8, 10, 29, 0.06) 140px, rgba(8, 10, 29, 0) 190px)",
          }}
        />

        <div className="relative mx-auto max-w-7xl px-6 pt-[164px] pb-[316px]">
          <div className="relative max-w-xl text-left">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-4 -inset-y-3 -z-10 rounded-2xl bg-[#080A1D]/35 blur-xl"
            />
            <p
              className="label-eyebrow text-copper-bright"
              style={{ textShadow: "0 1px 5px rgba(8, 10, 29, 0.75)" }}
            >
              Our Track Record
            </p>
            <h2 className="font-display mt-2 text-2xl font-bold text-foreground sm:text-3xl">
              Built on trust across the UAE.
            </h2>
          </div>

          <div className="mt-8 flex flex-col gap-5 sm:grid sm:grid-cols-2 lg:flex lg:flex-row lg:items-stretch lg:gap-10">
            <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-row lg:gap-4">
              {STATS.slice(0, 2).map((stat, i) => (
                <StatCard
                  key={stat.label}
                  stat={stat}
                  run={settled}
                  reduced={reduced}
                  cardRef={i === 0 ? desktopCardsRowRef : undefined}
                />
              ))}
            </div>

            <div className="hidden shrink-0 lg:block" style={{ width: "clamp(14rem, 16vw, 20rem)" }} aria-hidden="true" />

            <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-row lg:gap-4">
              {STATS.slice(2, 4).map((stat) => (
                <StatCard key={stat.label} stat={stat} run={settled} reduced={reduced} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile "The Load Line" — below lg only, entirely normal document
          flow. Begins immediately after Hero; no cover/sticky transition. */}
      <div className="pt-12 pb-10 lg:hidden">
        <div className="px-5">
          <p className="label-eyebrow text-copper-bright">Our Track Record</p>
          <h2 className="font-display mt-2.5 text-[2.05rem] leading-[1.1] font-bold text-foreground">
            Trust, measured load by load.
          </h2>
        </div>

        {/* Edge-to-edge cinematic plate — full section width, not inset
            into the text gutter. Square corners read as an integrated
            structural element rather than a floating card. */}
        <div className="relative mt-7 overflow-hidden" style={{ height: "clamp(270px, 39svh, 340px)" }}>
          <img
            src={craneBackground}
            alt="Crane lifting scrap metal at an MSM Scrap yard"
            loading="lazy"
            decoding="async"
            width={1672}
            height={941}
            className="h-full w-full object-cover object-center"
          />
          <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#080A1D]/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#080A1D]/75 to-transparent" />
        </div>

        {/* The rail begins immediately at the image's bottom edge — no
            gap — directly below the crane cable, and runs through every
            row's natural height. No fixed height, no percentage
            positioning; the container's height is just its content. */}
        <div ref={railWrapperRef} className="px-5">
          <div className="relative">
            <div aria-hidden="true" className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-copper/20" />
            <div
              ref={railDrawRef}
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-1/2 w-px origin-top -translate-x-1/2 bg-gradient-to-b from-copper to-copper/40"
            />
            <div
              ref={railGlowRef}
              aria-hidden="true"
              className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-copper opacity-0 shadow-[0_0_8px_2px_oklch(0.62_0.13_50/0.6)]"
            />

            <div className="flex flex-col">
              {TRACK_POINTS.map((point, i) => (
                <LoadLineRow
                  key={point.label}
                  point={point}
                  numberRef={(el) => {
                    numberRefs.current[i] = el;
                  }}
                  tickRef={(el) => {
                    tickRefs.current[i] = el;
                  }}
                />
              ))}
            </div>
          </div>

          {/* Transparent Weighing — the rail's final verification seal. A
              short stub bridges the row-rail's end to the node so the seal
              still reads as the rail's own endpoint, never a fixed width
              wider than available space. */}
          <div className="flex flex-col items-center pt-1 pb-1 text-center">
            <div aria-hidden="true" className="h-4 w-px bg-copper/40" />
            <div
              ref={sealNodeRef}
              className="mt-1 flex h-11 w-11 items-center justify-center rounded-full border border-copper/50 bg-[#0B0E24]"
            >
              <Scale className="h-5 w-5 text-copper" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div className="mt-3 min-w-0" style={{ width: "min(100%, 270px)" }}>
              <div className="font-display text-[13px] font-bold tracking-[0.06em] text-foreground uppercase">
                Transparent Weighing
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
