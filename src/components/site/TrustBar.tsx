import { forwardRef, useEffect, useRef, useState } from "react";
import { Scale, ShieldCheck, Truck, Users } from "lucide-react";
import { gsap } from "gsap";
import skyline from "@/assets/dubai-skyline.png";
import { DotGrid } from "./DotGrid";

const STATS = [
  { value: 14, suffix: "+", label: "Years Established", Icon: ShieldCheck },
  { value: 7, suffix: "", label: "Emirates Covered", Icon: Truck },
  { value: 100, suffix: "%", label: "Transparent Weighing", Icon: Scale },
  { value: 500, suffix: "+", label: "Clients Served", Icon: Users },
] as const;

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
 * Hidden (opacity-0, space reserved) until `run` flips true. Counts 0 -> to,
 * fading/popping in on the first non-zero update, then stays at the final
 * whole-number value. Two stages, 2s total: a quick climb to `to - 4` (1.2s),
 * then the final four numbers stepped slowly and deliberately (0.8s, 4
 * whole-number steps) so the ending reads as premium rather than trailing
 * off. Opacity/scale are owned entirely by GSAP on the ref (never by React's
 * style prop) so the reveal pop and the reduced-motion set can't fight a
 * React re-render triggered by the same tick's setDisplay call.
 */
function Counter({
  to,
  suffix,
  run,
  reduced,
}: {
  to: number;
  suffix: string;
  run: boolean;
  reduced: boolean;
}) {
  const [display, setDisplay] = useState(to);
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);
  const revealedRef = useRef(false);

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
    const stageBoundary = Math.max(0, to - 4);
    const revealOnce = () => {
      if (revealedRef.current) return;
      revealedRef.current = true;
      const el = spanRef.current;
      if (el) {
        gsap.fromTo(
          el,
          { opacity: 0, scale: 0.9 },
          { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.7)" },
        );
      }
    };
    gsap
      .timeline()
      .to(counter, {
        val: stageBoundary,
        duration: 1.2,
        ease: "power2.out",
        onUpdate: () => {
          const v = Math.round(counter.val);
          setDisplay(v);
          if (v > 0) revealOnce();
        },
      })
      .to(counter, {
        val: to,
        duration: 0.8,
        ease: "steps(4)",
        onUpdate: () => setDisplay(Math.round(counter.val)),
      });
  }, [run, to, reduced]);

  return (
    <span ref={spanRef} className="inline-block opacity-0">
      {display}
      {suffix}
    </span>
  );
}

/** One-time scale/fade pop for the non-numeric "UAE-Wide" stat. */
function PopIn({ text, run, reduced }: { text: string; run: boolean; reduced: boolean }) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    if (reduced) {
      gsap.set(el, { opacity: 1, scale: 1 });
      return;
    }
    if (!run || startedRef.current) return;
    startedRef.current = true;
    gsap.fromTo(el, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.7)" });
  }, [run, reduced]);

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
      className="glass-panel glass-ring flex flex-col items-center rounded-2xl px-6 py-9 text-center lg:flex-1"
    >
      <stat.Icon className="h-6 w-6 text-[oklch(0.62_0.13_50)]" strokeWidth={1.5} aria-hidden="true" />
      <div className="font-display mt-5 text-3xl font-bold sm:text-4xl">
        <Counter to={stat.value} suffix={stat.suffix} run={run} reduced={reduced} />
      </div>
      <div className="label-eyebrow mt-3 text-[0.65rem] text-muted-foreground">{stat.label}</div>
      <div className="mt-5 h-px w-8 bg-[oklch(0.62_0.13_50)]" />
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
      <img
        src={skyline}
        alt="Dubai skyline at night with the Burj Khalifa"
        loading="lazy"
        width={1624}
        height={968}
        className="absolute inset-0 h-full w-full object-cover object-top"
        style={{ filter: "brightness(1.07) contrast(1.04)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#080A1D]/85 via-[#080A1D]/45 to-[#080A1D]/92" />
      {/* Single tuned top fade (replaces the previous 100%-opaque h-24 backstop
          plus separate h-16 fade, which stacked with the base gradient above
          to fully block the Burj Khalifa's spire). Strong right at y:0 for
          legibility behind the fixed header (~87px tall), then eases out
          entirely by 190px so the spire reads clearly against just the base
          gradient beneath it. */}
      <div
        className="absolute inset-x-0 top-0 h-[190px]"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(8, 10, 29, 0.92) 0px, rgba(8, 10, 29, 0.55) 87px, rgba(8, 10, 29, 0.18) 140px, rgba(8, 10, 29, 0) 190px)",
        }}
      />

      {/* Dot texture over the sky only — masked out before the skyline itself */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%]"
        style={{
          maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
        }}
      >
        <DotGrid glow={0} />
      </div>

      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 px-6 pt-[164px] pb-[316px] sm:grid sm:grid-cols-2 lg:flex lg:flex-row lg:items-stretch lg:gap-10">
        <div className="contents lg:flex lg:flex-1 lg:flex-row lg:gap-4">
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

        <div className="hidden shrink-0 lg:block lg:w-16 xl:w-28" aria-hidden="true" />

        <div className="contents lg:flex lg:flex-1 lg:flex-row lg:gap-4">
          {STATS.slice(2, 4).map((stat) => (
            <StatCard key={stat.label} stat={stat} run={settled} reduced={reduced} />
          ))}
        </div>
      </div>
    </section>
  );
});
