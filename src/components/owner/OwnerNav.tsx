import { Link } from "@tanstack/react-router";
import { Inbox, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * CHECKPOINT C2L-V3 / OWNER DESKTOP REFINEMENT — the owner workspace's one
 * labelled functional navigation area (Overview, Enquiries), rendered once
 * inside OwnerShell's header. "Quick Add" was removed as a peer nav tab —
 * that workflow is reached exclusively through the header's own primary
 * `+ Add enquiry` action now (see OwnerShell.tsx), never duplicated here.
 * The capsule keeps the PUBLIC nav's own exact glass recipe (`glass-panel
 * glass-ring`, Header.tsx/styles.css) — the one place this batch's "glass
 * only where it meaningfully communicates stationary navigation chrome"
 * rule keeps it, rather than a flat navy-soft fill.
 *
 * Contrast (computed against the reported rendered nav background,
 * ~#1A1F34, per WCAG relative-luminance formula):
 *   - inactive `text-foreground/75` ≈ 12:1 (target ≥4.5:1)
 *   - active `text-foreground` (full opacity) ≈ 15.6:1 (target ≥7:1)
 * Both classes are set explicitly on every link (never inherited from a
 * `text-muted-foreground` ancestor, which would silently undercut this).
 *
 * Active state is never colour-alone: full text contrast + font-weight + a
 * solid copper underline + a solid (not glossy-translucent) copper-tinted
 * fill together — `bg-copper/15`, not the previous `bg-white/8` generic
 * wash, so the selected tab reads unambiguously at a glance instead of
 * blending into the glass capsule around it.
 */

const NAV_LINK_BASE =
  "font-display inline-flex items-center gap-1.5 rounded-full border-b-2 border-transparent px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const NAV_LINK_INACTIVE = "text-foreground/75 hover:bg-white/5 hover:text-foreground";
const NAV_LINK_ACTIVE = "border-copper bg-copper/15 font-semibold text-foreground";

const NAV_LINK_CLASS = cn(NAV_LINK_BASE, NAV_LINK_INACTIVE);
const NAV_LINK_ACTIVE_CLASS = cn(NAV_LINK_BASE, NAV_LINK_ACTIVE);

export function OwnerNav() {
  return (
    <nav aria-label="Owner workspace" className="glass-panel glass-ring flex items-center gap-1 rounded-full p-1">
      <Link to="/owner/overview" className={NAV_LINK_CLASS} activeProps={{ className: NAV_LINK_ACTIVE_CLASS }}>
        <LayoutDashboard className="size-4" aria-hidden="true" />
        Overview
      </Link>
      <Link to="/owner" activeOptions={{ exact: true }} className={NAV_LINK_CLASS} activeProps={{ className: NAV_LINK_ACTIVE_CLASS }}>
        <Inbox className="size-4" aria-hidden="true" />
        Enquiries
      </Link>
    </nav>
  );
}
