import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { gsap } from "gsap";
// Full-bleed photographic scenes (warehouse + grounded foreground pile in
// one shot), landscape-oriented — desktop's own asset, used only there.
import copperScene from "@/assets/materials-copper-scene.webp";
import aluminiumScene from "@/assets/materials-aluminium-scene.webp";
import steelScene from "@/assets/materials-steel-iron-scene.webp";
import leadScene from "@/assets/materials-lead-scene.webp";
// Layered mobile assets: one warehouse/floor photo per material (v7 for
// Aluminium/Steel/Lead; Copper keeps the original v5 warehouse — all four
// are plain warehouse-only shots, no baked-in pile, same 941x1672 size),
// plus one transparent (alpha-preserved) pile cutout per material. The
// warehouse crossfades between these four on an active-material change,
// exactly like the cutout, using the same opacity transition (see the
// render below) — it never reloads/jumps, and nothing else about the
// cutout's own crop/size/position/shadow changes.
import copperWarehouse from "@/assets/msm-trade-mobile-warehouse-v5.webp";
import aluminiumWarehouse from "@/assets/msm-trade-aluminium-mobile-warehouse-v7.webp";
import steelWarehouse from "@/assets/msm-trade-steel-iron-mobile-warehouse-v7.webp";
import leadWarehouse from "@/assets/msm-trade-lead-mobile-warehouse-v7.webp";
import copperCutout from "@/assets/msm-trade-copper-cutout-v5.webp";
import aluminiumCutout from "@/assets/msm-trade-aluminium-cutout-v5.webp";
import steelCutout from "@/assets/msm-trade-steel-iron-cutout-v5.webp";
import leadCutout from "@/assets/msm-trade-lead-cutout-v5.webp";

const MATERIALS = [
  {
    key: "copper",
    name: "Copper",
    scene: copperScene,
    description: "Copper wire and cable, pipes, coils, sheets and radiator scrap.",
    pills: ["Wire & Cable", "Pipes & Coils", "Radiators"],
    quoteMaterialKey: "copper",
    quoteLabel: "Get a Copper Quote",
  },
  {
    key: "aluminium",
    name: "Aluminium",
    scene: aluminiumScene,
    description: "Aluminium profiles and frames, sheets, panels, cable and cast aluminium scrap.",
    pills: ["Profiles & Frames", "Sheets & Panels", "Cast Aluminium"],
    quoteMaterialKey: "aluminium",
    quoteLabel: "Get an Aluminium Quote",
  },
  {
    key: "steel",
    name: "Steel & Iron",
    scene: steelScene,
    description:
      "Steel and iron rebar, structural beams, plates, sheets, pipes and machinery scrap.",
    pills: ["Rebar & Beams", "Plates & Pipes", "Machinery Scrap"],
    quoteMaterialKey: "steel_iron",
    quoteLabel: "Get a Steel & Iron Quote",
  },
  {
    key: "lead",
    name: "Lead",
    scene: leadScene,
    description: "Lead sheets, pipes, cable sheathing, wheel weights and industrial lead scrap.",
    pills: ["Sheets & Pipes", "Cable Sheathing", "Wheel Weights"],
    quoteMaterialKey: "lead",
    quoteLabel: "Get a Lead Quote",
  },
] as const;

// Real periodic-table values for each material's small badge — shared by
// the desktop card and the new mobile card (both render the same plain
// text badge, no image).
const MATERIAL_META = {
  copper: { symbol: "Cu", atomicNumber: 29 },
  aluminium: { symbol: "Al", atomicNumber: 13 },
  steel: { symbol: "Fe", atomicNumber: 26 },
  lead: { symbol: "Pb", atomicNumber: 82 },
} as const;

// The approved mobile-site orange — the exact literal value WhatWeDo.tsx's
// mobile "Our Services" eyebrow uses (its own local `ROUTE_ACTIVE`, not a
// shared export), reused here by value so this section's mobile accent
// colour matches that approved reference exactly rather than the
// visibly-more-yellow `--copper-bright` token.
const MOBILE_ORANGE = "#C66A3D";

// Mobile-only warehouse photo per material — see the import comments
// above. Crossfaded exactly like `MOBILE_CUTOUT` below, same timing.
const MOBILE_WAREHOUSE = {
  copper: copperWarehouse,
  aluminium: aluminiumWarehouse,
  steel: steelWarehouse,
  lead: leadWarehouse,
} as const;

// Mobile-only transparent pile cutout per material — see the import
// comments above. Crossfaded on top of the matching warehouse background.
const MOBILE_CUTOUT = {
  copper: copperCutout,
  aluminium: aluminiumCutout,
  steel: steelCutout,
  lead: leadCutout,
} as const;

// Each cutout's raw canvas size plus the TIGHT bounding box of its actual
// *meaningful* (alpha > 32, not merely alpha > 0) pixels within that canvas.
// An alpha > 0 bbox (the previous version of this constant) included faint
// noise spread across almost the entire transparent canvas, which produced
// a bbox barely smaller than the raw canvas itself — still tall for Copper,
// still wide for Lead — so "crop to that bbox" behaved almost like the
// original "contain the raw canvas" bug it was meant to replace: on-device
// this still rendered Copper/Aluminium/Steel tall enough to overlap the
// heading/tabs above the pile slot. Re-measured at alpha > 32 with a small
// edge allowance, all four collapse to the same genuinely wide/short pile
// shape (aspect ratios 1.70–1.95, not 0.57–1.83):
//   copper:    941x1672  -> (82,669)-(872,1135)   -> 790x466
//   aluminium: 1225x1284 -> (27,323)-(1217,1017)  -> 1190x694
//   steel:     1246x1263 -> (13,315)-(1236,983)   -> 1223x668
//   lead:      1672x941  -> (138,143)-(1609,896)  -> 1471x753
// `canvasWidth`/`canvasHeight` are the raw file's own full pixel size (the
// full original image is always kept — never stretched — only the SVG
// viewBox/crop below uses the smaller box); `contentLeft`/`contentTop`/
// `contentWidth`/`contentHeight` are this alpha>32 bbox.
const MOBILE_CUTOUT_CROP: Record<
  (typeof MATERIALS)[number]["key"],
  { canvasWidth: number; canvasHeight: number; contentLeft: number; contentTop: number; contentWidth: number; contentHeight: number }
> = {
  copper: { canvasWidth: 941, canvasHeight: 1672, contentLeft: 82, contentTop: 669, contentWidth: 790, contentHeight: 466 },
  aluminium: { canvasWidth: 1225, canvasHeight: 1284, contentLeft: 27, contentTop: 323, contentWidth: 1190, contentHeight: 694 },
  steel: { canvasWidth: 1246, canvasHeight: 1263, contentLeft: 13, contentTop: 315, contentWidth: 1223, contentHeight: 668 },
  lead: { canvasWidth: 1672, canvasHeight: 941, contentLeft: 138, contentTop: 143, contentWidth: 1471, contentHeight: 753 },
};

