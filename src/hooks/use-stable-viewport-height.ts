import { useEffect } from "react";

/**
 * `--app-vh` (1% of `window.innerHeight`) is set once, before this hook ever
 * runs, by an inline synchronous script in `src/routes/__root.tsx`
 * (`STABLE_VH_SCRIPT`) — that script captures the viewport at initial page
 * load, when the browser's toolbar is still shown. This hook is only
 * responsible for *updating* it afterward, and only for a genuine layout
 * change.
 *
 * A physical-device trace proved `svh` is not actually fixed at the
 * browser's collapsed-toolbar height on at least one real iOS browser — it
 * tracked the live viewport (778px toolbar shown / 678px collapsed)
 * identically to `dvh`, which let a toolbar-only scroll-chrome change alone
 * shrink Hero/WhatWeDo/Materials' mobile height and shift Materials' own
 * `getBoundingClientRect()`-based scroll-progress math with zero actual
 * scroll input.
 *
 * Width is the deciding signal for "is this a genuine change": a real
 * resize or orientation flip always changes `innerWidth`, while a
 * toolbar-only height change — or a keyboard/textarea focus opening the
 * on-screen keyboard, which also only changes height — never does. Gating
 * on width alone is what keeps this from recomputing for either of those
 * and reintroducing the exact instability this fix removes.
 * `orientationchange` recomputes unconditionally, as an explicit "this is a
 * genuine change" signal independent of the width comparison.
 */
export function useStableViewportHeight() {
  useEffect(() => {
    let lastWidth = window.innerWidth;
    const recompute = () => {
      document.documentElement.style.setProperty("--app-vh", `${window.innerHeight / 100}px`);
    };
    const onResize = () => {
      const width = window.innerWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      recompute();
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", recompute, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", recompute);
    };
  }, []);
}
