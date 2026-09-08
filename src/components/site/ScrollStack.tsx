import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type Props = {
  heroWrapperRef: React.RefObject<HTMLDivElement | null>;
  heroRef: React.RefObject<HTMLElement | null>;
  trustBarRef: React.RefObject<HTMLElement | null>;
};

/**
 * Neither Hero nor TrustBar uses GSAP's native pin: true — that relies on
 * GSAP's own internal getComputedStyle-based width/height measurement and
 * pin-spacer machinery, which was found (via live browser inspection) to
 * measure Hero's width incorrectly (896px instead of full viewport) and to
 * leave a permanent compensating transform on Hero after unpinning. Instead,
 * both are driven manually and identically: explicit
 * { position: "fixed", top: 0, left: 0, width: "100%" } while the trigger's
 * range is active, reverted to their own permanent default position once it
 * ends. Hero's default is position: absolute/inset-0 (set in Hero.tsx,
 * inside a fixed-height, position: relative wrapper <div> in
 * routes/index.tsx — that wrapper is what reserves Hero's scroll distance,
 * not a GSAP pin spacer). TrustBar's default is position: relative,
 * additionally driven by a y: 100vh -> 0vh tween scrubbed 1:1 against
 * scroll — no other motion layered on top.
 *
 * The trigger is the wrapper <div>, not Hero itself: Hero's own position is
 * toggled fixed/absolute by this same effect, and using it as the trigger
 * too meant GSAP was trying to measure a stable, scroll-invariant page
 * coordinate from an element being pulled in and out of normal flow at the
 * same time — confirmed via live inspection to freeze scroll progress
 * entirely. The wrapper never changes position, so it's a reliable anchor.
 */
export function ScrollStack({ heroWrapperRef, heroRef, trustBarRef }: Props) {
  useEffect(() => {
    if (!heroWrapperRef || !heroRef || !trustBarRef) return;

    // CHECKPOINT C2L (trust composition lock) — reduced-motion users never
    // get the fixed/slide/scrub treatment at all: no ScrollTrigger is ever
    // created, so there is nothing to set up or tear down. TrustBar is left
    // exactly as its own component authors it (position: relative,
    // min-h-screen, no transform) — normal document flow, fully visible.
    // Hero is likewise left untouched (its own default absolute/inset-0
    // layout is unrelated to this scroll-stack effect). Normal users below
    // this check are completely unaffected.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const heroWrapper = heroWrapperRef.current;
    const hero = heroRef.current;
    const trustBar = trustBarRef.current;
    if (!heroWrapper || !hero || !trustBar) return;

    // Without explicit z-index, position: fixed Hero/TrustBar were not
    // reliably stacking above WhatWeDo's later, normal-flow content
    // (confirmed via live inspection: elementFromPoint returned WhatWeDo's
    // text as topmost despite Hero's fixed box geometrically covering that
    // point). Pin order matches DOM order: Hero below TrustBar.
    gsap.set(hero, { zIndex: 1 });
    gsap.set(trustBar, { zIndex: 2 });

    // CHECKPOINT C2L (verified seam fix) — yPercent is a live CSS %
    // transform resolved against the element's OWN current box (not a
    // one-time px snapshot the way GSAP resolves "100vh" strings), so it
    // stays correct after activateTrustBarFixed below resizes TrustBar to
    // height:calc(100% + 4px) for its own anti-gap buffer. y:0 keeps the
    // plain-px y channel at zero so there's no competing "vh"/px value.
    gsap.set(trustBar, { yPercent: 100, y: 0 });

    const activateHeroFixed = () => gsap.set(hero, { position: "fixed", top: 0, left: 0, width: "100%" });
    const releaseHeroFixed = () =>
      gsap.set(hero, { position: "absolute", top: "auto", left: "auto", width: "auto" });

    // A 2px overlap on every edge while fixed/covering makes a sub-pixel
    // rounding gap at the viewport boundary geometrically impossible,
    // instead of chasing exact frame timing — top/left go slightly
    // negative and width/height slightly over 100%, so TrustBar always
    // extends a hair past the viewport on all sides during this phase.
    // Reverts to plain 0/auto once released back to normal flow, where
    // there's nothing underneath left to compete with.
    const activateTrustBarFixed = () =>
      gsap.set(trustBar, {
        position: "fixed",
        top: "-2px",
        left: "-2px",
        width: "calc(100% + 4px)",
        height: "calc(100% + 4px)",
      });
    const releaseTrustBarFixed = () =>
      gsap.set(trustBar, {
        position: "relative",
        top: "auto",
        left: "auto",
        width: "auto",
        height: "auto",
        y: 0,
      });

    const slideTween = gsap.to(trustBar, { yPercent: 0, y: 0, ease: "none" });

    const stageA = ScrollTrigger.create({
      trigger: heroWrapper,
      start: "top top",
      end: "+=100%",
      animation: slideTween,
      scrub: true,
      onEnter: () => {
        activateHeroFixed();
        activateTrustBarFixed();
      },
      onLeave: () => {
        releaseHeroFixed();
        releaseTrustBarFixed();
      },
      // Scrolling back up: onEnterBack fires re-crossing the end boundary
      // (re-entering the range from beyond it) — re-establish the same
      // fixed/pinned state onEnter set going forward, since the scrub
      // animation keeps updating the transform regardless of these position
      // toggles and will desync from a stale position: relative otherwise.
      onEnterBack: () => {
        activateHeroFixed();
        activateTrustBarFixed();
      },
      // onLeaveBack fires crossing the start boundary backward (scrolled
      // back to the very top). There's no distinct "before start" state for
      // this trigger — start is the literal top of the page — so this
      // matches the same activate state as onEnter/the initial-sync below.
      onLeaveBack: () => {
        activateHeroFixed();
        activateTrustBarFixed();
      },
    });

    // "top top" means the trigger's active range starts at scrollY 0 — on a
    // fresh page load we're already inside (or past) it, but onEnter only
    // fires on a future boundary-crossing scroll event, not for a trigger
    // created already in-range. Sync both Hero's and TrustBar's state
    // immediately instead of waiting for a scroll that may not come before
    // the user looks.
    if (stageA.progress >= 1) {
      releaseHeroFixed();
      releaseTrustBarFixed();
    } else {
      activateHeroFixed();
      activateTrustBarFixed();
    }

    return () => {
      stageA.kill();
    };
  }, [heroWrapperRef, heroRef, trustBarRef]);

  return null;
}