// Shared sizing for every material's cropped pile in the pile slot (see
// MobileMaterialsBoard) — one width and one floor offset, not per-material,
// is what gives all four the same visible footprint and the same floor
// line.
//
// `52%` (not the previous `96%`) of the (edge-to-edge, see the pile slot's
// own `-mx-6`) slot — the earlier `96%` was sized against a screenshot
// pixel scale, not the actual 402 CSS-pixel viewport: at 402 CSS px, 96%
// is ~386 CSS px, which is correct in CSS terms, but combined with the
// alpha>0 bbox's inflated content height (see MOBILE_CUTOUT_CROP), that
// width produced piles tall enough to overlap the tabs above. `52%` here
// (~209 CSS px at 402px) is the starting value confirmed against the
// supplied 780px-wide screenshots (~405 screenshot px there).
const PILE_WIDTH = "52%";
// `32` (not the previous `16`) CSS px — the floor line all four piles'
// bases align to, measured against the supplied 780x1500 screenshots
// (floor ~y=845-855, card starting ~y=914; the ~60-70 screenshot-px gap
// between them is ~32-36 CSS px at the ~1.94x screenshot-to-CSS scale).
const PILE_FLOOR_GAP_PX = 32;
// Safety floor for the pile slot itself. The pile images are all
// `position: absolute`, so they contribute zero intrinsic height to the
// slot — fine when the slot's flex ancestor has a real fixed height to
// distribute (the scroll-pinned sticky stage), but on the short-viewport
// fallback (`Materials()`'s `shortViewport` branch) the containing wrapper
// is plain, auto-height document flow with no fixed height to stretch
// into, so a `flex-1` slot with nothing to grow into collapses to 0px —
// at that point `bottom: ${PILE_FLOOR_GAP_PX}px` positions the pile
// relative to a 0-height anchor sitting exactly between the tabs and the
// card, i.e. directly overlapping the tabs above. This min-height
// guarantees real, reserved space for the pile + floor gap in that case
// too, while never capping growth in the sticky branch (min-height is a
// floor, not a fixed size). Sized generously above the tallest pile
// (Copper, ~123px at the reference 402px viewport) plus the floor gap.
const PILE_SLOT_MIN_HEIGHT_PX = 170;

