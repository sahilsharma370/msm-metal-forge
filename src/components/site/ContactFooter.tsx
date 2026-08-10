import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Mail, Mailbox, MapPin, Phone, PhoneCall, Truck } from "lucide-react";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
import { ADDRESS, EMAIL, NAV_LINKS, WHATSAPP_URL } from "@/lib/site";

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

const REVEAL_CLIP_PATH = buildTornCirclePath(48, 40);

export function ContactFooter() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const revealRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const reveal = revealRef.current;
    if (!section || !reveal) return;

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
      reveal.style.opacity = "1";
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
        className="group cta-section relative overflow-hidden bg-[image:var(--gradient-copper)] py-24 text-center"
      >
        <img
          ref={revealRef}
          src={scrapTexture}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
          style={{
            clipPath: REVEAL_CLIP_PATH,
            WebkitClipPath: REVEAL_CLIP_PATH,
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <p className="label-eyebrow text-[#080A1D]/80 transition-colors duration-300 group-hover:text-white">
            Let's Trade
          </p>
          <h2 className="font-display text-balance mt-4 text-3xl font-bold tracking-[0.02em] text-[#080A1D] uppercase transition-colors duration-300 group-hover:text-white sm:text-4xl">
            Buying or selling metal scrap?
          </h2>
          <p className="font-display mx-auto mt-4 max-w-3xl text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase transition-colors duration-300 group-hover:text-white/90 lg:max-w-none">
            Share the material, approximate quantity, and location for an accurate quote or
            availability update.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {/* Wrapper width is driven entirely by two named CSS variables
                (--gq-label-w, --gq-circle-d) instead of a single guessed
                total: label width = --gq-label-w (the original button's own
                width — px-7 + font-semibold text-sm tracking-[0.14em],
                unchanged from before the Jitter effect, sized generously
                plus `whitespace-nowrap` so "GET QUOTE" can never wrap),
                circle diameter = --gq-circle-d (the original button's
                height). Label translates by exactly --gq-circle-d, circle by
                exactly -(--gq-label-w) — flush with zero gap/overlap at rest
                and after the swap, by construction from the same two
                variables. Locally named group (group/quote) so this
                button's own hover drives the swap independently of the
                section-wide `group` used for the cursor-reveal/heading. */}
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
              className="font-display rounded-full border border-[#080A1D]/70 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] text-[#080A1D] uppercase transition-colors duration-300 group-hover:border-white group-hover:text-white hover:!border-[#25D366] hover:!text-[#25D366]"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </section>

      <footer className="bg-[#080A1D] py-20">
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
            <p className="mt-4 text-[15px] text-foreground/85">
              Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, importing and exporting
              metal scrap across the UAE.
            </p>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-foreground/78">Quick Links</p>
            <ul className="mt-5 space-y-3 text-sm text-foreground/85">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="hover:text-[oklch(0.62_0.13_50)]">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-foreground/78">Contact Info</p>
            <ul className="mt-5 space-y-3 text-sm text-foreground/85">
              <li className="flex items-center gap-3">
                <Phone
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <a href="tel:+971508491233" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 50 849 1233
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <a href="tel:+971554477153" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 55 447 7153
                </a>
              </li>
              <li className="flex items-center gap-3">
                <PhoneCall
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <a href="tel:+97167021312" className="hover:text-[oklch(0.62_0.13_50)]">
                  +971 6 702 1312
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <a href={`mailto:${EMAIL}`} className="hover:text-[oklch(0.62_0.13_50)]">
                  {EMAIL}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-foreground/78">Business Info</p>
            <ul className="mt-5 space-y-3 text-sm text-foreground/85">
              <li className="flex items-start gap-3">
                <MapPin
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <span>{ADDRESS}</span>
              </li>
              <li className="flex items-start gap-3">
                <Mailbox
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <span>P.O. Box 46303, Sharjah, UAE</span>
              </li>
              <li className="flex items-center gap-3">
                <Clock
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <span>7:00 AM – 7:00 PM</span>
              </li>
              <li className="flex items-center gap-3">
                <Truck
                  aria-hidden="true"
                  strokeWidth={1.3}
                  className="h-4 w-4 shrink-0 text-foreground/85"
                />
                <span>UAE-wide pickup</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-16 flex max-w-7xl flex-col gap-2 border-t border-border px-6 pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Mohammed Sihabuddin Metal Scrap Trading LLC. All rights reserved.</p>
          <p>Trade Licence No. 719219</p>
        </div>
      </footer>
    </>
  );
}
