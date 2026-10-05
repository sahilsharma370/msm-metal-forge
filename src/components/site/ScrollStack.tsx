import { useLayoutEffect } from "react";
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
 * ends. Both default to position: absolute/inset-0 (Hero in Hero.tsx;
 * TrustBar in TrustBar.tsx) inside their own fixed-height, position:
 * relative wrapper <div> in routes/index.tsx — those wrappers are what
 * reserve each one's scroll distance, not a GSAP pin spacer. TrustBar is
 * additionally driven by a single yPercent: 100 -> 0 slide, scrubbed 1:1
 * against the entire trigger range, matching this file's own git history
 * (`ease: "none"`, a plain tween, not a timeline) — a two-part
 * slide-then-static-hold timeline giving TrustBar a deliberate full-screen
 * dwell was tried and then deliberately removed; there is no dwell and no
 * scroll-snap anywhere in this file's history, so none is invented here.
 *
 * Measured root cause of a real, separate bug (Trust filling the screen
 * then Services replacing it on the very next frame, plus an intervening
 * blank-navy frame): TrustBar used to be the element whose OWN height
 * sections after it relied on for their document position — but while
 * `position: fixed` (true for nearly this whole trigger's range, including
 * at initial page load), an element contributes ZERO height to normal
 * document flow. So WhatWeDo's own ScrollTrigger (`trigger: section,
 * start: "top top"` in that file), measuring `section`'s position at a
 * moment TrustBar was fixed, computed a `start` roughly one whole
 * TrustBar-height too early. Giving TrustBar its own always-correctly-sized
 * wrapper (mirroring Hero's existing pattern, kept here deliberately even
 * though the dwell that originally motivated looking at this is gone) fixes
 * this at the source: WhatWeDo's section always measures the same correct
 * position, however TrustBar's own child element is currently positioned.
 *
 * The trigger is the wrapper <div>, not Hero itself: Hero's own position is
 * toggled fixed/absolute by this same effect, and using it as the trigger
 * too meant GSAP was trying to measure a stable, scroll-invariant page
 * coordinate from an element being pulled in and out of normal flow at the
 * same time — confirmed via live inspection to freeze scroll progress
 * entirely. The wrapper never changes position, so it's a reliable anchor.
 *
 * Entry distance is intentionally shorter than a full viewport. This used
 * to be done by `gsap.set`-overriding heroWrapper's height after mount —
 * MEASURED ROOT CAUSE of the "first scroll does nothing, Hero snaps back"
 * bug: live hydration-timing capture showed that JS-only override landing
 * 0.4-1.2s after first paint on this dev server (hydration itself —
 * JS download/parse/eval of an unbundled dev module graph — is what's
 * slow, not React's effect scheduling). Any real scroll in that window
 * moved the page against the OLD, full-height layout; the instant the
 * override finally applied, the trigger's own `end` (tied to heroWrapper's
 * height) suddenly shrank too, so the same scrollY now mapped to a
 * completely different, further-along progress, and Hero's `position:
 * fixed` snapped it back to covering the full viewport regardless of
 * where the user had actually scrolled to.
 * Fixed by deleting the JS override entirely and instead baking the short
 * height into `.hero-stage-height` itself, via a `(min-width: 1024px) and
 * (prefers-reduced-motion: no-preference)` media query in styles.css —
 * exactly the population this effect goes on to treat as "desktop,
 * motion-enabled" below. That query is active from the very first byte of
 * SSR HTML (no JS required), so heroWrapper already renders at its final,
 * hydrated-pinned height on first paint — there is no later resize, so no
 * stale-scrollY/progress mismatch is possible, by construction. Mobile and
 * desktop-reduced-motion are untouched (the query excludes both), matching
 * `.hero-stage-height`'s existing role as their own, separately-correct
 * full-height fallback. The trigger's own `end` is still derived by
 * measuring `heroWrapper.getBoundingClientRect().height` (now CSS-driven,
 * not JS-driven) rather than a separately-guessed value, so start and end
 * stay tied to one source of truth and TrustBar's release still lands
 * exactly at the top of its own wrapper with no gap and no jump.
 */
export function ScrollStack({ heroWrapperRef, heroRef, trustBarRef }: Props) {
  // `useLayoutEffect`, not `useEffect`: React runs `useEffect` callbacks
  // asynchronously after the browser has already painted, which — measured
  // live — let a painted frame of Hero/TrustBar's plain, un-fixed default
  // layout slip through before this effect's `position: fixed` landed a
  // moment later, a second, independent visible snap on top of the one
  // described above. `useLayoutEffect` commits synchronously before paint,
  // so the fixed state lands in the same frame hydration does. Mirrors
  // WhatWeDo.tsx's own desktop pin effect, which already uses
  // `useLayoutEffect` for this exact reason.
  useLayoutEffect(() => {
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

    // REGRESSION FIX — this fixed/pin/scrub choreography is desktop-only
    // (BATCH 5N), but it used to be gated by a plain one-shot
    // `window.matchMedia(...).matches` check that only ran once at mount.
    // Resizing the real viewport across the 1024px line afterward (desktop
    // devtools/testing, a tablet rotating, or the visualViewport changing
    // as a mobile browser's chrome shows/hides) never re-ran that check, so
    // if the effect happened to mount — or was mid-"fixed" — at >=1024px,
    // the `position: fixed` inline styles this sets on Hero/TrustBar below
    // were left stuck on those elements even after the viewport dropped
    // below 1024px: the two sections' own mobile-only CSS (`lg:hidden` /
    // `hidden lg:contents`) correctly swapped their *inner* content for the
    // mobile layout, but the outer, still-`position:fixed`, full-viewport
    // Hero/TrustBar elements kept covering whatever mobile content (the
    // Services truck/timeline) sat below them in the document — the
    // reported "sections rendering on top of one another" bug.
    //
    // `gsap.matchMedia()` (already the pattern WhatWeDo's mobile
    // `DispatchRun` uses for its own breakpoint-scoped ScrollTrigger) fixes
    // this at the root: it re-evaluates the query on every resize and, on
    // every match/unmatch transition, first calls the previous match's
    // returned cleanup — invoking `ctx.revert()` below, which undoes every
    // `gsap.set`/`gsap.to` this effect made (including whichever `position:
    // fixed` values happened to be live at that moment) — before ever
    // running the handler again for the new state. Desktop and mobile are
    // thus always initialized/torn down separately, and old-breakpoint
    // fixed positioning can never survive into the other breakpoint.
    const mm = gsap.matchMedia();

    mm.add("(min-width: 1024px)", () => {
      const heroWrapper = heroWrapperRef.current;
      const hero = heroRef.current;
      const trustBar = trustBarRef.current;
      if (!heroWrapper || !hero || !trustBar) return;

      const ctx = gsap.context(() => {
        // CHECKPOINT C2L (verified seam fix) — yPercent is a live CSS %
        // transform resolved against the element's OWN current box (not a
        // one-time px snapshot the way GSAP resolves "100vh" strings), so
        // it stays correct after activateTrustBarFixed below resizes
        // TrustBar to height:calc(100% + 4px) for its own anti-gap buffer.
        // y:0 keeps the plain-px y channel at zero so there's no competing
        // "vh"/px value.
        gsap.set(trustBar, { yPercent: 100, y: 0 });

        // z-index is scoped to the activate/release pairs below, not set
        // unconditionally — measured root cause of a real bug: it used to
        // be set once, permanently, outside these toggles, so TrustBar
        // (z-index 2) and Hero (z-index 1) kept outranking everything
        // after them in the document FOR THE REST OF THE PAGE even once
        // released back to normal flow. WhatWeDo's own desktop pin
        // (`pin: canvas` in WhatWeDo.tsx) is `position: fixed` with no
        // z-index of its own (auto) — confirmed via live measurement
        // (`getComputedStyle`) that at a real scroll position mid-way
        // through WhatWeDo's pinned phase, TrustBar's released, normal-flow
        // box still geometrically overlapped the top of the viewport and,
        // carrying its permanent z-index: 2, painted its own crane image
        // OVER WhatWeDo's fixed canvas for that overlapping region — the
        // canvas itself was correctly pinned and positioned the whole time;
        // only the stacking order was wrong. Without an explicit z-index at
        // all, `position: fixed` Hero/TrustBar were not reliably stacking
        // above WhatWeDo's later, normal-flow content either (confirmed via
        // live inspection: elementFromPoint returned WhatWeDo's text as
        // topmost despite Hero's fixed box geometrically covering that
        // point) — so each needs it ONLY while actually fixed, reset the
        // instant it releases. Pin order matches DOM order: Hero below
        // TrustBar.
        const activateHeroFixed = () =>
          gsap.set(hero, { position: "fixed", top: 0, left: 0, width: "100%", zIndex: 1 });
        // `left: 0, width: "100%"` (not "auto") — both Hero's and TrustBar's
        // className already carry `lg:inset-0` (right: 0, bottom: 0 included)
        // for their OWN default/no-JS layout; leaving left/width as "auto"
        // here only ever cleared top/left/width, never the class's own
        // right: 0, so the browser solved the remaining box as
        // shrink-to-fit-width anchored to the right edge — a visible navy
        // strip down the left side at the exact moment of release,
        // confirmed from the reported screenshot. Explicit left: 0 + width:
        // 100% fully determines the box regardless of whatever `right` the
        // class still has, anchoring it to the wrapper's full width.
        const releaseHeroFixed = () =>
          gsap.set(hero, { position: "absolute", top: "auto", left: 0, width: "100%", zIndex: "auto" });

        // A 2px overlap on every edge while fixed/covering makes a
        // sub-pixel rounding gap at the viewport boundary geometrically
        // impossible, instead of chasing exact frame timing — top/left go
        // slightly negative and width/height slightly over 100%, so
        // TrustBar always extends a hair past the viewport on all sides
        // during this phase. Reverts to plain 0/auto once released back to
        // normal flow, where there's nothing underneath left to compete
        // with.
        const activateTrustBarFixed = () =>
          gsap.set(trustBar, {
            position: "fixed",
            top: "-2px",
            left: "-2px",
            width: "calc(100% + 4px)",
            height: "calc(100% + 4px)",
            zIndex: 2,
          });
        // MEASURED ROOT CAUSE of the subtle crane photo resize/recrop at the
        // boundary (reported from a live recording, both directions): the
        // box this function produced was a DIFFERENT SIZE than
        // activateTrustBarFixed's box, not just a different position. That
        // earlier `top:0, left:0, width:"100%", height:"auto"` relied on
        // the class's own `lg:inset-0` bottom:0 to auto-fill height to the
        // wrapper's bare height (confirmed ~779px) and TrustBar's intrinsic
        // content height never entered into it either way (shrink-to-fit
        // never won once bottom:0 forces the fill path) — but
        // activateTrustBarFixed's box is 2px bigger on every edge
        // (`calc(100% + 4px)`, the deliberate anti-seam overlap from
        // viewport "100%"). So at the exact release frame the box shrank by
        // 4px in each dimension and shifted 2px right/down in the same
        // instant — `object-cover` recomputes its crop window from the
        // box's own size every frame, so that real (if small) box resize
        // read as the image subtly re-cropping/resizing, independent of the
        // gap bug fixed earlier (same symptom family, different cause: that
        // one was about `top`/`height` resolving to the wrong VALUE at all;
        // this one is about the two states not agreeing on a SIZE even once
        // both resolve to "fill the box"). Fix: give this the exact same
        // `-2px`/`calc(100% + 4px)` overlap as activateTrustBarFixed, just
        // resolved against the wrapper (its containing block once absolute)
        // instead of the viewport — TrustBar's own wrapper is sized to
        // `lg:min-h-screen` specifically so that "100%" of it and "100%" of
        // the viewport are the same number of pixels at this exact scroll
        // position, so the box — and therefore the image's object-cover
        // frame — is pixel-identical on both sides of the boundary. No
        // scale/fade/margin added; only the box's own numbers now match.
        const releaseTrustBarFixed = () =>
          gsap.set(trustBar, {
            position: "absolute",
            top: "-2px",
            left: "-2px",
            width: "calc(100% + 4px)",
            height: "calc(100% + 4px)",
            y: 0,
            zIndex: "auto",
          });

        const slideTween = gsap.to(trustBar, { yPercent: 0, y: 0, ease: "none" });

        const stageA = ScrollTrigger.create({
          trigger: heroWrapper,
          start: "top top",
          // Derived from heroWrapper's own just-overridden height, not a
          // separately-guessed percentage — see this file's own top
          // comment for why that's what makes entry end exactly where
          // heroWrapper's box ends, with no gap before TrustBar's wrapper
          // and no release jump.
          end: () => `+=${heroWrapper.getBoundingClientRect().height}`,
          animation: slideTween,
          scrub: true,
          // Directional snap — scoped to stageA only, so it only ever acts
          // within the entry phase (Hero fixed + Trust sliding in): a light
          // downward touch completes the entry to progress 1 (Trust
          // full-screen), a light upward touch returns it to progress 0
          // (Hero), both via an eased scrollTo ScrollTrigger drives itself
          // — no wheel handler, no scroll lock. `directional: true` means
          // it snaps toward whichever end the user was already heading,
          // not always the nearer one. It only engages once the user's
          // gesture ends (after `delay`, no ongoing scroll input) and any
          // new scroll input during the snap animation interrupts it
          // (ScrollTrigger's own built-in behavior) — continued scrolling
          // past progress 1 still leaves the range normally into Trust's
          // dwell/exit and the Services handoff below, untouched.
          snap: {
            snapTo: [0, 1],
            directional: true,
            inertia: false,
            delay: 0.12,
            duration: { min: 0.35, max: 0.75 },
            ease: "power2.inOut",
          },
          onEnter: () => {
            activateHeroFixed();
            activateTrustBarFixed();
          },
          onLeave: () => {
            releaseHeroFixed();
            releaseTrustBarFixed();
          },
          // Scrolling back up: onEnterBack fires re-crossing the end
          // boundary (re-entering the range from beyond it) — re-establish
          // the same fixed/pinned state onEnter set going forward, since
          // the scrub animation keeps updating the transform regardless of
          // these position toggles and will desync from a stale position:
          // relative otherwise.
          onEnterBack: () => {
            activateHeroFixed();
            activateTrustBarFixed();
          },
          // onLeaveBack fires crossing the start boundary backward
          // (scrolled back to the very top). There's no distinct "before
          // start" state for this trigger — start is the literal top of
          // the page — so this matches the same activate state as
          // onEnter/the initial-sync below.
          onLeaveBack: () => {
            activateHeroFixed();
            activateTrustBarFixed();
          },
        });

        // "top top" means the trigger's active range starts at scrollY 0 —
        // on a fresh page load (or a breakpoint switch landing us already
        // mid-range) we may already be inside/past it, but onEnter only
        // fires on a future boundary-crossing scroll event, not for a
        // trigger created already in-range. Sync both Hero's and TrustBar's
        // state immediately instead of waiting for a scroll that may not
        // come before the user looks.
        if (stageA.progress >= 1) {
          releaseHeroFixed();
          releaseTrustBarFixed();
        } else {
          activateHeroFixed();
          activateTrustBarFixed();
        }
      }, heroWrapper);

      // Returned to gsap.matchMedia: run automatically — before the handler
      // above ever runs again — the moment "(min-width: 1024px)" stops
      // matching (crossing down into mobile) or this component unmounts.
      // ctx.revert() kills stageA's ScrollTrigger AND undoes every
      // gsap.set/gsap.to made inside the context above, restoring Hero and
      // TrustBar's inline styles to whatever they were before this effect
      // ever touched them (i.e. no inline position/zIndex/transform left
      // behind), regardless of which fixed/released state was live at the
      // moment of the switch.
      return () => ctx.revert();
    });

    return () => mm.revert();
  }, [heroWrapperRef, heroRef, trustBarRef]);

  return null;
}
