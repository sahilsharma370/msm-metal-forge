import { Link } from "@tanstack/react-router";
import { Clock, Mail, Mailbox, MapPin, Phone, PhoneCall, Truck } from "lucide-react";
import msmLogo from "@/assets/msm-logo.svg";
import copperCtaBackground from "@/assets/msm-copper-cta-background-v2.webp";
import letsTradeCopperBg from "@/assets/lets-trade-copper-bg.webp";
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

const COPPER = "oklch(0.583 0.135 45.5)";

// Mobile footer only — one shared flat (card-free) treatment for Contact
// Info/Business Info so both stay pixel-identical (heading, background,
// icon size/colour, row spacing). No background/border/radius of its own —
// separation between sections is owned by the divider lines the caller
// places around each one, not by a bounding box here. `href` present
// renders the row as a real tel:/mailto: link; absent renders a plain row
// (Business Info's rows have no destination).
type MobileFooterRow = { Icon: typeof Phone; text: string; href?: string };

function MobileFooterSection({ title, rows }: { title: string; rows: MobileFooterRow[] }) {
  return (
    <div style={{ background: "transparent", border: "none", borderRadius: 0, boxShadow: "none" }}>
      <p
        className="uppercase"
        style={{ marginBottom: "18px", fontSize: "12.5px", fontWeight: 700, letterSpacing: "0.22em", color: COPPER }}
      >
        {title}
      </p>
      <div className="flex flex-col" style={{ gap: "13px" }}>
        {rows.map((row) => {
          const rowContent = (
            <>
              <row.Icon
                aria-hidden="true"
                strokeWidth={1.4}
                style={{ width: "21px", height: "21px", color: COPPER, flexShrink: 0 }}
              />
              <span
                style={{
                  minWidth: 0,
                  flex: "1 1 auto",
                  overflowWrap: "break-word",
                  fontSize: "15.5px",
                  lineHeight: 1.35,
                  color: "rgba(235, 237, 244, 0.9)",
                }}
              >
                {row.text}
              </span>
            </>
          );
          return row.href ? (
            <a
              key={row.text}
              href={row.href}
              className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.583_0.135_45.5)]"
            >
              {rowContent}
            </a>
          ) : (
            <div key={row.text} className="flex items-center gap-3">
              {rowContent}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ContactFooter() {
  return (
    <>
      <section
        id="contact"
        className="cta-section relative overflow-hidden lg:py-24 lg:text-center"
        style={{ backgroundColor: "#080A1D" }}
      >
        {/* Desktop-only background — the real photographed copper texture
            asset (central light + upper-right rings baked in), not a
            recreated CSS gradient. Diagonal bottom edge lives on this
            background layer only (clip-path), so the interactive content
            below stays a normal, unclipped rectangle. The clipped-away
            triangle exposes the section's own navy background-color
            (#080A1D above), which matches the footer immediately below —
            no separate fill needed to avoid a gap. `filter` is applied
            here, on the image layer alone (this div has no text/icon
            children — those live in the separate content block below) —
            it tones the centre's brightness/saturation down from a
            luminous spotlight to warm brushed copper without adding an
            opaque wash that would flatten the texture, and without
            touching heading/body/button/icon color or contrast. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden lg:block"
          style={{
            backgroundImage: `url(${letsTradeCopperBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            backgroundRepeat: "no-repeat",
            filter: "brightness(0.82) saturate(0.88)",
            clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% calc(100% - 45px))",
            WebkitClipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% calc(100% - 45px))",
          }}
        />

        {/* Mobile — full-width brushed-copper panel on a navy field, below
            lg only. The panel starts flush at the top of this section (no
            external spacer) so the copper begins directly below the
            header's own divider with no extra navy band, regardless of
            scroll position — the panel's own 142px top padding is what
            provides the "breathing space" before the eyebrow, not a
            separate reserved-height element. Panel (diagonal bottom edge)
            flows straight into the navy footer immediately after. */}
        <div className="relative lg:hidden">
          <div
            className="relative w-full"
            style={{
              paddingTop: "142px",
              paddingBottom: "76px",
              paddingLeft: "32px",
              paddingRight: "32px",
              backgroundImage: `url(${copperCtaBackground})`,
              backgroundSize: "cover",
              backgroundPosition: "center top",
              backgroundRepeat: "no-repeat",
              clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% calc(100% - 50px))",
              WebkitClipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% calc(100% - 50px))",
            }}
          >
            <div className="relative z-[1]">
              <div className="flex items-center gap-3">
                <span
                  className="uppercase whitespace-nowrap"
                  style={{ fontSize: "14px", fontWeight: 700, letterSpacing: "0.15em", color: "#080A1D" }}
                >
                  Let’s Trade
                </span>
                <span aria-hidden="true" className="h-px shrink-0" style={{ width: "36px", backgroundColor: "#080A1D", opacity: 0.4 }} />
              </div>

              <h2
                className="font-display uppercase"
                style={{
                  marginTop: "24px",
                  fontSize: "clamp(35px, 9vw, 38px)",
                  lineHeight: 1.0,
                  letterSpacing: "-0.025em",
                  fontWeight: 800,
                  color: "#080A1D",
                }}
              >
                <span className="block whitespace-nowrap">Buying or selling</span>
                <span className="block whitespace-nowrap">metal scrap?</span>
                <span className="block whitespace-nowrap">Let’s talk.</span>
              </h2>

              <p
                className="font-display"
                style={{
                  marginTop: "26px",
                  maxWidth: "320px",
                  fontSize: "20px",
                  lineHeight: 1.4,
                  fontWeight: 400,
                  color: "#080A1D",
                }}
              >
                Share the material, approximate quantity and location. We’ll assess pricing, pickup or
                availability.
              </p>

              <div className="flex items-center gap-2" style={{ marginTop: "28px" }}>
                <Clock aria-hidden="true" strokeWidth={1.75} style={{ width: "24px", height: "24px", color: "#080A1D", flexShrink: 0 }} />
                <span
                  className="uppercase"
                  style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", color: "#080A1D" }}
                >
                  Response within one business day
                </span>
              </div>

              <Link
                to="/"
                search={{ quote: true, source: "final_cta" }}
                mask={{ to: "/quote", search: { source: "final_cta" } }}
                aria-label="Get a quote"
                className="font-display flex h-[68px] w-full items-center justify-between rounded-full outline-none transition-transform duration-300 focus-visible:ring-2 focus-visible:ring-[#080A1D] active:scale-[0.98]"
                style={{ marginTop: "28px", backgroundColor: "#EDE8D0", paddingLeft: "28px", paddingRight: "8px" }}
              >
                <span
                  className="uppercase whitespace-nowrap"
                  style={{ fontSize: "15px", fontWeight: 750, letterSpacing: "0.16em", color: "#080A1D" }}
                >
                  Get a Quote
                </span>
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center justify-center rounded-full"
                  style={{ width: "56px", height: "56px", backgroundColor: "#080A1D", color: "#EDE8D0", fontSize: "16px" }}
                >
                  →
                </span>
              </Link>

              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="font-display flex h-[64px] w-full items-center justify-center rounded-full outline-none transition-transform duration-300 active:scale-[0.98]"
                style={{
                  marginTop: "16px",
                  backgroundColor: "transparent",
                  border: "1.5px solid #080A1D",
                  gap: "14px",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="size-[18px] shrink-0"
                  style={{ color: "#080A1D" }}
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
                </svg>
                <span
                  className="uppercase whitespace-nowrap"
                  style={{ fontSize: "15px", fontWeight: 750, letterSpacing: "0.12em", color: "#080A1D" }}
                >
                  Chat on WhatsApp
                </span>
              </a>

              <div className="flex items-center gap-2" style={{ marginTop: "24px" }}>
                <span
                  className="uppercase whitespace-nowrap"
                  style={{ fontSize: "10px", fontWeight: 650, letterSpacing: "0.18em", color: "#080A1D" }}
                >
                  No Account Required
                </span>
                <span aria-hidden="true" className="shrink-0 rounded-full" style={{ width: "3px", height: "3px", backgroundColor: "#080A1D" }} />
                <span
                  className="uppercase whitespace-nowrap"
                  style={{ fontSize: "10px", fontWeight: 650, letterSpacing: "0.18em", color: "#080A1D" }}
                >
                  UAE-Wide
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mx-auto hidden max-w-6xl px-6 lg:block">
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

      <footer className="bg-[#080A1D]">
        {/* Mobile — compact, premium single-column footer, redesigned to
            fit approximately one mobile viewport instead of two: smaller
            brand logo, a 2x2 Quick Links grid of underlined rows, and
            Contact/Business Info as flat (card-free) sections separated
            only by thin divider lines. One completely uniform #050819
            background throughout — no gradients, glows, dot patterns,
            card fills or shadows anywhere in this block. */}
        <div
          className="lg:hidden"
          style={{
            background: "#050819",
            backgroundImage: "none",
            boxShadow: "none",
            paddingLeft: "22px",
            paddingRight: "22px",
            paddingTop: "36px",
            paddingBottom: "24px",
            boxSizing: "border-box",
            width: "100%",
            maxWidth: "100%",
          }}
        >
          {/* Brand block */}
          <img src={msmLogo} alt="MSM Scrap" loading="lazy" width={1174} height={417} style={{ width: "118px", height: "auto" }} />
          <p style={{ marginTop: "16px", fontSize: "15.5px", lineHeight: 1.45, color: "rgba(235, 237, 244, 0.72)" }}>
            Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, importing and exporting
            metal scrap across the UAE.
          </p>

          {/* Quick Links — 2x2 grid; FOOTER_LINKS' existing order (Home,
              Materials, About, Contact) already lands as Home/About left,
              Materials/Contact right under a plain 2-column row-major
              grid. Unchanged from the prior batch. */}
          <p
            className="uppercase"
            style={{ marginTop: "28px", fontSize: "13px", fontWeight: 700, letterSpacing: "0.22em", color: COPPER }}
          >
            Quick Links
          </p>
          <div className="grid grid-cols-2" style={{ marginTop: "10px", columnGap: "16px" }}>
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="group flex items-center justify-between outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.583_0.135_45.5)]"
                style={{ height: "42px", borderBottom: "1px solid rgba(112, 132, 174, 0.22)" }}
              >
                <span className="text-white/82 transition-colors duration-[180ms] group-hover:text-white group-focus-visible:text-white" style={{ fontSize: "15px" }}>
                  {link.label}
                </span>
                <span
                  aria-hidden="true"
                  className="transition-transform duration-[180ms] group-hover:translate-x-[3px] group-focus-visible:translate-x-[3px]"
                  style={{ color: COPPER, fontSize: "14px" }}
                >
                  →
                </span>
              </a>
            ))}
          </div>

          {/* One divider above Contact Info — the only thing separating
              it from Quick Links now that neither section has its own
              bounding box. Margin above/below (14px) plus the 1px line
              itself totals ~29px, within the requested 26-30px
              between-section gap. */}
          <div style={{ margin: "14px 0", borderTop: "1px solid rgba(145, 155, 180, 0.18)" }} />
          <MobileFooterSection
            title="Contact Info"
            rows={[
              { Icon: Phone, text: "+971 50 849 1233", href: "tel:+971508491233" },
              { Icon: Phone, text: "+971 55 447 7153", href: "tel:+971554477153" },
              { Icon: PhoneCall, text: "+971 6 702 1312", href: "tel:+97167021312" },
              { Icon: Mail, text: EMAIL, href: `mailto:${EMAIL}` },
            ]}
          />

          {/* One divider between Contact Info and Business Info. */}
          <div style={{ margin: "14px 0", borderTop: "1px solid rgba(145, 155, 180, 0.18)" }} />
          <MobileFooterSection
            title="Business Info"
            rows={[
              { Icon: MapPin, text: ADDRESS },
              { Icon: Mailbox, text: "P.O. Box 46303, Sharjah, UAE" },
              { Icon: Clock, text: "7:00 AM – 7:00 PM" },
              { Icon: Truck, text: "UAE-wide pickup" },
            ]}
          />

          {/* Legal — one divider above, then a clean copyright-left /
              licence-right row (no pill, no vertical divider, no card).
              Above 350px it's a single flex row; below 350px it stacks
              left-aligned with a small gap. */}
          <div style={{ margin: "14px 0", borderTop: "1px solid rgba(145, 155, 180, 0.18)" }} />
          <div className="flex flex-col min-[350px]:flex-row min-[350px]:items-center min-[350px]:justify-between" style={{ gap: "7px", columnGap: "14px" }}>
            <p style={{ fontSize: "11px", lineHeight: 1.4, color: "rgba(235, 237, 244, 0.62)" }}>
              © 2026 MSM Scrap. All rights reserved.
            </p>
            <p
              className="uppercase"
              style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: COPPER, whiteSpace: "nowrap" }}
            >
              Trade Licence No. 719219
            </p>
          </div>
        </div>

        <div className="hidden pt-20 pb-12 lg:block">
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
                Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, importing and
                exporting metal scrap across the UAE.
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
        </div>
      </footer>
    </>
  );
}
