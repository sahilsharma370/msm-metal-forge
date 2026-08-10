import { useEffect, useRef, useState } from "react";
import copperBg from "@/assets/copper-bg.png";
import aluminiumBg from "@/assets/aluminium-bg.png";
import steelBg from "@/assets/steel-bg.png";
import leadBg from "@/assets/lead-bg.png";
import copperCard from "@/assets/copper-card.png";
import aluminiumCard from "@/assets/aluminium-card.png";
import steelCard from "@/assets/steel-card.png";
import leadCard from "@/assets/lead-card.png";
import copperEdge from "@/assets/copper-edge-strip.webp";
import aluminiumEdge from "@/assets/aluminium-edge-strip.webp";
import steelEdge from "@/assets/steel-edge-strip.webp";
import leadEdge from "@/assets/lead-edge-strip.webp";

const MATERIALS = [
  // Preserve all original edge imports and metadata for compatibility, even
  // though production rendering intentionally uses only the stable face tilt.
  {
    key: "copper",
    name: "Copper",
    bg: copperBg,
    card: copperCard,
    shape: "circle",
    edge: copperEdge,
    edgeAspect: 110 / 1130,
    description: "We buy copper wire, cables, pipes, coils, sheets and radiator scrap.",
    pills: ["Wire & Cable", "Pipes & Coils", "Radiators"],
  },
  {
    key: "aluminium",
    name: "Aluminium",
    bg: aluminiumBg,
    card: aluminiumCard,
    shape: "square",
    edge: aluminiumEdge,
    edgeAspect: 160 / 1090,
    description:
      "We buy aluminium profiles, sheets, frames, panels, cables and cast aluminium scrap.",
    pills: ["Profiles & Frames", "Sheets & Panels", "Cast Aluminium"],
  },
  {
    key: "steel",
    name: "Steel & Iron",
    bg: steelBg,
    card: steelCard,
    shape: "square",
    edge: steelEdge,
    edgeAspect: 170 / 1090,
    description: "We buy rebar, structural beams, plates, sheets, pipes and heavy machinery scrap.",
    pills: ["Rebar & Beams", "Plates & Pipes", "Machinery Scrap"],
  },
  {
    key: "lead",
    name: "Lead",
    bg: leadBg,
    card: leadCard,
    shape: "square",
    edge: leadEdge,
    edgeAspect: 175 / 1080,
    description:
      "We buy lead sheets, pipes, cable sheathing, wheel weights and industrial lead scrap.",
    pills: ["Sheets & Pipes", "Cable Sheathing", "Wheel Weights"],
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

/** Drives `active` purely from scroll position: whichever chapter spans the viewport center wins. */
function useScrollActiveMaterial(count: number) {
  const chapterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = chapterRefs.current.indexOf(entry.target as HTMLDivElement);
          if (idx !== -1) setActive(idx);
        }
      },
      { threshold: 0, rootMargin: "-50% 0px -50% 0px" },
    );
    chapterRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [count]);

  return { chapterRefs, active };
}

/**
 * Cursor-driven 3D tilt + a specular highlight that overlay-blends with
 * whatever is beneath it: it blooms brightly over the reflective metal and
 * stays suppressed over the dark backing, so the light reads as moving across
 * the metal surface itself rather than sliding over the card box.
 * Skipped entirely on touch/coarse pointers so nothing gets stuck mid-tilt.
 *
 * The static navy frame (background/border/clip) never receives a transform —
 * only `objectRef`, the inner coin/plate wrapper, rotates. The frame just sets
 * a plain `perspective` CSS property (not a transform) so that inner rotation
 * still reads as 3D.
 */
