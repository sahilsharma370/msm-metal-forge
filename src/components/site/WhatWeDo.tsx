import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Boxes, Import, Scale, Upload } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DotGrid } from "./DotGrid";
import truckImg from "@/assets/truck.png";
import servicesStage from "@/assets/services-recessed-stage-lowered.webp";
import lampOffImg from "@/assets/services-pendant-lamp-off.png";
import lampOnImg from "@/assets/services-pendant-lamp-on.png";
// Mobile Our Services is now a split-flap board (real DOM text, no
// image/screenshot asset) — the previous warehouse/truck mobile artwork
// imports are gone. Desktop keeps its own `servicesStage`/`truckImg` above,
// untouched.

// Supplied artwork's own natural size and internal composition — the
// clean stage WebP fills the pinned canvas exactly (object-fit: fill), so
// every live layer below reads its coordinates from these same constants
// rather than any independently-guessed value.
const STAGE_WIDTH = 1665;
const STAGE_HEIGHT = 936;
const STAGE_SURFACE_Y_PCT = 60.2; // illuminated surface contact line
const STAGE_TRUCK_START_PCT = 17.8; // BUY cavity centre
const STAGE_TRUCK_END_PCT = 82.3; // EXPORT cavity centre
const STAGE_CHECKPOINT_PCTS = [17.8, 39.3, 60.8, 82.3];

// Measured directly from the lamp-on PNG's own pixels (brightest-core
// bounding box of the lit glass, not guessed): the bulb's vertical centre
// sits at ~72% of the fixture image's height, and the bulb's own bottom
// tip (its widest bright cross-section runs ~78-80%, narrowing to a point
// by ~84%, which also matches the whole artwork's opaque-content bottom
// bound exactly) sits at ~84%. Two distinct anchors: the halo sits
// slightly below the *centre*; the atmospheric spill starts at the
// bulb's *bottom* edge, per spec, never its centre.
const LAMP_BULB_Y_RATIO = 0.72;
const LAMP_BULB_BOTTOM_Y_RATIO = 0.84;

// Desktop truck vibration — additive, not blended:
//   final = continuousEngineVibration + speedScaledRoadSuspension
// The engine layer is genuine Hz (multiplied by 2π), runs continuously
// and unconditionally whenever the canvas/truck are visible — stationary,
// mid-scroll, at checkpoints, parked under the lamp — and is NEVER
// crossfaded out while moving (that was the old, since-removed
// idle<->moving blend, which made a real engine go quiet while driving).
// The road layer adds on top only while horizontal movement occurs,
// phase driven by travelled pixels (currentX) and amplitude scaled by
// real px/sec speed — same mechanism as before, just smaller now that
// the engine layer supplies the visible rapid "tak-tak-tak".
// Idle (engine) layer — this is the "tiny engine vibration" that runs
// continuously whenever the truck is visible, moving or not. Sized to
// idle spec: ~0.12-0.20px typical Y peak (±0.25px absolute), ~0.015-
// 0.025deg typical rotation peak (±0.03deg absolute). Y and rotation
// only — no X: the inner suspension wrapper never receives horizontal
// motion (see setBodyY/setBodyRotation below).
const ENGINE_Y_FREQ_1_HZ = 8.6;
const ENGINE_Y_AMP_1 = 0.13; // px
const ENGINE_Y_FREQ_2_HZ = 13.2;
const ENGINE_Y_AMP_2 = 0.055; // px — combined peak ~0.185px
const ENGINE_Y_MIN = -0.15; // px upward
const ENGINE_Y_MAX = 0.19; // px downward — asymmetric on purpose (see FINAL_Y below)

const ENGINE_ROT_FREQ_1_HZ = 8.1;
const ENGINE_ROT_AMP_1 = 0.014; // deg
const ENGINE_ROT_FREQ_2_HZ = 12.7;
const ENGINE_ROT_AMP_2 = 0.007; // deg — combined peak ~0.021deg
const ENGINE_ROT_CAP = 0.025; // deg

// Road suspension — the "moving" layer, added on top of the idle engine
// layer only while actually travelling. Sized so idle+road together stay
// at/under the moving spec: ~0.8px typical Y peak (±1px absolute),
// ~0.1deg typical rotation peak (±0.12deg absolute). Phase/frequency and
// the dt-normalized real-px/sec speed gate are unchanged from before.
const ROAD_Y_AMP_1 = 0.42; // px
const ROAD_Y_AMP_2 = 0.18; // px — combined peak 0.6px
const ROAD_Y_FREQ_1 = 0.045; // radians per px of currentX travelled
const ROAD_Y_FREQ_2 = 0.097;
const ROAD_Y_CAP = 0.6; // px
const ROAD_ROT_AMP_1 = 0.05; // deg
const ROAD_ROT_AMP_2 = 0.02; // deg — combined peak 0.07deg, matches the ±0.07deg cap exactly
const ROAD_ROT_FREQ_1 = 0.052;
const ROAD_ROT_FREQ_2 = 0.11;
const ROAD_ROT_CAP = 0.07; // deg

// Speed-based (not per-tick-pixel-based) road-layer intensity gate: GSAP
// scrub advances by small per-frame deltas, so a per-tick px threshold
// stayed pinned near 0 through completely normal scroll speeds.
// Converting to true px/sec — dt-normalized, not frame-dependent — and
// gating over an actual px/sec range fixes that. This smoothed 0-1 value
// *is* the road layer's own movement fade in/out (no separate blend
// variable needed): it already reaches ~0 at rest and ramps with speed.
const MOVE_SPEED_MIN_PXPS = 3; // px/sec — below this, road intensity is 0
const MOVE_SPEED_MAX_PXPS = 38; // px/sec — at/above this, road intensity saturates at 1
const MOVE_INTENSITY_SMOOTH = 0.3; // per-scroll-tick smoothing, avoids flicker

// Hard clamps on the *combined* engine+road output — the asymmetric Y
// range is intentional: the truck may compress slightly further downward
// than it lifts upward, so the wheels always read as grounded. Both
// within the ±1px / ±0.12deg absolute moving caps, with headroom below
// them so a fast-scroll spike saturates safely instead of overshooting.
const FINAL_Y_MIN = -0.75; // px upward
const FINAL_Y_MAX = 0.8; // px downward
const FINAL_ROT_CAP = 0.1; // deg

const SCENE_BLEND_LERP = 0.12; // per-ticker-frame smoothing toward canvas-visible/not

