import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
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
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
        <YearsBadge className="w-32 shrink-0" />

        <nav className="glass-panel glass-ring hidden rounded-full px-6 py-2.5 md:block">
          <ul className="flex items-center">
            {NAV_LINKS.map((link, i) => (
              <Fragment key={link.label}>
                {i > 0 && (
                  <li aria-hidden="true" className="px-1 text-foreground/35 select-none">
                    ·
                  </li>
                )}
                <li>
                  <a
                    href={link.href}
                    onClick={(e) => handleAnchorClick(e, link.href)}
                    className="block rounded-full px-4 py-1 text-[0.95rem] font-semibold text-foreground transition-colors hover:text-[oklch(0.62_0.13_50)]"
                  >
                    {link.label}
                  </a>
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
            className="font-display inline-flex items-center rounded-full bg-[image:var(--gradient-copper)] px-7 py-3 text-sm font-bold tracking-[0.1em] whitespace-nowrap text-[#080A1D] uppercase shadow-[0_10px_30px_-10px_oklch(0.583_0.135_45.5/0.9)] transition-transform hover:scale-[1.03] hover:text-[#EDE8D0] hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]"
          >
            Get Quote
          </Link>
        </div>
      </div>
    </header>
  );
}
