import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import copperBg from "@/assets/copper-bg.png";
import aluminiumBg from "@/assets/aluminium-bg.png";
import steelBg from "@/assets/steel-bg.png";
import leadBg from "@/assets/lead-bg.png";
import copperCard from "@/assets/copper-card.png";
import aluminiumCard from "@/assets/aluminium-card.png";
import steelCard from "@/assets/steel-card.png";
import leadCard from "@/assets/lead-card.png";
import copperScrap from "@/assets/copper-scrap-cutout.webp";
import aluminiumScrap from "@/assets/aluminium-scrap-cutout.webp";
import steelScrap from "@/assets/steel-iron-scrap-cutout.webp";
import leadScrap from "@/assets/lead-scrap-cutout.webp";

const MATERIALS = [
  {
    key: "copper",
    name: "Copper",
    bg: copperBg,
    card: copperCard,
    scrap: copperScrap,
    shape: "circle",
    description: "Copper wire and cable, pipes, coils, sheets and radiator scrap.",
    pills: ["Wire & Cable", "Pipes & Coils", "Radiators"],
    quoteMaterialKey: "copper",
    quoteLabel: "Get a Copper Quote",
  },
  {
    key: "aluminium",
    name: "Aluminium",
    bg: aluminiumBg,
    card: aluminiumCard,
    scrap: aluminiumScrap,
    shape: "square",
    description: "Aluminium profiles and frames, sheets, panels, cable and cast aluminium scrap.",
    pills: ["Profiles & Frames", "Sheets & Panels", "Cast Aluminium"],
    quoteMaterialKey: "aluminium",
    quoteLabel: "Get an Aluminium Quote",
  },
  {
    key: "steel",
    name: "Steel & Iron",
    bg: steelBg,
    card: steelCard,
    scrap: steelScrap,
    shape: "square",
    description:
      "Steel and iron rebar, structural beams, plates, sheets, pipes and machinery scrap.",
    pills: ["Rebar & Beams", "Plates & Pipes", "Machinery Scrap"],
    quoteMaterialKey: "steel_iron",
    quoteLabel: "Get a Steel & Iron Quote",
  },
  {
    key: "lead",
    name: "Lead",
    bg: leadBg,
    card: leadCard,
    scrap: leadScrap,
    shape: "square",
    description: "Lead sheets, pipes, cable sheathing, wheel weights and industrial lead scrap.",
    pills: ["Sheets & Pipes", "Cable Sheathing", "Wheel Weights"],
    quoteMaterialKey: "lead",
    quoteLabel: "Get a Lead Quote",
  },
] as const;

// Each active tab magnifies a clean, unlettered area of its own element-card
// image. This gives it the exact photographed metal grain and colour instead
// of approximating the surface with gradients or blending it with glass.
const MATERIAL_TAB_STYLES = {
  copper: {
    texturePosition: "36% 70%",
    border: "rgb(206 140 112 / 0.76)",
    shadow: "0 12px 34px -14px rgb(107 52 30 / 0.85), inset 0 1px 0 rgb(228 176 150 / 0.42)",
    fallback: "rgb(160 98 72)",
  },
  aluminium: {
    texturePosition: "75% 30%",
    border: "rgb(217 214 212 / 0.72)",
    shadow: "0 12px 34px -14px rgb(117 111 108 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.46)",
    fallback: "rgb(154 148 145)",
  },
  steel: {
    texturePosition: "50% 22%",
    border: "rgb(172 170 170 / 0.72)",
    shadow: "0 12px 34px -14px rgb(41 40 39 / 0.78), inset 0 1px 0 rgb(215 213 212 / 0.32)",
    fallback: "rgb(103 101 101)",
  },
  lead: {
    texturePosition: "71% 21%",
    border: "rgb(149 147 147 / 0.55)",
    shadow: "0 12px 34px -14px rgb(40 40 39 / 0.84), inset 0 1px 0 rgb(213 211 210 / 0.2)",
    fallback: "rgb(83 82 83)",
  },
} as const;

// Per-material face crop for the periodic identity seal. The source cards
// are fully opaque PNGs with a black canvas baked around the metal face
// (confirmed by pixel audit — no CSS wrapper background can remove it), so
// each face is clipped tightly to its own measured visible-content bounds
// instead of one shared shape. `scale` compensates so the four faces read
// as a consistent size after cropping — Copper's content already fills
// ~96% of its frame, the others only ~88-92%, so they're scaled up to match.
const SEAL_FACE = {
  copper: { clipPath: "circle(48% at 50% 50%)", scale: 1 },
  aluminium: { clipPath: "inset(5% 5.7% round 20%)", scale: 1.08 },
  steel: { clipPath: "inset(5.1% 5.8% round 20%)", scale: 1.08 },
  lead: { clipPath: "inset(3.9% 5% round 20%)", scale: 1.05 },
} as const;

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

