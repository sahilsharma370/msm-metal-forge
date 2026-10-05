import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Menu } from "lucide-react";
import { NAV_LINKS, WHATSAPP_URL } from "@/lib/site";
import { WhatsAppIcon } from "./icons";
import { YearsBadge } from "./YearsBadge";
import msmLogo from "@/assets/msm-logo.svg";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// MEASURED ROOT CAUSE (desktop fresh-load "first few trackpad scrolls do
// nothing" bug): useMobileHeaderFold below was called unconditionally, with
// no viewport check of its own — on every breakpoint, including desktop, it
// locks `document.documentElement`/`body` to `overflow: hidden` at mount
// (see its own `setLock`) and only releases that lock once a qualifying
// wheel/touch gesture completes its ~1100ms fold-away animation. The folding
// bar itself IS already correctly mobile-only (its own `<header>` below
// carries `lg:hidden`), but the hook driving it had no matching gate, so
// desktop visitors inherited a scroll lock for a header that was never even
// rendered for them — any scroll input in that window is not "snapped back"
// or "consumed", it is physically prevented by CSS, exactly matching a live
// diagnostic capture of `scrollY` staying 0 across repeated wheel events
// with `overflow-y: hidden` on both elements from mount. A lazy `useState`
// initializer (not a plain `useState(false)` corrected only after an
// effect, unlike useReducedMotion above) is deliberate here: this value
// gates a *lock*, so it must already be correct on the very first
// client-side layout-effect pass — defaulting to `false` and correcting a
// render later would mean a genuine mobile load briefly skips the fold's
// own intentional lock on its first frame, a real (if small) mobile
// regression this fix must not introduce while removing the desktop one.
function useIsNarrowViewport() {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 1023.98px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    setIsNarrow(mq.matches);
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isNarrow;
}

// How far the rotation goes at full fold (90deg = perfectly edge-on, hidden
// outright with `backfaceVisibility: hidden` rather than showing a mirrored
// back face).
const FOLD_MAX_DEG = 90;
// A full 0->1 (or 1->0) fold takes this long; a reversal partway through
// takes proportionally less, at the same angular velocity (see `animateTo`).
const FOLD_DURATION_MS = 1100;
// Wheel/touch movement below this (px) is noise, not an intentional gesture.
const GESTURE_THRESHOLD = 6;
// "Actual scrollY ~ 0" — a couple of px of tolerance for Safari's overscroll
// bounce and sub-pixel scroll-restoration rounding.
const TOP_TOLERANCE = 4;
// Reduced-motion's own immediate hide/show still needs a *hysteresis* pair
// (not one boundary), or a finger-jitter right at the edge would flip
// visibility back and forth with no transition to hide the flicker.
const REDUCED_MOTION_HIDE_AT = 8;
const REDUCED_MOTION_REVEAL_AT = 2;

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

type FoldPhase = "idle-open" | "animating" | "idle-hidden";

