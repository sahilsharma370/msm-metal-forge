import { Fragment } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { NAV_LINKS } from "@/lib/site";
import { YearsBadge } from "./YearsBadge";

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

export function Header() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const onHome = pathname === "/";
  const onAbout = pathname === "/about";

  return (
    <header className="fixed inset-x-0 top-0 z-40">
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
          className="hidden rounded-full px-6 py-2.5 md:block"
          style={{
            backgroundColor: "oklch(0.16 0.045 265 / 0.85)",
            backdropFilter: "blur(17px) saturate(140%)",
            WebkitBackdropFilter: "blur(17px) saturate(140%)",
            border: "1px solid rgba(237, 232, 208, 0.14)",
            boxShadow: "0 8px 24px -12px rgba(0, 0, 0, 0.55)",
          }}
        >
          <ul className="flex items-center">
            {NAV_LINKS.map((link, i) => {
              const linkClassName =
                "block rounded-full px-4 py-1 text-[0.95rem] font-semibold transition-colors hover:text-[oklch(0.62_0.13_50)]";

              // "About" always opens the standalone page. The others stay
              // same-page anchor scrolls while already on "/" (unchanged
              // behaviour); off "/" (e.g. from /about) they become a real
              // navigation back to "/" with a `hash`, which the router's
              // own scroll-restoration already resolves by scrolling the
              // matching element into view once the homepage mounts — no
              // extra scroll code needed here.
              let content: React.ReactNode;
              if (link.href === "#about") {
                const active = pathname === "/about";
                content = (
                  <Link
                    to="/about"
                    aria-current={active ? "page" : undefined}
                    className={`${linkClassName} ${active ? "text-[oklch(0.62_0.13_50)]" : "text-foreground"}`}
                  >
                    {link.label}
                  </Link>
                );
              } else if (onHome) {
                content = (
                  <a
                    href={link.href}
                    onClick={(e) => handleAnchorClick(e, link.href)}
                    className={`${linkClassName} text-foreground`}
                  >
                    {link.label}
                  </a>
                );
              } else {
                content = (
                  <Link
                    to="/"
                    hash={link.href.slice(1)}
                    className={`${linkClassName} text-foreground`}
                  >
                    {link.label}
                  </Link>
                );
              }

              return (
                <Fragment key={link.label}>
                  {i > 0 && (
                    <li aria-hidden="true" className="px-1 text-foreground/35 select-none">
                      ·
                    </li>
                  )}
                  <li>{content}</li>
                </Fragment>
              );
            })}
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
  );
}
