import { forwardRef, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
import { WHATSAPP_URL } from "@/lib/site";
import { DotGrid } from "./DotGrid";

export const Hero = forwardRef<HTMLElement>(function Hero(_props, forwardedRef) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const spotlightRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const spotlight = spotlightRef.current;
    if (!section || !spotlight) return;

    // CHECKPOINT C2L (hero final interaction lock) — cursor-follow reveal
    // is skipped entirely for reduced-motion users: no listeners attached,
    // spotlight stays at its default opacity-0, leaving a calm static
    // composition. Everyone else keeps the exact existing behavior.
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
      className="absolute inset-0 flex min-h-screen items-center overflow-hidden bg-[#080A1D] pt-24 pb-16 sm:pt-[72px] sm:pb-10"
    >
      <img
        ref={spotlightRef}
        src={scrapTexture}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
        style={{
          maskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
        }}
      />

      <DotGrid glow={0} interactive={false} />

      {/* CHECKPOINT C2L (hero final interaction lock) — smallest
          content-safe scrim: a soft radial navy fade centered on the text
          column (not a hard-edged box), sitting above the moving scrap
          reveal but beneath the text below it. Protects headline/paragraph/
          CTA legibility at any cursor-reveal position without dimming the
          full Hero or flattening the image elsewhere. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(55% 50% at 50% 50%, rgba(8,10,29,0.55) 0%, rgba(8,10,29,0.22) 50%, rgba(8,10,29,0) 78%)",
        }}
      />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className="label-eyebrow text-[oklch(0.72_0.13_60)]">Based in Sharjah · Serving all Emirates</p>

        <div className="mt-6">
          {/* CHECKPOINT C2L (hero addendum) — ~13% smaller than the previous
              w-64/sm:w-80 (256px/320px), same aspect ratio, to help the
              whole composition sit higher without a layout-emptying
              transform. */}
          <img
            src={msmLogo}
            alt="MSM Scrap — Mohammed Sihabuddin Metal Scrap Trading LLC"
            width={1174}
            height={417}
            className="w-[224px] sm:w-[276px]"
          />
        </div>

        <h1 className="font-display mt-8 text-[2.6rem] leading-[1.08] font-bold tracking-[-0.02em] sm:text-[3.5rem]">
          <span className="text-copper-metal">14+ Years</span> of Trusted Scrap Metal Trading in the UAE
        </h1>

        <p className="font-display mt-6 max-w-2xl text-base leading-[1.5] font-medium text-foreground/90 sm:text-lg">
          We buy, sell, import and export copper, aluminium, steel and lead scrap—with transparent
          weighing and UAE-wide pickup.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
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
          {/* CHECKPOINT C2L (hero final interaction lock) — no genuine
              WhatsApp brand icon asset exists anywhere in this codebase to
              reuse (checked: no src/assets/whatsapp*, no inline
              brand-glyph SVG, the footer's own "WhatsApp" is plain text
              with no icon), so this is a compact inline SVG of the
              standard WhatsApp glyph, not a new dependency. fill="currentColor"
              means it automatically inherits this link's own neutral rest
              colour and green hover/focus colour — no separate icon-hover
              classes needed. Decorative (aria-hidden); the link's own
              accessible name stays "Chat on WhatsApp". Neutral/outlined at
              rest; authentic WhatsApp green (#25D366) — text/border only, a
              very light transparent tint, never a full fill — on hover AND
              keyboard focus. */}
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display inline-flex items-center gap-2 rounded-full border border-foreground/35 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] uppercase outline-none transition-colors hover:border-[#25D366]/70 hover:bg-[#25D366]/10 hover:text-[#25D366] hover:shadow-[0_0_16px_-4px_oklch(0.72_0.19_150/0.5)] focus-visible:border-[#25D366]/70 focus-visible:bg-[#25D366]/10 focus-visible:text-[#25D366] focus-visible:shadow-[0_0_16px_-4px_oklch(0.72_0.19_150/0.5)]"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="size-[18px] shrink-0"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
            </svg>
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
});