/**
 * BATCH 5V — the navbar fold is gesture-triggered and time-based, not
 * scroll-scrubbed and never scroll-position-automatic: at the top, the
 * first intentional downward wheel/touch gesture starts one ~1100ms eased
 * fold from 0 (open) to 1 (hidden); the reverse (1 -> 0) only ever starts
 * from an intentional *upward* gesture received while `phase` is already
 * `"idle-hidden"` AND `scrollY <= TOP_TOLERANCE` — i.e. only once the user
 * is genuinely back at the top AND does something about it. Merely
 * arriving at the top (by any means — reverse scrolling, a bounce, a
 * programmatic jump) never unfolds it by itself, and an upward gesture
 * anywhere else in the page (mid-Hero, Trust, Services, ...) is a no-op —
 * there is deliberately no scroll listener or Hero-intersection check
 * here, just the same gesture listeners already driving the fold-away,
 * read against the live `window.scrollY` at the moment of the gesture.
 * Neither direction is driven by scroll position while it plays — `angle`
 * is advanced purely by elapsed time via `requestAnimationFrame`, which is
 * what makes the duration constant regardless of how fast or far the
 * triggering gesture was.
 *
 * The scroll gate: while `phase` is `"idle-open"` (waiting at the top for a
 * gesture) or `"animating"`, `document.documentElement`/`body` get
 * `overflow: hidden` — the *only* lock in this file, and it is what actually
 * keeps the hero motionless (native `overflow: hidden` halts even iOS
 * momentum scrolling, which `preventDefault` on later touch events can't
 * reliably do once a finger has lifted). The lock is released the instant
 * `phase` becomes `"idle-hidden"`, so normal native scrolling resumes with
 * whatever momentum the browser already had queued — nothing was ever
 * prevented mid-gesture, so there is no pent-up delta to release as a jump.
 * `freeze` (drawer open, or focus inside the header) only gates *new*
 * gesture/scroll triggers — it never touches `animRef`, so an animation
 * already in flight when the drawer opens simply keeps playing via its own
 * rAF loop, independent of this effect's listener teardown/rebuild.
 *
 * Wheel and touch listeners are attached once, for the component's whole
 * lifetime, and read intent passively (no `preventDefault` — the CSS lock
 * already makes the scroll physically impossible, so there's nothing to
 * prevent): the same handler drives both the initial trigger *and* a
 * same-animation reversal if the user changes direction mid-fold, by
 * comparing the intent's direction against `animRef.current.to` rather than
 * starting a second, competing `animateTo` call.
 *
 * `reducedMotion` bypasses all of the above for a plain, instant 0/1
 * hysteresis snap on scroll position alone — no gesture wait, no lock, no
 * animation. `!isNarrow` (see `useIsNarrowViewport` above) does the same for
 * every effect below that could lock scroll — this hook's own consumer
 * (BATCH 5M-A's `lg:hidden` folding `<header>`) is already mobile-only, so
 * this is the breakpoint gate that was missing, not a new one invented here.
 */