/**
 * Dominant transparent scrap cutout + a small periodic-card "identity seal"
 * pinned to one corner. Both stay mounted for the section's whole lifetime —
 * only their image stack crossfades per material (same stacked-opacity
 * technique already used for the section backgrounds) — so a material switch
 * never remounts this component and never resets tilt/shine state.
 *
 * One pointer calculation per move event drives two independent rotateY
 * targets from the same horizontal value: a restrained 1.5° on the cutout, a
 * livelier 3.5° on the seal. Only the seal receives the cursor-follow shine —
 * no large shine layer crosses the transparent cutout. Effect is a no-op
 * (nothing attached) under `prefers-reduced-motion` or without a fine
 * hover-capable pointer, so it's automatically inert on touch and in
 * "stacked" layout mode.
 */
function MaterialVisual({ active }: { active: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cutoutObjectRef = useRef<HTMLDivElement>(null);
  const sealObjectRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const cutoutObject = cutoutObjectRef.current;
    const sealObject = sealObjectRef.current;
    const shine = shineRef.current;
    if (!container || !cutoutObject || !sealObject || !shine) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hoverFine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduced || !hoverFine) return;

    const CUTOUT_MAX_DEG = 1.5;
    const SEAL_MAX_DEG = 3.5;
    const target = { cutoutRy: 0, sealRy: 0, mx: 50, my: 38, active: false };
    const current = { cutoutRy: 0, sealRy: 0 };
    let raf = 0;

    const refreshRect = () => {
      rectRef.current = container.getBoundingClientRect();
    };

    const tick = () => {
      current.cutoutRy += (target.cutoutRy - current.cutoutRy) * 0.12;
      current.sealRy += (target.sealRy - current.sealRy) * 0.12;

      const cutoutSettled = Math.abs(target.cutoutRy - current.cutoutRy) < 0.01;
      const sealSettled = Math.abs(target.sealRy - current.sealRy) < 0.01;
      if (!target.active && cutoutSettled) current.cutoutRy = 0;
      if (!target.active && sealSettled) current.sealRy = 0;

      cutoutObject.style.transform = `rotateY(${current.cutoutRy.toFixed(2)}deg)`;
      sealObject.style.transform = `rotateY(${current.sealRy.toFixed(2)}deg)`;
      shine.style.setProperty("--mx", `${target.mx}%`);
      shine.style.setProperty("--my", `${target.my}%`);

      if (target.active || !cutoutSettled || !sealSettled) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        cutoutObject.style.willChange = "auto";
        sealObject.style.willChange = "auto";
      }
    };

    const ensureLoop = () => {
      cutoutObject.style.willChange = "transform";
      sealObject.style.willChange = "transform";
      if (!raf) raf = requestAnimationFrame(tick);
    };

    // Cached on enter/resize rather than read on every pointermove.
    const handleEnter = () => refreshRect();
    const handleResize = () => refreshRect();

    const handleMove = (e: PointerEvent) => {
      const rect = rectRef.current ?? container.getBoundingClientRect();
      const px = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const py = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
      const horizontal = (px - 0.5) * 2;
      // Same accelerated response curve as before, shared by both objects —
      // one pointer calculation, two scaled outputs.
      const curve = Math.sign(horizontal) * Math.pow(Math.abs(horizontal), 0.68);
      target.cutoutRy = curve * CUTOUT_MAX_DEG;
      target.sealRy = curve * SEAL_MAX_DEG;
      target.mx = px * 100;
      target.my = py * 100;
      target.active = true;
      shine.style.opacity = "1";
      ensureLoop();
    };

    const handleLeave = () => {
      target.cutoutRy = 0;
      target.sealRy = 0;
      target.active = false;
      shine.style.opacity = "0";
      ensureLoop();
    };

    refreshRect();
    container.addEventListener("pointerenter", handleEnter);
    container.addEventListener("pointermove", handleMove);
    container.addEventListener("pointerleave", handleLeave);
    window.addEventListener("resize", handleResize);
    return () => {
      container.removeEventListener("pointerenter", handleEnter);
      container.removeEventListener("pointermove", handleMove);
      container.removeEventListener("pointerleave", handleLeave);
      window.removeEventListener("resize", handleResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="group relative mx-auto aspect-square w-full max-w-md"
      style={{ perspective: "1000px" }}
    >
      {/* Dominant scrap cutout — transparent WebP, floats directly over the
          section's own background. No navy backing box: that slab now
          belongs only to the small identity seal below. */}
      <div
        ref={cutoutObjectRef}
        className="absolute inset-0"
        style={{ transformOrigin: "50% 50%" }}
      >
        {MATERIALS.map((m, i) => (
          <img
            key={m.key}
            src={m.scrap}
            alt=""
            aria-hidden="true"
            loading={i === 0 ? "eager" : "lazy"}
            className="absolute inset-0 h-full w-full object-contain object-bottom p-4 transition-opacity duration-500 ease-out"
            style={{
              opacity: i === active ? 1 : 0,
              transform: m.key === "copper" ? "scale(0.92)" : undefined,
              transformOrigin: "50% 100%",
            }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)] transition-[filter] duration-500 group-hover:drop-shadow-[0_36px_70px_rgba(193,98,46,0.35)]" />

      {/* Small premium identity seal — a bare positioning/tilt box now, no
          visible shape of its own. Each face image clips to its own measured
          bounds (SEAL_FACE), so only the metallic face itself ever shows —
          no circular disc, no navy backing, no shared outline. */}
      <div className="absolute right-2 bottom-2 h-[85px] w-[85px] sm:h-[100px] sm:w-[100px]">
        <div
          ref={sealObjectRef}
          className="absolute inset-0"
          style={{ transformOrigin: "50% 50%" }}
        >
          {MATERIALS.map((m, i) => (
            <img
              key={m.key}
              src={m.card}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover drop-shadow-[0_12px_20px_rgba(0,0,0,0.65)] transition-opacity duration-500 ease-out"
              style={{
                opacity: i === active ? 1 : 0,
                clipPath: SEAL_FACE[m.key].clipPath,
                transform: `scale(${SEAL_FACE[m.key].scale})`,
                transformOrigin: "50% 50%",
              }}
            />
          ))}
        </div>
        {/* cursor-tracked specular highlight — clipped to the same face shape */}
        <div
          ref={shineRef}
          aria-hidden="true"
          className="mix-blend-overlay pointer-events-none absolute inset-0 opacity-0"
          style={{
            clipPath: SEAL_FACE[MATERIALS[active]!.key].clipPath,
            background:
              "radial-gradient(circle 45px at var(--mx, 50%) var(--my, 38%), oklch(1 0 0 / 0.98), oklch(1 0 0 / 0) 66%), radial-gradient(circle 90px at var(--mx, 50%) var(--my, 38%), oklch(0.9 0.055 55 / 0.5), oklch(1 0 0 / 0) 74%)",
            transition: "opacity 300ms ease-out",
          }}
        />
      </div>
    </div>
  );
}

export function Materials() {
  const layoutMode = useMaterialsLayoutMode();
  const { chapterRefs, active, selectMaterial } = useMaterialsController(
    MATERIALS.length,
    layoutMode,
  );
  const material = MATERIALS[active]!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Load every background + cutout + seal texture up front (fire-and-forget,
  // never blocks the initial Copper render) so a fast scroll or click can't
  // outrun a still-lazy-loading image.
  useEffect(() => {
    MATERIALS.forEach((m) => {
      const bg = new Image();
      bg.src = m.bg;
      const scrap = new Image();
      scrap.src = m.scrap;
      const card = new Image();
      card.src = m.card;
    });
  }, []);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % MATERIALS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + MATERIALS.length) % MATERIALS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MATERIALS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectMaterial(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      id="materials"
      className="relative bg-background"
      style={layoutMode === "pinned" ? { height: `${MATERIALS.length * 100}vh` } : undefined}
    >
      <div
        className={
          layoutMode === "pinned"
            ? "sticky top-0 h-screen overflow-hidden"
            : "relative overflow-hidden py-20"
        }
      >
        {/* Scroll-synced, crossfading material backgrounds */}
        {MATERIALS.map((m, i) => (
          <img
            key={m.key}
            src={m.bg}
            alt=""
            aria-hidden="true"
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-500 ease-out ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        <div className="absolute inset-0 bg-navy-deep/65" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/85 via-transparent to-background/90" />

        <div
          className={`relative z-10 mx-auto flex max-w-7xl flex-col justify-center px-6 ${
            layoutMode === "pinned" ? "h-full" : "py-4"
          }`}
          style={
            layoutMode === "pinned"
              ? { transform: "translateY(clamp(1.5rem, 3.5vh, 2.75rem))" }
              : undefined
          }
        >
          <p className="glass-panel glass-ring label-eyebrow inline-block w-fit rounded-full px-5 py-2 text-[oklch(0.62_0.13_50)]">
            Materials
          </p>
          <h2 className="font-display mt-4 text-3xl font-bold tracking-[0.02em] text-foreground uppercase sm:text-4xl">
            What we <span className="text-[oklch(0.62_0.13_50)]">trade</span>
          </h2>
          <p className="font-display mt-3 max-w-xl text-sm font-medium text-foreground/83 sm:text-base lg:max-w-[740px]">
            Buying or selling metal scrap? Choose a material to view common forms and start a quote.
          </p>

          {/* Full tablist: roving tabindex + Left/Right/Home/End, each tab
              wired to its own tabpanel via aria-controls/aria-labelledby. */}
          <div
            className="relative z-20 mt-8 flex flex-wrap gap-3"
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
                onKeyDown={(e) => handleTabKeyDown(e, i)}
                className={`font-display relative overflow-hidden rounded-full border px-6 py-2.5 text-sm font-semibold whitespace-nowrap outline-none transition-[color,border-color,box-shadow] duration-500 focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.13_60)] ${
                  i === active
                    ? "text-white"
                    : "glass-panel glass-ring border-transparent text-foreground/80"
                }`}
                style={
                  i === active
                    ? {
                        backgroundColor: MATERIAL_TAB_STYLES[m.key].fallback,
                        backgroundImage: `url(${m.card})`,
                        backgroundPosition: MATERIAL_TAB_STYLES[m.key].texturePosition,
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "700% auto",
                        borderColor: MATERIAL_TAB_STYLES[m.key].border,
                        boxShadow: MATERIAL_TAB_STYLES[m.key].shadow,
                        textShadow: "0 1px 3px rgb(0 0 0 / 0.62)",
                      }
                    : undefined
                }
              >
                {m.name}
              </button>
            ))}
          </div>

          <div
            className="relative z-10 mt-9 grid items-center gap-12 lg:grid-cols-2"
            style={
              layoutMode === "pinned"
                ? { transform: "translateY(calc(-1 * clamp(5rem, 9vh, 6.5rem)))" }
                : undefined
            }
          >
            <MaterialVisual active={active} />

            <div
              key={`${material.key}-copy`}
              role="tabpanel"
              id={`material-panel-${material.key}`}
              aria-labelledby={`material-tab-${material.key}`}
              tabIndex={0}
              className="glass-panel glass-ring animate-material-zoom rounded-3xl p-8 sm:p-10"
            >
              {/* Restrained readability scrim, local to this card only —
                  strongest over the text column, fading out to the right so
                  the glass/background depth stays visible. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-r from-navy-deep/70 via-navy-deep/25 to-transparent"
              />
              <div className="relative z-10">
                <h3 className="font-display text-3xl font-bold whitespace-nowrap text-foreground">
                  {material.name}
                </h3>
                <p className="font-display mt-5 max-w-xl text-base font-medium text-foreground sm:text-lg">
                  {material.description}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  {material.pills.map((pill) => (
                    <span
                      key={pill}
                      className="glass-panel glass-ring font-display rounded-full px-4 py-2 text-sm font-semibold text-foreground"
                    >
                      {pill}
                    </span>
                  ))}
                </div>

                <Link
                  to="/"
                  search={{ quote: true, source: "materials", material: material.quoteMaterialKey }}
                  mask={{
                    to: "/quote",
                    search: { source: "materials", material: material.quoteMaterialKey },
                  }}
                  className="group/cta font-display mt-8 flex w-full max-w-full items-center justify-center rounded-full bg-[image:var(--gradient-copper-cta)] px-6 py-3 shadow-[0_10px_24px_-10px_oklch(0.46_0.11_42/0.55)] transition-transform motion-safe:hover:scale-[1.03] motion-safe:focus-visible:scale-[1.03] lg:w-[390px]"
                >
                  <span className="text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase transition-colors group-hover/cta:text-[#EDE8D0] group-hover/cta:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]">
                    {material.quoteLabel}
                  </span>
                </Link>

                <p className="font-display mt-6 border-t border-white/10 pt-4 text-[13px] leading-[1.4] font-medium tracking-[0.02em] text-white/79 sm:text-[14px]">
                  Quote value depends on verified grade, condition, quantity and location.
                </p>
                <p className="font-display mt-2 text-[13px] leading-[1.4] font-medium tracking-[0.02em] text-white/79 sm:text-[14px]">
                  Not sure of the grade? Add clear photos to your quote request—we’ll help identify
                  it.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

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
              className="pointer-events-none absolute inset-x-0 h-screen"
              style={{ top: `${i * 100}vh`, height: "100vh" }}
            />
          ))}
        </>
      )}
    </section>
  );
}
