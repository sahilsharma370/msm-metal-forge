import type { SVGProps } from "react";

/**
 * Quote wizard material/intent icons — hand-authored inline SVGs, not
 * extracted from the reference mockups and not a new icon-library
 * dependency (matches the existing lucide-react convention: 24x24
 * viewBox, `currentColor` stroke/fill so callers control colour via a
 * text-* className exactly like a lucide icon).
 *
 * Each material gets a genuinely distinct silhouette (stacked ingots vs
 * flat overlapping sheets vs an I-beam profile vs a single bar vs dots) —
 * recolouring one shared shape per material was explicitly ruled out.
 */

type IconProps = SVGProps<SVGSVGElement>;

/** Copper — three stacked ingot bars (two at the base, one bridging on top). Also reused for the Request step's "Sell to Us" card, matching the reference's own reuse of this exact glyph in both places. */
export function StackedIngotsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="13.5" width="7.5" height="4" rx="1" />
      <rect x="13" y="13.5" width="7.5" height="4" rx="1" />
      <rect x="7.2" y="7" width="7.5" height="4" rx="1" />
    </svg>
  );
}

/** Aluminium — thin, wide, overlapping sheets. Deliberately flat and broad rather than chunky/stacked, so it never reads as a recoloured ingot icon. */
export function ThinSheetsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 7.5h13l3.5 3H6.5L3 7.5z" />
      <path d="M4.5 12.5h13l3.5 3H8l-3.5-3z" />
      <path d="M6 17.5h13l1 1.3H7l-1-1.3z" />
    </svg>
  );
}

/** Steel & Iron — an I-beam cross-section: top/bottom flanges plus a connecting web. Unambiguously a structural-metal silhouette. */
export function SteelBeamIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="5.5" y="4" width="13" height="3" rx="0.6" />
      <rect x="5.5" y="17" width="13" height="3" rx="0.6" />
      <rect x="10.5" y="7" width="3" height="10" rx="0.6" />
    </svg>
  );
}

/** Lead — a single dense bar, no stacking, no sheets, no beam profile — the simplest of the five silhouettes, matching lead's own "one heavy block" character. */
export function LeadBarIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 13.5l3-4h10l3 4-3 4H7l-3-4z" />
    </svg>
  );
}

/** Other / Not listed — three plain dots, matching the reference's own "○ ○ ○" placeholder glyph. */
export function MaterialOtherDotsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

/** "Buy from Us" — a simple two-wheeled hand-trolley/dolly carrying a box, distinct from every material icon above. */
export function BuyDollyIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4.5 3v13.5h4" />
      <circle cx="6.3" cy="19.2" r="1.4" />
      <circle cx="15.2" cy="19.2" r="1.4" />
      <rect x="8.5" y="8" width="10" height="8.5" rx="0.8" />
    </svg>
  );
}
