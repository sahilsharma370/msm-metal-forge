import { forwardRef, useEffect, useRef, useState } from "react";
import { Scale, ShieldCheck, Truck, Users } from "lucide-react";
import { gsap } from "gsap";
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

/**
 * Dispatches "trustbar:settled" once the first stat card (the "14+" card) is
 * sufficiently visible, then disconnects. On desktop all four cards share
 * the same row, so this card entering the screen represents all four.
 * Desktop uses a high threshold (~90%) since the card fits within one
 * viewport there; mobile's stacked layout can push the card partly off
 * either edge of the viewport, so it uses a much lower threshold (~20%).
 */
function useSettledOnCardsVisible<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    const threshold = isDesktop ? 0.9 : 0.2;
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

export const TrustBar = forwardRef<HTMLElement>(function TrustBar(_props, forwardedRef) {
  const reduced = usePrefersReducedMotion();
  const [settled, setSettled] = useState(false);
  const cardsRowRef = useSettledOnCardsVisible<HTMLDivElement>();

  useEffect(() => {
    const onSettled = () => setSettled(true);
    window.addEventListener("trustbar:settled", onSettled, { once: true });
    return () => window.removeEventListener("trustbar:settled", onSettled);
  }, []);

  return (
    <section ref={forwardedRef} className="relative min-h-screen overflow-hidden bg-[#080A1D]">
      {/* Crane photograph — bottom-most layer, full-bleed, decorative
          (alt="" + aria-hidden, cards/copy already carry the real content). */}
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
      {/* CHECKPOINT C2L (trust background swap) — the previous skyline wash
          (85%/45%/92% alpha) was tuned specifically to hide the old image's
          own busy sky/spire; against this crane photo it would flatten the
          sunlight/copper/shadow detail the photo is chosen for. Capped at
          25% max (same top-heavier/bottom-heavier shape, just far lighter)
          — the minimum needed to keep card text readable. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#080A1D]/25 via-[#080A1D]/10 to-[#080A1D]/25" />
      {/* Header-legibility fade only, same 190px band, same shape as
          before — peak reduced from 0.92 to 0.25 for the same reason. */}
      <div
        className="absolute inset-x-0 top-0 h-[190px]"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(8, 10, 29, 0.25) 0px, rgba(8, 10, 29, 0.15) 87px, rgba(8, 10, 29, 0.06) 140px, rgba(8, 10, 29, 0) 190px)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6 pt-[164px] pb-[316px]">
        {/* CHECKPOINT C2L (trust composition lock) — eyebrow + heading share
            this same max-w-7xl/px-6 gutter as the cards below (no separate
            centred wrapper), so their left edge lines up with the left
            card's own left edge. A small localized navy fade sits only
            behind this block (not the full section) purely so the heading
            stays readable over the photo without darkening it elsewhere. */}
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
                cardRef={i === 0 ? cardsRowRef : undefined}
              />
            ))}
          </div>

          {/* Central corridor — clamp(14rem, 16vw, 20rem) so no card edge
              crosses or crowds the crane's cable/claw silhouette. */}
          <div className="hidden shrink-0 lg:block" style={{ width: "clamp(14rem, 16vw, 20rem)" }} aria-hidden="true" />

          <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-row lg:gap-4">
            {STATS.slice(2, 4).map((stat) => (
              <StatCard key={stat.label} stat={stat} run={settled} reduced={reduced} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
});
