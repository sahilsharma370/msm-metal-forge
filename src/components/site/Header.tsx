import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Menu } from "lucide-react";
import { NAV_LINKS, WHATSAPP_URL } from "@/lib/site";
import { WhatsAppIcon } from "./icons";
import { YearsBadge } from "./YearsBadge";
import msmLogo from "@/assets/msm-logo.svg";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

function handleAnchorClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault();
  const target = document.querySelector(href);
  if (!target) return;

  history.pushState(null, "", href);
  target.scrollIntoView({ behavior: "smooth", block: "start" });

  // scrollIntoView has no completion callback — wait roughly as long as the
  // smooth scroll takes, then let Hero's ScrollTrigger resync against the
  // post-jump scroll position instead of being left stuck mid-pin state.
  setTimeout(() => {
    ScrollTrigger.refresh();
  }, 700);
}

/**
 * BATCH 5M-A — the one place that decides how a NAV_LINKS-shaped entry
 * navigates, shared by the desktop pill nav and the mobile drawer so the
 * two presentations can never drift into competing routing behaviour for
 * the same destination. "About" always opens the standalone `/about` route
 * (never an in-page anchor, even on the homepage, which also happens to
 * have its own `#about` teaser section) — unchanged from the original
 * desktop-only implementation this was extracted from.
 */
function SiteNavLink({
  link,
  pathname,
  onHome,
  isActive,
  className,
  activeClassName,
  onNavigate,
  showActiveRail,
}: {
  link: { label: string; href: string };
  pathname: string;
  onHome: boolean;
  isActive: boolean;
  className: string;
  activeClassName: string;
  onNavigate?: () => void;
  showActiveRail?: boolean;
}) {
  const resolvedClassName = isActive ? `${className} ${activeClassName}` : className;
  // BATCH 5M-B2 — mobile-drawer-only active indicator, an absolutely
  // positioned rail rather than a border-color utility swap, so it never
  // depends on Tailwind's class cascade order to win. Never rendered for
  // desktop (showActiveRail is only passed true from the drawer call site).
  const rail =
    isActive && showActiveRail ? (
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1 h-7 w-[3px] -translate-y-1/2 rounded-full bg-copper"
      />
    ) : null;

  if (link.href === "#about") {
    return (
      <Link
        to="/about"
        aria-current={pathname === "/about" ? "page" : undefined}
        className={resolvedClassName}
        onClick={onNavigate}
      >
        {rail}
        {link.label}
      </Link>
    );
  }
  if (onHome) {
    return (
      <a
        href={link.href}
        onClick={(e) => {
          handleAnchorClick(e, link.href);
          onNavigate?.();
        }}
        className={resolvedClassName}
      >
        {rail}
        {link.label}
      </a>
    );
  }
  return (
    <Link to="/" hash={link.href.slice(1)} className={resolvedClassName} onClick={onNavigate}>
      {rail}
      {link.label}
    </Link>
  );
}

/**
 * BATCH 5M-A — the mobile drawer's own link list: the same NAV_LINKS
 * destinations plus one extra "Materials" entry pointing at the homepage's
 * existing `#materials` section (Materials.tsx — that section was never
 * removed, only the old top-nav label was repointed to `#services`
 * elsewhere). Deliberately not folded into NAV_LINKS itself, since that
 * array also drives the desktop pill nav, which must keep showing exactly
 * its current four destinations, unchanged.
 */
const MOBILE_DRAWER_LINKS = [
  NAV_LINKS[0]!,
  NAV_LINKS[1]!,
  { label: "Materials", href: "#materials" },
  NAV_LINKS[2]!,
  NAV_LINKS[3]!,
];

const MOBILE_SCROLL_SPY_IDS = ["home", "services", "materials", "contact"];

