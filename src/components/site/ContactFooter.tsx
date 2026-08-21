import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Mail, Mailbox, MapPin, Phone, PhoneCall, Truck } from "lucide-react";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
import { ADDRESS, EMAIL, WHATSAPP_URL } from "@/lib/site";

// Route-aware Quick Links: this footer renders on both "/" and "/about", so
// unlike a same-page anchor these need an actual path — Home is a clean "/"
// (not "/#home"), Materials/Contact are homepage anchors reachable from any
// route via plain hrefs (no scroll-controller needed: the browser natively
// scrolls same-page anchors, and normally navigates cross-page ones), and
// About is its own standalone page.
const FOOTER_LINKS = [
  { label: "Home", href: "/" },
  { label: "Materials", href: "/#materials" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/#contact" },
];

// Torn/jagged reveal shape, mirroring Hero's cursor-following spotlight
// (same ref-driven --mouse-x/--mouse-y write, same opacity toggle) but with
// a jagged circular clip-path instead of Hero's soft circular mask —
// mask-image radial-gradient has no jagged equivalent, so each vertex is
// pinned to the live cursor position via calc(var(--mouse-x/y) + offsetPx).
//
// The outline is generated (not hand-typed) so it can carry enough points
// (48) for a fine, non-repeating "hand-torn paper" edge instead of a
// spiky/faceted star: each vertex sits at a fixed angle around the circle,
// offset from the base radius by a small (3-8%) pseudo-random amount with a
// random in/out sign, so no two points look alike but the overall silhouette
// still reads clearly as a circle. A fixed PRNG seed keeps the shape stable
// across reloads instead of reshuffling on every page load.
function buildTornCirclePath(pointCount: number, baseRadius: number) {
  let seed = 1337;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const points: string[] = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2;
    const magnitude = (0.03 + nextRandom() * 0.05) * baseRadius; // 3-8% of radius
    const sign = nextRandom() < 0.5 ? -1 : 1;
    const radius = baseRadius + sign * magnitude;
    const x = Math.round(radius * Math.cos(angle));
    const y = Math.round(radius * Math.sin(angle));
    const xTerm = x >= 0 ? `+ ${x}px` : `- ${Math.abs(x)}px`;
    const yTerm = y >= 0 ? `+ ${y}px` : `- ${Math.abs(y)}px`;
    points.push(`calc(var(--mouse-x, 50%) ${xTerm}) calc(var(--mouse-y, 50%) ${yTerm})`);
  }

  return `polygon(${points.join(", ")})`;
}

// Radius 60 -> ~120px opening diameter (within the requested 112-136px
// range) — large enough to read as scrap metal on a laptop viewport, up
// from the previous 40 (~80px), still comfortably inside the section.
const REVEAL_CLIP_PATH = buildTornCirclePath(48, 60);