function ElementCard({ material }: { material: (typeof MATERIALS)[number] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const objectRef = useRef<HTMLDivElement>(null);
  const shineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    const object = objectRef.current;
    const shine = shineRef.current;
    if (!card || !object || !shine) return;

    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const MAX_DEG = 22;
    // Horizontal-only pivot: `ry` (left/right) is the sole rotation axis. Vertical
    // cursor movement only ever feeds the shine position, never the tilt. No scale,
    // no skew — rotateY is the only transform applied to the object.
    const target = { ry: 0, mx: 50, my: 38, active: false };
    const current = { ry: 0 };
    let raf = 0;

    const tick = () => {
      current.ry += (target.ry - current.ry) * 0.12;

      // Snap the final frame to a true zero. Without this, easing leaves a tiny
      // non-zero angle for several frames, which can expose a one-pixel slice.
      const settled = Math.abs(target.ry - current.ry) < 0.02;
      if (!target.active && settled) current.ry = 0;

      object.style.transform = `rotateY(${current.ry.toFixed(2)}deg)`;

      shine.style.setProperty("--mx", `${target.mx}%`);
      shine.style.setProperty("--my", `${target.my}%`);

      if (target.active || !settled) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        object.style.willChange = "auto";
      }
    };

    const ensureLoop = () => {
      object.style.willChange = "transform";
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const handleMove = (e: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      const px = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      const py = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
      const horizontal = (px - 0.5) * 2;
      // A slightly accelerated response makes real depth readable before the
      // pointer reaches the extreme edge, while preserving zero at the center.
      target.ry = Math.sign(horizontal) * Math.pow(Math.abs(horizontal), 0.68) * MAX_DEG;
      target.mx = px * 100;
      target.my = py * 100;
      target.active = true;
      shine.style.opacity = "1";
      ensureLoop();
    };

    const handleLeave = () => {
      target.ry = 0;
      target.active = false;
      shine.style.opacity = "0";
      ensureLoop();
    };

    // Listens across the whole static card (not just the inner object) so
    // there's no dead zone near the edges — but only `object` ever moves.
    card.addEventListener("pointermove", handleMove);
    card.addEventListener("pointerleave", handleLeave);
    return () => {
      card.removeEventListener("pointermove", handleMove);
      card.removeEventListener("pointerleave", handleLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [material.card]);

  // Clip only the single face image. Keeping it out of a translateZ stack
  // avoids Chrome compositor failures at browser zoom and across GPU drivers.
  const clipPath = material.shape === "circle" ? "circle(41% at 50% 50%)" : "inset(12.5% round 12%)";

  return (
    <div ref={cardRef} className="group animate-material-zoom relative mx-auto aspect-square w-full max-w-md">
      {/* Static navy frame: the only clipping boundary. */}
      <div
        className="relative isolate h-full w-full overflow-hidden rounded-[2rem]"
        style={{
          background:
            "radial-gradient(circle at 50% 38%, oklch(0.34 0.06 264) 0%, oklch(0.16 0.05 265) 72%)",
          perspective: "800px",
        }}
      >
        {/* the only element that tilts: the coin/plate itself, floating inside the fixed frame */}
        <div
          ref={objectRef}
          className="absolute inset-0"
          style={{ transformOrigin: "50% 50%" }}
        >
          <img
            src={material.card}
            alt={`${material.name} element reference card`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain p-8"
            style={{ clipPath }}
          />
        </div>

        {/* cursor-tracked specular highlight — unchanged logic; stays flat on the static
            frame (sibling of the tilting object) so it keeps blending against this card's
            own background exactly as before */}
        <div
          ref={shineRef}
          aria-hidden="true"
          className="mix-blend-overlay pointer-events-none absolute inset-0 opacity-0"
          style={{
            background:
              "radial-gradient(circle 90px at var(--mx, 50%) var(--my, 38%), oklch(1 0 0 / 0.98), oklch(1 0 0 / 0) 66%), radial-gradient(circle 220px at var(--mx, 50%) var(--my, 38%), oklch(0.9 0.055 55 / 0.5), oklch(1 0 0 / 0) 74%)",
            transition: "opacity 300ms ease-out",
          }}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 rounded-[2rem] shadow-[0_30px_70px_-20px_oklch(0_0_0/0.65)] transition-shadow duration-500 group-hover:shadow-[0_40px_90px_-16px_oklch(0.583_0.135_45.5/0.55)]" />
    </div>
  );
}

export function Materials() {
  const { chapterRefs, active } = useScrollActiveMaterial(MATERIALS.length);
  const material = MATERIALS[active]!;

  // Load every selector texture up front. The active pill can then switch
  // straight to its final metal crop without briefly showing a dark fallback
  // while that material's card image is fetched for the first time.
  useEffect(() => {
    MATERIALS.forEach((m) => {
      const image = new Image();
      image.src = m.card;
    });
  }, []);

  return (
    <section
      id="materials"
      className="relative bg-background"
      style={{ height: `${MATERIALS.length * 100}vh` }}
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* Scroll-synced, crossfading material backgrounds */}
        {MATERIALS.map((m, i) => (
          <img
            key={m.key}
            src={m.bg}
            alt=""
            aria-hidden="true"
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full scale-105 object-cover transition-opacity duration-[1400ms] ease-out ${
              i === active ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        <div className="absolute inset-0 bg-navy-deep/65" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/85 via-transparent to-background/90" />

        <div
          className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-center px-6"
          style={{ transform: "translateY(clamp(1.5rem, 3.5vh, 2.75rem))" }}
        >
          <p className="glass-panel glass-ring label-eyebrow inline-block w-fit rounded-full px-5 py-2 text-[oklch(0.62_0.13_50)]">
            Our Inventory
          </p>
          <h2 className="font-display mt-4 text-3xl font-bold tracking-[0.02em] text-foreground uppercase sm:text-4xl">
            What we <span className="text-[oklch(0.62_0.13_50)]">trade</span>
          </h2>

          {/* Scroll-synced indicator; clicking scrolls to that material's chapter,
              but the IntersectionObserver in useScrollActiveMaterial remains the
              sole owner of `active` — the click never calls setActive itself. */}
          <div
            className="mt-10 flex flex-wrap gap-3"
            role="tablist"
            aria-label="Material shown, synced to scroll position"
          >
            {MATERIALS.map((m, i) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={active === i}
                onClick={() => {
                  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  chapterRefs.current[i]?.scrollIntoView({
                    behavior: reduced ? "auto" : "smooth",
                    block: "center",
                  });
                }}
                className={`font-display relative overflow-hidden rounded-full border px-6 py-2.5 text-sm font-semibold whitespace-nowrap transition-[color,border-color,box-shadow] duration-500 ${
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

          <div className="mt-12 grid items-center gap-12 lg:grid-cols-2">
            <ElementCard key={material.key} material={material} />

            <div
              key={`${material.key}-copy`}
              className="glass-panel glass-ring animate-material-zoom rounded-3xl p-8 sm:p-10"
            >
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
              <p className="font-display mt-5 border-t border-white/10 pt-4 text-[13px] leading-[1.4] font-medium tracking-[0.02em] text-white/72">
                Pricing varies by material grade, condition and quantity.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Invisible scroll chapters: one viewport tall each, drive `active` via IntersectionObserver */}
      {MATERIALS.map((m, i) => (
        <div
          key={m.key}
          ref={(el) => {
            chapterRefs.current[i] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 h-screen"
          style={{ top: `${i * 100}vh` }}
        />
      ))}
    </section>
  );
}