function useReducedMotion() {
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

// Genuinely short screens (landscape phones, small older devices) get a
// plain, normal-flow, tap-only fallback instead of the pinned scroll stage
// below — there's no viewport height to reliably fit "heading through
// upload link" in one screen, so forcing the pin there would either clip
// content or trap the user against a sticky box taller than the screen.
//
// `max-height` media queries evaluate against the LIVE viewport (the same
// quantity `dvh` tracks), so on a device whose viewport height straddles
// this boundary as the mobile browser's own toolbar collapses/expands
// during scroll (e.g. a smaller phone sitting around 600-650px), a single
// threshold would flip `short` mid-scroll — switching the entire pinned
// vs. normal-flow layout underneath the user. `EXIT_MAX_HEIGHT` (60px above
// the entry threshold, comfortably larger than any real toolbar's own
// height delta) is a hysteresis band: once short, height has to recover
// past the *wider* boundary before switching back, so a toolbar-only
// fluctuation within that band never flips it either way.
const SHORT_VIEWPORT_MAX_HEIGHT = 620;
const SHORT_VIEWPORT_EXIT_MAX_HEIGHT = 680;
function useShortViewport() {
  const [short, setShort] = useState(false);
  const shortRef = useRef(false);
  useEffect(() => {
    const enterMq = window.matchMedia(`(max-height: ${SHORT_VIEWPORT_MAX_HEIGHT}px)`);
    const exitMq = window.matchMedia(`(max-height: ${SHORT_VIEWPORT_EXIT_MAX_HEIGHT}px)`);
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

function clamp01(n: number) {
  return Math.min(Math.max(n, 0), 1);
}

/** Mobile-only scroll narrative controller — four stages (Copper -> Aluminium
 * -> Steel & Iron -> Lead) pinned as one sticky screen while the page's own
 * scroll progresses through them, exactly like the mobile "Our Services"
 * flow diagram elsewhere on this page. Derives a single continuous
 * `progress` (0..1) from the narrative wrapper vs. its sticky stage via one
 * passive, rAF-throttled scroll listener (+ resize) — no wheel/touch
 * interception, no body scroll lock, nothing hijacked; scrolling the page
 * normally is the only input this reads. Completely independent of the
 * desktop `active`/IntersectionObserver controller above. */
function useMobileMaterialProgress() {
  const narrativeRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const narrative = narrativeRef.current;
    const sticky = stickyRef.current;
    if (!narrative || !sticky) return;

    let stickyTopPx = 0;
    let scrollRange = 1;
    let ticking = false;
    // Mobile browsers fire `resize` when the address-bar/toolbar itself
    // collapses or expands during scroll — that only ever changes
    // `innerHeight`, never `innerWidth`. A genuine layout change worth
    // re-measuring for (orientation flip, real window resize) always
    // changes width; a toolbar-only event never does, so width is the one
    // thing this compares.
    let lastWidth = window.innerWidth;

    const measure = () => {
      stickyTopPx = parseFloat(getComputedStyle(sticky).top) || 0;
      scrollRange = Math.max(1, narrative.offsetHeight - sticky.offsetHeight);
    };

    const update = () => {
      ticking = false;
      const rect = narrative.getBoundingClientRect();
      setProgress(clamp01((stickyTopPx - rect.top) / scrollRange));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    const onResize = () => {
      const width = window.innerWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      measure();
      update();
    };

    measure();
    update(); // initialize immediately so a deep-linked/refreshed scroll position renders correctly
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /** Tap/keyboard convenience: scroll the narrative to a material's anchor
   * instead of setting local state directly, so scroll position and the
   * displayed material can never fall out of sync. */
  const scrollToAnchor = (i: number, reduced: boolean) => {
    const narrative = narrativeRef.current;
    const sticky = stickyRef.current;
    if (!narrative || !sticky) return;
    const stickyTopPx = parseFloat(getComputedStyle(sticky).top) || 0;
    const scrollRange = Math.max(1, narrative.offsetHeight - sticky.offsetHeight);
    const narrativeDocTop = narrative.getBoundingClientRect().top + window.scrollY;
    const targetY = narrativeDocTop - stickyTopPx + (i / 3) * scrollRange;
    window.scrollTo({ top: targetY, behavior: reduced ? "auto" : "smooth" });
  };

  return { narrativeRef, stickyRef, progress, scrollToAnchor };
}

/**
 * Purely visual fill-height for the sticky stage (and, through plain CSS
 * inheritance/inset, its warehouse background) — deliberately separate
 * from `--app-vh` (see __root.tsx), which is captured once at initial load
 * and frozen thereafter specifically to keep SCROLL-DISTANCE math
 * (narrative's own height, `scrollRange`, `progress` above) stable across
 * the browser's address-bar show/hide. That freeze is correct for scroll
 * math but wrong for this: when the toolbar later hides and the actually
 * visible viewport grows, the sticky box needs to visually grow with it —
 * otherwise it (and the warehouse photo filling it) stay pinned at the
 * smaller, frozen size, leaving a blank strip of the section's own navy
 * background below the card.
 *
 * This hook sets `--materials-live-vh` on the sticky element itself,
 * updated on every resize/visualViewport/orientation event, no width- or
 * genuineness-gating at all — unlike `useStableViewportHeight`, staying
 * live here is the entire point. This is safe to leave ungated because
 * narrative's own height is a separate, untouched CSS variable (`--app-vh`)
 * with an explicit, fixed value: growing the sticky CHILD's height can
 * never change the already-fixed-height narrative PARENT's own box, so it
 * can't perturb document height or any other section's scroll math —
 * the effect is fully contained inside this one sticky element.
 */
function useLiveStageHeight(target: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const update = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      el.style.setProperty("--materials-live-vh", `${h / 100}px`);
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [target]);
}

type LayoutMode = "pinned" | "stacked";

/**
 * Mobile/touch and reduced-motion users get a normal-height, manual-tab-only
 * presentation instead of the 400vh-ish pinned scroll sequence — no forced
 * scroll distance, nothing pinned, nothing to get stuck inside. Gated on
 * `prefers-reduced-motion` OR a coarse pointer independently, so a
 * reduced-motion desktop (fine pointer) user and a touch (no reduced-motion
 * preference) user both land here for their own reason.
 */
function useMaterialsLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>("pinned");

  useEffect(() => {
    const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarseMq = window.matchMedia("(pointer: coarse)");
    const compute = () => setMode(reducedMq.matches || coarseMq.matches ? "stacked" : "pinned");
    compute();
    reducedMq.addEventListener("change", compute);
    coarseMq.addEventListener("change", compute);
    return () => {
      reducedMq.removeEventListener("change", compute);
      coarseMq.removeEventListener("change", compute);
    };
  }, []);

  return mode;
}

/**
 * `active` has exactly one writer path with two entry points: the
 * IntersectionObserver (natural scroll) and `selectMaterial` (tab click /
 * keyboard). A click sets `active` immediately (instant display) and then
 * "suppresses" the observer until the programmatic scroll it triggers
 * actually arrives at that same chapter — so the chapters crossed en route
 * can't flash the wrong material back into view. Any real user input (wheel,
 * touch, keydown) clears that suppression immediately, handing control back
 * to natural scrolling the moment the user actually intervenes. In "stacked"
 * layout mode there is no scroll linkage at all — `selectMaterial` just sets
 * state.
 */
function useMaterialsController(count: number, layoutMode: LayoutMode) {
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const suppressIndexRef = useRef<number | null>(null);
  const suppressTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (layoutMode !== "pinned") return;

    const clearSuppression = () => {
      suppressIndexRef.current = null;
      if (suppressTimeoutRef.current !== null) {
        window.clearTimeout(suppressTimeoutRef.current);
        suppressTimeoutRef.current = null;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = chapterRefs.current.indexOf(entry.target as HTMLDivElement);
          if (idx === -1) continue;
          const suppressed = suppressIndexRef.current;
          if (suppressed !== null && idx !== suppressed) continue;
          if (suppressed !== null && idx === suppressed) clearSuppression();
          setActive(idx);
        }
      },
      { threshold: 0, rootMargin: "-50% 0px -50% 0px" },
    );
    chapterRefs.current.forEach((el) => el && io.observe(el));

    window.addEventListener("wheel", clearSuppression, { passive: true });
    window.addEventListener("touchstart", clearSuppression, { passive: true });
    window.addEventListener("keydown", clearSuppression);

    return () => {
      io.disconnect();
      window.removeEventListener("wheel", clearSuppression);
      window.removeEventListener("touchstart", clearSuppression);
      window.removeEventListener("keydown", clearSuppression);
      clearSuppression();
    };
  }, [count, layoutMode]);

  const selectMaterial = (i: number) => {
    setActive(i);
    if (layoutMode !== "pinned") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    suppressIndexRef.current = i;
    if (suppressTimeoutRef.current !== null) window.clearTimeout(suppressTimeoutRef.current);

    // Cleared by the real `scrollend` event (fires exactly when the
    // triggered scroll settles, regardless of distance/duration) rather than
    // a guessed fixed delay — a fixed delay can expire mid-flight on a long
    // jump (e.g. Lead back to Copper), letting the observer reassert an
    // intermediate chapter before the scroll actually arrives. The timeout
    // is only a safety net for browsers without `scrollend` or an
    // interrupted scroll that never fires it.
    const clear = () => {
      suppressIndexRef.current = null;
      if (suppressTimeoutRef.current !== null) {
        window.clearTimeout(suppressTimeoutRef.current);
        suppressTimeoutRef.current = null;
      }
      window.removeEventListener("scrollend", clear);
    };
    window.addEventListener("scrollend", clear, { once: true });
    suppressTimeoutRef.current = window.setTimeout(clear, 2000);

    chapterRefs.current[i]?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
  };

  return { chapterRefs, active, selectMaterial };
}

