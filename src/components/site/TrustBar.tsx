import { forwardRef, useEffect, useRef, useState } from "react";
import { Check, Scale, ShieldCheck, Truck, Users } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import craneBackground from "@/assets/trust-industrial-crane.webp";
import mobileSeamlessTransition from "@/assets/msm-mobile-trust-full-matched-v2.webp";

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
  { kind: "counter", value: 14, suffix: "+", label: "Years of Experience", Icon: ShieldCheck, delayMs: 0, durationMs: 850 },
  { kind: "counter", value: 7, suffix: "", label: "Emirates Served", Icon: Truck, delayMs: 80, durationMs: 750 },
  { kind: "text", value: "TRANSPARENT", label: "Weighing", Icon: Scale, delayMs: 160, durationMs: 700 },
  { kind: "counter", value: 500, suffix: "+", label: "Clients Served", Icon: Users, delayMs: 240, durationMs: 950 },
];

/** Mobile-only proof stations — kept separate from STATS above since the
    wording/captions differ from the desktop cards; the underlying facts
    are the same. Transparent Weighing is the rail's endpoint/seal, not
    part of this alternating list. Every station uses the same three-colour
    system (copper numbers, white labels) — no per-station tone variation. */
type ProofStation = {
  value: string;
  label: string;
  caption: string;
  align: "left" | "right";
};
const PROOF_STATIONS: ProofStation[] = [
  {
    value: "14+",
    label: "Years of Experience",
    caption: "Established UAE trading expertise",
    align: "right",
  },
  {
    value: "7",
    label: "Emirates Served",
    caption: "UAE-wide coverage",
    align: "left",
  },
  {
    value: "500+",
    label: "Clients Served",
    caption: "Relationships built trade by trade",
    align: "right",
  },
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
 * Rests at a muted-but-clearly-readable 0.6 opacity (never fully hidden —
 * if the visibility IntersectionObserver this depends on never fires, the
 * number must still be legible, not blank) until `run` flips true, then
 * counts 0 -> to as a single continuous tween (one duration, one ease — no
 * discrete "steps()" easing, which produced visible plateaus on the old
 * two-stage timeline). The whole timeline (reveal fade + count) is offset
 * by the card's own approved `delayMs`, so number reveal and counting
 * begin together at that delay. onComplete forces the exact target in case
 * the last onUpdate tick rounds a hair short. The entrance tween starts
 * from that same 0.6 resting opacity (not 0), so there's no flash when it
 * fires. Opacity/scale are owned entirely by GSAP on the ref (never by
 * React's style prop) so the reveal fade can't fight a React re-render
 * triggered by the same tick's setDisplay call.
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
      tl.fromTo(el, { opacity: 0.6, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }, 0);
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
    <span ref={spanRef} className="inline-block" style={{ opacity: 0.6 }}>
      {display}
      {suffix}
    </span>
  );
}

/**
 * Restrained reveal for the non-numeric "TRANSPARENT" stat: rests at the
 * same muted-but-legible 0.6 opacity as Counter (never fully hidden — see
 * that component's note on why), then eases to opacity 1 plus a 6px upward
 * settle at the card's own approved delay/duration, no scale/bounce/
 * shimmer/glow — a qualitative trust proof, not a counter, so it should
 * read calmer than the numbers.
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
      { opacity: 0.6, y: 6 },
      { opacity: 1, y: 0, duration: durationMs / 1000, delay: delayMs / 1000, ease: "power2.out" },
    );
    return () => {
      tween.kill();
    };
  }, [run, reduced, delayMs, durationMs]);

  return (
    <span ref={spanRef} className="inline-block" style={{ opacity: 0.6 }}>
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

/** One proof-station row: filled/checked circular node + a single short
    connector (toward the content side only) on the central spine, with the
    number/label/caption alternating either side. Animated values (number/
    label opacity, connector + node-fill + check opacity/scale, content
    translateY) default to their *inactive* value inline, keyed off
    `reduced` — under reduced motion that default flips straight to the
    fully-active look with no JS/scroll dependency; otherwise the scroll
    effect below overwrites these same inline styles on every tick,
    reversibly in both scroll directions (see `crossedRefs` and its
    `HYSTERESIS_PX` dead-band, which only stops rapid flicker at a paused
    boundary — a real scroll reversal still un-activates a milestone). The
    inactive floor for number/label/caption (0.68/0.75/0.62) is kept well
    above "disabled-looking" so every row stays clearly readable against
    the navy background even before any animation runs, including the
    worst case where the driving
    ScrollTrigger never initializes at all. */