// Same easeInOutQuad used to both derive this frame's true pixel position
// (for velocity/acceleration below) and the render-time transform, so the
// two never drift apart.
function easeProgress(p: number) {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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

// BATCH SERVICES-M1 — short mobile route-node labels (distinct from each
// card's own full title above) and the shared materials line every mobile
// dossier card closes on. Same commodity set already stated sitewide
// (Hero, Materials), not a new business claim.
const ACTION_LABELS = ["BUY", "SELL", "IMPORT", "EXPORT"];
const MATERIALS_LINE = "Copper · Aluminium · Steel · Lead";

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

/** Truck journey pinned to scroll via GSAP ScrollTrigger (BUY -> SELL ->
    IMPORT -> EXPORT), desktop-only (>=1024px) — see further down for the
    separate mobile "Dispatch Run". CHECKPOINT (pin redesign) — replaces
    the previous native rAF/scroll-listener "reveal as you pass it" system
    entirely: the whole desktop canvas now pins for a fixed scroll distance
    while the truck travels start-to-end, mirroring the same
    ScrollTrigger-scrub-drives-everything pattern already proven on mobile
    (truck X, lean/suspension physicality and active-card index are all
    driven from one shared `onUpdate`, never a second competing timeline). */
export function WhatWeDo() {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const desktopCanvasRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const truckWrapRef = useRef<HTMLDivElement | null>(null);
  const truckMotionRef = useRef<HTMLDivElement | null>(null);
  const truckGroundShadowRef = useRef<HTMLDivElement | null>(null);
  const truckBeaconRef = useRef<HTMLSpanElement | null>(null);
  const lampSceneRef = useRef<HTMLDivElement | null>(null);
  const truckLightRef = useRef<HTMLDivElement | null>(null);
  const lampOnRef = useRef(false);
  const travelPxRef = useRef(0);
  const startLeftPxRef = useRef(0);
  const canvasWidthPxRef = useRef(0);
  const truckWidthPxRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lampOn, setLampOn] = useState(false);

  // useLayoutEffect (not useEffect) so the truck's correct start-X is
  // applied synchronously, in the same pass as the DOM commit, before the
  // browser's first paint — truckWrap starts CSS `visibility:hidden` (see
  // JSX below) specifically so nothing is ever visible at the default
  // x:0/left:0 position first; `gsap.set` reveals it only once it's
  // already placed correctly.
  useLayoutEffect(() => {
    // Reduced motion: no pin, no scrub, nothing to tear down — the truck
    // and first card simply render at their default resting DOM state
    // (truckWrap carries no transform until gsap.set below ever runs;
    // activeIndex's initial `0` already highlights BUY), which is already
    // a stable, fully accessible, non-animated desktop layout. Explicitly
    // force visibility here too (not just via the GSAP context below) —
    // `reduced` starts false on first mount and is only corrected by
    // `usePrefersReducedMotion`'s own effect a tick later, so this branch
    // can run *after* a `gsap.context` revert has already restored
    // truckWrap's original `visibility:hidden`; without this line a
    // reduced-motion user could otherwise be left with a permanently
    // hidden truck.
    if (reduced) {
      if (truckWrapRef.current) truckWrapRef.current.style.opacity = "1";
      // Static OFF fixture only — no ignition, no beam/pool (those all
      // stay off since `lampOn`/`lampOnRef` never flip true outside the
      // ScrollTrigger onEnter/onEnterBack below, which never run here).
      // Already centred via plain CSS (`left: 50%`).
      if (lampSceneRef.current) lampSceneRef.current.style.opacity = "1";
      return;
    }

    const section = sectionRef.current;
    const canvas = desktopCanvasRef.current;
    const lane = laneRef.current;
    const truckWrap = truckWrapRef.current;
    if (!section || !canvas || !lane || !truckWrap) return;

    gsap.registerPlugin(ScrollTrigger);
    // `gsap.matchMedia()` rather than the bare `ScrollTrigger.matchMedia({...})`
    // form — same underlying breakpoint-scoped-ScrollTrigger mechanism, but
    // this one gives back a handle with a real `.revert()` for the effect's
    // own cleanup below (matching the mobile journey's identical pattern).
    const mm = gsap.matchMedia();

    mm.add("(min-width: 1024px)", () => {
      let lastActive = -1;

      // Truck vibration state — plain closure variables (same convention
      // as `lastActive` above), never React state, never read every
      // render. `lastX`/`lastTickTime` feed the dt-normalized speed calc
      // in onUpdate below; `moveIntensitySmoothed` is that speed's
      // smoothed 0-1 gate — it *is* the road layer's own movement
      // fade in/out, so no separate mode-blend variable is needed.
      // `roadHeaveTarget`/`roadPitchTarget` are the road layer's targets,
      // computed on each scroll tick; the continuous engine layer is
      // computed fresh every ticker frame (below) and is never gated by
      // any of this — only by `sceneBlend`, a smoothed 0-1 kept current
      // by the IntersectionObserver set up below (real viewport
      // intersection, not ScrollTrigger.isActive, which can go false
      // right at progress 1 while the truck is still clearly parked on
      // screen under the lamp).
      let lastX = 0;
      let lastTickTime = 0;
      let moveIntensitySmoothed = 0;
      let roadHeaveTarget = 0;
      let roadPitchTarget = 0;
      let sceneBlend = 0;
      let canvasVisible = false;
      // Whether `tick` (declared below) is currently registered on
      // gsap.ticker — starts true since it's added unconditionally right
      // after its own declaration. `tick` itself flips this false and
      // deregisters once it has fully settled to rest while offscreen; the
      // IntersectionObserver above flips it back true and re-registers the
      // instant the canvas is visible again.
      let tickerActive = true;

      // Functional measurement, recomputed on every ScrollTrigger refresh
      // — never assumed from a stale snapshot (same discipline as the
      // mobile journey's own `computeTravel`). Truck WIDTH is still sized
      // off the same reference the pre-stage-background version used (39%
      // of the max-w-7xl/px-6 content column, clamped 180-330px) so its
      // on-screen size is unchanged; its horizontal TRAVEL is now driven
      // by the stage canvas's own percentage composition (start/end
      // cavity centres) instead of the old lane-width math.
      const computeTravel = () => {
        const canvasWidthPx = canvas.clientWidth;
        const canvasHeightPx = canvas.clientHeight;
        const contentWidthPx = Math.min(canvasWidthPx, 1280) - 48;
        const truckWidthPx = clamp(contentWidthPx * 0.39, 180, 330);
        truckWrap.style.width = `${truckWidthPx}px`;
        const startCenterPx = (STAGE_TRUCK_START_PCT / 100) * canvasWidthPx;
        const endCenterPx = (STAGE_TRUCK_END_PCT / 100) * canvasWidthPx;
        startLeftPxRef.current = startCenterPx - truckWidthPx / 2;
        travelPxRef.current = endCenterPx - startCenterPx;

        // Cached for the lamp-proximity calc in onUpdate below, so that
        // calc never needs its own getBoundingClientRect — it just reads
        // these two refs (kept fresh only here, on refresh/resize).
        canvasWidthPxRef.current = canvasWidthPx;
        truckWidthPxRef.current = truckWidthPx;

        // Surface Y — the lamp itself is horizontally centred via plain
        // CSS (`left: 50%`) now, not measured against the truck's final
        // position. Still exposed as a custom property since the
        // ambient wash/pool (and the fixture height below) need to know
        // where the road line is. `--services-lamp-fixture-h` is set
        // here too (a static clamp(), not a measurement) purely so it's
        // available on every descendant of `canvas` — including the
        // ambient-light layer, which is now a *sibling* of the fixture
        // layer rather than nested inside it, so it can't inherit a
        // custom property declared only on `.services-lamp-scene`.
        canvas.style.setProperty("--services-surface-y", `${(STAGE_SURFACE_Y_PCT / 100) * canvasHeightPx}px`);
        canvas.style.setProperty("--services-lamp-fixture-h", "clamp(320px, 38vh, 430px)");
        canvas.style.setProperty("--services-lamp-bulb-y-ratio", `${LAMP_BULB_Y_RATIO}`);
        canvas.style.setProperty("--services-lamp-bulb-bottom-y-ratio", `${LAMP_BULB_BOTTOM_Y_RATIO}`);
      };

      // Single shared position setter — used for the pre-paint initial
      // placement below, every scrub `onUpdate`, and every `onRefresh`
      // (after remeasuring), so there is exactly one formula for "where
      // is the truck at progress p" and it can never drift out of sync
      // with itself. Same easing as before (unchanged scroll animation).
      const syncTruckPosition = (progress: number) => {
        const currentX = startLeftPxRef.current + easeProgress(clamp(progress, 0, 1)) * travelPxRef.current;
        gsap.set(truckWrap, { x: currentX });
        return currentX;
      };

      // Ref + state, updated only on the boolean edge — never a React
      // re-render on every scroll tick. Driven purely by the section's
      // pinned state (onEnter/onEnterBack/onLeaveBack below), never by
      // truck progress.
      const setLampState = (next: boolean) => {
        if (next !== lampOnRef.current) {
          lampOnRef.current = next;
          setLampOn(next);
        }
      };

      const ctx = gsap.context(() => {
        // Clears whatever `translateY` __root.tsx's
        // PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT may have applied to
        // this canvas pre-hydration (see that script's own comment) —
        // first, synchronously, before ScrollTrigger.create below ever
        // measures canvas's "original" state for its own pin/unpin
        // bookkeeping. A plain mutation, not `gsap.set`: nothing here is
        // gsap-tracked, so there's nothing for `ctx.revert()` to restore
        // on teardown, and canvas's transform is never touched again after
        // this point.
        canvas.style.transform = "";
        computeTravel();

        // Place the truck at its correct start position (and set the
        // lamp's own size-driving custom properties, just above in
        // computeTravel()) in this same synchronous layout-effect pass —
        // before ScrollTrigger exists and before the browser's first
        // paint, so there is never a frame at the default x:0/left:0 or
        // the lamp's pre-measurement 0×0 collapse. Position/size are still
        // set exactly this way: instant, synchronous `gsap.set`.
        gsap.set(truckWrap, { x: startLeftPxRef.current, force3D: true });

        // Only the REVEAL itself (opacity 0 -> 1) is now a short GSAP tween
        // (same mechanism TrustBar.tsx's own Counter/FadeUpReveal already
        // use for this exact "reveal once positioned" pattern — not a CSS
        // transition: MEASURED live that a CSS `transition-opacity` class
        // never actually animated here, `truckOpacity` jumped straight from
        // "0" to "1" with no intermediate frames, so the pop was identical
        // either way) rather than an instant visibility:hidden -> visible
        // (or opacity 0 -> 1 via `.set`) snap — MEASURED (reload already
        // scrolled into Services): hydration reliably takes long enough
        // that the previous instant on/off read as a visible pop, even
        // though the position underneath was already correct the entire
        // time. `x` above is already final before this tween is even
        // created, so it can never reveal a wrong position — it only
        // softens an already-correct reveal. A real `gsap.to` (not `.set`)
        // is also what makes `gsap.context`'s own revert correctly kill/
        // reset it — already relied on elsewhere in this file to restore
        // truckWrap's pre-GSAP state when this breakpoint match tears down
        // (e.g. desktop -> mobile) — the same safety a plain DOM mutation
        // here would NOT have had.
        gsap.to(truckWrap, { opacity: 1, duration: 0.2, ease: "power1.out" });
        if (lampSceneRef.current) {
          gsap.to(lampSceneRef.current, { opacity: 1, duration: 0.2, ease: "power1.out" });
        }
        lastX = startLeftPxRef.current;
        lastTickTime = performance.now();

        // Real viewport-intersection check for the canvas, independent of
        // ScrollTrigger's own pinned/active bookkeeping — the truck must
        // keep idling for as long as it's genuinely visible on screen,
        // including the moment it's parked under the lamp at progress 1
        // (where ScrollTrigger.isActive can already have gone false).
        // Also what resumes the ticker below once it has stopped itself
        // after fading out offscreen.
        const io = new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            canvasVisible = !!entry && entry.isIntersecting;
            if (canvasVisible && !tickerActive) {
              tickerActive = true;
              gsap.ticker.add(tick);
            }
          },
          { threshold: 0 },
        );
        io.observe(canvas);

        // Direct-mutation quickSetters (never React state) for the truck
        // body's own suspension transform — set up once per breakpoint
        // match, reused on every scrub tick below. Y and rotation only:
        // the outer wrapper already owns horizontal X (its own journey
        // `x`, set via syncTruckPosition above), so this inner wrapper
        // never receives X.
        const setBodyY = truckMotionRef.current ? gsap.quickSetter(truckMotionRef.current, "y", "px") : null;
        const setBodyRotation = truckMotionRef.current
          ? gsap.quickSetter(truckMotionRef.current, "rotation", "deg")
          : null;

        const st = ScrollTrigger.create({
          trigger: section,
          start: "top top",
          end: () => `+=${window.innerHeight * 2.8}`,
          pin: canvas,
          pinSpacing: true,
          scrub: 0.65,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefresh: (self) => {
            computeTravel();
            syncTruckPosition(self.progress);
          },
          // Lamp is driven purely by the section's pinned state, never by
          // truck progress: on the instant the section pins (scrolling
          // down) or is re-entered pinned (scrolling up from past the
          // end), it's ON: the moment you scroll back above the section
          // entirely, it's OFF.
          onEnter: () => setLampState(true),
          onEnterBack: () => setLampState(true),
          onLeaveBack: () => setLampState(false),
          onUpdate: (self) => {
            const progress = self.progress;
            const currentX = syncTruckPosition(progress);

            // Truck-light proximity: pure arithmetic on already-cached
            // measurements (canvasWidthPxRef/truckWidthPxRef, refreshed
            // only in computeTravel) — never a getBoundingClientRect
            // here. The lamp is horizontally centred on the stage
            // (`left: 50%`), so its centre is just half the canvas
            // width. Smoothstepped within an ~18%-of-stage-width zone,
            // so it's 0 at both journey ends (they're ~32 points away
            // from centre) and reaches exactly 1 directly underneath.
            // Purely a function of `currentX`, so reverse scroll
            // reproduces the same values deterministically.
            if (truckLightRef.current) {
              const lampCenterX = canvasWidthPxRef.current / 2;
              const truckCenterX = currentX + truckWidthPxRef.current / 2;
              const zonePx = canvasWidthPxRef.current * 0.18;
              const t = zonePx > 0 ? clamp(1 - Math.abs(truckCenterX - lampCenterX) / zonePx, 0, 1) : 0;
              const influence = t * t * (3 - 2 * t);
              truckLightRef.current.style.setProperty("--lamp-influence", influence.toFixed(4));
            }

            const p = clamp(progress, 0, 1);

            // Road suspension: only the *target* is computed here (on
            // each scroll tick); the ticker below adds it on top of the
            // always-on engine layer. Phase is driven by travelled pixels
            // (currentX) — not progress, not time — so reverse scroll
            // runs the same wave backwards with zero discontinuity.
            // Intensity is scaled by dt-normalized speed (px/sec, not raw
            // per-tick pixel delta — GSAP scrub advances in small
            // per-frame steps, so a per-tick px threshold stayed pinned
            // near 0 through completely normal scroll speeds) and
            // smoothed across ticks so it never flickers — this smoothed
            // value *is* the road layer's own fade in/out with movement.
            // Two non-integer-multiple frequencies per axis — never one
            // clean sine.
            const now = performance.now();
            const dtSeconds = Math.max((now - lastTickTime) / 1000, 1 / 120);
            const speedPxPerSec = Math.abs(currentX - lastX) / dtSeconds;
            lastTickTime = now;
            lastX = currentX;
            const moveIntensityRaw = clamp(
              (speedPxPerSec - MOVE_SPEED_MIN_PXPS) / (MOVE_SPEED_MAX_PXPS - MOVE_SPEED_MIN_PXPS),
              0,
              1,
            );
            moveIntensitySmoothed += (moveIntensityRaw - moveIntensitySmoothed) * MOVE_INTENSITY_SMOOTH;
            const rawRoadHeave =
              Math.sin(currentX * ROAD_Y_FREQ_1) * ROAD_Y_AMP_1 + Math.sin(currentX * ROAD_Y_FREQ_2 + 0.9) * ROAD_Y_AMP_2;
            const rawRoadPitch =
              Math.sin(currentX * ROAD_ROT_FREQ_1 + 0.5) * ROAD_ROT_AMP_1 +
              Math.sin(currentX * ROAD_ROT_FREQ_2 + 1.6) * ROAD_ROT_AMP_2;
            roadHeaveTarget = clamp(rawRoadHeave * moveIntensitySmoothed, -ROAD_Y_CAP, ROAD_Y_CAP);
            roadPitchTarget = clamp(rawRoadPitch * moveIntensitySmoothed, -ROAD_ROT_CAP, ROAD_ROT_CAP);

            // Roof beacon: tiny, deterministic opacity variation driven by
            // progress alone (never elapsed time), so it sits perfectly
            // still whenever scrolling stops — no continuous flashing.
            // Kept within the 0.20-0.42 static range, just nudged.
            if (truckBeaconRef.current) {
              truckBeaconRef.current.style.opacity = clamp(0.3 + 0.06 * Math.sin(p * Math.PI * 6), 0.2, 0.42).toFixed(
                3,
              );
            }

            // BUY 0.00-0.24 / SELL 0.25-0.49 / IMPORT 0.50-0.74 / EXPORT
            // 0.75-1.00 — one active card at a time; the previous one
            // returns to normal the instant the quartile changes.
            const quartile = clamp(Math.floor(progress * 4), 0, 3);
            if (quartile !== lastActive) {
              lastActive = quartile;
              setActiveIndex(quartile);
            }
          },
        });

        // Runs every animation frame via GSAP's own ticker (the same
        // underlying rAF GSAP/ScrollTrigger already use internally —
        // never a second, competing animation timeline), independent of
        // scroll events, since the idle layer is time-based and must
        // keep playing even while scroll is completely still. This is
        // also the *only* place that ever writes to truckMotionRef's
        // y/rotation — the single source of truth for both. The ground
        // shadow is never touched here.
        const tick = () => {
          const now = performance.now();

          // Smoothed 0-1 toward whether the canvas is *actually visible*
          // in the viewport right now (IntersectionObserver-backed, not
          // ScrollTrigger.isActive — that can go false right at progress
          // 1 while the truck is still clearly on screen parked under
          // the lamp, which would otherwise kill vibration there). Lets
          // Y/rotation ease back to exactly 0 (rather than snap) only
          // once the canvas has genuinely left the viewport, and stops
          // them growing again while it's off-screen.
          sceneBlend += ((canvasVisible ? 1 : 0) - sceneBlend) * SCENE_BLEND_LERP;

          // Once that ease-out has genuinely finished and the canvas is
          // still offscreen, snap the residual to an exact rest state
          // (an asymptotic lerp never reaches literal 0 on its own) and
          // deregister this function from gsap.ticker entirely — with the
          // section scrolled away, there is nothing left to animate, so
          // running this every frame for the rest of the page's lifetime
          // is pure waste. The IntersectionObserver above re-registers it
          // the instant the canvas becomes visible again.
          if (!canvasVisible && sceneBlend < 0.001) {
            sceneBlend = 0;
            setBodyY?.(0);
            setBodyRotation?.(0);
            tickerActive = false;
            gsap.ticker.remove(tick);
            return;
          }

          // Continuous diesel-engine vibration — genuine Hz (×2π),
          // computed fresh every frame, completely unconditional (never
          // gated by movement or checkpoint state): this is what's
          // "always running" whether the truck is stationary, scrolling,
          // or parked under the lamp. Two non-matching frequencies per
          // axis, deterministic (no Math.random()), so it's stable and
          // repeatable without flicker or drift — each wave is centred on
          // 0 and self-clamped, so there's no position accumulation.
          const t = now / 1000;
          const engineY = clamp(
            Math.sin(t * Math.PI * 2 * ENGINE_Y_FREQ_1_HZ) * ENGINE_Y_AMP_1 +
              Math.sin(t * Math.PI * 2 * ENGINE_Y_FREQ_2_HZ + 1.15) * ENGINE_Y_AMP_2,
            ENGINE_Y_MIN,
            ENGINE_Y_MAX,
          );
          const engineRotation = clamp(
            Math.sin(t * Math.PI * 2 * ENGINE_ROT_FREQ_1_HZ + 0.4) * ENGINE_ROT_AMP_1 +
              Math.sin(t * Math.PI * 2 * ENGINE_ROT_FREQ_2_HZ + 1.8) * ENGINE_ROT_AMP_2,
            -ENGINE_ROT_CAP,
            ENGINE_ROT_CAP,
          );

          // Additive, per the required architecture — road suspension
          // (roadHeaveTarget/roadPitchTarget, cached from the latest
          // scroll tick, already 0 at rest via moveIntensitySmoothed) is
          // added on top of the engine layer, never blended/crossfaded
          // against it, then the combined result is hard-clamped. The
          // asymmetric Y range lets the truck compress slightly further
          // downward than it lifts upward, so wheels always read grounded.
          const finalY = clamp(engineY + roadHeaveTarget, FINAL_Y_MIN, FINAL_Y_MAX);
          const finalRotation = clamp(engineRotation + roadPitchTarget, -FINAL_ROT_CAP, FINAL_ROT_CAP);

          setBodyY?.(finalY * sceneBlend);
          setBodyRotation?.(finalRotation * sceneBlend);

          // Ground shadow lives outside truckMotionRef (a sibling of the
          // suspension wrapper), so it only ever follows the outer
          // wrapper's own horizontal X — it never reads finalY/rotation
          // and its scale/opacity are never touched here.
        };
        gsap.ticker.add(tick);

        // One-time refresh once BOTH the truck image (loaded async) and the
        // page's web fonts have settled — never a recurring refresh loop.
        // `start: "top top"` above is measured against `section`'s current
        // document position, which depends on everything rendered above it.
        // A font-driven reflow of that preceding content was the original,
        // UNVERIFIED theory for a reported Trust/Services overlap — it
        // turned out to be wrong: the actual cause was TrustBar itself
        // contributing zero document height while `position: fixed`
        // (fixed in ScrollStack.tsx, not a layout/font concern at all — see
        // that file's own doc comment). This refresh is kept regardless, as
        // ordinary defensive practice for any other late image-driven
        // layout shift above this section — it just isn't load-bearing for
        // that specific, now-fixed bug.
        const img = truckWrap.querySelector("img");
        const imageReady =
          img && !(img as HTMLImageElement).complete
            ? new Promise<void>((resolve) => {
                (img as HTMLImageElement).addEventListener("load", () => resolve(), { once: true });
              })
            : Promise.resolve();
        Promise.all([imageReady, document.fonts.ready]).then(() => ScrollTrigger.refresh());

        return () => {
          st.kill();
          gsap.ticker.remove(tick);
          io.disconnect();
          setBodyY?.(0);
          setBodyRotation?.(0);
        };
      }, section);

      return () => ctx.revert();
    });

    return () => mm.revert();
  }, [reduced]);

  return (
    <section
      id="services"
      ref={sectionRef}
      className="services-stage-height relative isolate bg-[#050617] lg:overflow-hidden"
    >
      {/* Mobile gets a fully static grid — no pointer/touch follow, no
          push, no copper-on-proximity colour shift (interactive=false
          skips the pointermove/pointerleave listeners and the push/colour
          branch entirely, so a touch-drag can never move or recolour a
          dot). A muted, very-low-opacity navy tone (0.09) keeps it as
          background depth only, still deliberately more present than the
          card's own internal dot texture (0.035, unchanged), which stays
          the softer of the two per spec. Unaffected by the desktop layers
          below. */}
      <DotGrid glow={0} interactive={false} restingColor="52, 68, 104" restingAlpha={0.09} className="lg:hidden" />

      {/* Desktop composition — this whole canvas is what gets pinned
          while the truck travels; `lg:min-h-screen lg:pt-16 lg:pb-16`
          kept verbatim from the pre-pin layout, unchanged — the fix lives
          on the OUTER `<section>` above (`services-stage-height`), not
          here. MEASURED (twice, live): putting the pre-sized min-height
          directly on this pinned element instead inflated its own natural
          size, which made GSAP's pin-spacer compensate for a pinned
          element "taller than the viewport" and reserve roughly DOUBLE
          the real scroll distance (2.8 viewports measured as ~4676px
          instead of ~2338px) — confirmed by comparing the pin-spacer's
          own rendered height before/after moving this class. Sizing the
          outer, un-pinned `<section>` instead (mirroring Hero's own
          wrapper/pinned-element split exactly — `heroWrapper` is sized,
          `Hero` itself never is) lets this canvas stay at its true natural
          size, so GSAP's own spacer math isn't skewed by an artificial
          inflation it has no way to know is synthetic. */}
      <div
        ref={desktopCanvasRef}
        className="services-pin-canvas hidden lg:relative lg:isolate lg:flex lg:min-h-screen lg:flex-col lg:justify-start lg:overflow-hidden lg:pt-16 lg:pb-16"
      >
        {/* Clean supplied stage plate — the sole desktop environment now.
            It already contains the technical-grid pattern, the
            illuminated surface and all four recessed card wells, so no
            CSS-drawn grid/platform/line/gradient competes with it. Fills
            the whole pinned canvas exactly (object-fit: fill — the
            artwork's own 1665:936 composition is authored to match), and
            every live layer below reads its position as a percentage of
            this same canvas box. */}
        <img
          aria-hidden="true"
          src={servicesStage}
          alt=""
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          className="pointer-events-none absolute inset-0 block h-full w-full object-fill select-none"
          draggable={false}
        />

        {/* Ambient lamp light — atmospheric spill + road pool. A sibling
            placed *before* the truck lane (not nested inside the lamp
            fixture below) specifically so it paints behind the truck and
            its ground shadow, per the required back-to-front layer
            order: stage → this → truck shadow → truck → truck-light
            overlay → lamp fixture PNG. Horizontally centred on the stage
            the same way the fixture is (`left: 50%`). Opacity toggled by
            the same `lampOn` state as the fixture, so both fade together. */}
        <div
          aria-hidden="true"
          className={`services-lamp-ambient pointer-events-none absolute top-0 hidden lg:block ${lampOn ? "is-on" : ""}`}
        >
          <div className="services-lamp-wash" />
          <div className="services-lamp-pool" />
        </div>

        {/* Truck lane — spans the full canvas so the truck's horizontal
            travel and the illuminated-surface vertical line are both
            computed in percentages of the exact box the stage plate
            fills, never a narrower sub-container. */}
        <div ref={laneRef} className="absolute inset-0">
          {/* Four checkpoint inlays, centred on the illuminated surface
              line at the artwork's own four cavity-centre percentages —
              driven by the same `activeIndex` the cards use, no separate
              state; reached nodes stay filled through reverse scroll for
              free. */}
          {STAGE_CHECKPOINT_PCTS.map((pct, i) => {
            const reachedOrActive = i <= activeIndex;
            return (
              <span
                key={CARDS[i]!.label}
                aria-hidden="true"
                className={`pointer-events-none absolute block h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[background-color,border-color,box-shadow,opacity] duration-500 ${
                  reachedOrActive
                    ? "border-copper-bright bg-copper-bright opacity-100 shadow-[0_0_6px_oklch(0.72_0.13_60_/_0.5)]"
                    : "border-[oklch(0.6_0.04_255_/_0.55)] bg-[oklch(0.1_0.02_260_/_0.6)] opacity-65"
                }`}
                style={{ left: `${pct}%`, top: `${STAGE_SURFACE_Y_PCT}%` }}
              />
            );
          })}
          <div
            ref={truckWrapRef}
            className="absolute left-0 isolate min-w-[180px] max-w-[330px] overflow-visible will-change-transform"
            style={{ bottom: `calc(${100 - STAGE_SURFACE_Y_PCT}% - 2px)`, opacity: 0 }}
          >
            {/* Localised surface lift, then the single overhead-light
                ground shadow (underbody wash + two tyre contact patches,
                three radial gradients in one element) — both ahead of the
                truck image in paint order (so they stay behind it) and a
                sibling of truckMotionRef (never inside it), so the shadow
                inherits this wrapper's horizontal translate but never the
                suspension wrapper's own y/rotate. Every offset here is
                unchanged from before and still resolves correctly, since
                truckWrapRef's own bottom edge is what's pinned to
                STAGE_SURFACE_Y_PCT (60.2%). */}
            <div aria-hidden="true" className="truck-surface" />
            <div ref={truckGroundShadowRef} aria-hidden="true" className="truck-ground-shadow" />
            {/* Suspension (translateY heave) + pitch (rotate) live on
                this inner wrapper only — both deterministic functions
                of scroll progress `p` (see onUpdate above), pivoting
                near the rear axle/contact line so they read as chassis
                travel/weight-transfer rather than the whole graphic
                sliding. The roof-beacon highlight lives here too, so
                it travels with the body's own heave/pitch. */}
            <div
              ref={truckMotionRef}
              className="relative z-[2] will-change-transform"
              style={{ transformOrigin: "55% 82%" }}
            >
              <img
                src={truckImg}
                alt=""
                width={1108}
                height={511}
                loading="lazy"
                className="w-full"
                style={{
                  filter:
                    "brightness(0.88) contrast(1.12) saturate(0.92) drop-shadow(0 1px 1px rgba(145, 169, 210, 0.14))",
                }}
              />
              {/* Lighting-only overlay, masked to the truck's own alpha
                  shape so it can never render as a second visible
                  truck/logo. Lives inside this same suspension wrapper so
                  it inherits the exact X/heave/rotate the truck image
                  itself has — its only independent variable is opacity,
                  driven by --lamp-influence (set each scrub tick above
                  from cached proximity-to-lamp, never from a new
                  getBoundingClientRect call here). Base truck image
                  opacity/filter above are untouched. */}
              <div
                ref={truckLightRef}
                aria-hidden="true"
                className="truck-light-response"
                style={{
                  maskImage: `url(${truckImg})`,
                  WebkitMaskImage: `url(${truckImg})`,
                }}
              />
              {/* Positioned relative to this same wrapper (not
                  truckWrapRef) so it inherits its transform — i.e.
                  travels with the body's own heave/pitch. Overlaps
                  the existing painted roof beacon in the artwork; the
                  image's own tail-light is used as-is for the rear,
                  no separate overlay. */}
              <span ref={truckBeaconRef} aria-hidden="true" className="truck-light-beacon" />
            </div>
          </div>
        </div>

        {/* Pendant-lamp fixture — hangs from the pinned canvas's own top
            edge, horizontally centred on the stage via plain CSS
            (`left: 50%`), not tied to the truck's position at all. Both
            OFF/ON artwork are always mounted (genuine transparent PNGs)
            — the crossfade only ever toggles opacity, so ignition never
            waits on an image download. Its on/off state is driven purely
            by the section's own pinned state (onEnter/onEnterBack/
            onLeaveBack above), not by truck progress. Deliberately the
            LAST layer in this canvas (topmost), per the required
            back-to-front order — the ambient wash/pool above are a
            separate, earlier sibling specifically so they can sit behind
            the truck while this fixture stays in front of everything. */}
        <div
          ref={lampSceneRef}
          aria-hidden="true"
          className={`services-lamp-scene pointer-events-none absolute top-0 hidden lg:block ${lampOn ? "is-on" : ""}`}
          style={{ opacity: 0 }}
        >
          <div className="services-lamp-fixture">
            {/* Behind both PNGs in paint order (DOM-first, no z-index),
                so it reads as glow radiating from/around the bulb rather
                than a separate shape drawn over the fixture. */}
            <div className="services-lamp-halo" />
            <img src={lampOffImg} alt="" draggable={false} style={{ opacity: lampOn ? 0 : 1 }} />
            <img src={lampOnImg} alt="" draggable={false} style={{ opacity: lampOn ? 1 : 0 }} />
          </div>
        </div>

        {/* Live heading — in its original upper position (right after the
            canvas's own top padding), above the stage plate/truck/cards.
            `lg:translate-y-8` only nudges this title group down to clear
            the fixed navbar — a transform, so it doesn't affect layout
            flow/canvas height and can't shift the truck/cards, which are
            positioned independently via absolute % coordinates anyway. */}
        <div className="relative mx-auto max-w-7xl px-6 text-center lg:translate-y-8">
          <p className="label-eyebrow text-copper-bright">Our Services</p>
          <h3 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl lg:text-4xl">
            Buying, selling and moving metal—across the UAE and beyond.
          </h3>
        </div>

        {/* Live card content, fitted into the artwork's four empty wells
            at its own exact coordinates. No standalone card background,
            border or shadow: the cavity already painted into the artwork
            is what reads as each card's container; only a restrained
            copper glow (aligned to the cavity's own rounded edge) marks a
            reached card. */}
        <div
          className="pointer-events-none absolute grid"
          style={{
            left: "8.23%",
            right: "8.00%",
            top: "66.0%",
            height: "22.2%",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            columnGap: "2.8%",
          }}
        >
          {CARDS.map((card, i) => {
            // Cumulative, not latched: derived fresh from activeIndex
            // (itself derived from live scroll progress) every render,
            // so reverse-scrolling past a card naturally drops its glow
            // again — no separate "ever reached" state to desync.
            const isReached = i <= activeIndex;
            const isCurrent = i === activeIndex;
            return (
              <div
                key={card.label}
                className={`service-cavity relative isolate flex h-full w-full min-w-0 flex-col items-center justify-start overflow-hidden rounded-2xl border-0 bg-transparent px-[30px] text-center shadow-none outline-0 ${
                  isReached ? "is-reached" : ""
                } ${lampOn ? "is-on" : ""}`}
              >
                {/* Depth (::before) and, when reached, inward copper
                    illumination (::after) are both defined in styles.css
                    on `.service-cavity` — carved-in shading and
                    cumulative reached glow that only ever emits inward
                    from the baked rim, never an outer border/box-shadow.
                    Cumulative, not latched: `isReached` is derived fresh
                    from activeIndex every render, so reverse-scrolling
                    past a card naturally drops its glow again. */}
                <div className="relative z-[1] flex h-12 w-12 items-center justify-center">
                  <card.Icon
                    className={`h-6 w-6 transition-colors duration-500 ${
                      isCurrent ? "text-copper-bright" : "text-[oklch(0.62_0.13_50)]"
                    }`}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </div>
                <span className="font-display relative z-[1] mt-4 text-lg font-bold tracking-[0.04em] text-foreground uppercase sm:text-xl">
                  {card.label}
                </span>
                <p className="font-display relative z-[1] mx-auto mt-2 max-w-[90%] min-w-0 text-sm leading-[1.45] text-foreground/85">
                  {card.copy}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile/tablet — flow diagram, below lg only. `DispatchRun`
          handles its own `prefers-reduced-motion` and short-viewport
          checks internally. */}
      <DispatchRun />
    </section>
  );
}

// Copper when a position is the active stage; muted steel-grey otherwise.
// `ROUTE_ACTIVE` is TrustBar.tsx's own single copper source (`copperBright`
// there, "#C66A3D" — see its "Single copper source throughout" comment),
// read directly rather than approximated, so the route/circle/diamond/stem
// match the preceding Trust section's active timeline line exactly. The
// Reverted per feedback: only the active NUMBER changes colour on
// scroll/selection (as originally) — label and caption stay constant,
// unmuted colours always. The active colour is now the same "#C66A3D" as
// the routes/diamond/stem, matching TrustBar.tsx's own active timeline
// line exactly, instead of the previous, slightly different oklch shade.
//
// The two "inactive" colours are plain rgba(), not oklch() — GSAP's colour
// parser doesn't understand the oklch() function, so tweening from
// "#C66A3D" to an oklch() string (or back) had it fall back to garbage
// interpolation, flashing through unrelated hues (reported as pink/green/
// blue) for a couple of frames before snapping to the correct final
// value. rgba() (and hex) are both formats GSAP parses and interpolates
// correctly, so the same muted steel-grey now tweens smoothly with no
// flash.
const ROUTE_ACTIVE = "#C66A3D";
const ROUTE_INACTIVE = "rgba(138, 145, 163, 0.45)";
const NUMBER_ACTIVE = "#C66A3D";
const NUMBER_INACTIVE = "rgba(191, 193, 202, 0.7)";

const STAGE_COUNT = ACTION_LABELS.length;

// Mobile pin's active-stage windows, as fractions of the pinned scroll
// range. The previous scheme (`Math.round(progress * (STAGE_COUNT - 1))`)
// splits the range into STAGE_COUNT-1 equal "cadence" widths (1/3 each,
// here) but — being a round() over 4 discrete values — the two EDGE
// stages (BUY and EXPORT) only get HALF that cadence (1/6 each), since
// round() clips at both ends of the range. BUY's short edge window was
// never reported as an issue (it's the entry stage). EXPORT's short edge
// window was: the pin releases at progress 1 the instant EXPORT's own
// half-width bucket ends, leaving no scroll room to actually view its
// card before the section unpins.
//
// BUY/SELL/IMPORT's own transition points are left exactly where they
// were (as fractions of the OLD range: 1/6, 1/2, 5/6 — BUY's pacing is
// untouched). EXPORT's window is extended to the SAME full cadence
// SELL/IMPORT already have (1/3 of the OLD range) by extending the pinned
// scroll range itself by exactly one half-cadence (old range * 1/6) — see
// the narrative wrapper's own height below, which implements that
// extension; the pin still releases exactly at progress 1, now the end of
// EXPORT's own full window, not before it. Re-expressed as fractions of
// that NEW, extended total (old fractions divided by the 7/6 the range
// grew by): 0, 1/7, 3/7, 5/7, 1 — BUY keeps a half-width 1/7 edge window
// (its existing, preserved pacing), SELL/IMPORT/EXPORT each get a full
// 2/7.
const STAGE_WINDOWS: Array<[number, number]> = [
  [0, 1 / 7],
  [1 / 7, 3 / 7],
  [3 / 7, 5 / 7],
  [5 / 7, 1],
];
const STAGE_BOUNDARIES = STAGE_WINDOWS.slice(1).map(([lo]) => lo); // [1/7, 3/7, 5/7]

// Diagram geometry — sourced directly from the approved
// mobile-services-route-reference.svg (the exact authority for line paths,
// circle positions, the diamond and spacing), viewBox 0 0 390 370. One
// fixed viewBox shared by the SVG routes/diamond and the
// percentage-positioned HTML text/buttons, so both scale together and
// never drift apart across viewport widths.
//
// `TEXT_ANCHORS` is where each position's number/label/caption block
// starts (hugging the left/right edges) — adapted from, not copied from,
// the reference's own placement-guide labels: the reference draws one
// simple line of text per corner, but the live site's block is three real
// lines (number/label/caption), so its anchor sits higher above the
// circle to leave room for that extra height. `NODE_LAYOUT` (circle
// centres) and `ROUTES` (path `d` strings) are copied verbatim from the
// reference SVG's own `<circle>`/`<path>` elements, just reordered to this
// file's canonical BUY/SELL/IMPORT/EXPORT index order.
const DIAGRAM_VIEWBOX = "0 0 390 370";
// Reverted per feedback: the previous pass's precision fixes (bottom row
// anchor pulled up to clear the circle; route endpoints moved to the
// diamond's exact rotated-corner math) made the IMPORT/EXPORT circle read
// as pointing at the caption text instead of the number, and changed the
// route/curve look from the approved version. Back to the original
// reference-derived anchor/endpoint values.
const TEXT_ANCHORS: Array<{ x: number; y: number; side: "left" | "right" }> = [
  { x: 16, y: 12, side: "left" }, // 01 BUY
  { x: 374, y: 12, side: "right" }, // 02 SELL
  { x: 16, y: 245, side: "left" }, // 03 IMPORT
  { x: 374, y: 245, side: "right" }, // 04 EXPORT
];
const NODE_LAYOUT: Array<{ cx: number; cy: number }> = [
  { cx: 84, cy: 60 }, // 01 BUY
  { cx: 306, cy: 60 }, // 02 SELL
  { cx: 84, cy: 268 }, // 03 IMPORT
  { cx: 306, cy: 268 }, // 04 EXPORT
];
// Hub centred at (195, 164), same centre the original diamond used. Each
// route: a short horizontal lead off the circle, a rounded bend, a
// straight diagonal, and a gentle curve — the original reference-derived
// shape, unchanged up to the last curve's own endpoint/control points,
// which are truncated exactly where that curve crosses the new hex-nut
// hub's own boundary (found by walking the original bezier and testing it
// against the hex polygon, then re-deriving a matching sub-curve via De
// Casteljau subdivision) — so every route now meets the hub's edge
// precisely instead of running into its interior.
const ROUTES = [
  "M98,60 H111 C123,60 129,67 135,79 L164,132 C168,139 171,144 174,149",
  "M292,60 H279 C267,60 261,67 255,79 L226,132 C222,139 219,144 216,149",
  "M98,268 H111 C123,268 129,261 135,249 L164,196 C168,189 171,184 174,179",
  "M292,268 H279 C267,268 261,261 255,249 L226,196 C222,189 219,184 216,179",
];
// Exact short captions from the approved mockup — deliberately distinct
// from `CARDS[i].copy` (the full descriptions used in the detail card
// below): these are the diagram's own compact labels, not a second
// rendering of the card's copy.
const NODE_CAPTIONS = [
  "We purchase scrap metals",
  "We supply global markets",
  "We source internationally",
  "We ship worldwide",
];

// `max-height` media queries evaluate against the LIVE viewport (the same
// quantity `dvh` tracks), so on a device whose viewport height straddles
// this boundary as the mobile browser's own toolbar collapses/expands
// during scroll, a single threshold would flip `short` mid-scroll — a
// hysteresis band (60px above the entry threshold, comfortably larger than
// any real toolbar's own height delta) means height has to recover past the
// *wider* boundary before switching back, so a toolbar-only fluctuation
// inside that band never flips it either way.
function usePrefersShortViewport() {
  const [short, setShort] = useState(false);
  const shortRef = useRef(false);
  useEffect(() => {
    const enterMq = window.matchMedia("(max-height: 600px)");
    const exitMq = window.matchMedia("(max-height: 660px)");
    const evaluate = () => {
      const next = shortRef.current ? exitMq.matches : enterMq.matches;
      if (next === shortRef.current) return;
      shortRef.current = next;
      setShort(next);
    };
    evaluate();
    enterMq.addEventListener("change", evaluate);
    exitMq.addEventListener("change", evaluate);
    return () => {
      enterMq.removeEventListener("change", evaluate);
      exitMq.removeEventListener("change", evaluate);
    };
  }, []);
  return short;
}

/** Mobile/tablet "Our Services" flow diagram: four numbered positions
    (BUY/SELL/IMPORT/EXPORT) arranged around a central diamond hub, joined
    by curved SVG routes ending in outlined circles (no arrowheads), with a
    short stem into the detail card below. A mobile-only scroll runway
    (the outer wrapper, see its own height comment for the exact value)
    plus a sticky inner stage pinned beneath the fixed header let normal
    document scrolling drive `requestedIndex` through the four stages
    (`ScrollTrigger` reads progress, never wheel/touch events directly,
    never locks body scroll). Tapping a position calls `goToStage`, which
    smooth-scrolls to that stage's own offset in the runway so the same
    scroll-driven update loop lands on, and holds, the tapped stage. */
function DispatchRun() {
  const reduced = usePrefersReducedMotion();
  const short = usePrefersShortViewport();
  const narrativeRef = useRef<HTMLDivElement | null>(null);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);

  const [requestedIndex, setRequestedIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const displayedIndexRef = useRef(0);
  const isAnimatingRef = useRef(false);
  const pendingIndexRef = useRef<number | null>(null);

  const routePathRefs = useRef<Array<SVGPathElement | null>>([]);
  const routeCircleRefs = useRef<Array<SVGCircleElement | null>>([]);
  const numberRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const hubRef = useRef<SVGGElement | null>(null);
  const cardPanelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  // Scroll wiring — mobile-only, section-local. No wheel/touch interception
  // and no body scroll lock anywhere: this only ever reads `ScrollTrigger`'s
  // own progress from normal document scroll. Skipped entirely on short
  // viewports, where the diagram renders in normal flow (no sticky, no
  // runway) so the page can never lock the user in.
  useEffect(() => {
    const narrative = narrativeRef.current;
    if (!narrative || short) return;

    gsap.registerPlugin(ScrollTrigger);
    // ScrollTrigger's default behaviour treats every window `resize` as a
    // reason to re-measure and refresh all triggers — but mobile browsers
    // fire `resize` purely from their own address-bar/toolbar collapsing or
    // expanding during scroll, which only changes `innerHeight`. Without
    // this, that toolbar-only event alone could re-run this trigger's own
    // start/end math mid-scroll and jump `requestedIndex` (the active
    // BUY/SELL/IMPORT/EXPORT stage) with zero real scroll input. This is
    // GSAP's own documented flag for exactly this class of mobile-only
    // false-positive resize; it's global to ScrollTrigger, not scoped to
    // this one instance, and safe to call repeatedly.
    ScrollTrigger.config({ ignoreMobileResize: true });
    const mm = gsap.matchMedia();

    mm.add("(max-width: 1023.98px)", () => {
      let lastActive = -1;
      const ctx = gsap.context(() => {
        const st = ScrollTrigger.create({
          trigger: narrative,
          start: "top top+=72",
          end: "bottom bottom",
          scrub: reduced ? true : 0.4,
          onUpdate: (self) => {
            // See `STAGE_BOUNDARIES`'s comment — this counts how many of
            // the (non-uniform) transition points progress has passed,
            // which is exactly the active stage index under that scheme.
            const nextActive = STAGE_BOUNDARIES.filter((b) => self.progress >= b).length;
            if (nextActive !== lastActive) {
              lastActive = nextActive;
              setRequestedIndex(nextActive);
            }
          },
        });
        scrollTriggerRef.current = st;
        return () => st.kill();
      }, narrative);

      return () => {
        scrollTriggerRef.current = null;
        ctx.revert();
      };
    });

    return () => mm.revert();
  }, [reduced, short]);

  // Tapping a position scrolls to that stage's own offset in the runway
  // (via the live ScrollTrigger) rather than writing state directly, so the
  // same scroll-driven update above lands on and holds it. On short
  // viewports (no ScrollTrigger mounted) it just requests the stage
  // directly — the diagram is still fully usable, just not scroll-tied.
  const goToStage = (i: number) => {
    const st = scrollTriggerRef.current;
    if (!st) {
      setRequestedIndex(i);
      return;
    }
    // Targets the centre of that stage's own window (see
    // `STAGE_WINDOWS`), not just its start — for EXPORT in particular,
    // landing at its start (old behaviour: `i / (STAGE_COUNT - 1)` = 1 for
    // the last stage) would scroll straight to progress 1, the exact
    // unpin point, leaving no dwell room to view it even via a tap.
    const [lo, hi] = STAGE_WINDOWS[i]!;
    const targetProgress = (lo + hi) / 2;
    window.scrollTo({ top: st.start + targetProgress * (st.end - st.start), behavior: reduced ? "auto" : "smooth" });
  };

  // Crossfades the outgoing/incoming route+circle+number colour and the
  // detail card content. Rapid requests never stack: a request arriving
  // mid-transition only updates `pendingIndexRef`, and `onComplete`
  // immediately chases it — so the diagram always finishes on the latest
  // request, never a mixed/stale state.
  const runTransition = (fromIndex: number, toIndex: number) => {
    isAnimatingRef.current = true;

    const settle = () => {
      isAnimatingRef.current = false;
      const pending = pendingIndexRef.current;
      pendingIndexRef.current = null;
      if (pending !== null && pending !== toIndex) {
        runTransition(toIndex, pending);
      }
    };

    if (reduced) {
      setDisplayedIndex(toIndex);
      displayedIndexRef.current = toIndex;
      settle();
      return;
    }

    const duration = 0.4;
    timelineRef.current?.kill();
    const tl = gsap.timeline({ onComplete: settle });
    timelineRef.current = tl;

    const fromPath = routePathRefs.current[fromIndex];
    const fromCircle = routeCircleRefs.current[fromIndex];
    const fromNumber = numberRefs.current[fromIndex];
    const toPath = routePathRefs.current[toIndex];
    const toCircle = routeCircleRefs.current[toIndex];
    const toNumber = numberRefs.current[toIndex];

    if (fromPath) tl.to(fromPath, { stroke: ROUTE_INACTIVE, duration }, 0);
    if (fromCircle) tl.to(fromCircle, { stroke: ROUTE_INACTIVE, duration }, 0);
    if (fromNumber) tl.to(fromNumber, { color: NUMBER_INACTIVE, duration }, 0);

    if (toPath) tl.to(toPath, { stroke: ROUTE_ACTIVE, duration }, 0);
    if (toCircle) tl.to(toCircle, { stroke: ROUTE_ACTIVE, duration }, 0);
    if (toNumber) tl.to(toNumber, { color: NUMBER_ACTIVE, duration }, 0);

    if (hubRef.current) {
      tl.fromTo(hubRef.current, { opacity: 0.55 }, { opacity: 1, duration: 0.35 }, 0);
    }

    const fromPanel = cardPanelRefs.current[fromIndex];
    const toPanelEl = cardPanelRefs.current[toIndex];
    if (fromPanel) tl.to(fromPanel, { opacity: 0, duration: 0.16 }, 0);

    tl.call(
      () => {
        setDisplayedIndex(toIndex);
        displayedIndexRef.current = toIndex;
      },
      undefined,
      0.16,
    );

    if (toPanelEl) tl.fromTo(toPanelEl, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.18);
  };

  useEffect(() => {
    if (requestedIndex === displayedIndexRef.current) return;
    if (isAnimatingRef.current) {
      pendingIndexRef.current = requestedIndex;
      return;
    }
    runTransition(displayedIndexRef.current, requestedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedIndex]);

  useEffect(() => {
    return () => {
      timelineRef.current?.kill();
    };
  }, []);

  const board = (
    <>
      <p className="label-eyebrow" style={{ color: ROUTE_ACTIVE }}>
        Our Services
      </p>
      <h3 className="font-display mt-2 text-[clamp(2.125rem,9vw,2.375rem)] leading-[1.05] font-bold text-foreground">
        <span className="block whitespace-nowrap">Metal trading,</span>
        <span className="block whitespace-nowrap">
          handled <span style={{ color: ROUTE_ACTIVE }}>end to end.</span>
        </span>
      </h3>

      {/* Diagram — routes/diamond/circles are a decorative SVG (aria-hidden,
          one shared viewBox so it always scales in lockstep with the
          percentage-positioned position buttons below); every number,
          label and tap target is real accessible DOM. */}
      <div className="relative mx-auto mt-2 w-full" style={{ aspectRatio: "390 / 370" }}>
        <svg viewBox={DIAGRAM_VIEWBOX} aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
          {ROUTES.map((d, i) => (
            <path
              key={`route-${i}`}
              ref={(el) => {
                routePathRefs.current[i] = el;
              }}
              d={d}
              fill="none"
              stroke={i === displayedIndex ? ROUTE_ACTIVE : ROUTE_INACTIVE}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {/* No arrowheads — each route just ends at its own outlined
              circle (here) and meets the diamond's stroke cleanly at the
              other end. Fill stays constant (matching the card's own
              navy) for both states; only the stroke colour changes, so
              every circle always reads as "outlined", never solid. */}
          {NODE_LAYOUT.map((node, i) => (
            <circle
              key={`node-${i}`}
              ref={(el) => {
                routeCircleRefs.current[i] = el;
              }}
              cx={node.cx}
              cy={node.cy}
              r={12}
              fill="#0B0E24"
              stroke={i === displayedIndex ? ROUTE_ACTIVE : ROUTE_INACTIVE}
              strokeWidth={2.7}
            />
          ))}
          {/* Hub — a hex-nut (flat-top hexagon, outer circumradius 30,
              centred at (195,164), same centre the diamond it replaces
              used) with a precisely concentric hollow inner ring (radius
              14.5), per msm-services-mobile-hub-target.png. Both values
              were measured directly off that reference image (relative to
              the diagram's own known circle/line geometry, not guessed) —
              see the git history for the derivation. A constant brand
              accent (always copper), not tied to which stage is active;
              only the group's opacity pulses briefly on a stage change. */}
          <g ref={hubRef}>
            <polygon
              points="225,164 210,138 180,138 165,164 180,190 210,190"
              fill="#0B0E24"
              stroke={ROUTE_ACTIVE}
              strokeWidth={2.7}
              strokeLinejoin="round"
            />
            <circle cx={195} cy={164} r={14.5} fill="none" stroke={ROUTE_ACTIVE} strokeWidth={2.7} />
          </g>
          <line x1={195} y1={190} x2={195} y2={370} stroke={ROUTE_ACTIVE} strokeWidth={2.5} />
        </svg>

        {TEXT_ANCHORS.map((anchor, i) => (
          <button
            key={ACTION_LABELS[i]}
            type="button"
            onClick={() => goToStage(i)}
            aria-current={i === displayedIndex ? "step" : undefined}
            aria-label={`View ${ACTION_LABELS[i]} details`}
            className={`absolute flex min-h-11 min-w-11 max-w-[84px] flex-col ${
              anchor.side === "left" ? "items-start text-left" : "items-end text-right"
            } appearance-none border-0 bg-transparent p-1`}
            style={{
              left: anchor.side === "left" ? `${(anchor.x / 390) * 100}%` : undefined,
              right: anchor.side === "right" ? `${100 - (anchor.x / 390) * 100}%` : undefined,
              top: `${(anchor.y / 370) * 100}%`,
            }}
          >
            <span
              ref={(el) => {
                numberRefs.current[i] = el;
              }}
              className="font-display text-[clamp(1.9rem,8.5vw,2.3rem)] leading-none font-bold"
              style={{ color: i === displayedIndex ? NUMBER_ACTIVE : NUMBER_INACTIVE }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="mt-1 text-[13px] leading-none font-bold tracking-[0.06em] text-foreground uppercase">
              {ACTION_LABELS[i]}
            </span>
            {/* The mockup's own exact short caption — distinct from
                `CARDS[i].copy` (the full description used in the detail
                card below), not a second rendering of it. */}
            <span className="mt-1 text-[12px] leading-snug text-foreground/55">{NODE_CAPTIONS[i]}</span>
          </button>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {CARDS[displayedIndex]!.label}
      </p>

      {/* Detail card — all four panels stacked in the same grid cell (sized
          to the tallest) so the card's own height never moves between
          stages; only the active panel is visible/exposed, crossfaded by
          the timeline above. Divider + materials line are constant, so
          they live once, outside the crossfading grid. */}
      <div
        className="relative mt-0 rounded-[20px] border border-white/10 px-5 pt-5"
        style={{ backgroundColor: "#0B0E24" }}
      >
        <div className="relative grid">
          {CARDS.map((card, i) => (
            <div
              key={card.label}
              ref={(el) => {
                cardPanelRefs.current[i] = el;
              }}
              aria-hidden={i === displayedIndex ? undefined : true}
              className="flex flex-col will-change-transform"
              style={{
                gridArea: "1 / 1",
                visibility: i === displayedIndex ? "visible" : "hidden",
                ...(i === displayedIndex ? null : { opacity: 0 }),
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] font-semibold tracking-[0.14em]">
                  <span style={{ color: ROUTE_ACTIVE }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-foreground/45"> / 04</span>
                </div>
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
                  style={{ borderColor: `${ROUTE_ACTIVE}80` }}
                >
                  <card.Icon className="h-5 w-5" style={{ color: ROUTE_ACTIVE }} strokeWidth={1.5} aria-hidden="true" />
                </div>
              </div>
              <h4 className="font-display mt-2 text-[clamp(2rem,9vw,2.5rem)] leading-none font-bold uppercase">
                <span className="text-foreground">We </span>
                <span style={{ color: ROUTE_ACTIVE }}>{ACTION_LABELS[i]}</span>
              </h4>
              <p className="font-display mt-2 text-[16px] leading-relaxed text-foreground/80">{card.copy}</p>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-3 h-px bg-white/12" />
        <p className="mt-3 pb-4 text-center text-[11px] font-semibold tracking-[0.14em] text-foreground/55 uppercase">
          {MATERIALS_LINE}
        </p>
      </div>
    </>
  );

  if (short) {
    return <div className="relative px-6 pt-4 pb-8 text-left lg:hidden">{board}</div>;
  }

  return (
    // `--app-vh` (see __root.tsx) replaces `190svh` — a physical-device
    // trace on Materials.tsx's identical pattern proved `svh` tracks the
    // live, toolbar-sensitive viewport on this browser rather than staying
    // fixed at the collapsed-toolbar height, which let a toolbar-only
    // scroll-chrome change alone shrink this wrapper (and shift Materials'
    // own scroll math below it) with zero actual scroll input. `--app-vh`
    // is captured once at initial load and only updates on a genuine
    // width/orientation change.
    //
    // `205 * var(--app-vh) + 12px` (not the previous flat `190`): the
    // pinned scroll range the ScrollTrigger below normalizes `self.progress`
    // against is `R = height - viewportHeight + 72px` (from its own
    // `"top top+=72"` / `"bottom bottom"` start/end), i.e. with the old
    // `190 * var(--app-vh)` height, `R_old = 0.9 * viewportHeight + 72px`.
    // Giving EXPORT a full, equal window (see `STAGE_WINDOWS`'s comment)
    // means extending that range by exactly one half-cadence, `R_old / 6`
    // = `0.15 * viewportHeight + 12px` = `15 * var(--app-vh) + 12px` (since
    // `var(--app-vh)` is defined as `viewportHeight / 100`). Added to the
    // old `190 * var(--app-vh)`, that's `205 * var(--app-vh) + 12px` — this
    // is the ONLY place that extension is implemented; the active-stage
    // math below just re-expresses the (unchanged) BUY/SELL/IMPORT
    // transition points as fractions of this new, larger total.
    <div
      ref={narrativeRef}
      className="relative lg:hidden"
      style={{ height: "calc(var(--app-vh, 7.6px) * 205 + 12px)" }}
    >
      {/* Sticky scene, pinned beneath the fixed header for the runway
          above. No explicit height: the diagram + card's own compact
          content sizes it, with nothing left to overflow. Sticky's native
          release at both ends of the containing block above (now taller,
          see its own height comment) is unmodified. Header offset matches
          Header.tsx's actual 56px
          (`h-14`) mobile bar height — a stale 72px here (from before that
          header was shrunk) was pure excess top space with nothing to
          justify it. `pt-3`/`pb-4` (was `pt-4`/`pb-5`) trims the same kind
          of unjustified excess immediately around the content, landing the
          bottom gap after the card in the intended ~12–16px range at a
          ~390×750 viewport. */}
      <div
        className="sticky px-6 pt-3 pb-4 text-left"
        style={{ top: "calc(56px + env(safe-area-inset-top))", zIndex: 10 }}
      >
        {board}
      </div>
    </div>
  );
}