export function Materials() {
  const layoutMode = useMaterialsLayoutMode();
  const { chapterRefs, active, selectMaterial } = useMaterialsController(
    MATERIALS.length,
    layoutMode,
  );
  const material = MATERIALS[active]!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mobileTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const reducedMotion = useReducedMotion();
  const shortViewport = useShortViewport();
  const { narrativeRef, stickyRef, progress, scrollToAnchor } = useMobileMaterialProgress();
  useLiveStageHeight(stickyRef);
  // Short viewports skip the scroll-pinned stage entirely (see
  // `useShortViewport`) and fall back to plain click state instead of a
  // scroll-derived value, since there's no sticky/narrative wrapper mounted
  // to derive `progress` from in that branch.
  const [shortClickActive, setShortClickActive] = useState(0);
  const mobileActive = shortViewport ? shortClickActive : Math.round(progress * 3);
  // "TRADE" in the mobile heading: white until this same `progress` value
  // (the section's existing pin/scroll-progress trigger — see
  // `useMobileMaterialProgress`) first goes past 0, which is exactly the
  // instant the narrative wrapper reaches its sticky offset and the pinned
  // Copper -> Lead sequence begins; copper for the rest of that pinned
  // dwell, and back to white the moment progress returns to 0 on an upward
  // scroll. No second observer — short viewports have no pin at all, so
  // "TRADE" just stays copper there, matching its previous always-on state.
  const tradeCopperActive = shortViewport ? true : progress > 0;

  // Single entry animation for whichever material panel just became
  // active; no continuous scroll-tied blending anywhere. `entranceTweenRef`
  // is the animation token: killed before every new tween so rapid
  // forward/reverse scrolling or clicking can never leave two panels
  // mid-animation (and thus visible) at once. `useLayoutEffect` so the
  // tween's own "from" state paints first — no one-frame flash of the
  // instant, un-animated state `mobileActive`'s own render would otherwise
  // produce.
  const mobilePanelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const mobileEntranceRef = useRef<gsap.core.Tween | null>(null);
  const mobileMountedRef = useRef(false);
  useLayoutEffect(() => {
    const panel = mobilePanelRefs.current[mobileActive];
    if (!panel) return;
    mobileEntranceRef.current?.kill();
    if (!mobileMountedRef.current || reducedMotion) {
      mobileMountedRef.current = true;
      gsap.set(panel, { opacity: 1, y: 0 });
      return;
    }
    mobileEntranceRef.current = gsap.fromTo(
      panel,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" },
    );
  }, [mobileActive, reducedMotion]);

  // Tapping a pill scrolls to that stage's anchor (keeping scroll position
  // and displayed material in sync) when the scroll stage is mounted; on
  // short viewports (no scroll linkage at all) it just sets state directly.
  const selectMobileMaterial = (i: number) => {
    if (shortViewport) {
      setShortClickActive(i);
      return;
    }
    scrollToAnchor(i, reducedMotion);
  };

  const handleMobileTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(i + 1, MATERIALS.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MATERIALS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectMobileMaterial(next);
    mobileTabRefs.current[next]?.focus();
  };

  // Load every desktop scene and mobile background photo up front
  // (fire-and-forget, never blocks the initial Copper render, and only
  // ever runs once — no per-update recreation) so a fast click can't
  // outrun a still-lazy-loading image. These are large photographs, so
  // each is explicitly decoded off the main thread once fetched.
  useEffect(() => {
    MATERIALS.forEach((m) => {
      const scene = new Image();
      scene.src = m.scene;
      void scene.decode?.().catch(() => {});
      const warehouse = new Image();
      warehouse.src = MOBILE_WAREHOUSE[m.key];
      void warehouse.decode?.().catch(() => {});
      const cutout = new Image();
      cutout.src = MOBILE_CUTOUT[m.key];
      void cutout.decode?.().catch(() => {});
    });
  }, []);

  const handleTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    i: number,
    refs: React.RefObject<(HTMLButtonElement | null)[]>,
  ) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % MATERIALS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + MATERIALS.length) % MATERIALS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MATERIALS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectMaterial(next);
    refs.current[next]?.focus();
  };

  return (
    <section
      id="materials"
      className={`relative ${layoutMode === "pinned" ? "lg:h-[400vh]" : ""}`}
      style={{
        // BATCH MATERIALS-M1-R1 — the shared `--background` token resolves
        // lighter than the deep ink navy every locked section (Hero/Trust/
        // Services) actually uses, which is what read as a disconnected
        // "light-blue slab" on mobile (desktop's own full-bleed photo
        // layers already hid this, so it's safe to fix here at the section
        // level without any visible desktop change). One static, restrained
        // copper atmosphere on top — never colour-shifted per material.
        backgroundImage:
          "radial-gradient(85% 42% at 50% 35%, rgba(190, 92, 45, 0.055) 0%, rgba(8, 10, 29, 0) 72%)",
        backgroundColor: "#080A1D",
      }}
    >
      {/* BATCH 7M-DESKTOP-SCENE — full-bleed photographic scene redesign,
          `lg` and up only. Both "pinned" and "stacked" layoutMode variants
          (an input-capability axis, unrelated to this viewport-width axis)
          keep using the same `active`/`selectMaterial`/`chapterRefs` state
          from `useMaterialsController` — no second scroll or active-material
          system. A dedicated `lg:hidden` mobile composition (the "Material
          Vault") is untouched below `lg`. */}
      <div
        className={
          (layoutMode === "pinned"
            ? "sticky top-0 h-screen overflow-hidden"
            : "relative min-h-screen overflow-hidden") + " hidden lg:block"
        }
      >
        {/* Full-bleed crossfading material scenes — opacity only, no zoom/
            pan/parallax. Previous scene stays visible (opacity-0, still
            mounted) until the next one has finished its own fade in. */}
        <div className="absolute inset-0">
          {MATERIALS.map((m, i) => (
            <img
              key={m.key}
              src={m.scene}
              alt=""
              aria-hidden="true"
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-center"
              style={{
                opacity: i === active ? 1 : 0,
                transition: reducedMotion ? "none" : "opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          ))}
        </div>

        {/* Restrained readability overlay: soft top/bottom navy gradient so
            the eyebrow/heading and card edges never sit on raw photo, plus a
            slightly darker right side behind the info card. No blur, no
            opaque wash, no colour glow, no vignette. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(8, 10, 29, 0.5) 0%, rgba(8, 10, 29, 0) 24%, rgba(8, 10, 29, 0) 58%, rgba(8, 10, 29, 0.6) 100%), linear-gradient(to right, rgba(8, 10, 29, 0) 38%, rgba(8, 10, 29, 0.4) 70%, rgba(8, 10, 29, 0.58) 100%)",
          }}
        />

        <div className="relative z-10 mx-auto h-full max-w-7xl px-6">
          {/* Heading + tabs — upper-left, below the fixed navbar, leaving the
              rest of the scene's left/centre pile visible. Corrected vertical
              rhythm (BATCH 7M-POLISH): the eyebrow is now a plain section
              label (no capsule), so the block's own height dropped and the
              generous top padding shrank to match — that is what actually
              lifts the tab row, not a transform offset. */}
          <div className="pt-[clamp(72px,11vh,104px)]">
            <p className="label-eyebrow text-[oklch(0.62_0.13_50)]">Materials</p>
            <h2 className="font-display mt-6 text-3xl font-bold tracking-[0.02em] text-foreground uppercase sm:text-4xl">
              What we <span className="text-[oklch(0.62_0.13_50)]">trade</span>
            </h2>
            <p className="font-display mt-4 max-w-[clamp(30rem,44vw,52rem)] text-sm font-medium text-foreground/83 sm:text-base">
              Choose a material to view common forms and request a quote.
            </p>

            {/* Full tablist: roving tabindex + Left/Right/Home/End, each tab
                wired to its own tabpanel via aria-controls/aria-labelledby.
                Active state reuses the section's one restrained copper/
                orange treatment for every material — no per-material
                silver/grey texture fills. Inactive tabs use a flat dark
                translucent fill (not the lighter glass gradient) so they
                stay readable over bright scene areas. */}
            <div
              className="relative z-20 mt-[26px] flex flex-wrap gap-3"
              role="tablist"
              aria-label="Material shown, synced to scroll position"
            >
              {MATERIALS.map((m, i) => (
                <button
                  key={m.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`material-tab-${m.key}`}
                  aria-selected={active === i}
                  aria-controls={`material-panel-${m.key}`}
                  tabIndex={active === i ? 0 : -1}
                  onClick={() => selectMaterial(i)}
                  onKeyDown={(e) => handleTabKeyDown(e, i, tabRefs)}
                  className={`font-display relative flex h-[var(--materials-pill-h)] items-center overflow-hidden rounded-full border px-6 py-2.5 text-sm font-semibold whitespace-nowrap uppercase outline-none transition-colors duration-500 focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.13_60)] ${
                    i === active
                      ? "border-transparent bg-[image:var(--gradient-copper-cta)] text-[#080A1D] shadow-[0_12px_34px_-14px_rgb(107_52_30/0.85)]"
                      : "border-white/14 bg-[rgba(5,8,26,0.58)] text-white/80"
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Info card — right side, vertically centred independently of the
            heading, positioned relative to the full-bleed scene (not the
            max-w-7xl content column) so its distance from the viewport edge
            stays constant and generous at every desktop width — this is
            also what keeps a consistent gap from the material pile in every
            state, Aluminium included, without a per-material position.
            BATCH MATERIALS-CARD-NORMALIZE — one shared CSS grid (7 rows,
            fixed padding, fixed row-gap) drives every material state, so
            the outer panel's width/height and every internal anchor
            (header, both dividers, CTA) are identical regardless of which
            material is active. Only two rows are `auto`-sized, and both are
            still deterministic per-viewport (never per-material): the
            description row is `auto` only because a fixed 54px track
            already reserves its 2-line height via `grid-template-rows`
            below — the `auto` here is just "respect that track," not
            "size to content" — and the footer row is `auto` because its
            two lines of copy are byte-identical across all four materials,
            so its height can never differ between them. Matte near-opaque
            navy (not glass), a restrained 24px radius, a neutral blue-grey
            border (no copper perimeter), and a short copper accent rail
            (`.materials-card-rail::before` in styles.css) instead of an
            outline. */}
        <div className="absolute inset-y-0 right-[clamp(48px,6vw,96px)] z-10 flex items-center py-10">
          <div
            key={material.key}
            role="tabpanel"
            id={`material-panel-${material.key}`}
            aria-labelledby={`material-tab-${material.key}`}
            tabIndex={0}
            className="materials-card-rail animate-material-card-fade relative grid w-[clamp(480px,39vw,640px)] max-w-[calc(100vw-3rem)] grid-rows-[56px_1px_54px_auto_44px_1px_auto] gap-y-5 rounded-[24px] border p-10"
            style={{
              backgroundColor: "rgba(5, 8, 26, 0.95)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderColor: "rgba(145, 160, 190, 0.16)",
              boxShadow: "0 28px 70px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
            }}
          >
            {/* Row 1 — header: material name left, periodic-table badge
                right, both vertically centred in a fixed 56px row (set by
                the badge, the taller of the two) so title length never
                moves the badge and the row's own height never varies. */}
            <div className="flex items-center justify-between">
              <h3 className="font-display text-3xl font-bold whitespace-nowrap text-foreground">
                {material.name}
              </h3>
              <div
                aria-hidden="true"
                className="flex h-[56px] w-[56px] shrink-0 flex-col items-center justify-center gap-1 rounded-[11px] border"
                style={{
                  backgroundColor: "rgba(8, 10, 26, 0.9)",
                  borderColor: "rgba(145, 160, 190, 0.16)",
                }}
              >
                <span
                  className="font-display text-[9px] leading-none font-semibold tabular-nums"
                  style={{ color: "var(--copper)" }}
                >
                  {MATERIAL_META[material.key].atomicNumber}
                </span>
                <span className="font-display text-[19px] leading-none font-bold text-foreground/92">
                  {MATERIAL_META[material.key].symbol}
                </span>
              </div>
            </div>

            {/* Row 2 — top divider, locked to a 1px track. */}
            <div aria-hidden="true" className="h-px w-full self-center bg-white/10" />

            {/* Row 3 — description: a fixed 54px track (18px/1.5 line-height
                × 2 lines) reserved for every material regardless of actual
                sentence length. Grid's default stretch makes this <p> fill
                the full 54px track; a one-line sentence just leaves blank
                space below it (no vertical centering, no truncation) — all
                four current sentences fit within two lines at this card's
                width range. */}
            <p className="font-display text-lg leading-[1.5] font-medium text-foreground">
              {material.description}
            </p>

            {/* Row 4 — specification tags: always exactly three equal-width
                columns / one row (`grid-template-columns: repeat(3,
                minmax(0, 1fr))` via Tailwind's grid-cols-3), for every
                material at every desktop width — no breakpoint fallback,
                so a 2+1 wrap is structurally impossible. Each tag's own
                height is `h-[var(--materials-pill-h)]` — the exact same
                shared CSS variable the selector tabs above now use (see
                :root in styles.css), not an independently-guessed number,
                so the two can't drift apart. The grid container has no
                `auto-rows` override: with every tag explicitly 42px tall,
                the row auto-sizes to match on its own. Marker + label are
                centred as one group (`justify-center`, plus `items-center`
                and a shared `gap-1.5`) inside each equal-width column, not
                left-aligned. Font matches the tabs exactly (`text-sm
                font-semibold`, no tracking override); only horizontal
                padding stays independently tight (px-2) since it's outside
                the "must match" list and is what lets the longest labels
                (Profiles & Frames, Machinery Scrap) sit on one `nowrap`
                line inside a fixed-width column. Passive information, not
                buttons: flat translucent navy fill, neutral border, no
                hover/glow/cursor. */}
            <div role="list" className="grid grid-cols-3 gap-2">
              {material.pills.map((pill) => (
                <span
                  key={pill}
                  role="listitem"
                  className="font-display flex h-[var(--materials-pill-h)] w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2 py-2.5 text-sm font-semibold whitespace-nowrap text-foreground"
                  style={{
                    backgroundColor: "rgba(8, 10, 26, 0.55)",
                    borderColor: "rgba(145, 160, 190, 0.16)",
                    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="h-[12px] w-[2px] shrink-0"
                    style={{ backgroundColor: "var(--copper)" }}
                  />
                  {pill}
                </span>
              ))}
            </div>

            {/* Row 5 — CTA: fixed 44px track/height (h-11) instead of
                padding-driven auto height, so it never shifts with type
                rendering. Shadow restrained from the previous pass (lower
                alpha, tighter spread) so it reads solid, not a heavy glow. */}
            <Link
              to="/"
              search={{ quote: true, source: "materials", material: material.quoteMaterialKey }}
              mask={{
                to: "/quote",
                search: { source: "materials", material: material.quoteMaterialKey },
              }}
              className="group/cta font-display flex h-11 w-full max-w-full items-center justify-center rounded-full bg-[image:var(--gradient-copper-cta)] px-6 shadow-[0_8px_20px_-10px_oklch(0.46_0.11_42/0.4)] transition-transform motion-safe:hover:scale-[1.03] motion-safe:focus-visible:scale-[1.03]"
            >
              <span className="text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase transition-colors group-hover/cta:text-[#EDE8D0] group-hover/cta:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]">
                {material.quoteLabel}
              </span>
            </Link>

            {/* Row 6 — bottom divider, same fixed 1px track as row 2. */}
            <div aria-hidden="true" className="h-px w-full self-center bg-white/10" />

            {/* Row 7 — footer: both lines are identical copy for every
                material, so this row's height can never differ between
                states even though it's `auto`. */}
            <div className="flex flex-col gap-2">
              <p className="font-display text-[14px] leading-[1.4] font-medium tracking-[0.02em] text-white/79">
                Value depends on verified grade, condition, quantity and location.
              </p>
              <Link
                to="/"
                search={{ quote: true, source: "materials", material: material.quoteMaterialKey }}
                mask={{
                  to: "/quote",
                  search: { source: "materials", material: material.quoteMaterialKey },
                }}
                className="font-display inline-block w-fit text-[14px] font-medium tracking-[0.02em] text-white/79 underline decoration-white/30 underline-offset-2 transition-colors hover:text-white"
              >
                Not sure of the grade? Upload photos
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile "What We Trade", below lg only. Four-stage scroll-pinned
          stage, matching the mobile "Our Services" flow diagram's own
          pattern: a mobile-only tall wrapper (`narrativeRef`) provides the
          scroll runway, a sticky inner stage (`stickyRef`) pins one full
          screen beneath the fixed header for its duration, and
          `useMobileMaterialProgress`'s passive scroll listener (never a
          wheel/touch interceptor, never a body scroll lock) drives which
          material is active as the page scrolls normally through that
          runway. Short viewports skip the pin entirely (see
          `useShortViewport`) and render the exact same content in normal
          flow instead, so a screen too short to fit "heading through
          upload link" in one view never gets clipped or trapped. */}
      {shortViewport ? (
        <div className="relative px-6 pt-4 pb-10 text-left lg:hidden">
          <MobileMaterialsBoard
            mobileActive={mobileActive}
            reducedMotion={reducedMotion}
            tradeCopperActive={tradeCopperActive}
            mobileTabRefs={mobileTabRefs}
            mobilePanelRefs={mobilePanelRefs}
            onSelect={selectMobileMaterial}
            onKeyDown={handleMobileTabKeyDown}
          />
        </div>
      ) : (
        <div
          ref={narrativeRef}
          id="materials-mobile-narrative"
          className="relative lg:hidden"
          // `--app-vh` (see __root.tsx) replaces raw `svh` — a physical-
          // device trace proved `svh` tracks the live, toolbar-sensitive
          // viewport on this browser, which let a toolbar-only scroll-chrome
          // change alone shrink this wrapper and shift everything below it.
          // `--app-vh` is captured once at initial load and only updates on
          // a genuine width/orientation change, so this height stays fixed
          // across toolbar toggles at a constant width.
          //
          // 190 (not the previous 285): with the sticky stage at 100vh, a
          // scrollRange of 285-100=185vh is the distance the user must
          // scroll through this pin before it releases into the owner
          // section, regardless of how many of the four materials actually
          // change on screen along the way. `Math.round(progress*3)`
          // (mobileActive, above) is the exact same quantization WhatWeDo's
          // own mobile flow diagram uses for its own four stages — proven
          // and correct — but that flow uses a 190vh narrative for the same
          // four-stage count, i.e. a 90vh scrollRange, not 185vh. 285 here
          // was sized for the old per-material full-scene photo backgrounds
          // (a full photo swap read as "finished" more slowly); now that
          // each material only crossfades a small pile cutout over one
          // shared static warehouse photo — a much lighter visual change —
          // the same 185vh range meant the last ~1/6 of it (Lead's own
          // settled window, worth ~31vh at a typical 778px viewport) was
          // spent fully pinned on an unchanging screen right before release,
          // which is what read on-device as "a large empty dark region"
          // scrolling by before the owner section appeared. Matching
          // WhatWeDo's own proven 190vh for the identical four-stage
          // structure removes that excess without touching the (shared,
          // approved) quantization itself — Lead's settled window shrinks
          // proportionally to ~15vh, and every material still gets the same
          // relative share of the runway it always has.
          style={{ height: "calc(var(--app-vh, 7.6px) * 190)" }}
        >
          <div
            ref={stickyRef}
            id="materials-mobile-sticky"
            // Mobile header (Header.tsx) is a `position: fixed` overlay that
            // hides/reveals independently of this stage — it never occupies
            // document flow space, so this stage must not reserve space for
            // it either (a `top`/`height` offset here would leave a blank
            // band the instant the header slides away). The stage itself
            // pins flush to the true viewport top so the background photo
            // always reaches it; header clearance instead lives on this
            // flex column's own `pt-[72px]` (56px header height + the
            // original 16px breathing room), which only pushes the
            // in-flow heading/tabs/card down — the absolutely positioned
            // background layer below ignores padding, so it's unaffected
            // and still spans the full stage. The header (z-40) then simply
            // overlays that same photo on top when shown, never shifting
            // this section or covering the heading.
            className="sticky flex flex-col px-6 pt-[72px] pb-5 text-left"
            style={{
              top: "env(safe-area-inset-top)",
              // `--materials-live-vh` (see `useLiveStageHeight`, set on this
              // exact element), not `--app-vh` — this is the one place the
              // stage's height is allowed to track the CURRENT visible
              // viewport live, so it (and the warehouse background filling
              // it) visually grows to fill the screen when the browser's
              // address bar hides, instead of staying pinned at the
              // smaller, frozen `--app-vh` size and leaving a blank navy
              // strip below the card. Falls back to `--app-vh` (then the
              // static px value) for the brief pre-effect window before
              // the live value is first set. Narrative's own height above
              // is untouched — still `--app-vh`, still frozen, so the
              // scroll-distance math this stage's own progress is derived
              // from (`useMobileMaterialProgress`) stays exactly as stable
              // as before.
              height: "calc(var(--materials-live-vh, var(--app-vh, 7.6px)) * 100 - env(safe-area-inset-top))",
            }}
          >
            <MobileMaterialsBoard
              mobileActive={mobileActive}
              reducedMotion={reducedMotion}
              tradeCopperActive={tradeCopperActive}
              mobileTabRefs={mobileTabRefs}
              mobilePanelRefs={mobilePanelRefs}
              onSelect={selectMobileMaterial}
              onKeyDown={handleMobileTabKeyDown}
            />
          </div>
        </div>
      )}

      {layoutMode === "pinned" && (
        <>
          {/* Invisible scroll chapters: one full viewport-tall segment per
              material, all equal, so each gets the same dwell and centred
              scroll target — Lead included. Uneven segments previously let
              Lead activate right at the section's edge and release into
              About with almost no dwell. */}
          {MATERIALS.map((m, i) => (
            <div
              key={m.key}
              ref={(el) => {
                chapterRefs.current[i] = el;
              }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 hidden h-screen lg:block"
              style={{ top: `${i * 100}vh`, height: "100vh" }}
            />
          ))}
        </>
      )}
    </section>
  );
}

/** Shared content for both the scroll-pinned and short-viewport mobile
    layouts (see the two branches in `Materials()`) — identical markup
    either way, just wrapped differently by the caller, so there is exactly
    one place that can drift from the approved composition.

    Layering (back to front): (1) one warehouse/floor photo per material
    (`MOBILE_WAREHOUSE`), absolutely positioned, plain `object-fit: cover`,
    crossfaded on an active-material change via the same opacity transition
    as the pile cutout below — it never jumps/hard-cuts and is never
    repositioned, only its opacity animates, same as the cutout; (2)
    normal-flow foreground content: a
    small fixed top nudge, the heading/description/tabs, then a pile slot,
    then the card. The pile slot (`flex-1`, floored by
    `PILE_SLOT_MIN_HEIGHT_PX`) is where each material's transparent cutout
    (`MOBILE_CUTOUT`) renders — cropped (not merely "contained") to its own
    measured, meaningful-alpha (>32, not >0) bounding box
    (`MOBILE_CUTOUT_CROP`), then rendered at one shared width (`PILE_WIDTH`,
    same for all four) so every pile gets the same floor footprint, with
    height following each material's own true content aspect ratio (so a
    naturally low/wide pile and a naturally tall/narrow one still look
    different, just not wildly mismatched in scale) and its bottom edge
    pinned to one shared floor offset (`PILE_FLOOR_GAP_PX`) above the card.
    A single static contact-shadow ellipse (not per-material, not
    crossfaded — the shared width/floor line make one shadow correct for
    all four) sits just beneath them. This replaces three earlier,
    disproven approaches, confirmed wrong by physical-device screenshots at
    each step, not by typecheck or computed CSS values alone: (a)
    positioning each cutout at a fixed coordinate in the same full-frame
    canvas as the warehouse, which tied pile position to the warehouse's
    own coordinate space and left bare floor for short cutouts; (b)
    "containing" each raw, uncropped canvas at its own native aspect ratio
    — Copper's raw canvas (941x1672) is tall, Lead's (1672x941) is wide, so
    "contain" alone rendered Copper tiny and Lead oversized; (c) cropping to
    an alpha>0 bounding box, which still included faint noise across
    nearly the whole canvas and so barely shrank from (b) — tall/narrow
    enough, at the width used then, to overlap the tabs above. `position:
    relative` on
    the foreground wrapper (not a z-index number) is what keeps it
    painting above the absolute background: two `position`ed siblings with
    the same (auto) z-index stack in DOM order, and the foreground wrapper
    comes second. */
function MobileMaterialsBoard({
  mobileActive,
  reducedMotion,
  tradeCopperActive,
  mobileTabRefs,
  mobilePanelRefs,
  onSelect,
  onKeyDown,
}: {
  mobileActive: number;
  reducedMotion: boolean;
  tradeCopperActive: boolean;
  mobileTabRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  mobilePanelRefs: React.RefObject<(HTMLDivElement | null)[]>;
  onSelect: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => void;
}) {
  return (
    <>
      {/* Full-section background — one warehouse photo per material, plain
          `object-fit: cover`, crossfaded on an active-material change using
          the same opacity transition as the pile cutout below (not a
          separate timing). `inset-x-0` (not a negative `-inset-x-6`) is
          deliberate: the sticky/short wrapper's own `px-6` is padding, not
          a width reduction, so its box already spans the true viewport
          width and `inset-x-0` already reaches both edges exactly — a
          negative inset here previously pushed this layer 24px past the
          viewport on both sides, which is what forced the page's own
          (lighter) `--background` to show through as a vertical strip at
          the right edge on mobile browsers that expand the layout viewport
          to fit horizontally-overflowing content. */}
      <div className="absolute inset-x-0 top-0 bottom-0 overflow-hidden" aria-hidden="true">
        {MATERIALS.map((m, i) => (
          <img
            key={m.key}
            src={MOBILE_WAREHOUSE[m.key]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: i === mobileActive ? 1 : 0,
              transition: reducedMotion ? "none" : "opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        ))}
        {/* Light readability insurance only — the photo's own dark top
            headroom and floor already do most of the work; this is a much
            gentler wash than the previous heavily-darkened background. */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, rgba(8, 10, 29, 0.22) 0%, rgba(8, 10, 29, 0) 18%, rgba(8, 10, 29, 0) 62%, rgba(8, 10, 29, 0.3) 100%)",
          }}
        />
      </div>

      <div className="relative flex flex-1 flex-col">
        {/* Small, fixed (not proportional) downward nudge for the whole
            foreground group below — heading through card. Fixed rather
            than viewport-scaled so it can never grow large enough on a
            short viewport to threaten the card's own space; the pile slot
            right below (flex-1) is what actually absorbs any leftover
            height difference between viewports, never this. */}
        <div aria-hidden="true" className="h-3 shrink-0" />
        <div className="shrink-0">
          {/* MOBILE_ORANGE matches WhatWeDo.tsx's `ROUTE_ACTIVE` — the same
              literal colour the approved mobile "Our Services" eyebrow
              uses. `--copper-bright` (a different, more yellow/golden
              token) was used here previously; this section never shared a
              token with it, so the fix is a literal colour match, not a
              token swap. */}
          <p className="label-eyebrow" style={{ color: MOBILE_ORANGE }}>
            Materials
          </p>
          <h2 className="font-display mt-1 text-[clamp(1.85rem,8.6vw,2.25rem)] leading-[1.0] font-bold whitespace-nowrap text-foreground">
            WHAT WE{" "}
            <span
              style={{
                color: tradeCopperActive ? MOBILE_ORANGE : "inherit",
                transition: reducedMotion ? "none" : "color 250ms ease",
              }}
            >
              TRADE
            </span>
          </h2>
          <p className="font-display mt-1.5 text-[13.5px] leading-snug font-medium text-foreground/85">
            Choose a material to view common forms and request a quote.
          </p>

          {/* Pill selector — a flex row (not a forced 4-equal-column grid)
              so each label gets only the width its own text needs; "Steel &
              Iron" no longer has to shrink to fit the same column as
              "Lead". `justify-between` spreads any leftover width as extra
              gap beyond the explicit `gap-1` floor, so the row still reads
              as one balanced line at 390px with no horizontal scrolling. */}
          <div role="tablist" aria-label="Material shown" className="mt-3 flex items-center justify-between gap-1">
            {MATERIALS.map((m, i) => {
              const isActive = i === mobileActive;
              return (
                <button
                  key={m.key}
                  ref={(el) => {
                    mobileTabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`material-tab-mobile-${m.key}`}
                  aria-selected={isActive}
                  aria-controls={`material-panel-mobile-${m.key}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onSelect(i)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                  className={`font-display flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2 text-center text-[12.5px] leading-none font-bold tracking-[0.01em] uppercase outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-copper-bright ${
                    isActive ? "border-transparent text-[#080A1D]" : "border-white/14 text-white/80"
                  }`}
                  style={
                    isActive
                      ? { backgroundImage: "var(--gradient-copper-cta)" }
                      : { backgroundColor: "rgba(5, 8, 26, 0.58)" }
                  }
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Pile slot — takes whatever space is actually left between the
            tabs and the card (`flex-1`) when its flex ancestor has a real
            height to distribute (the scroll-pinned sticky stage), but
            never less than `PILE_SLOT_MIN_HEIGHT_PX` — see that constant's
            comment for why a `position: absolute`-only slot needs an
            explicit floor on the short-viewport fallback, where there's no
            fixed height to stretch into. `-mx-6` cancels this column's own
            `px-6` (set on `stickyRef`, see below) for this one child only,
            so the pile can render edge-to-edge like the warehouse
            background instead of being squeezed into the narrower text
            column — the heading/tabs/card above and below are unaffected,
            they keep their own padding. `PILE_FLOOR_GAP_PX` is the one
            shared floor offset (and the contact shadow's own position)
            every material's pile bottom aligns to, so all four share one
            visual floor line regardless of their own height. */}
        <div
          className="relative flex-1 -mx-6"
          style={{ minHeight: PILE_SLOT_MIN_HEIGHT_PX }}
          aria-hidden="true"
        >
          {/* Shared static contact shadow — one element, not per-material
              and not crossfaded: since every pile now renders at the same
              width and the same floor offset, one shadow is correct for
              all four, which is also what keeps the floor from visibly
              changing during the crossfade. Soft, neutral, low-alpha —
              deliberately not a strong glow/reflection and not detached
              from the pile's own base. */}
          <div
            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: `${PILE_FLOOR_GAP_PX - 10}px`,
              width: PILE_WIDTH,
              height: 20,
              background: "radial-gradient(ellipse 50% 100% at 50% 50%, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 72%)",
            }}
          />
          {MATERIALS.map((m, i) => {
            const crop = MOBILE_CUTOUT_CROP[m.key];
            return (
              <svg
                key={m.key}
                viewBox={`0 0 ${crop.contentWidth} ${crop.contentHeight}`}
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  bottom: PILE_FLOOR_GAP_PX,
                  width: PILE_WIDTH,
                  aspectRatio: `${crop.contentWidth} / ${crop.contentHeight}`,
                  opacity: i === mobileActive ? 1 : 0,
                  transition: reducedMotion ? "none" : "opacity 420ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <image
                  href={MOBILE_CUTOUT[m.key]}
                  x={-crop.contentLeft}
                  y={-crop.contentTop}
                  width={crop.canvasWidth}
                  height={crop.canvasHeight}
                />
              </svg>
            );
          })}
        </div>

        {/* Card — opaque deep-navy (alpha 1, not translucent), landing
            naturally on the background photo's own floor region (the
            spacer above pushes it there) rather than overlapping a
            separate pile layer. All four panels share the same grid cell
            (sized to the tallest) so the card's width/height never move
            between materials. */}
        <div
          className="relative shrink-0 -mx-2 overflow-hidden rounded-[20px] border"
          style={{
            backgroundColor: "rgba(5, 8, 26, 1)",
            borderColor: "rgba(145, 160, 190, 0.16)",
            boxShadow: "0 20px 44px rgba(0, 0, 0, 0.4)",
          }}
        >
          <div className="relative grid">
            {MATERIALS.map((m, i) => {
              const meta = MATERIAL_META[m.key];
              return (
                <div
                  key={m.key}
                  id={`material-panel-mobile-${m.key}`}
                  role="tabpanel"
                  aria-labelledby={`material-tab-mobile-${m.key}`}
                  ref={(el) => {
                    mobilePanelRefs.current[i] = el;
                  }}
                  aria-hidden={i === mobileActive ? undefined : true}
                  className="relative flex flex-col px-5 py-4"
                  style={{
                    gridArea: "1 / 1",
                    visibility: i === mobileActive ? "visible" : "hidden",
                    ...(i === mobileActive ? null : { opacity: 0 }),
                  }}
                >
                  {/* Copper accent — a short mark beside the heading, not a
                      rail running the card's full height. */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-6 w-[3px] shrink-0 rounded-full"
                        style={{ backgroundColor: "var(--copper)" }}
                      />
                      <h3 className="font-display text-[24px] leading-none font-bold text-foreground">{m.name}</h3>
                    </div>
                    <div
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[10px] border"
                      style={{ backgroundColor: "rgba(8, 10, 26, 0.9)", borderColor: "rgba(145, 160, 190, 0.16)" }}
                    >
                      <span
                        className="font-display text-[8px] leading-none font-semibold tabular-nums"
                        style={{ color: "var(--copper)" }}
                      >
                        {meta.atomicNumber}
                      </span>
                      <span className="font-display text-[14px] leading-none font-bold text-foreground/92">
                        {meta.symbol}
                      </span>
                    </div>
                  </div>
                  <div aria-hidden="true" className="mt-2.5 h-px w-full bg-white/10" />
                  <p className="font-display mt-2.5 text-[12.5px] leading-snug text-foreground/85">{m.description}</p>
                  {/* Three category chips, one fixed row (never wraps to a
                      second row) — compact type/padding is what keeps
                      every existing label on a single line at this width
                      without changing the wording. */}
                  <div role="list" className="mt-2.5 grid grid-cols-3 gap-1.5">
                    {m.pills.map((pill) => (
                      <span
                        key={pill}
                        role="listitem"
                        className="font-display flex h-8 min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-1.5 text-center text-[9.5px] leading-none font-semibold whitespace-nowrap text-foreground"
                        style={{ backgroundColor: "rgba(8, 10, 26, 0.55)", borderColor: "rgba(145, 160, 190, 0.16)" }}
                      >
                        <span
                          aria-hidden="true"
                          className="h-[9px] w-[2px] shrink-0"
                          style={{ backgroundColor: "var(--copper)" }}
                        />
                        {pill}
                      </span>
                    ))}
                  </div>
                  <Link
                    to="/"
                    search={{ quote: true, source: "materials", material: m.quoteMaterialKey }}
                    mask={{ to: "/quote", search: { source: "materials", material: m.quoteMaterialKey } }}
                    className="font-display mt-2.5 flex h-10 w-full items-center justify-center rounded-full bg-[image:var(--gradient-copper-cta)] px-4 shadow-[0_8px_20px_-10px_oklch(0.46_0.11_42/0.4)] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-copper-bright motion-safe:active:scale-[0.98]"
                  >
                    <span className="text-[13px] font-bold tracking-[0.06em] text-[#080A1D] uppercase">
                      {m.quoteLabel}
                    </span>
                  </Link>
                  <div aria-hidden="true" className="mt-2.5 h-px w-full bg-white/10" />
                  <p className="font-display mt-2 text-[10.5px] leading-snug text-white/70">
                    Value depends on verified grade, condition, quantity and location.
                  </p>
                  <Link
                    to="/"
                    search={{ quote: true, source: "materials", material: m.quoteMaterialKey }}
                    mask={{ to: "/quote", search: { source: "materials", material: m.quoteMaterialKey } }}
                    className="font-display mt-0.5 inline-block w-fit text-[10.5px] text-white/70 underline decoration-white/30 underline-offset-2"
                  >
                    Not sure of the grade? Upload photos
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