function ProofStationRow({
  station,
  reduced,
  rowRef,
  numberRef,
  labelRef,
  captionRef,
  connectorOverlayRef,
  nodeOverlayRef,
  checkRef,
}: {
  station: ProofStation;
  reduced: boolean;
  rowRef?: React.Ref<HTMLDivElement> | undefined;
  numberRef?: React.Ref<HTMLDivElement> | undefined;
  labelRef?: React.Ref<HTMLDivElement> | undefined;
  captionRef?: React.Ref<HTMLDivElement> | undefined;
  connectorOverlayRef?: React.Ref<HTMLDivElement> | undefined;
  nodeOverlayRef?: React.Ref<HTMLDivElement> | undefined;
  checkRef?: React.Ref<SVGSVGElement> | undefined;
}) {
  const onLeft = station.align === "left";
  const content = (
    <div
      ref={rowRef}
      style={{ transform: `translateY(${reduced ? 0 : 7}px)` }}
      className={onLeft ? "text-right" : "text-left"}
    >
      <div
        ref={numberRef}
        style={{ opacity: reduced ? 1 : 0.68, color: reduced ? "#C66A3D" : "#F4F4F2" }}
        className="font-display text-[54px] leading-[0.9] font-bold"
      >
        {station.value}
      </div>
      <div
        ref={labelRef}
        style={{ opacity: reduced ? 1 : 0.75 }}
        className="mt-1 text-[13px] font-bold tracking-[0.08em] text-[#F4F4F2] uppercase"
      >
        {station.label}
      </div>
      <div
        ref={captionRef}
        style={{ opacity: reduced ? 0.85 : 0.62 }}
        className={`mt-1 max-w-[160px] text-[14px] leading-[1.4] text-[#F4F4F2] ${onLeft ? "ml-auto" : ""}`}
      >
        {station.caption}
      </div>
    </div>
  );

  return (
    <div className="relative grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] items-center py-3">
      <div className="min-w-0 pr-4">{onLeft && content}</div>
      <div className="relative flex h-[18px] w-9 items-center justify-center" style={{ marginLeft: "var(--rail-axis)" }}>
        {/* Single short connector toward the content side only — never a
            line running through both sides of the node. */}
        <div
          aria-hidden="true"
          style={onLeft ? { right: "50%" } : { left: "50%" }}
          className="absolute top-1/2 h-[1.5px] w-[18px] -translate-y-1/2 bg-[#C66A3D]/30"
        />
        <div
          ref={connectorOverlayRef}
          aria-hidden="true"
          style={{ opacity: reduced ? 1 : 0, ...(onLeft ? { right: "50%" } : { left: "50%" }) }}
          className="absolute top-1/2 h-[1.5px] w-[18px] -translate-y-1/2 bg-[#C66A3D]"
        />
        {/* Node — container is the z-20 stacking context so the checkmark
            never gets clipped/hidden. The base ring has an opaque navy fill
            (not transparent) so it physically covers the rail line passing
            behind it — otherwise the cable is visible through the hollow
            inactive circle. The solid-copper overlay snaps in on top as the
            station activates, and the check icon (a real lucide SVG, not a
            background image) appears with it — both are binary, never
            tweened/partial. */}
        <div className="relative z-20 flex h-[18px] w-[18px] items-center justify-center">
          <div aria-hidden="true" className="absolute inset-0 rounded-full border border-[#C66A3D]/45 bg-[#080A1D]" />
          <div
            ref={nodeOverlayRef}
            aria-hidden="true"
            style={{ opacity: reduced ? 1 : 0 }}
            className="absolute inset-0 rounded-full bg-[#C66A3D] shadow-[0_0_6px_rgba(198,106,61,0.20)]"
          />
          <Check
            ref={checkRef}
            aria-hidden="true"
            strokeWidth={2.5}
            style={{
              opacity: reduced ? 1 : 0,
              transform: `scale(${reduced ? 1 : 0.75})`,
            }}
            className="relative z-10 h-[10px] w-[10px] text-[#080A1D]"
          />
        </div>
      </div>
      <div className="min-w-0 pl-4">{!onLeft && content}</div>
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
  // rail's `scaleY` draw + each station's node/text to the natural scroll
  // position of its own in-flow container, giving each row a small settle-in;
  // nothing here is pinned and nothing controls layout. Base render (rail
  // fully drawn, rows at rest) is already correct HTML/CSS, so a JS
  // failure or a page load that lands mid-section never hides content.
  const railWrapperRef = useRef<HTMLDivElement | null>(null);
  const railDrawRef = useRef<HTMLDivElement | null>(null);
  const railHandoffDrawRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const numberRefs = useRef<Array<HTMLDivElement | null>>([]);
  const labelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const captionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const connectorOverlayRefs = useRef<Array<HTMLDivElement | null>>([]);
  const nodeOverlayRefs = useRef<Array<HTMLDivElement | null>>([]);
  const checkRefs = useRef<Array<SVGSVGElement | null>>([]);
  // Binary crossed/not-crossed state per station + the seal, so the
  // line-tip-vs-node-centre comparison only fires an animation on an
  // actual state change, never re-triggers every scroll tick.
  const crossedRefs = useRef<boolean[]>(PROOF_STATIONS.map(() => false));
  const sealCrossedRef = useRef(false);
  const sealNodeRef = useRef<HTMLDivElement | null>(null);
  const sealStubOverlayRef = useRef<HTMLDivElement | null>(null);
  const sealIconRef = useRef<SVGSVGElement | null>(null);
  const sealPulseRef = useRef<HTMLDivElement | null>(null);
  const sealHeadingRef = useRef<HTMLDivElement | null>(null);
  const sealDescRef = useRef<HTMLParagraphElement | null>(null);
  const sealPulseTweenRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (reduced) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    const wrapper = railWrapperRef.current;
    if (!wrapper) return;

    gsap.registerPlugin(ScrollTrigger);

    // Single copper source (#C66A3D) throughout — dim/active states are
    // the same colour at different opacity, never a different hue. GSAP's
    // colour interpolator doesn't parse oklch(), so these are plain rgba.
    // "TRANSPARENT WEIGHING" itself stays permanently white (per the
    // three-colour hierarchy) — only the icon/border/illumination activate,
    // and the icon is never white, only dim-copper -> bright-copper.
    const copperDim = "rgba(198, 106, 61, 0.55)";
    const copperBright = "#C66A3D";
    const glowOff = "0 0 0 0 rgba(198, 106, 61, 0)";
    const glowOn = "inset 0 0 18px rgba(198, 106, 61, 0.08), 0 0 14px rgba(198, 106, 61, 0.18)";
    const sealBorderDim = "rgba(198, 106, 61, 0.55)";
    const sealBorderActive = "#C66A3D";

    const activateSeal = () => {
      // Bridging stub (500+ node -> seal circle): fills top-down with the
      // same copper as the main rail draw, in step with the rest of the
      // seal's activation — keeps the final milestone visually connected
      // to the rail instead of reading as a separate, disconnected piece.
      if (sealStubOverlayRef.current) {
        gsap.to(sealStubOverlayRef.current, { scaleY: 1, duration: 0.28, ease: "power2.out", overwrite: true });
      }
      if (sealIconRef.current) {
        gsap.to(sealIconRef.current, { color: copperBright, duration: 0.28, ease: "power2.out", overwrite: "auto" });
        gsap.to(sealIconRef.current, { scale: 1, duration: 0.35, ease: "power2.out", overwrite: "auto" });
      }
      if (sealNodeRef.current) {
        gsap.to(sealNodeRef.current, {
          borderColor: sealBorderActive,
          boxShadow: glowOn,
          duration: 0.28,
          ease: "power2.out",
          overwrite: true,
        });
      }
      // One-shot pulse ring — killed/reset first so a rapid re-cross can't
      // stack overlapping pulses; never loops (no repeat set).
      if (sealPulseRef.current) {
        sealPulseTweenRef.current?.kill();
        gsap.set(sealPulseRef.current, { opacity: 0, scale: 0.88 });
        sealPulseTweenRef.current = gsap
          .timeline()
          .to(sealPulseRef.current, { opacity: 0.28, duration: 0.15, ease: "power2.out" })
          .to(sealPulseRef.current, { opacity: 0, scale: 1.22, duration: 0.5, ease: "power2.out" }, "<");
      }
      if (sealHeadingRef.current) {
        gsap.to(sealHeadingRef.current, { opacity: 1, y: 0, duration: 0.32, delay: 0.08, ease: "power2.out", overwrite: true });
      }
      if (sealDescRef.current) {
        gsap.to(sealDescRef.current, { opacity: 0.72, y: 0, duration: 0.32, delay: 0.08, ease: "power2.out", overwrite: true });
      }
    };
    // Mirror of activateSeal — scrolling back up past the seal eases it
    // back to its dim resting state, same durations/easing as forward, so
    // the reverse reads as a continuation of one scrub animation rather
    // than a reset. Targets match the JSX/ctx resting values below (0.55
    // alpha copper, 0.7/0.62 opacity) so there's no jump at either end.
    const deactivateSeal = () => {
      if (sealStubOverlayRef.current) {
        gsap.to(sealStubOverlayRef.current, { scaleY: 0, duration: 0.28, ease: "power2.out", overwrite: true });
      }
      sealPulseTweenRef.current?.kill();
      sealPulseTweenRef.current = null;
      if (sealPulseRef.current) gsap.set(sealPulseRef.current, { opacity: 0, scale: 0.88 });
      if (sealIconRef.current) {
        gsap.to(sealIconRef.current, { color: copperDim, duration: 0.28, ease: "power2.out", overwrite: "auto" });
        gsap.to(sealIconRef.current, { scale: 0.94, duration: 0.28, ease: "power2.out", overwrite: "auto" });
      }
      if (sealNodeRef.current) {
        gsap.to(sealNodeRef.current, {
          borderColor: sealBorderDim,
          boxShadow: glowOff,
          duration: 0.28,
          ease: "power2.out",
          overwrite: true,
        });
      }
      if (sealHeadingRef.current) {
        gsap.to(sealHeadingRef.current, { opacity: 0.7, y: 6, duration: 0.28, ease: "power2.out", overwrite: true });
      }
      if (sealDescRef.current) {
        gsap.to(sealDescRef.current, { opacity: 0.62, y: 6, duration: 0.28, ease: "power2.out", overwrite: true });
      }
    };

    // Hysteresis gap (px of scroll-driven line movement): activating a
    // milestone still fires the instant the line reaches it, but once
    // active, deactivating requires the line to retreat this much further
    // past it first. That dead-band absorbs the sub-pixel wobble of a
    // paused/jittery scroll position sitting right on a boundary, so
    // nothing flickers on/off — without it ever blocking a real, sustained
    // scroll reversal from properly reversing the timeline.
    const HYSTERESIS_PX = 8;

    const ctx = gsap.context(() => {
      // Resting state starts dim-but-legible (matches the pre-crossing
      // appearance the JSX's own inline defaults already render before
      // this effect ever runs, so there's no flash) — never fully
      // transparent, so the heading/description stay readable even in the
      // worst case where this ScrollTrigger never initializes at all.
      if (sealNodeRef.current) gsap.set(sealNodeRef.current, { borderColor: sealBorderDim, boxShadow: glowOff });
      if (sealStubOverlayRef.current) gsap.set(sealStubOverlayRef.current, { scaleY: 0 });
      if (sealIconRef.current) gsap.set(sealIconRef.current, { color: copperDim, scale: 0.94 });
      if (sealPulseRef.current) gsap.set(sealPulseRef.current, { opacity: 0, scale: 0.88 });
      if (sealHeadingRef.current) gsap.set(sealHeadingRef.current, { opacity: 0.7, y: 6 });
      if (sealDescRef.current) gsap.set(sealDescRef.current, { opacity: 0.62, y: 6 });

      if (railDrawRef.current) {
        const track = railDrawRef.current;
        const handoffTrack = railHandoffDrawRef.current;

        // Single source of truth: the *actual rendered* bottom edge of this
        // bright line element, read after GSAP has applied this frame's
        // scaleY to the DOM. `getBoundingClientRect()` on a transformed
        // element already reflects the transform (transform-origin: top
        // means the top edge is pinned and the bottom edge is exactly the
        // visible tip), so no separate progress/percentage math is needed
        // or used. Deliberately NOT reading `self.progress` from
        // ScrollTrigger — with `scrub: 0.3` that value is the raw target,
        // ahead of wherever the smoothed tween has actually rendered the
        // line to, which is exactly what caused activation to fire before
        // the visible line reached each node (and to drift further off with
        // each station down the timeline).
        const syncMilestones = () => {
          const lineTipY = track.getBoundingClientRect().bottom;

          nodeOverlayRefs.current.forEach((nodeEl, i) => {
            if (!nodeEl) return;
            const nodeRect = nodeEl.getBoundingClientRect();
            const nodeCenterY = nodeRect.top + nodeRect.height / 2;
            // Reversible with hysteresis: the "on" threshold is the node's
            // own centre (line reaches it -> activate); the "off" threshold
            // is offset an extra HYSTERESIS_PX further back, only checked
            // once already active. A scroll position sitting anywhere in
            // that gap keeps whatever state it already had, so pausing near
            // a node can't flicker it — but a sustained scroll past either
            // edge still switches it, in either direction, every time.
            const wasActive = crossedRefs.current[i];
            const threshold = wasActive ? nodeCenterY - HYSTERESIS_PX : nodeCenterY;
            const crossed = lineTipY >= threshold - 1;
            if (crossed === wasActive) return;
            crossedRefs.current[i] = crossed;

            // Node/check: immediate, binary — gsap.set, never a tween, so
            // there is no partially-filled/partially-ticked in-between
            // frame.
            gsap.set(nodeEl, { opacity: crossed ? 1 : 0 });
            const checkEl = checkRefs.current[i];
            if (checkEl) gsap.set(checkEl, { opacity: crossed ? 1 : 0, scale: crossed ? 1 : 0.75 });
            const connectorEl = connectorOverlayRefs.current[i];
            if (connectorEl) gsap.set(connectorEl, { opacity: crossed ? 1 : 0 });

            // Content eases between its resting and active look every time
            // the threshold is crossed, in either direction — a continuous
            // scrub, not a one-shot entrance replay.
            const numberEl = numberRefs.current[i];
            const labelEl = labelRefs.current[i];
            const captionEl = captionRefs.current[i];
            const rowEl = rowRefs.current[i];
            if (numberEl) {
              gsap.to(numberEl, {
                opacity: crossed ? 1 : 0.68,
                color: crossed ? "#C66A3D" : "#F4F4F2",
                duration: 0.35,
                ease: "power2.out",
                overwrite: true,
              });
            }
            if (labelEl) gsap.to(labelEl, { opacity: crossed ? 1 : 0.75, duration: 0.35, ease: "power2.out", overwrite: true });
            if (captionEl) gsap.to(captionEl, { opacity: crossed ? 0.85 : 0.62, duration: 0.35, ease: "power2.out", overwrite: true });
            if (rowEl) gsap.to(rowEl, { y: crossed ? 0 : 7, duration: 0.35, ease: "power2.out", overwrite: true });
          });

          // Transparent Weighing: same rendered line-tip source, compared
          // against the seal's own top edge (where the cable visually
          // meets the seal) — not its centre, not a different threshold.
          // `track` only draws (scaleY 0->1) within its own row-container
          // parent, so its rendered bottom can never physically pass that
          // parent's own bottom edge — clamping the target to that edge
          // is required, otherwise `sealRect.top` (below the fixed,
          // always-opaque stub) could never actually be reached and the
          // finale would never fire. The always-visible static stub is
          // what visually bridges the rest of the way to the seal once the
          // animated line finishes drawing.
          const seal = sealNodeRef.current;
          if (seal) {
            const trackParentRect = track.parentElement?.getBoundingClientRect();
            const sealRect = seal.getBoundingClientRect();
            const endpointY = trackParentRect ? Math.min(sealRect.top, trackParentRect.bottom) : sealRect.top;
            const sealWasActive = sealCrossedRef.current;
            const sealThreshold = sealWasActive ? endpointY - HYSTERESIS_PX : endpointY;
            const sealCrossed = lineTipY >= sealThreshold - 1;
            if (sealCrossed !== sealWasActive) {
              sealCrossedRef.current = sealCrossed;
              if (sealCrossed) activateSeal();
              else deactivateSeal();
            }
          }
        };

        // BATCH FILAMENT-HANDOFF-ORIGIN — the connector must finish drawing
        // top-to-bottom (from the photo-wire tip down to the rail) BEFORE
        // the straight rail itself starts, not the reverse. Previously the
        // rail's own scrollTrigger began at the very first sign of scroll
        // ("top 95%"), so it started drawing from ITS OWN top (which sits
        // exactly at the connector's bottom) immediately — a visible
        // orange sliver appearing at the JOIN before the connector was lit
        // at all, which read as "starting from the wrong end." Fixed with
        // two sequenced scrollTriggers sharing one boundary ("top 92%"):
        // the connector owns the short "top 95% -> top 92%" span (drawn via
        // a `mask-image` top-down wipe below, since `scaleY` would distort
        // its curve — see the JSX comment on this same ref), and the main
        // rail's own tween does not begin until that same "top 92%" point,
        // so at zero overall progress NEITHER shows any orange, and the
        // rail's own growth literally cannot start until the connector has
        // finished. Both scrub at the same 0.3 rate so the hand-off reads
        // as one continuous draw, and both reverse (retract bottom-to-top,
        // rail first, then the connector) automatically on scroll-up since
        // each is just that scrollTrigger's own range being exited in
        // reverse — no separate reverse-handling code needed.
        if (handoffTrack) {
          const handoffProgress = { value: 0 };
          const applyHandoffMask = () => {
            const stop = `${handoffProgress.value}%`;
            const mask = `linear-gradient(to bottom, black 0%, black ${stop}, transparent ${stop})`;
            handoffTrack.style.maskImage = mask;
            handoffTrack.style.webkitMaskImage = mask;
          };
          applyHandoffMask();
          gsap.to(handoffProgress, {
            value: 100,
            ease: "none",
            onUpdate: applyHandoffMask,
            scrollTrigger: {
              trigger: wrapper,
              start: "top 95%",
              end: "top 92%",
              scrub: 0.3,
            },
          });
        }

        gsap.fromTo(
          track,
          { scaleY: 0, transformOrigin: "top" },
          {
            scaleY: 1,
            transformOrigin: "top",
            ease: "none",
            // Runs after *this tween* renders its current scaleY — i.e.
            // after the visible line has actually moved — rather than
            // ScrollTrigger's own onUpdate, which fires on the raw scroll
            // event ahead of the scrub-smoothed render.
            onUpdate: syncMilestones,
            // `start` is "top 92%" (not "top 95%") so the rail's own draw
            // cannot begin until the connector above has fully finished —
            // see the BATCH FILAMENT-HANDOFF-ORIGIN comment above. `end` is
            // unchanged.
            scrollTrigger: {
              trigger: wrapper,
              start: "top 92%",
              end: "bottom 85%",
              scrub: 0.3,
            },
          },
        );
      }
    }, wrapper);

    return () => ctx.revert();
  }, [reduced]);

  return (
    // Mobile keeps its own documented "ordinary document flow... no
    // fixed-height wrapper" behavior (`relative`, content-driven height,
    // untouched). Desktop (`lg:absolute lg:inset-0`, `lg:min-h-screen`
    // moved off this element) now mirrors Hero's own pattern exactly: this
    // section fills a SEPARATE, always-`lg:min-h-screen` wrapper
    // (routes/index.tsx) via inset, instead of carrying its own height —
    // ScrollStack.tsx's own doc comment explains why: that wrapper is what
    // lets sections after TrustBar measure a stable document position
    // regardless of whether THIS element is currently `position: fixed`
    // (ScrollStack's active/dwell phases) or `absolute` (released).
    <section
      ref={forwardedRef}
      className="trust-stage-offset relative overflow-hidden bg-[#080A1D] lg:absolute lg:inset-0"
    >
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

      {/* Mobile "The Calibrated Load" — below lg only, entirely normal
          document flow. Begins immediately after Hero; no cover/sticky
          transition. Eyebrow + heading sit inside the photograph itself so
          the opening reads as one cinematic scene rather than a text block
          stacked on top of a separate image card. */}
      <div className="pt-0 pb-12 lg:hidden">
        {/* BATCH TRACK-RECORD-JOIN — msm-mobile-trust-full-matched-v2.webp is
            the exact continuation of Hero's own mobile background (see
            Hero.tsx's own comment on this pairing): same 853x1844 canvas,
            one continuous photographic composition, this image picking up
            exactly where Hero's leaves off. Never a second, independently
            art-directed copper photo — one shared visual layer for both the
            lower-hero hand-off and this Track Record intro. Height and the
            heading's offset below are driven by `vw` (not svh/px) so the
            composition holds the same proportions across ordinary mobile
            widths; the specific numbers were last tuned from a direct
            screenshot-pixel comparison against the approved target (target
            888px wide vs. a 790px-wide current screenshot, normalized) —
            see the heading block's own comment below for the exact deltas. */}
        <div
          className="relative mt-0 overflow-hidden"
          style={{ height: "clamp(180px, calc(75vw - 68px), 460px)" }}
        >
          {/* Purely decorative — the same content (eyebrow/headline) exists
              as real text below, so this photo carries no information of
              its own and is hidden from assistive tech. `object-fit: cover`
              here never distorts or arbitrarily re-centres the artwork: at
              this container's aspect ratio (much shorter than the photo's
              native 853x1844 at full width) cover only ever scales to match
              the full viewport width and crops from the bottom — the same
              width-driven scale Hero's own image resolves to, so both
              images render at the exact same effective zoom, and neither
              ever crops horizontally, so the coil/filament's x-position is
              always the artwork's own. `object-position: top` is the other
              half of the join: it keeps this image's true top row (which is
              Hero's own true bottom row, pixel-for-pixel) anchored to this
              container's top edge on every device, cropping only the
              (unneeded, already-faded-to-navy) remainder from the bottom.
              Alpha-masked (not a colour-overlay div) so the section's own
              navy background (bg-[#080A1D] on the <section>) shows straight
              through at the faded edges — a true soft dissolve with no
              rectangular photo edge. The top of the mask starts partially
              transparent to roughly match Hero's own ending darkness
              (~0.48, see Hero.tsx's mobile scrim) so brightness is
              continuous across the seam instead of jumping from "dim
              photo" to "flat navy" in one pixel row; the bottom eases all
              the way to fully transparent so the photographic panel
              dissolves into the flat timeline below with no second hard
              boundary. */}
          <img
            src={mobileSeamlessTransition}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            width={853}
            height={1844}
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{
              maskImage:
                "linear-gradient(to bottom, rgba(0,0,0,0.48) 0%, black 14%, black 78%, rgba(0,0,0,0) 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, rgba(0,0,0,0.48) 0%, black 14%, black 78%, rgba(0,0,0,0) 100%)",
            }}
          />

          {/* Eyebrow + heading — offset from the artwork's own visible top
              by 14vw, not the previous 38vw: a direct screenshot-pixel
              comparison (target 888px wide vs. a 790px-wide current
              screenshot, normalized) measured the eyebrow ~190 screenshot
              px (~95 CSS px) too low at 38vw. 14vw sits the block much
              closer to the coil/curve itself, matching the target far more
              closely — this is a position-only change, the heading's own
              font size/leading from the previous pass is untouched.
              max-w-[44vw] and a slightly tighter -0.02em tracking (was
              -0.01em, no font-size change) keep the block's actual
              rendered width a little narrower so "UAE." sits with more
              clearance from the curve, which is further right at this
              higher position than it was at the old 38vw — still an
              estimate, not pixel-verified against the curve's exact path. */}
          <div className="absolute inset-x-0 px-6" style={{ top: "14vw" }}>
            <p
              className="label-eyebrow text-[#C66A3D]"
              style={{ textShadow: "0 1px 6px rgba(8,10,29,0.85)", letterSpacing: "0.18em" }}
            >
              Our Track Record
            </p>
            <h2
              className="font-display mt-2.5 max-w-[44vw] text-[clamp(27px,7.9vw,34px)] leading-[1.0] font-bold tracking-[-0.02em] text-foreground"
              style={{ textShadow: "0 2px 12px rgba(8,10,29,0.9)" }}
            >
              <span className="block whitespace-nowrap">Built on trust</span>
              <span className="block whitespace-nowrap">across the UAE.</span>
            </h2>
          </div>
        </div>

        {/* The rail begins immediately at the image's bottom edge — no
            added gap — directly below the photographed cable. `--rail-axis`
            is the single shared horizontal offset (a small left nudge to
            true up with the photographed cable's own centre) that the
            rail, glow, every connector and the seal all read from — never
            individually offset — so they stay one continuous line. No
            fixed height, no percentage positioning; the container's height
            is just its content. */}
        <div ref={railWrapperRef} className="px-6" style={{ "--rail-axis": "-3px" } as React.CSSProperties}>
          <div className="relative">
            {/* BATCH FILAMENT-HANDOFF-CURVE — a single filled, smoothly
                curved ribbon (one `clip-path: path()` shape, reused for
                both the dim and bright layers) whose two edges are cubic
                béziers that flatten to a purely vertical tangent at the
                bottom control points — it meets the rail with no corner,
                widens from ~1px (near the photo's own filament thickness)
                to the rail's exact 2.5px, and leans toward the photo's
                actual wire tip only at its far end, still referenced off
                `--rail-axis` (the one shared geometric constant every
                other piece of this rail already anchors to, not an
                independent screenshot coordinate). A solid navy patch
                (the section's own existing `#080A1D`, not a new colour)
                sits behind both layers, local to this small handoff area
                only, to conceal the photo's own baked-in filament tail so
                it can't peek out beside the clean CSS connector.
                BATCH FILAMENT-HANDOFF-ORIGIN — the bright layer is a
                `mask-image` top-down wipe (0% = nothing revealed, 100% =
                fully revealed from its own top edge downward), driven by
                its own short, EARLIER scrollTrigger phase — see that tween
                next to the main rail's own tween in the effect above for
                why it must finish before the rail starts, not tied to the
                rail's overall (much longer) progress. */}
            <div
              aria-hidden="true"
              className="absolute left-1/2 z-0 -translate-x-1/2 bg-[#080A1D]"
              style={{ bottom: "100%", height: "28px", width: "40px", marginLeft: "var(--rail-axis)" }}
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 z-0 bg-[#C66A3D]/28"
              style={{
                bottom: "100%",
                height: "28px",
                width: "16px",
                marginLeft: "calc(var(--rail-axis) - 8px)",
                clipPath: "path('M 6.75,28 C 6.75,14 11,14 11,0 L 12,0 C 12,14 9.25,14 9.25,28 Z')",
              }}
            />
            <div
              ref={railHandoffDrawRef}
              aria-hidden="true"
              className="absolute left-1/2 z-0 bg-[#C66A3D]"
              style={{
                bottom: "100%",
                height: "28px",
                width: "16px",
                maskImage: reduced ? undefined : "linear-gradient(to bottom, black 0%, black 0%, transparent 0%)",
                WebkitMaskImage: reduced
                  ? undefined
                  : "linear-gradient(to bottom, black 0%, black 0%, transparent 0%)",
                marginLeft: "calc(var(--rail-axis) - 8px)",
                clipPath: "path('M 6.75,28 C 6.75,14 11,14 11,0 L 12,0 C 12,14 9.25,14 9.25,28 Z')",
              }}
            />
            <div
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-1/2 z-0 w-[2.5px] -translate-x-1/2 bg-[#C66A3D]/28"
              style={{ marginLeft: "var(--rail-axis)" }}
            />
            <div
              ref={railDrawRef}
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-1/2 z-0 w-[2.5px] origin-top -translate-x-1/2 bg-[#C66A3D]"
              style={{ marginLeft: "var(--rail-axis)" }}
            />

            <div className="flex flex-col">
              {PROOF_STATIONS.map((station, i) => (
                <ProofStationRow
                  key={station.label}
                  station={station}
                  reduced={reduced}
                  rowRef={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  numberRef={(el) => {
                    numberRefs.current[i] = el;
                  }}
                  labelRef={(el) => {
                    labelRefs.current[i] = el;
                  }}
                  captionRef={(el) => {
                    captionRefs.current[i] = el;
                  }}
                  connectorOverlayRef={(el) => {
                    connectorOverlayRefs.current[i] = el;
                  }}
                  nodeOverlayRef={(el) => {
                    nodeOverlayRefs.current[i] = el;
                  }}
                  checkRef={(el) => {
                    checkRefs.current[i] = el;
                  }}
                />
              ))}
            </div>
          </div>

          {/* Transparent Weighing — the rail's final verification seal. A
              short stub bridges the row-rail's end to the node so the seal
              still reads as the rail's own endpoint, never a fixed width
              wider than available space. The dim base stays permanently
              visible (identical to before); a bright copper overlay fills
              it top-down in step with the seal's own activate/deactivate,
              exactly like the per-station connectors, so the final
              milestone never reads as visually disconnected from the rail. */}
          <div className="flex flex-col items-center pt-1 text-center">
            <div
              className="relative h-12 w-[2.5px]"
              style={{ marginLeft: "calc(var(--rail-axis) - 2px)" }}
            >
              <div aria-hidden="true" className="absolute inset-0 bg-[#C66A3D]/40" />
              <div
                ref={sealStubOverlayRef}
                aria-hidden="true"
                className="absolute inset-0 origin-top bg-[#C66A3D]"
                style={{ transform: `scaleY(${reduced ? 1 : 0})` }}
              />
            </div>
            <div
              ref={sealNodeRef}
              className="relative flex h-[88px] w-[88px] items-center justify-center rounded-full border-[1.5px] bg-[#080A1D]"
              style={{
                marginLeft: "var(--rail-axis)",
                borderColor: reduced ? "#C66A3D" : "rgba(198, 106, 61, 0.55)",
                boxShadow: reduced
                  ? "inset 0 0 18px rgba(198, 106, 61, 0.08), 0 0 14px rgba(198, 106, 61, 0.18)"
                  : "0 0 0 0 rgba(198, 106, 61, 0)",
              }}
            >
              {/* One-shot pulse ring on activation only — thin copper
                  outline expanding out from the seal, never a looping/
                  breathing glow. Stays at opacity 0 under reduced motion. */}
              <div
                ref={sealPulseRef}
                aria-hidden="true"
                style={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0 rounded-full border border-[#C66A3D]"
              />
              <Scale
                ref={sealIconRef}
                className="h-[32px] w-[32px]"
                style={{ color: reduced ? "#C66A3D" : "rgba(198, 106, 61, 0.55)", transform: `scale(${reduced ? 1 : 0.94})` }}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </div>
            <div className="mt-4 min-w-0" style={{ width: "min(100%, 270px)", marginLeft: "var(--rail-axis)" }}>
              <div
                ref={sealHeadingRef}
                style={{ opacity: reduced ? 1 : 0.7, transform: `translateY(${reduced ? 0 : 6}px)` }}
                className="font-display text-[24px] leading-[0.95] font-bold tracking-[0.04em] text-[#F4F4F2] uppercase min-[390px]:text-[26px]"
              >
                <span className="block">Transparent</span>
                <span className="block">Weighing</span>
              </div>
              <p
                ref={sealDescRef}
                style={{ opacity: reduced ? 0.72 : 0.62, transform: `translateY(${reduced ? 0 : 6}px)` }}
                className="mt-2 text-[16px] leading-[1.5] text-[#F4F4F2]"
              >
                Clear measurements. Straightforward dealing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
