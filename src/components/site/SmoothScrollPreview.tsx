import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Query-gated preview only — mounted from routes/index.tsx exclusively when
 * `search.smoothPreview === 1` (`?smoothPreview=1`), never by default. Off
 * the homepage (`/quote`, `/owner`, `/about`, …) this component is never
 * rendered at all, so those stay fully native regardless of the query
 * string. Desktop + motion-enabled only is enforced again here via
 * `gsap.matchMedia`, matching ScrollStack.tsx's own gating exactly — mobile
 * and reduced-motion visitors who somehow load this URL get no Lenis
 * instance, no ticker listener, nothing.
 *
 * Lenis is created with NO `wrapper`/`content` options — its default mode
 * drives the real `window`/`document.documentElement` scroll position via
 * native `scrollTo`, not a transformed `<div>`. This matters specifically
 * because ScrollStack.tsx's Hero/TrustBar are manually toggled between
 * `position: fixed` (viewport-relative) and `position: absolute` (document-
 * relative) — wrapping the page in a translated content container would
 * silently break every one of those coordinate assumptions. Lenis touching
 * only the native scroll position means ScrollStack.tsx, WhatWeDo.tsx's pin,
 * and Materials.tsx's own plain `window.scrollY`/`scroll`-event tracking all
 * keep working exactly as they already do — none of them needed to change.
 *
 * Sync is the two-line recipe Lenis's own docs give for GSAP ScrollTrigger:
 * `lenis.on('scroll', ScrollTrigger.update)` keeps every existing trigger's
 * progress reading Lenis's eased position instead of waiting on the native
 * (now-smoothed, less frequent) scroll event, and a single
 * `gsap.ticker.add` callback is the one animation ticker driving Lenis's own
 * `raf` — not a second independent rAF loop racing GSAP's.
 *
 * KNOWN RISK, not patched around here (see this file's PR description):
 * ScrollTrigger's `snap` (stageA in ScrollStack.tsx) animates scroll
 * position by calling the scroller's setter directly — for the plain
 * `window` scroller that is a direct `window.scrollTo`, bypassing Lenis
 * entirely. Lenis's own `raf` tick right after can overwrite that with its
 * own still-interpolating `targetScroll`, fighting the snap. The documented
 * fix for that specific case is a `ScrollTrigger.scrollerProxy` redirecting
 * ScrollTrigger's scroll-setting through `lenis.scrollTo` — deliberately
 * NOT added here, since that's an additional mechanism beyond the
 * recipe this preview was scoped to, and the brief for this preview is to
 * report that exact conflict rather than silently patch around it.
 */
export function SmoothScrollPreview() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

    const mm = gsap.matchMedia();

    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis();

      lenis.on("scroll", ScrollTrigger.update);

      const tick = (time: number) => {
        lenis.raf(time * 1000);
      };
      gsap.ticker.add(tick);
      // Lenis already supplies its own easing; GSAP's lag-smoothing
      // (catch-up jumps after a stalled tab/frame) would otherwise fight
      // that by skipping ticks, so it's disabled only while this ticker
      // listener is attached.
      gsap.ticker.lagSmoothing(0);

      return () => {
        gsap.ticker.remove(tick);
        // Restore GSAP's own default lag-smoothing instead of leaving it
        // globally disabled after this preview-only effect tears down.
        gsap.ticker.lagSmoothing(500, 33);
        lenis.destroy();
      };
    });

    return () => mm.revert();
  }, []);

  return null;
}