export function useMobileHeaderFold(freeze: boolean, reducedMotion: boolean, pathname: string) {
  const isNarrow = useIsNarrowViewport();
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  const phaseRef = useRef<FoldPhase>("idle-open");
  const rafRef = useRef<number | null>(null);
  const animRef = useRef<{ start: number; from: number; to: number; duration: number } | null>(null);
  const lockedRef = useRef(false);
  const reducedHiddenRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const freezeRef = useRef(freeze);
  freezeRef.current = freeze;

  const setAngleBoth = (a: number) => {
    angleRef.current = a;
    setAngle(a);
  };

  const setLock = (locked: boolean) => {
    if (lockedRef.current === locked) return;
    lockedRef.current = locked;
    document.documentElement.style.overflow = locked ? "hidden" : "";
    document.body.style.overflow = locked ? "hidden" : "";
  };

  const syncLockForPhase = () => {
    setLock(!freezeRef.current && phaseRef.current !== "idle-hidden");
  };

  const animateTo = (target: 0 | 1) => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const from = angleRef.current;
    if (from === target) {
      phaseRef.current = target === 1 ? "idle-hidden" : "idle-open";
      syncLockForPhase();
      return;
    }
    animRef.current = { start: performance.now(), from, to: target, duration: FOLD_DURATION_MS * Math.abs(target - from) };
    phaseRef.current = "animating";
    syncLockForPhase();

    const tick = (now: number) => {
      const anim = animRef.current;
      if (!anim) return;
      const t = Math.min(1, (now - anim.start) / anim.duration);
      setAngleBoth(anim.from + (anim.to - anim.from) * easeInOutCubic(t));
      if (t >= 1) {
        rafRef.current = null;
        animRef.current = null;
        phaseRef.current = anim.to === 1 ? "idle-hidden" : "idle-open";
        syncLockForPhase();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Sync on mount and on every route change — a refresh mid-page or a
  // client-side navigation renders the correct phase/angle immediately
  // instead of assuming "idle-open" and flashing the fold on the next tick.
  useLayoutEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    animRef.current = null;
    if (reducedMotion || !isNarrow) {
      // Desktop (or reduced motion): this hook's only consumer is the
      // `lg:hidden` folding bar, so there is nothing to wait at the top
      // for — release any lock unconditionally rather than just bailing,
      // in case a resize crossed the breakpoint while already locked.
      phaseRef.current = "idle-open";
      setAngleBoth(0);
      setLock(false);
      return;
    }
    const hidden = window.scrollY > TOP_TOLERANCE;
    phaseRef.current = hidden ? "idle-hidden" : "idle-open";
    setAngleBoth(hidden ? 1 : 0);
    syncLockForPhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, reducedMotion, isNarrow]);

  useEffect(() => {
    if (reducedMotion || !isNarrow) return;

    const onDirectionalIntent = (direction: "down" | "up") => {
      if (freezeRef.current) return;
      const phase = phaseRef.current;
      if (phase === "idle-open" && direction === "down") {
        animateTo(1);
      } else if (phase === "idle-hidden" && direction === "up" && window.scrollY <= TOP_TOLERANCE) {
        // State-machine correction — reaching the absolute top (by any
        // means — reverse scrolling, a bounce, anything) must NOT unfold
        // the line by itself; it only unfolds on the next deliberate
        // upward gesture, and only while genuinely still at the top (not
        // merely "once was folded" — an upward gesture anywhere else in
        // the page, including right after leaving the top, must do
        // nothing, which is exactly what omitting this branch there
        // already achieves).
        animateTo(0);
      } else if (phase === "animating") {
        const anim = animRef.current;
        if (!anim) return;
        if (anim.to === 1 && direction === "up") animateTo(0);
        else if (anim.to === 0 && direction === "down") animateTo(1);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < GESTURE_THRESHOLD) return;
      onDirectionalIntent(e.deltaY > 0 ? "down" : "up");
    };
    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const startY = touchStartYRef.current;
      const y = e.touches[0]?.clientY;
      if (startY == null || y == null) return;
      const dy = startY - y; // finger moving up (dy > 0) == content scrolling down
      if (Math.abs(dy) < GESTURE_THRESHOLD) return;
      touchStartYRef.current = y;
      onDirectionalIntent(dy > 0 ? "down" : "up");
    };
    const onTouchEnd = () => {
      touchStartYRef.current = null;
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, isNarrow]);

  // Re-evaluate the lock whenever `freeze` itself changes (e.g. the drawer
  // closes while we're still sitting at the top) — new-trigger gating is
  // already handled via `freezeRef` above; this only keeps the CSS lock
  // itself correctly in sync with the latest freeze state.
  useEffect(() => {
    if (reducedMotion || !isNarrow) return;
    syncLockForPhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze, reducedMotion, isNarrow]);

  // Reduced motion: plain instant hysteresis snap, no gesture wait, no lock.
  useEffect(() => {
    if (!reducedMotion) return;
    setLock(false);

    const update = () => {
      if (freezeRef.current) return;
      const y = window.scrollY;
      reducedHiddenRef.current = reducedHiddenRef.current
        ? y > REDUCED_MOTION_REVEAL_AT
        : y > REDUCED_MOTION_HIDE_AT;
      setAngleBoth(reducedHiddenRef.current ? 1 : 0);
    };
    update();

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [reducedMotion, pathname]);

  // Unmount safety net: never leave the page scroll-locked behind us.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  return angle;
}

/**
 * BATCH 5P — the mobile header's hamburger button. Not a Radix
 * `SheetTrigger` since `Sheet` is already driven by the `open`/
 * `onOpenChange` props below — a plain click handler is equivalent.
 */
function MobileMenuTrigger({
  drawerOpen,
  onOpen,
  drawerInputModalityRef,
}: {
  drawerOpen: boolean;
  onOpen: () => void;
  drawerInputModalityRef: React.RefObject<"pointer" | "keyboard">;
}) {
  return (
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
      onClick={onOpen}
      className="flex h-11 w-11 items-center justify-center rounded-full text-foreground/85 transition-colors hover:bg-copper/10 active:bg-copper/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
    >
      <Menu className="size-[26px]" aria-hidden="true" />
    </button>
  );
}

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
  const [activeSectionHash, setActiveSectionHash] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  // Keyboard focus landing inside the mobile header (logo link or hamburger)
  // freezes its scroll mode too, same as the drawer being open — otherwise a
  // scroll-driven hide could slide the header away from underneath a
  // focused control.
  const [mobileHeaderFocused, setMobileHeaderFocused] = useState(false);
  const mobileHeaderFold = useMobileHeaderFold(
    drawerOpen || mobileHeaderFocused,
    reducedMotion,
    pathname,
  );
  // MEASURED ROOT CAUSE of the motion-order regression (full header visibly
  // slid up and clipped before it flipped): making the whole header
  // `position: absolute` unconditionally put it in Hero's SCROLLING
  // coordinate space for the "idle-open"/"animating" phases too, not just
  // the settled "idle-hidden" one — those phases are meant to stay
  // viewport-stationary (that's the entire point of the CSS scroll lock
  // `syncLockForPhase` applies throughout them: `position: fixed` is
  // immune to scroll/rubber-band by definition, `absolute` is not, so even
  // the sub-pixel overscroll a locked `overflow: hidden` doesn't fully
  // suppress on a real touch device was enough to visibly shift it).
  // `angle` reaches exactly `1` (verified: `easeInOutCubic(1) === 1`, and
  // the mount-sync/reduced-motion paths also set it to exactly 1 or 0, never
  // a fraction) only once `phase` has actually settled at `"idle-hidden"` —
  // mid-fold it's always strictly between 0 and 1. So this is the same
  // state `phaseRef` already tracks internally, read back out through
  // existing render-driving state instead of exposing a second value from
  // the hook. The two position modes meet only at that exact instant, and
  // only there: entering "idle-hidden" is also exactly when
  // `syncLockForPhase` releases the scroll lock, so scrollY is still ~0 at
  // the handoff (fixed-at-viewport-top and absolute-at-document-top
  // coincide) — the switch is a no-op visually, not a jump, and the
  // settled edge only starts actually moving once the user's own
  // now-unlocked scroll carries it, exactly as required. Reverse is the
  // same coincidence at the opposite edge: the upward-gesture-at-top
  // branch in `onDirectionalIntent` only ever calls `animateTo(0)` when
  // `scrollY <= TOP_TOLERANCE` is already true, so switching back to
  // `fixed` right as `phase` leaves `"idle-hidden"` happens at (within a
  // few px of) the same position too.
  const mobileHeaderUseAbsolute = mobileHeaderFold >= 1;

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
          small logo left, hamburger right, safe-area-aware. No large trust
          badge and no Get-a-Quote pill here — trust proof lives inside the
          mobile hero itself, and Get a Quote lives inside the drawer.
          BATCH 5N — the header is now permanently logo + hamburger only:
          the scroll-triggered compact "Quote" pill (and its
          IntersectionObserver on Hero's `#hero-cta-mobile`) was removed —
          it caused a width/position shift in this fixed header as the
          user scrolled.
          BATCH 5T — a restrained 3D fold instead of a translateY slide: the
          bar rotates around its own TOP edge (`transformOrigin: "top"`,
          `rotateX` on a group that a `perspective`-carrying parent renders),
          driven by `mobileHeaderFold` (see `useMobileHeaderFold` above,
          BATCH 5V) with no CSS transition of its own — the hook advances
          this angle itself via `requestAnimationFrame` on a fixed ~1100ms
          timer, so this render layer just paints whatever angle it's handed
          each frame; it doesn't know or care whether that angle came from a
          gesture-triggered animation or (in the reduced-motion path) an
          instant snap. `rotateX` is POSITIVE here — in CSS's own 3D space (X
          right, Y down, Z *toward the viewer*, per the transforms spec), a positive
          angle moves a point below the origin (our hinge is at the top, so
          the whole bar is "below" it) toward positive Z, i.e. toward the
          viewer. That's what makes the bottom edge swing forward, over the
          hero, instead of receding into it. `backfaceVisibility: hidden` on
          the front face keeps it from ever flashing a mirrored back once
          past 90deg (rotation is capped there — edge-on, invisible).
          The bottom face below is a *real* second plane, not a flat
          decorative strip: `transformStyle: "preserve-3d"` on this rotating
          group is what lets it carry its own independent local rotateX
          (-90deg, folded flat against the group's own rotation at rest) so
          the two faces compose into one rigid right-angle shape that the
          group's rotation then moves as a whole — the same technique used
          to build any flat-div "cube"/"box" in CSS. Box-shadow still grows
          with the same progress (cast onto the hero as it lifts), toned
          down from the previous pass so it never reads as oversized.
          Rotation alone leaves a residual strip at 100% fold: the bottom
          face's own -90deg local hinge means the group's rotation carries
          it to face the viewer head-on exactly when the front face goes
          edge-on, so it (and its shadow) stays on screen as a thin, flat
          horizontal edge — intentional: folded state is this line, not
          nothing, and a reverse gesture flips the full bar back up from
          exactly this edge since it's the same rotating group, just
          continuing its own rotateX in reverse.
          Two real, sequential bugs sit behind `mobileHeaderUseAbsolute`
          (computed above, next to the hook call) — see its own comment for
          the full reasoning. Summary: this `<header>`'s `position` now
          switches between `fixed` (viewport-stationary — `"idle-open"` and
          `"animating"`, i.e. whenever the lock in `syncLockForPhase` is
          engaged) and `absolute` (Hero's own document coordinate space —
          only once settled at `"idle-hidden"`, where `top: 0` lands on
          Hero's own top since this `<header>` has no positioned ancestor
          between it and `<body>`). `fixed` throughout the open/animating
          phases is what keeps the full bar genuinely motionless while it
          flips, immune to the sub-pixel scroll/rubber-band a touch-held
          `overflow: hidden` lock doesn't always fully suppress on a real
          device; `absolute` only once settled is what lets the folded edge
          actually scroll away with Hero afterward, instead of staying
          viewport-pinned or needing an opacity toggle to hide that. The
          outer shell is `pointer-events-none`
          so its box (still occupying 56px + safe-area of header space even
          while the bar inside it is folded away) never blocks taps on the
          content underneath; the bar itself drops `pointer-events`/goes
          `inert` once fully folded (`mobileHeaderFold === 1`), so nothing
          folded away can be tabbed to or tapped. */}
      <header
        className="pointer-events-none inset-x-0 top-0 z-40 lg:hidden"
        style={{
          perspective: "900px",
          // `perspectiveOrigin` defaults to the element's own centre, not
          // its top edge — misaligned with the rotating group's own
          // `transformOrigin: "top center"` hinge below. That mismatch
          // over-foreshortens the bar as it rotates away from the hinge,
          // reading as a brief extra pinch/compression mid-flip beyond the
          // fold's own intended thinning. Aligning the two keeps the
          // rotation a true hinge (viewed edge-on from the hinge itself),
          // so the visible height tracks the fold angle smoothly instead
          // of dipping further.
          perspectiveOrigin: "top center",
          position: mobileHeaderUseAbsolute ? "absolute" : "fixed",
        }}
        onFocus={() => setMobileHeaderFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMobileHeaderFocused(false);
        }}
      >
        <div
          className="pointer-events-auto relative"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            transformOrigin: "top center",
            transformStyle: "preserve-3d",
            transform: `rotateX(${FOLD_MAX_DEG * mobileHeaderFold}deg)`,
            transition: "none",
            pointerEvents: mobileHeaderFold >= 1 ? "none" : "auto",
          }}
          inert={mobileHeaderFold >= 1 ? true : undefined}
        >
          {/* Front face — logo, hamburger, dimensions/colours untouched. */}
          <div
            className="relative flex h-14 items-center justify-between gap-3 border-b border-white/10 bg-[#080A1D]/92 px-4 backdrop-blur-md sm:px-6"
            style={{
              backfaceVisibility: "hidden",
              boxShadow: `0 ${4 + 14 * mobileHeaderFold}px ${10 + 18 * mobileHeaderFold}px rgba(0, 0, 0, ${0.18 + 0.22 * mobileHeaderFold})`,
            }}
          >
            {/* Top highlight — a hairline that only brightens as the panel
                tilts, simulating light catching the leading edge. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ boxShadow: `inset 0 1px 0 rgba(255, 255, 255, ${0.05 + 0.1 * mobileHeaderFold})` }}
            />
            <Link to="/" aria-label="MSM Scrap — Home" className="flex shrink-0 items-center">
              <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} className="h-auto w-24" />
            </Link>
            <MobileMenuTrigger
              drawerOpen={drawerOpen}
              onOpen={() => setDrawerOpen(true)}
              drawerInputModalityRef={drawerInputModalityRef}
            />
          </div>

          {/* Bottom/underside face — the panel's real thickness (~11px), a
              second plane hinged at its own top edge (= the front face's
              bottom edge) and pre-rotated -90deg in this group's own 3D
              space, so at rest it folds flat against the group (invisible,
              facing straight down) and only becomes visible as the group's
              own rotation sweeps it toward the viewer alongside the front
              face. One continuous solid-navy face (not a thin decorative
              strip): a restrained highlight near the crease fading through
              to a darker shadow tone lower down, so it reads as a lit,
              shaded edge rather than a flat cut-out. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: "100%",
              height: "11px",
              transformOrigin: "top center",
              transform: "rotateX(-90deg)",
              backfaceVisibility: "hidden",
              backgroundImage:
                "linear-gradient(to bottom, rgba(24, 31, 64, 0.98) 0%, rgba(8, 10, 29, 0.98) 45%, rgba(2, 3, 8, 0.98) 100%)",
            }}
          />
        </div>
      </header>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
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
                className="flex w-[min(88vw,360px)] flex-col gap-0 border-l border-copper/25 bg-[#080A1D] p-0 text-foreground motion-reduce:transition-none data-[state=open]:duration-300 data-[state=closed]:duration-300 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:text-foreground/85 [&>button]:transition-colors [&>button]:hover:bg-copper/10 [&>button]:hover:text-foreground [&>button]:active:bg-copper/15 [&>button]:data-[state=open]:bg-transparent [&>button]:focus-visible:outline [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-copper [&>button]:focus:ring-0 [&>button]:focus:ring-offset-0 [&>button>svg]:size-6"
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
                            activeClassName="mx-5 translate-x-[5px] bg-[oklch(0.583_0.135_45.5/0.06)] !text-foreground"
                          />
                        </li>
                      );
                    })}
                  </ul>
                </nav>

                <div
                  className="flex flex-col gap-3 border-t border-white/10 px-5 py-5"
                  style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
                >
                  <Link
                    to="/"
                    search={{ quote: true, source: "header" }}
                    mask={{ to: "/quote", search: { source: "header" } }}
                    onClick={() => setDrawerOpen(false)}
                    className="font-display flex h-[48px] items-center justify-center rounded-[12px] bg-[image:var(--gradient-copper-cta)] text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase"
                  >
                    Get a Quote
                  </Link>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setDrawerOpen(false)}
                    className="font-display flex h-[48px] items-center justify-center gap-2 rounded-[12px] border border-foreground/25 text-sm font-semibold tracking-[0.08em] text-foreground/90 uppercase transition-colors hover:border-[#25D366]/70 hover:text-[#25D366]"
                  >
                    <WhatsAppIcon />
                    Chat on WhatsApp
                  </a>
                </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