export function ContactFooter() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const revealRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const reveal = revealRef.current;
    if (!section || !reveal) return;

    // Touch devices never fire mousemove, so they already land on the
    // stable resting composition without any extra guard. Reduced-motion
    // users get the same: no listeners attached, reveal stays at its
    // default opacity-0 rest state.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const applyPosition = () => {
      raf = 0;
      if (!pending) return;
      reveal.style.setProperty("--mouse-x", `${pending.x}px`);
      reveal.style.setProperty("--mouse-y", `${pending.y}px`);
    };

    const handleMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect();
      pending = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      reveal.style.opacity = "0.58";
      if (!raf) raf = requestAnimationFrame(applyPosition);
    };

    const handleLeave = () => {
      reveal.style.opacity = "0";
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
    <>
      <section
        ref={sectionRef}
        id="contact"
        className="cta-section relative overflow-hidden py-24 text-center"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 48%, rgba(237, 232, 208, 0.28) 0%, rgba(215, 166, 111, 0.14) 22%, transparent 42%), linear-gradient(105deg, #873B20 0%, #B65B2F 28%, #C97947 50%, #B65B2F 72%, #873B20 100%)",
        }}
      >
        {/* Restrained dark shadow + thin copper/metal highlight around the
            torn silhouette itself (filter:drop-shadow follows the clip-path
            shape, unlike box-shadow which would only box the element) —
            reads as a peeled edge, not a glow or paper-sticker outline.
            brightness/saturate/contrast lift the image's own darkest pixels
            so the deep-navy CTA copy stays readable when the reveal tracks
            across it — the reveal itself stays visible everywhere (no
            suppression over text or controls), readability is protected by
            softening the source image, not by hiding it. */}
        <img
          ref={revealRef}
          src={scrapTexture}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
          style={{
            clipPath: REVEAL_CLIP_PATH,
            WebkitClipPath: REVEAL_CLIP_PATH,
            filter:
              "brightness(1.12) saturate(0.82) contrast(0.92) drop-shadow(0 0 1px rgba(237, 232, 208, 0.55)) drop-shadow(0 3px 8px rgba(0, 0, 0, 0.45))",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <div>
            <p className="label-eyebrow text-[#080A1D]/80">Let’s Trade</p>
            <h2 className="font-display text-balance mt-4 text-3xl font-bold tracking-[0.02em] text-[#080A1D] uppercase sm:text-4xl">
              Buying or selling metal scrap? Let’s talk.
            </h2>
            <p className="font-display mx-auto mt-4 max-w-2xl text-base font-medium text-[#080A1D]/88">
              Share the material, approximate quantity and location so we can assess pricing, pickup
              or availability.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            {/* Wrapper width is driven entirely by two named CSS variables
                (--gq-label-w, --gq-circle-d): label width = --gq-label-w,
                circle diameter = --gq-circle-d. Label translates by exactly
                --gq-circle-d, circle by exactly -(--gq-label-w) — flush with
                zero gap/overlap at rest and after the swap, by construction
                from the same two variables. Locally named group
                (group/quote) so this button's own hover drives the swap
                independently of the section-wide cursor-reveal/heading. */}
            <Link
              to="/"
              search={{ quote: true, source: "final_cta" }}
              mask={{ to: "/quote", search: { source: "final_cta" } }}
              className="group/quote cta-jitter-quote font-display relative inline-block [--gq-circle-d:48px] [--gq-label-w:190px] h-[var(--gq-circle-d)] w-[calc(var(--gq-label-w)+var(--gq-circle-d))]"
            >
              <span className="absolute top-0 left-0 flex h-[var(--gq-circle-d)] w-[var(--gq-label-w)] items-center justify-center rounded-full bg-white px-7 text-sm font-bold whitespace-nowrap tracking-[0.14em] text-[#080A1D] uppercase transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] delay-[40ms] group-hover/quote:translate-x-[var(--gq-circle-d)] motion-reduce:transition-none motion-reduce:group-hover/quote:translate-x-0">
                Get Quote
              </span>
              <span
                aria-hidden="true"
                className="absolute top-0 right-0 flex h-[var(--gq-circle-d)] w-[var(--gq-circle-d)] items-center justify-center rounded-full bg-white text-sm font-bold text-[#080A1D] transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/quote:-translate-x-[var(--gq-label-w)] motion-reduce:transition-none motion-reduce:group-hover/quote:translate-x-0"
              >
                →
              </span>
            </Link>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="group font-display inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#080A1D] bg-transparent px-7 py-3.5 text-sm font-bold tracking-[0.14em] text-[#080A1D] uppercase outline-none transition-[color,background-color,border-color,box-shadow] duration-300 hover:border-[#25D366] hover:bg-white hover:text-[#075E54] hover:shadow-[0_0_8px_1px_rgba(37,211,102,0.35)] focus-visible:border-[#25D366] focus-visible:bg-white focus-visible:text-[#075E54] focus-visible:shadow-[0_0_8px_1px_rgba(37,211,102,0.35)]"
            >
              {/* Reused verbatim from Hero's WhatsApp control — the only
                  WhatsApp brand-glyph SVG in the codebase. Deep-navy at rest
                  (matching the border/label), authentic WhatsApp green
                  #25D366 only on hover/focus — driven by group-hover/
                  group-focus-visible since the label's own hover colour
                  (#075E54) is a different shade from the icon's. */}
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="size-[18px] shrink-0 text-[#080A1D] transition-colors duration-300 group-hover:text-[#25D366] group-focus-visible:text-[#25D366]"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
              </svg>
              Chat on WhatsApp
            </a>
          </div>
        </div>
      </section>

      <footer className="bg-[#080A1D] pt-20 pb-12">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <img
              src={msmLogo}
              alt="MSM Scrap"
              loading="lazy"
              width={1174}
              height={417}
              className="w-40"
            />
            <p className="mt-4 text-[15px] text-white/82">
              Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, importing and exporting
              metal scrap across the UAE.
            </p>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-white">Quick Links</p>
            <ul className="mt-5 space-y-3 text-sm text-white">
              {FOOTER_LINKS.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="hover:text-[oklch(0.62_0.13_50)]">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-white">Contact Info</p>
            <ul className="mt-5 space-y-3 text-sm text-white">
              <li className="flex items-center gap-3">
                <Phone aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <a href="tel:+971508491233" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 50 849 1233
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <a href="tel:+971554477153" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 55 447 7153
                </a>
              </li>
              <li className="flex items-center gap-3">
                <PhoneCall aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <a href="tel:+97167021312" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 6 702 1312
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <a href={`mailto:${EMAIL}`} className="hover:text-[oklch(0.62_0.13_50)]">
                  {EMAIL}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-white">Business Info</p>
            <ul className="mt-5 space-y-3 text-sm text-white">
              <li className="flex items-start gap-3">
                <MapPin aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <span>{ADDRESS}</span>
              </li>
              <li className="flex items-start gap-3">
                <Mailbox aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <span>P.O. Box 46303, Sharjah, UAE</span>
              </li>
              <li className="flex items-center gap-3">
                <Clock aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <span>7:00 AM – 7:00 PM</span>
              </li>
              <li className="flex items-center gap-3">
                <Truck aria-hidden="true" strokeWidth={1.3} className="h-4 w-4 shrink-0" />
                <span>UAE-wide pickup</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-12 flex max-w-7xl flex-col gap-2 border-t border-border px-6 pt-6 text-sm text-white/68 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Mohammed Sihabuddin Metal Scrap Trading LLC. All rights reserved.</p>
          <p>Trade Licence No. 719219</p>
        </div>
      </footer>
    </>
  );
}
