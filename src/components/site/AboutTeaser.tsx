import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import ownerPortrait from "@/assets/owner-mohammed-sihabuddin-dark.webp";

const COPPER = "oklch(0.583 0.135 45.5)";
const NAVY = "#080A1D";
// Genuinely loaded via Google Fonts (see __root.tsx
// `family=Cormorant+Garamond:ital,wght@1,300`), not a synthetic slant/weight
// on a system serif. Shared by both the desktop and mobile owner quotes.
const DESKTOP_QUOTE_SERIF = '"Cormorant Garamond", serif';

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

/** BATCH 8M — plays a restrained fade+rise once when the section first
 * scrolls into view (not on mount, since this section sits well below the
 * fold). Native IntersectionObserver only, disconnects after the first hit
 * so it never re-triggers on scroll-back. */
function useInViewOnce<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

/**
 * Also reused by the /about page's owner-note portrait placeholder — that
 * call site passes no `className`, so it keeps its exact current size
 * (`relative h-9 w-9`) untouched; only this file's own placeholder overrides
 * it.
 */
export function MonogramMark({ className = "relative h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 85 81" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21.02 7L0 40.5L21.02 74H64.89L85 39.6625L64.89 7H21.02ZM61 41C61 50.3888 52.94 58 43 58C33.06 58 25 50.3888 25 41C25 31.6112 33.06 24 43 24C52.94 24 61 31.6112 61 41Z"
        fill={COPPER}
      />
    </svg>
  );
}

/**
 * The circular arrow-link CTA treatment (originally "Read Our Full Story"),
 * extracted so every arrow-button link on the site — including the /about
 * hero's "Back to Home" — shares one implementation instead of a second
 * copy of the same styling. Default: copper-outline circle, copper arrow,
 * warm-neutral (#EDE8D0) label. Hover/focus-visible: circle fills copper,
 * arrow turns deep navy, label turns copper. The whole group shifts 2px and
 * the arrow itself an extra 3px in `direction`; both are full literal
 * Tailwind class strings per branch (not string-interpolated) so the JIT
 * scanner can see them. `motion-reduce` disables both translations while
 * leaving the colour transitions untouched.
 */
