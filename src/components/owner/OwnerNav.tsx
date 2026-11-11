import { Link, useRouterState } from "@tanstack/react-router";
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
 *   - Below `lg`: the public nav's own glass-panel/glass-ring capsule
 *     recipe. Below `sm` specifically, the capsule's own text labels hide
 *     (icon only) — CHECKPOINT OWNER MOBILE HEADER FIX: at a 390px phone
 *     width this pill's full "Overview"/"Enquiries" text labels alone
 *     (~237px) already consumed nearly the entire header budget, leaving
 *     the header's own right-side actions (Log out, + Add enquiry — see
 *     OwnerShell.tsx) nowhere to render but overlapping the pill itself.
 *     `aria-label` keeps each link's accessible name stable even with the
 *     text hidden, same pattern already used for OwnerShell's icon-only
 *     mobile actions.
 *   - `lg` and up: the approved reference's restrained treatment — no
 *     capsule background, no glass, no glow. Active state is icon colour +
 *     text weight/colour + a thin copper underline only.
 *
 * CHECKPOINT OWNER ENQUIRIES SIX-CIRCLE PASS — active state is computed
 * here directly from the current pathname, not from TanStack Router's own
 * `activeProps`/`data-status` mechanism. `to="/owner"` previously carried
 * `activeOptions={{ exact: true }}`, which only matches the bare `/owner`
 * index route — a lead's detail (`/owner/leads/$leadId`), its edit screen,
 * and Add Enquiry (`/owner/leads/new`) are all separate sibling routes
 * under the same layout, so Enquiries lost its active state the moment an
 * owner opened any of them, even though all three are squarely part of
 * the Enquiries section. `isEnquiriesActive` below covers the bare list
 * AND every `/owner/leads/*` route; `isOverviewActive` stays its own
 * separate, mutually-exclusive check — Overview must never also light up
 * just because both sit under the same `/owner` layout.
 */

const NAV_LINK_BASE =
  "font-display inline-flex items-center gap-1.5 rounded-full border-b-2 border-transparent px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const NAV_LINK_INACTIVE = "text-foreground/75 hover:bg-white/5 hover:text-foreground";
const NAV_LINK_ACTIVE = "border-copper bg-copper/15 font-semibold text-foreground";

const NAV_LINK_CLASS = cn(NAV_LINK_BASE, NAV_LINK_INACTIVE);
const NAV_LINK_ACTIVE_CLASS = cn(NAV_LINK_BASE, NAV_LINK_ACTIVE);

const DESKTOP_NAV_LINK_BASE =
  "font-display inline-flex items-center gap-2 border-b-2 border-transparent pb-2 text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#080A1D] [&_svg]:size-4 [&_svg]:text-foreground/50";
const DESKTOP_NAV_LINK_ACTIVE = "border-copper font-semibold text-foreground [&_svg]:text-copper";

export function OwnerNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isOverviewActive = pathname === "/owner/overview";
  const isEnquiriesActive = pathname === "/owner" || pathname.startsWith("/owner/leads");

  return (
    <>
      <nav aria-label="Owner workspace" className="glass-panel glass-ring flex items-center gap-1 rounded-full p-1 lg:hidden">
        <Link to="/owner/overview" aria-label="Overview" className={isOverviewActive ? NAV_LINK_ACTIVE_CLASS : NAV_LINK_CLASS}>
          <LayoutDashboard className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Overview</span>
        </Link>
        <Link to="/owner" aria-label="Enquiries" className={isEnquiriesActive ? NAV_LINK_ACTIVE_CLASS : NAV_LINK_CLASS}>
          <Inbox className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Enquiries</span>
        </Link>
      </nav>

      <nav aria-label="Owner workspace" className="hidden items-center gap-8 lg:flex">
        <Link to="/owner/overview" className={cn(DESKTOP_NAV_LINK_BASE, isOverviewActive && DESKTOP_NAV_LINK_ACTIVE)}>
          <LayoutDashboard aria-hidden="true" />
          Overview
        </Link>
        <Link to="/owner" className={cn(DESKTOP_NAV_LINK_BASE, isEnquiriesActive && DESKTOP_NAV_LINK_ACTIVE)}>
          <Inbox aria-hidden="true" />
          Enquiries
        </Link>
      </nav>
    </>
  );
}
