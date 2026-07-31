import { Fragment } from "react";
import { NAV_LINKS } from "@/lib/site";
import { YearsBadge } from "./YearsBadge";

export function Header() {
  return (
    <header
      className="animate-drop-in fixed inset-x-0 top-0 z-40"
      style={{ animationDelay: "1.45s" }}
    >
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
                    className="block rounded-full px-4 py-1 text-[0.95rem] text-foreground/90 transition-colors hover:text-copper"
                  >
                    {link.label}
                  </a>
                </li>
              </Fragment>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 justify-end">
          <a
            href="#contact"
            className="font-display inline-flex items-center rounded-full bg-copper px-7 py-3 text-sm font-bold tracking-[0.1em] whitespace-nowrap text-primary-foreground uppercase shadow-[0_10px_30px_-10px_oklch(0.583_0.135_45.5/0.9)] transition-transform hover:scale-[1.03]"
          >
            Get Quote
          </a>
        </div>
      </div>
    </header>
  );
}