export function ArrowLinkCTA({
  to,
  label,
  direction = "right",
  className = "",
}: {
  to: string;
  label: string;
  direction?: "left" | "right";
  className?: string;
}) {
  const ArrowIcon = direction === "left" ? ArrowLeft : ArrowRight;
  const groupShift =
    direction === "left"
      ? "hover:-translate-x-[2px] focus-visible:-translate-x-[2px]"
      : "hover:translate-x-[2px] focus-visible:translate-x-[2px]";
  const arrowShift =
    direction === "left"
      ? "group-hover:-translate-x-[3px] group-focus-visible:-translate-x-[3px]"
      : "group-hover:translate-x-[3px] group-focus-visible:translate-x-[3px]";

  return (
    <Link
      to={to}
      className={`group flex items-center gap-3 outline-none transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:hover:translate-x-0 motion-reduce:focus-visible:translate-x-0 ${groupShift} ${className}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[oklch(0.583_0.135_45.5)]/60 text-[oklch(0.583_0.135_45.5)] transition-[background-color,border-color] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:border-[oklch(0.583_0.135_45.5)] group-hover:bg-[oklch(0.583_0.135_45.5)] group-focus-visible:border-[oklch(0.583_0.135_45.5)] group-focus-visible:bg-[oklch(0.583_0.135_45.5)]">
        <ArrowIcon
          className={`h-4 w-4 text-[oklch(0.583_0.135_45.5)] transition-[color,transform] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:group-hover:translate-x-0 motion-reduce:group-focus-visible:translate-x-0 group-hover:text-[#080A1D] group-focus-visible:text-[#080A1D] ${arrowShift}`}
        />
      </span>
      <span className="font-display text-sm font-semibold tracking-[0.14em] text-[#EDE8D0] uppercase transition-colors duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:text-[oklch(0.583_0.135_45.5)] group-focus-visible:text-[oklch(0.583_0.135_45.5)]">
        {label}
      </span>
    </Link>
  );
}

function IndustryBadge() {
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke={COPPER}
        strokeWidth="1"
        strokeDasharray="1 4"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path id="badge-top-arc" d="M 15 50 A 35 35 0 0 1 85 50" fill="none" />
      <path id="badge-bottom-arc" d="M 85 50 A 35 35 0 0 1 15 50" fill="none" />
      <text fontSize="7.5" fontWeight="600" fill={COPPER} letterSpacing="1.5">
        <textPath href="#badge-top-arc" startOffset="50%" textAnchor="middle">
          YEARS IN
        </textPath>
      </text>
      <text fontSize="7.5" fontWeight="600" fill={COPPER} letterSpacing="1.5">
        <textPath href="#badge-bottom-arc" startOffset="50%" textAnchor="middle">
          THE INDUSTRY
        </textPath>
      </text>
      <text
        x="50"
        y="59"
        textAnchor="middle"
        fontSize="28"
        fontWeight="700"
        fill={COPPER}
        className="font-display"
      >
        14
      </text>
    </svg>
  );
}

export function AboutTeaser() {
  const reducedMotion = useReducedMotion();
  const { ref: cardRef, inView: cardInView } = useInViewOnce<HTMLDivElement>();

  return (
    <section
      id="about"
      className="relative overflow-hidden"
      style={{ backgroundColor: NAVY }}
    >
      {/* Desktop reuses Hero/Services' own square-grid CSS verbatim
          (`.hero-grid`, see styles.css) as a full-section background — same
          line thickness, colour, opacity, cell size and positioning as
          Hero's own desktop grid, with zero section-local divergence. No
          companion class needed here any more: `.hero-grid`'s own
          background-size is viewport-relative (vw/vh) now, so this div
          just scrolls normally with the section like any other background
          — no `background-attachment: fixed`, no drift.
          Mobile uses its own `.owner-mobile-grid` class instead (see
          styles.css) — one continuous grid across the whole section,
          including behind the panel below, matching the target mockup. */}
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-0 z-0 hidden lg:block"
      />
      <div
        aria-hidden="true"
        className="owner-mobile-grid pointer-events-none absolute inset-0 z-0 lg:hidden"
      />

      {/* Mobile/tablet "Founder's Ledger", below lg only — rebuilt to match
          src/assets/msm-owner-mobile-target.png: one outlined navy panel
          (not a full-bleed photo card) containing, top to bottom, the
          eyebrow, a rectangular portrait with the dotted industry badge
          beside it, the quote, the name/role block, and the story link.
          Normal document flow: no sticky, no pinning, no narrative height.
          The desktop subtree below is untouched.
          `pt-16`/`pb-16` — equal 64px section-level breathing room outside
          the white outlined card on both sides (above it, before Materials'
          own mobile stage; below it, before ContactFooter's orange CTA
          band). The panel's own `pt-6`/`pb-7` are separate, card-interior
          padding (inside its border, same role as Materials' own card
          padding) and are untouched. */}
      <div className="relative z-10 px-5 pt-16 pb-16 lg:hidden">
        <div className="mx-auto max-w-[420px]">
          <div
            ref={cardRef}
            className={
              reducedMotion
                ? "opacity-100"
                : cardInView
                  ? "animate-founder-rise-card opacity-0"
                  : "opacity-0"
            }
          >
            <div
              className="relative overflow-hidden rounded-[20px] border px-5 pt-6 pb-7"
              style={{ borderColor: "rgba(150, 168, 205, 0.35)" }}
            >
              {/* No panel-local background layer any more — the section-
                  wide `.owner-mobile-grid` behind this panel (see above)
                  shows straight through this transparent interior, so the
                  grid lines up continuously with the pattern outside the
                  panel's own border instead of resetting at its edge. */}
              <div className="relative z-10">
                {/* Eyebrow — reuses the exact shared `label-eyebrow` class
                    and copper token desktop's own header row uses, plus a
                    short connecting rule at the same 40% copper alpha
                    desktop uses between its label and its badge. */}
                <div className="flex items-center gap-3">
                  <p className="label-eyebrow shrink-0" style={{ color: COPPER }}>
                    The People Behind MSM
                  </p>
                  <span aria-hidden="true" className="h-px flex-1" style={{ backgroundColor: COPPER, opacity: 0.4 }} />
                </div>

                {/* Portrait + dotted badge row. Portrait reuses desktop's
                    own crop (`aspectRatio: "375 / 475"`, `object-[center_
                    top]`) and border tone (`COPPER` at desktop's own 0.45
                    alpha) rather than inventing a new thin-copper-outline
                    value. `IndustryBadge` is the exact desktop component,
                    unmodified (same dotted circle, same "14"/arc text). */}
                <div className="mt-5 flex items-start justify-between gap-4">
                  <div
                    className="w-[58%] shrink-0 overflow-hidden"
                    style={{ aspectRatio: "375 / 475", borderColor: "oklch(0.583 0.135 45.5 / 0.45)", borderWidth: "1px" }}
                  >
                    <img
                      src={ownerPortrait}
                      alt="Mohammed Sihabuddin, Owner of MSM Scrap"
                      className="h-full w-full object-cover object-[center_top]"
                    />
                  </div>
                  <IndustryBadge />
                </div>

                {/* Quote — desktop's exact text and font (Cormorant
                    Garamond, italic, weight 300), sized down for this
                    narrower panel rather than desktop's own `text-2xl
                    sm:text-3xl`. */}
                <blockquote
                  className="mt-6 text-left text-[#EDE8D0] italic"
                  style={{
                    fontFamily: DESKTOP_QUOTE_SERIF,
                    fontWeight: 300,
                    fontStyle: "italic",
                    fontSize: "clamp(1.2rem, 5.6vw, 1.4rem)",
                    lineHeight: 1.45,
                  }}
                >
                  “In this trade, trust is earned at the scale—through fair weights, clear
                  dealing and every commitment kept.”
                </blockquote>

                {/* Name/role — desktop's exact copy and classes, with a
                    shorter copper rule sized to two mobile-scale lines
                    instead of desktop's own 64px (`h-16`) rule. */}
                <div className="mt-6 flex items-start gap-4">
                  <span aria-hidden="true" className="mt-1 h-12 w-px shrink-0" style={{ backgroundColor: COPPER }} />
                  <div>
                    <p className="font-display text-lg font-bold text-[#EDE8D0]">Mohammed Sihabuddin</p>
                    <p className="mt-1 text-foreground/70">Owner – MSM Scrap</p>
                  </div>
                </div>

                {/* Story link — the exact same `ArrowLinkCTA` desktop uses,
                    so the visual treatment and the `/about` routing are
                    identical on both breakpoints. */}
                <ArrowLinkCTA to="/about" label="Read Our Full Story" direction="right" className="mt-7" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BATCH ABOUT-CARD-INVISIBLE — one-card composition restored from
          git HEAD:AboutTeaser.tsx (300px portrait column, IndustryBadge
          circular seal, header rule, quote, name block, then a
          separately-stacked bottom-right CTA), rebuilt onto the CURRENT
          outer wrapper/stage (unchanged: same clamp(590px,32vw,680px)
          section height, same clamp(500px,28vw,570px) stage height, same
          `.hero-grid` background, pixel-identical to Hero's own grid, no
          section-local override)
          instead of the original's own `min-h-[450px]`/`py-[72px]` sizing
          — the content column uses `justify-between` since this height
          budget is taller than the original's own auto-fit height ever
          was.
          The wrapper below now carries zero visual surface (no
          background/border/shadow/blur/filter — it has no `::before`/
          `::after` either, confirmed via computed styles) and exists only
          for the `grid-cols-[300px_1fr]` layout: portrait left, content
          right. The grid behind it is identical inside and outside its
          bounds. */}
      <div className="hidden lg:flex lg:h-[clamp(590px,32vw,680px)] lg:items-center">
        <div className="relative mx-auto w-[96%]">
          <div className="relative mx-auto grid items-center lg:h-[clamp(500px,28vw,570px)]">
            <div
              className="relative grid w-full grid-cols-[clamp(260px,18vw,370px)_1fr] gap-10 overflow-hidden p-[clamp(30px,2.1vw,42px)]"
              style={{
                background:
                  "linear-gradient(135deg, rgba(18, 25, 48, 0.18) 0%, rgba(6, 10, 28, 0.10) 100%)",
                backdropFilter: "blur(1px)",
                WebkitBackdropFilter: "blur(1px)",
                border: "1px solid rgba(177, 190, 216, 0.14)",
                borderRadius: "8px",
                boxShadow: "0 16px 36px rgba(0, 3, 15, 0.12)",
              }}
            >
              {/* No `h-full` here or on the content column below: the grid
                  row's height is driven purely by the portrait's own
                  aspect-ratio, computed from its own responsive width
                  (`clamp(260px,18vw,370px)`, same expression as the grid
                  column so the two never disagree) — not stretched to the
                  stage's full clamp(500px,28vw,570px) height. `vw`-relative
                  clamps (both here and on the card's own padding below) are
                  what keep the card compact at a real device pixel ratio /
                  OS display-scaling factor above 1, where a fixed CSS px
                  value renders visibly larger on screen than its literal
                  number suggests. The stage's own `items-center`
                  (unchanged) then centres this whole, now-compact row
                  within that leftover space — this is what makes the group
                  read as one centred unit instead of being stretched
                  top-to-bottom. */}
              <div
                className="relative z-10 w-full overflow-hidden border"
                style={{
                  aspectRatio: "375 / 475",
                  backgroundColor: "oklch(0.195 0.055 265.5)",
                  borderColor: "oklch(0.583 0.135 45.5 / 0.45)",
                }}
              >
                <img
                  src={ownerPortrait}
                  alt="Mohammed Sihabuddin, Owner of MSM Scrap"
                  className="h-full w-full object-cover object-[center_top]"
                />
              </div>

              {/* Grid's default `align-items: stretch` already sizes this
                  column to the portrait's own height (see comment above) —
                  `justify-between` on its 3 stacked groups (header row,
                  quote, name/CTA row) then pins the header row flush to the
                  top of that box and the name/CTA row flush to the bottom,
                  both landing exactly on the portrait's top/bottom edges.
                  The quote is the only item left in between, so it falls
                  naturally centred with equal space above and below —
                  no fixed `gap` needed to fake that centring. */}
              <div className="relative z-10 flex flex-col justify-between">
                {/* `items-start` (not `items-center`): the badge is the
                    tallest element in this row, so centring against it
                    used to sink the label/copper-line group toward the
                    badge's own vertical middle instead of the row's — and
                    therefore the portrait's — top edge. Top-aligning both
                    groups puts the label and the badge's own top edge on
                    that same top line. */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <p className="label-eyebrow shrink-0 text-[oklch(0.583_0.135_45.5)]">
                      The People Behind MSM
                    </p>
                    {/* Short fixed-width rule instead of `flex-1`: connects
                        the label to the seal without stretching across the
                        whole row and dominating the empty space. */}
                    <span
                      className="h-px w-16 shrink-0 bg-[oklch(0.583_0.135_45.5)]/40"
                      aria-hidden="true"
                    />
                  </div>
                  <IndustryBadge />
                </div>

                <blockquote
                  className="max-w-[58ch] text-left text-2xl leading-snug font-light text-balance text-[#EDE8D0] italic sm:text-3xl"
                  style={{ fontFamily: DESKTOP_QUOTE_SERIF, fontWeight: 300, fontStyle: "italic" }}
                >
                  “In this trade, trust is earned at the scale—through fair weights, clear
                  dealing and every commitment kept.”
                </blockquote>

                {/* Name/title and the CTA now share one row (baseline via
                    `items-end`) instead of stacking on separate lines. */}
                <div className="flex items-end justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <span
                      className="mt-1 h-16 w-px shrink-0 bg-[oklch(0.583_0.135_45.5)]"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-display text-lg font-bold text-[#EDE8D0]">
                        Mohammed Sihabuddin
                      </p>
                      <p className="text-foreground/70">Owner – MSM Scrap</p>
                    </div>
                  </div>

                  <ArrowLinkCTA to="/about" label="Read Our Full Story" direction="right" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
