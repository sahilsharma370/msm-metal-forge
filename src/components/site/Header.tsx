import { NAV_LINKS } from "@/lib/site";
import { YearsBadge } from "./YearsBadge";

export function Header() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-40 animate-drop-in"
      style={{ animationDelay: "1.45s" }}
    >
      <div className="glass-panel glass-ring border-0">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <YearsBadge className="w-32 shrink-0" />

          <nav className="glass-panel glass-ring hidden rounded-full px-2 py-2 md:block">
            <ul className="flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="block rounded-full px-4 py-1.5 text-sm text-foreground/85 transition-colors hover:bg-white/10 hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 justify-end">
            <a
              href="#contact"
              className="font-display inline-flex items-center rounded-full bg-copper px-6 py-2.5 text-xs font-semibold tracking-[0.14em] whitespace-nowrap text-primary-foreground uppercase transition-transform hover:scale-[1.03]"
            >
              Get Quote
            </a>
          </div>
        </div>
      </div>
      <div className="h-px w-full bg-gradient-to-r from-transparent via-copper/50 to-transparent" />
    </header>
  );
}