export function Header() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const onHome = pathname === "/";
  const onAbout = pathname === "/about";

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Skip trigger focus restoration after pointer closes; preserve it for keyboard navigation.
  const drawerInputModalityRef = useRef<"pointer" | "keyboard">("keyboard");
  const [showCompactQuote, setShowCompactQuote] = useState(false);
  const [activeSectionHash, setActiveSectionHash] = useState<string | null>(null);

  // BATCH 5M-A — the mobile bar's compact "Quote" action only appears once
  // the homepage hero's own primary CTA (id="hero-cta-mobile", set in
  // Hero.tsx's mobile composition) has scrolled out of view; on any route
  // that never has that element (e.g. /about) there is nothing to wait
  // for, so it shows immediately. Entirely client-side (useEffect only,
  // never reads window/document during render) and never used to decide
  // LAYOUT — the mobile bar itself is already fully responsive via CSS
  // breakpoints; this only toggles one small action's visibility on top of
  // markup that exists unconditionally.
  useEffect(() => {
    const heroCta = document.getElementById("hero-cta-mobile");
    if (!heroCta) {
      setShowCompactQuote(true);
      return;
    }
    setShowCompactQuote(false);
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setShowCompactQuote(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(heroCta);
    return () => observer.disconnect();
  }, [pathname]);

  // BATCH 5M-A — best-effort active-section highlight for the mobile
  // drawer, homepage only. A real IntersectionObserver over the same
  // section ids NAV_LINKS/MOBILE_DRAWER_LINKS already point at — not a
  // scroll-position calculation. "About" is deliberately excluded (see
  // SiteNavLink's own comment): it is always a route link, never an
  // in-page section, so it is never part of this scroll-spy.
  useEffect(() => {
    if (!onHome) {
      setActiveSectionHash(null);
      return;
    }
    const sections = MOBILE_SCROLL_SPY_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => !!el,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const mostVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (mostVisible) setActiveSectionHash(`#${mostVisible.target.id}`);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onHome]);

  return (
    <>
      {/* Desktop header — CHECKPOINT/BATCH 5M-A DESKTOP LOCK: unchanged
          content and classes from before this batch, now wrapped in
          `hidden lg:block` (visually identical to the previous
          unconditional render at every width >= lg, the only width this
          must still match exactly) so it no longer shows on mobile/tablet,
          which get the separate bar+drawer below instead. */}
      <header className="fixed inset-x-0 top-0 z-40 hidden lg:block">
        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
          {onAbout ? (
            // The 14+/Years-of-Trust tile is intentionally removed on /about
            // (no verified years-in-business claim on that page) — this stays
            // a plain invisible spacer, matching the badge's own width, purely
            // so the centred nav/CTA balance is unaffected.
            <div className="w-32 shrink-0" aria-hidden="true" />
          ) : (
            <YearsBadge className="w-32 shrink-0" />
          )}

          {/* Restrained deep-navy glass, applied the same way on every route:
              the shared glass-panel/glass-ring tokens are tuned lighter and
              read as pale/muddy over a photographic hero or the copper final
              CTA. Static per-render values only — no scroll listener, no
              IntersectionObserver, no section-specific state. */}
          <nav
            className="rounded-full px-6 py-2.5"
            style={{
              backgroundColor: "oklch(0.16 0.045 265 / 0.85)",
              backdropFilter: "blur(17px) saturate(140%)",
              WebkitBackdropFilter: "blur(17px) saturate(140%)",
              border: "1px solid rgba(237, 232, 208, 0.14)",
              boxShadow: "0 8px 24px -12px rgba(0, 0, 0, 0.55)",
            }}
          >
            <ul className="flex items-center">
              {NAV_LINKS.map((link, i) => (
                <Fragment key={link.label}>
                  {i > 0 && (
                    <li aria-hidden="true" className="px-1 text-foreground/35 select-none">
                      ·
                    </li>
                  )}
                  <li>
                    <SiteNavLink
                      link={link}
                      pathname={pathname}
                      onHome={onHome}
                      isActive={link.href === "#about" && onAbout}
                      className="block rounded-full px-4 py-1 text-[0.95rem] font-semibold text-foreground transition-colors hover:text-[oklch(0.62_0.13_50)]"
                      activeClassName="text-[oklch(0.62_0.13_50)]"
                    />
                  </li>
                </Fragment>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 justify-end">
            <Link
              to="/"
              search={{ quote: true, source: "header" }}
              mask={{ to: "/quote", search: { source: "header" } }}
              // CHECKPOINT C2L (inner-text hover restore) — the copper
              // surface itself (gradient/shadow) never changes on hover or
              // focus, only scales slightly. The beige hover treatment lives
              // on the inner label span via group-hover/group-focus-visible,
              // never on the outer card, so it can never render as an outer
              // glow/halo/sheen. No outline-none — the browser's native focus
              // ring stays as the outer focus indicator; the beige inner text
              // is layered on top of that, not a replacement for it.
              className="group font-display inline-flex items-center rounded-full bg-[image:var(--gradient-copper-cta)] px-7 py-3 shadow-[0_4px_10px_-4px_oklch(0.46_0.11_42/0.45)] transition-transform motion-safe:hover:scale-[1.03] motion-safe:focus-visible:scale-[1.03]"
            >
              <span className="text-sm font-bold tracking-[0.1em] whitespace-nowrap text-[#080A1D] uppercase transition-colors group-hover:text-[#EDE8D0] group-hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] group-focus-visible:text-[#EDE8D0] group-focus-visible:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]">
                Get a Quote
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* BATCH 5M-A — mobile/tablet header, below lg only. Slim sticky bar:
          small logo left, hamburger right, safe-area-aware. No large
          trust badge and no permanent Get-a-Quote pill here — trust proof
          now lives inside the mobile hero itself, and the compact "Quote"
          action only appears once the hero's own primary CTA has scrolled
          away (see the IntersectionObserver above). */}
      <header
        className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-[#080A1D]/92 backdrop-blur-md lg:hidden"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-[72px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="MSM Scrap — Home" className="flex shrink-0 items-center">
            <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-auto w-24" />
          </Link>

          <div className="flex items-center gap-2">
            {/* Reserved slot, always in the layout — only opacity/pointer-events
                toggle, so this appearing never shifts the hamburger next to it. */}
            <div
              className={`transition-opacity duration-200 ${showCompactQuote ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={!showCompactQuote}
            >
              <Link
                to="/"
                search={{ quote: true, source: "header" }}
                mask={{ to: "/quote", search: { source: "header" } }}
                tabIndex={showCompactQuote ? 0 : -1}
                className="font-display inline-flex h-9 items-center rounded-full bg-[image:var(--gradient-copper-cta)] px-4 text-xs font-bold tracking-[0.08em] text-[#080A1D] uppercase"
              >
                Quote
              </Link>
            </div>

            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  aria-expanded={drawerOpen}
                  aria-controls="mobile-nav-drawer"
                  onPointerDown={() => {
                    drawerInputModalityRef.current = "pointer";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") drawerInputModalityRef.current = "keyboard";
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-foreground/85 transition-colors hover:bg-copper/10 active:bg-copper/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
                >
                  <Menu className="size-[26px]" aria-hidden="true" />
                </button>
              </SheetTrigger>
              <SheetContent
                id="mobile-nav-drawer"
                side="right"
                onPointerDownCapture={() => {
                  drawerInputModalityRef.current = "pointer";
                }}
                onPointerDownOutside={() => {
                  drawerInputModalityRef.current = "pointer";
                }}
                onEscapeKeyDown={() => {
                  drawerInputModalityRef.current = "keyboard";
                }}
                onKeyDownCapture={() => {
                  drawerInputModalityRef.current = "keyboard";
                }}
                onCloseAutoFocus={(e) => {
                  if (drawerInputModalityRef.current === "pointer") e.preventDefault();
                }}
                className="flex w-[min(88vw,360px)] flex-col gap-0 border-l border-copper/25 bg-[#080A1D] p-0 text-foreground motion-reduce:transition-none data-[state=open]:duration-300 data-[state=closed]:duration-300 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:text-foreground/65 [&>button]:transition-colors [&>button]:hover:bg-copper/10 [&>button]:hover:text-foreground [&>button]:active:bg-copper/15 [&>button]:data-[state=open]:bg-transparent [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-copper [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0 [&>button>svg]:size-6"
                style={{
                  backgroundImage:
                    "radial-gradient(420px 320px at 100% 0%, oklch(0.583 0.135 45.5 / 0.05) 0%, transparent 70%)",
                }}
              >
                <SheetTitle className="sr-only">Site navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  MSM Scrap site navigation and quick actions
                </SheetDescription>

                <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
                  <div className="flex h-[72px] items-center border-b border-white/10 px-5">
                    <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-auto w-24" />
                  </div>
                </div>

                <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-3 pt-6 pb-4">
                  <p className="text-copper mb-2 px-4 text-[10px] font-bold tracking-[0.2em] uppercase">
                    Navigation
                  </p>
                  <ul className="flex flex-col gap-2">
                    {MOBILE_DRAWER_LINKS.map((link) => {
                      const isActive =
                        link.href === "#about" ? onAbout : onHome && activeSectionHash === link.href;
                      return (
                        <li key={link.label}>
                          <SiteNavLink
                            link={link}
                            pathname={pathname}
                            onHome={onHome}
                            isActive={isActive}
                            onNavigate={() => setDrawerOpen(false)}
                            showActiveRail
                            className="font-display relative flex min-h-[54px] items-center rounded-r-lg px-4 text-lg font-semibold text-foreground/75 transition-colors hover:bg-white/5 hover:text-foreground"
                            activeClassName="translate-x-[5px] bg-[oklch(0.583_0.135_45.5/0.06)] text-foreground"
                          />
                        </li>
                      );
                    })}
                  </ul>
                </nav>

                <div
                  className="flex flex-col gap-3 border-t border-white/10 px-5 py-5"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
                >
                  <Link
                    to="/"
                    search={{ quote: true, source: "header" }}
                    mask={{ to: "/quote", search: { source: "header" } }}
                    onClick={() => setDrawerOpen(false)}
                    className="font-display flex min-h-[56px] items-center justify-center rounded-full bg-[image:var(--gradient-copper-cta)] text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase"
                  >
                    Get a Quote
                  </Link>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setDrawerOpen(false)}
                    className="font-display flex min-h-[56px] items-center justify-center gap-2 rounded-full border border-foreground/25 text-sm font-semibold tracking-[0.08em] text-foreground/90 uppercase transition-colors hover:border-[#25D366]/70 hover:text-[#25D366]"
                  >
                    <WhatsAppIcon />
                    Chat on WhatsApp
                  </a>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  );
}
