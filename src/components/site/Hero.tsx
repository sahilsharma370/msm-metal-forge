import { forwardRef, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
// BATCH UI-H1-R2 — v2 kept on disk (unimported) only as a rollback asset;
// the live mobile Hero background is v3.
import heroMetalMobile from "@/assets/msm-mobile-hero-full-matched-v2.webp";
import { WHATSAPP_URL } from "@/lib/site";
import { WhatsAppIcon } from "./icons";

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
      className="hero-stage-min-height hero-stage-fixed absolute inset-0 flex touch-pan-y items-start overflow-hidden bg-[#080A1D] pt-[max(6rem,calc(env(safe-area-inset-top)+3rem))] pb-16 sm:pt-[72px] sm:pb-10 lg:items-center"
    >
      {/* BATCH HERO-GRID-MATCH — CSS square grid, geometry-matched to the
          Our Services desktop grid (baked into that section's own stage
          photograph, not CSS — see `.hero-grid` in styles.css for the
          measured source values and the ratio math). Mobile/base keeps the
          original fixed 48px/0.049-effective-alpha appearance unchanged;
          the `min-width: 1024px` block in that same class is the only
          desktop-specific override, so this single element needs no
          conditional className or duplicated inline declaration. First
          child of the section, so it paints behind the scrap-texture/
          mobile-photo layers and all real content below. */}
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />

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
          text-contrast work.
          BATCH TRACK-RECORD-JOIN — `object-bottom` (not the previous
          `object-center`) is the actual fix for the hero/trust seam: this
          image is paired pixel-for-pixel with TrustBar's own mobile
          background (msm-mobile-trust-full-matched-v2.webp, same 853x1844
          canvas, one continuous composition) so that this image's true
          bottom row continues directly into that image's true top row.
          `object-fit: cover` still scales this image to the viewport's
          width (this photo's aspect is narrower than every real phone's
          100svh viewport, so cover always crops vertically here, never
          horizontally — the coil's x-position is never shifted). With the
          previous `object-center`, that vertical crop was split evenly
          top+bottom, silently cutting off part of the image's own bottom —
          exactly the content that has to line up with the trust image's
          top. `object-bottom` anchors the image's bottom edge to the
          container's bottom edge instead, so the full, uncropped bottom
          row is always what's visible there, on every device height,
          cropping only from the top (empty yard, not the join) instead.
          MEASURED ROOT CAUSE (permanent navy grid band between Hero and
          Trust on a physical iPhone 14 Plus, iOS Safari) — confirmed via
          direct Web Inspector measurement on the device: `.hero-grid`,
          this section's own background-pattern sibling, carries only
          `absolute inset-0` (no explicit width/height) and correctly spans
          the full 744px Hero box. This `<img>` carried `h-full` (height:
          100%, a percentage) and measured only 584px tall on the same
          device — the exact 160px shortfall matching the reported band.
          FIRST FIX ATTEMPT (reverted — confirmed wrong on physical re-
          test): dropping `h-full`/`w-full` entirely, reasoning that
          `inset-0` alone — proven sufficient for `.hero-grid` — would do
          the same here. Visually, on the physical device, this traded the
          band for a different regression: a hard image cut with the
          bottom-anchored copper-wire composition (see BATCH TRACK-RECORD-
          JOIN above) missing — reported directly from physical-device
          visual review, not independently re-measured here. The likely
          explanation that assumption missed: `.hero-grid` is a plain,
          non-replaced `<div>` with no intrinsic size, where `inset-0`
          alone is well known to stretch an `auto`-height box between
          `top`/`bottom`; an `<img>` is a *replaced* element, and per the
          CSS2.1 absolutely-positioned-replaced-element sizing rules, an
          `auto` height on a replaced element is not guaranteed to stretch
          the same way — it can instead resolve from the image's own
          intrinsic ratio. That mechanism is offered here as the standard
          explanation consistent with the observed symptom, not as a
          separately re-verified measurement of this exact element's
          resulting box. CURRENT FIX: `h-[calc(var(--app-vh,7.6px)*100)]` — the same
          explicit, non-percentage formula `.hero-stage-height`/
          `.hero-stage-min-height` (styles.css) and QuoteExperience.tsx's
          own modal sizing already use for exactly this category of
          viewport-height dependency. It's a definite computed length, not
          a percentage, so it never depends on whether this element's
          containing block (itself sized via `inset-0`, not a literal
          `height` property) counts as "definite" for a descendant's
          percentage resolution — the specific cross-browser ambiguity
          `h-full` hit on iOS Safari. `width: 100%` (`w-full`) is kept
          unchanged: only the height axis was ever measured wrong, and
          width-percentage resolution against this section's own definite
          width is not the mechanism in question here. */}
      <img
        src={heroMetalMobile}
        alt=""
        aria-hidden="true"
        width={853}
        height={1844}
        fetchPriority="high"
        className="pointer-events-none absolute inset-0 h-[calc(var(--app-vh,7.6px)*100)] w-full object-cover object-bottom lg:hidden"
      />

      {/* CHECKPOINT C2L (hero final interaction lock) — smallest
          content-safe scrim: a soft radial navy fade centered on the text
          column (not a hard-edged box), sitting above the moving scrap
          reveal but beneath the text below it. Protects headline/paragraph/
          CTA legibility at any cursor-reveal position without dimming the
          full Hero or flattening the image elsewhere. Desktop-only radial
          position is unchanged; mobile gets its own centered scrim
          (BATCH 5M-A) matching the mobile text column's own centering. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            "radial-gradient(55% 50% at 50% 50%, rgba(8,10,29,0.55) 0%, rgba(8,10,29,0.22) 50%, rgba(8,10,29,0) 78%)",
        }}
      />
      {/* BATCH UI-H1-R5 — deeper ink-navy localized readability zone
          (still only behind the content column, not a full-screen wash),
          plus the same light top-to-bottom base gradient. Sits above the
          v3 photo, below the real HTML content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{
          backgroundImage: `
            radial-gradient(
              ellipse 90% 36% at 50% 46%,
              rgba(3, 10, 27, 0.92) 0%,
              rgba(4, 13, 32, 0.85) 40%,
              rgba(4, 15, 35, 0.64) 64%,
              rgba(4, 12, 29, 0.3) 82%,
              rgba(4, 9, 23, 0) 100%
            ),
            linear-gradient(
              180deg,
              rgba(4, 7, 16, 0.03) 0%,
              rgba(4, 7, 16, 0.07) 24%,
              rgba(4, 7, 16, 0.13) 65%,
              rgba(4, 7, 16, 0.48) 100%
            )
          `,
        }}
      />

      {/* Shared content column. Alignment itself is responsive (left/start
          on mobile for the new editorial composition, centred at lg+ —
          the exact desktop arrangement, unchanged); a handful of children
          below carry their own `lg:hidden` / `hidden lg:*` pairs so each
          breakpoint shows only its own copy and CTA styling, while the
          heading stays the one shared <h1> the whole page has.
          MEASURED ROOT CAUSE (mobile Chrome toolbar-collapse Hero shift) —
          this margin used raw `30.5svh`, which VIEWPORT-STABILITY-2 (see
          styles.css) already proved live-tracks the toolbar on this
          device/browser exactly like `dvh`, not fixed at any one toolbar
          state. The section's own background/height is sized off the
          frozen `--app-vh` (`.hero-stage-min-height`), so as the toolbar
          collapsed mid-scroll, this margin kept recalculating against the
          growing live viewport while the background stayed put — the text
          column visibly sliding down relative to it. Root cause measured
          via a SIMULATED probe (a desktop browser resizing an iframe's own
          viewport 660px -> 730px to stand in for a real toolbar collapse,
          not a physical-device trace): growing the viewport by 70px moved
          this column 21.3px relative to the unchanged 660px-tall
          background — 30.5% of 70, i.e. exactly the `30.5svh` term.
          Swapping to the same frozen `--app-vh` custom property every other
          flow-affecting viewport unit in this codebase already uses removes
          the live-tracking entirely; the margin now resolves once, at the
          same captured value, and never moves again until a real width/
          orientation change. The fix itself was then visually approved on
          a real iPhone (Chrome, LAN preview) performing the actual address-
          bar collapse/expand, separately from the simulated measurement
          above. */}
      <div
        className="relative mx-auto mt-[max(0px,calc(var(--app-vh,7.6px)*30.5-96px))] flex w-full max-w-4xl flex-col items-center px-6 text-center lg:mt-0 lg:items-center lg:text-center"
      >
        <p className="label-eyebrow text-[oklch(0.72_0.13_60)]">
          {/* BATCH UI-H1-R5 — mobile now shares desktop's fuller copy; kept
              on one line via a reduced mobile-only letter-spacing/size
              override on this span (label-eyebrow's own 0.22em tracking is
              inherited and would wrap this longer string at 390px). */}
          <span className="whitespace-nowrap text-[12px] tracking-[0.09em] text-[#C66A3D] lg:hidden lg:text-[0.75rem] lg:tracking-[0.22em]">
            Based in Sharjah · Serving all Emirates
          </span>
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

        <h1 className="font-display mt-3 text-[clamp(2rem,9.2vw,2.4rem)] leading-[0.98] font-bold tracking-[-0.02em] text-foreground sm:text-[3.1rem] lg:mt-8 lg:text-[3.5rem] lg:leading-[1.08]">
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
          Trusted across the UAE for 14+ years.
        </p>

        <p className="font-sans mt-4 max-w-2xl text-[16px] leading-[1.5] font-medium text-foreground/80 lg:mt-6 lg:font-display lg:text-lg lg:text-foreground/90">
          <span className="lg:hidden">
            Copper, aluminium, steel and lead. Transparent weighing and dependable logistics across
            the UAE.
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
        <div className="mt-3 flex w-full flex-col gap-2.5 lg:hidden">
          <Link
            id="hero-cta-mobile"
            to="/"
            search={{ quote: true, source: "hero" }}
            mask={{ to: "/quote", search: { source: "hero" } }}
            className="group font-display flex h-[48px] items-center justify-center rounded-[12px] bg-[image:var(--gradient-copper-cta)] shadow-[0_10px_24px_-10px_oklch(0.46_0.11_42/0.55)]"
          >
            <span className="text-[15px] font-bold tracking-[0.08em] text-[#080A1D] uppercase">
              Get a Quote →
            </span>
          </Link>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display flex h-[48px] items-center justify-center gap-2 rounded-[12px] border border-foreground/45 bg-[#080A1D]/18 text-[15px] font-semibold tracking-[0.08em] text-foreground/90 uppercase outline-none transition-colors hover:border-[#25D366]/70 hover:bg-[#25D366]/10 hover:text-[#25D366] focus-visible:border-[#25D366]/70 focus-visible:bg-[#25D366]/10 focus-visible:text-[#25D366]"
          >
            <WhatsAppIcon className="size-[20px] shrink-0" />
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
