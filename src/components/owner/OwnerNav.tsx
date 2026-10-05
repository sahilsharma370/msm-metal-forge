import { Link } from "@tanstack/react-router";
import { Inbox, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CHECKPOINT C2L-V3 / OWNER DESKTOP REFINEMENT — the owner workspace's one
 * labelled functional navigation area (Overview, Enquiries), rendered once
 * inside OwnerShell's header. "Quick Add" was removed as a peer nav tab —
 * that workflow is reached exclusively through the header's own primary
 * `+ Add enquiry` action now (see OwnerShell.tsx), never duplicated here.
 *
 * CHECKPOINT OWNER ENQUIRIES REFERENCE PASS — two separate `<nav>`
 * landmarks, toggled by breakpoint via `lg:hidden` / `hidden lg:flex`
 * (the same "only one is ever exposed to assistive tech, since the other
 * is a real `display:none`" pattern QuoteProgress.tsx already uses for its
 * own mobile/desktop trigger split), not one element fighting itself with
 * competing responsive overrides:
 *   - Below `lg`: unchanged, byte-identical to before this pass — the
 *     public nav's own glass-panel/glass-ring capsule recipe.
 *   - `lg` and up: the approved reference's restrained treatment — no
 *     capsule background, no glass, no glow. Active state is icon colour +
 *     text weight/colour + a thin copper underline only.
 */

const NAV_LINK_BASE =
  "font-display inline-flex items-center gap-1.5 rounded-full border-b-2 border-transparent px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const NAV_LINK_INACTIVE = "text-foreground/75 hover:bg-white/5 hover:text-foreground";
const NAV_LINK_ACTIVE = "border-copper bg-copper/15 font-semibold text-foreground";

const NAV_LINK_CLASS = cn(NAV_LINK_BASE, NAV_LINK_INACTIVE);
const NAV_LINK_ACTIVE_CLASS = cn(NAV_LINK_BASE, NAV_LINK_ACTIVE);

/**
 * `data-[status=active]:` variants, not `activeProps` — TanStack Router's
 * own `Link` merges `className`/`activeProps.className` by plain string
 * concatenation (`[className, activeProps.className].join(" ")`, see
 * link.js), never re-run through `cn()`/`twMerge`, so a conflicting pair
 * like `border-transparent` (base) + `border-copper` (active) both land in
 * the DOM at once and whichever Tailwind happens to generate later in the
 * stylesheet wins — empirically not the copper one. Router always sets
 * `data-status="active"` on an active link regardless of `activeProps`
 * (see `STATIC_ACTIVE_PROPS` in link.js), so a `data-[status=active]:`
 * selector — strictly higher specificity than the plain unqualified class —
 * deterministically wins instead. One static className, no activeProps.
 */
const DESKTOP_NAV_LINK_CLASS = cn(
  "font-display inline-flex items-center gap-2 border-b-2 border-transparent pb-2 text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#080A1D]",
  "[&_svg]:size-4 [&_svg]:text-foreground/50",
  "data-[status=active]:border-copper data-[status=active]:font-semibold data-[status=active]:text-foreground data-[status=active]:[&_svg]:text-copper",
);

export function OwnerNav() {
  return (
    <>
      <nav aria-label="Owner workspace" className="glass-panel glass-ring flex items-center gap-1 rounded-full p-1 lg:hidden">
        <Link to="/owner/overview" className={NAV_LINK_CLASS} activeProps={{ className: NAV_LINK_ACTIVE_CLASS }}>
          <LayoutDashboard className="size-4" aria-hidden="true" />
          Overview
        </Link>
        <Link to="/owner" activeOptions={{ exact: true }} className={NAV_LINK_CLASS} activeProps={{ className: NAV_LINK_ACTIVE_CLASS }}>
          <Inbox className="size-4" aria-hidden="true" />
          Enquiries
        </Link>
      </nav>

      <nav aria-label="Owner workspace" className="hidden items-center gap-8 lg:flex">
        <Link to="/owner/overview" className={DESKTOP_NAV_LINK_CLASS}>
          <LayoutDashboard aria-hidden="true" />
          Overview
        </Link>
        <Link to="/owner" activeOptions={{ exact: true }} className={DESKTOP_NAV_LINK_CLASS}>
          <Inbox aria-hidden="true" />
          Enquiries
        </Link>
      </nav>
    </>
  );
}
