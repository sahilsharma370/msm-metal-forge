import { forwardRef, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
import heroMetalMobile from "@/assets/hero-metal-mobile-v2.webp";
import { WHATSAPP_URL } from "@/lib/site";
import { WhatsAppIcon } from "./icons";
import { DotGrid } from "./DotGrid";

export const Hero = forwardRef<HTMLElement>(function Hero(_props, forwardedRef) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const spotlightRef = useRef<HTMLImageElement | null>(null);

  // CHECKPOINT C2L (hero final interaction lock) — desktop mouse-follow
  // reveal. BATCH 5M-A: unchanged from before this batch; the only edit
  // anywhere near it is the `hidden lg:block` visibility class added to
  // its own <img> markup below, so it never renders on mobile/tablet.
  useEffect(() => {
    const section = sectionRef.current;
    const spotlight = spotlightRef.current;
    if (!section || !spotlight) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const applyPosition = () => {
      raf = 0;
      if (!pending) return;
      spotlight.style.setProperty("--mouse-x", `${pending.x}px`);
      spotlight.style.setProperty("--mouse-y", `${pending.y}px`);
    };

    const handleMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect();
      pending = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      spotlight.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(applyPosition);
    };

    const handleLeave = () => {
      spotlight.style.opacity = "0";
    };

    section.addEventListener("mousemove", handleMove);
    section.addEventListener("mouseleave", handleLeave);
    return () => {
      section.removeEventListener("mousemove", handleMove);
      section.removeEventListener("mouseleave", handleLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={(node) => {
        sectionRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      id="home"
      // CHECKPOINT C2L (final hero polish) — desktop-only spacing
      // reduction (mobile pt-24/pb-16 unchanged): sm:pt-28(112px) ->
      // sm:pt-[72px] is a real 40px reduction via layout padding, not a
      // transform, and sm:pb-16(64px) -> sm:pb-10(40px) trims the now-empty
      // space left below the CTA row after removing the scroll chevron.
      // BATCH 5M-A: `touch-pan-y` added — mouse-only on desktop (no-op
      // there), and on any touch-capable device tells the browser this
      // section may still be panned/scrolled vertically as normal even
      // though it also listens for touchstart/touchmove itself.
      // `pt-24` (the un-prefixed/mobile-only value) becomes a safe-area-aware
      // arbitrary value instead of a bare class — this only ever affects
      // widths below `sm:`, since `sm:pt-[72px]` still overrides it above
      // that breakpoint exactly as before (an inline `style` here would
      // have out-specificity'd `sm:pt-[72px]` at every width, silently
      // breaking the desktop-locked padding — deliberately not done).
      className="absolute inset-0 flex min-h-screen touch-pan-y items-center overflow-hidden bg-[#080A1D] pt-[max(6rem,calc(env(safe-area-inset-top)+3rem))] pb-16 sm:pt-[72px] sm:pb-10"
    >
      <img
        ref={spotlightRef}
        src={scrapTexture}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover opacity-0 transition-opacity duration-300 lg:block"
        style={{
          maskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
        }}
      />

      {/* BATCH 5M-A5 — the mobile reveal experiment (auto ignition + manual
          touch/drag) is rejected; this is now a single, permanently visible
          photographic layer. No mask, no ref, no opacity animation — the
          mobile-only scrim below (not this image) carries all of the
          text-contrast work. */}
      <img
        src={heroMetalMobile}
        alt=""
        aria-hidden="true"
        width={941}
        height={1672}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center lg:hidden"
      />

      <DotGrid glow={0} interactive={false} className="opacity-40 lg:opacity-100" />

      {/* CHECKPOINT C2L (hero final interaction lock) — smallest
          content-safe scrim: a soft radial navy fade centered on the text
          column (not a hard-edged box), sitting above the moving scrap
          reveal but beneath the text below it. Protects headline/paragraph/
          CTA legibility at any cursor-reveal position without dimming the
          full Hero or flattening the image elsewhere. Desktop-only radial
          position is unchanged; mobile gets its own left-weighted scrim
          (BATCH 5M-A) since mobile text is left-aligned, not centred. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            "radial-gradient(55% 50% at 50% 50%, rgba(8,10,29,0.55) 0%, rgba(8,10,29,0.22) 50%, rgba(8,10,29,0) 78%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,10,29,0.22) 0%, rgba(8,10,29,0.42) 45%, rgba(8,10,29,0.6) 100%)",
        }}
      />

      {/* Shared content column. Alignment itself is responsive (left/start
          on mobile for the new editorial composition, centred at lg+ —
          the exact desktop arrangement, unchanged); a handful of children
          below carry their own `lg:hidden` / `hidden lg:*` pairs so each
          breakpoint shows only its own copy and CTA styling, while the
          heading stays the one shared <h1> the whole page has. */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-start px-6 text-left lg:items-center lg:text-center">
        <p className="label-eyebrow text-[oklch(0.72_0.13_60)]">
          <span className="lg:hidden">Sharjah · All 7 Emirates</span>
          <span className="hidden lg:inline">Based in Sharjah · Serving all Emirates</span>
        </p>

        <div className="mt-6 hidden lg:block">
          {/* CHECKPOINT C2L (hero addendum) — ~13% smaller than the previous
              w-64/sm:w-80 (256px/320px), same aspect ratio, to help the
              whole composition sit higher without a layout-emptying
              transform. BATCH 5M-A: desktop-only now — the mobile
              hierarchy goes straight from eyebrow to heading (the small
              logo already sits in the mobile sticky header at all times,
              so repeating a large wordmark mid-hero would just add
              height without adding information). */}
          <img
            src={msmLogo}
            alt="MSM Scrap — Mohammed Sihabuddin Metal Scrap Trading LLC"
            width={1174}
            height={417}
            className="w-[276px]"
          />
        </div>

        <h1 className="font-display mt-5 text-[clamp(1.9rem,8.5vw,2.6rem)] leading-[0.98] font-bold tracking-[-0.02em] text-foreground sm:text-[3.1rem] lg:mt-8 lg:text-[3.5rem] lg:leading-[1.08]">
          <span className="lg:hidden">
            <span className="block whitespace-nowrap">SCRAP TRADING.</span>
            <span className="block whitespace-nowrap">
              BUILT ON{" "}
              <span
                className="text-copper-metal"
                style={{
                  backgroundImage:
                    "linear-gradient(100deg, oklch(0.58 0.11 42) 0%, oklch(0.68 0.13 50) 22%, oklch(0.9 0.07 75) 50%, oklch(0.68 0.13 50) 78%, oklch(0.58 0.11 42) 100%)",
                }}
              >
                TRUST.
              </span>
            </span>
          </span>
          <span className="hidden lg:inline">
            <span className="text-copper-metal">14+ Years</span> of Trusted Scrap Metal Trading in the UAE
          </span>
        </h1>

        {/* BATCH 5M-A — mobile-only supporting proof line: the "14+ years"
            trust claim removed from the mobile header (no more large
            badge obstructing content) resurfaces here instead, exactly as
            planned, immediately under the heading where it reads as
            supporting proof rather than decoration. */}
        <p className="mt-4 max-w-md text-[17px] leading-[1.5] font-medium text-foreground/90 lg:hidden">
          14+ years of trusted metal trading across the UAE.
        </p>

        <p className="font-display mt-4 max-w-2xl text-[17px] leading-[1.5] font-medium text-foreground/75 lg:mt-6 lg:text-lg lg:text-foreground/90">
          <span className="lg:hidden">
            Copper, aluminium, steel and lead—with transparent weighing and dependable UAE‑wide
            coordination.
          </span>
          <span className="hidden lg:inline">
            We buy, sell, import and export copper, aluminium, steel and lead scrap—with transparent
            weighing and UAE-wide pickup.
          </span>
        </p>

        {/* Mobile CTAs — full-width within the content margins, stacked,
            each with its own fixed comfortable tap height. Only one is
            ever the dominant "quote" action (the copper-filled primary);
            WhatsApp stays a clearly secondary outlined action. */}
        <div className="mt-6 flex w-full flex-col gap-3 lg:hidden">
          <Link
            id="hero-cta-mobile"
            to="/"
            search={{ quote: true, source: "hero" }}
            mask={{ to: "/quote", search: { source: "hero" } }}
            className="group font-display flex h-14 items-center justify-center rounded-full bg-[image:var(--gradient-copper-cta)] shadow-[0_10px_24px_-10px_oklch(0.46_0.11_42/0.55)]"
          >
            <span className="text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase">
              Get a Quote →
            </span>
          </Link>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display flex h-[54px] items-center justify-center gap-2 rounded-full border border-foreground/34 bg-[#080A1D]/18 text-sm font-semibold tracking-[0.1em] text-foreground/90 uppercase outline-none transition-colors hover:border-[#25D366]/70 hover:bg-[#25D366]/10 hover:text-[#25D366] focus-visible:border-[#25D366]/70 focus-visible:bg-[#25D366]/10 focus-visible:text-[#25D366]"
          >
            <WhatsAppIcon />
            Chat on WhatsApp
          </a>
        </div>

        {/* Desktop CTAs — unchanged markup/classes from before this batch. */}
        <div className="mt-8 hidden flex-wrap items-center justify-center gap-4 lg:flex">
          <Link
            to="/"
            search={{ quote: true, source: "hero" }}
            mask={{ to: "/quote", search: { source: "hero" } }}
            // CHECKPOINT C2L (inner-text hover restore) — the copper
            // surface itself (gradient/shadow) never changes on hover or
            // focus, only scales slightly. The beige hover treatment lives
            // on the inner label span via group-hover/group-focus-visible,
            // never on the outer card, so it can never render as an outer
            // glow/halo/sheen. No outline-none — the browser's native focus
            // ring stays as the outer focus indicator; the beige inner text
            // is layered on top of that, not a replacement for it.
            className="group font-display rounded-full bg-[image:var(--gradient-copper-cta)] px-7 py-3 shadow-[0_10px_24px_-10px_oklch(0.46_0.11_42/0.55)] transition-transform motion-safe:hover:scale-[1.03] motion-safe:focus-visible:scale-[1.03]"
          >
            <span
              className="text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase transition-colors group-hover:text-[#EDE8D0] group-hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] group-focus-visible:text-[#EDE8D0] group-focus-visible:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]"
            >
              Get a Quote →
            </span>
          </Link>
          {/* CHECKPOINT C2L (hero final interaction lock) — neutral/outlined at
              rest; authentic WhatsApp green (#25D366) — text/border only, a
              very light transparent tint, never a full fill — on hover AND
              keyboard focus. */}
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display inline-flex items-center gap-2 rounded-full border border-foreground/35 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] uppercase outline-none transition-colors hover:border-[#25D366]/70 hover:bg-[#25D366]/10 hover:text-[#25D366] hover:shadow-[0_0_16px_-4px_oklch(0.72_0.19_150/0.5)] focus-visible:border-[#25D366]/70 focus-visible:bg-[#25D366]/10 focus-visible:text-[#25D366] focus-visible:shadow-[0_0_16px_-4px_oklch(0.72_0.19_150/0.5)]"
          >
            <WhatsAppIcon />
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
});
