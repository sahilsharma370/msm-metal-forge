// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT, RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT } from "./__root";

/**
 * REGRESSION — reload-while-already-scrolled-past-Trust flash. Confirmed
 * live (instrumented position/transform + img.complete polling across
 * repeated real reloads, at both the broken and fixed states) that:
 *   - the crane image was already loaded throughout — not an image-fetch
 *     delay;
 *   - a candidate fix reading `window.scrollY` from a script at the same
 *     position as STABLE_VH_SCRIPT/JS_ENABLED_SCRIPT (in <head>) always
 *     saw 0, even on a reload the browser went on to restore to a real
 *     scrolled position — ruled out and reverted;
 *   - a second candidate, `history.scrollRestoration = 'manual'`, had no
 *     measurable effect on a plain reload — ruled out and reverted;
 *   - a script placed at the end of <body> (after the SSR'd markup, before
 *     the hydration bundle's own script) DOES see the real restored
 *     scrollY, confirmed live on the exact same reload where <head> saw 0
 *     — this is where RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT actually lives.
 *
 * This runs the exact shipped script string (not a reimplementation), so
 * it can't silently drift from what the browser actually executes.
 */
function runScript(opts: { matches: boolean; scrollY: number; innerHeight: number; elTransform?: string }) {
  const el = { style: { transform: opts.elTransform ?? "matrix(1, 0, 0, 1, 0, 835)" } };
  const querySelector = vi.fn().mockReturnValue(el);
  const fn = new Function("window", "document", `${RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT}`);
  fn(
    {
      matchMedia: vi.fn().mockReturnValue({ matches: opts.matches }),
      scrollY: opts.scrollY,
      innerHeight: opts.innerHeight,
    },
    { querySelector },
  );
  return { el, querySelector };
}

describe("RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT", () => {
  it("releases Trust (clears the transform) when already scrolled at or past 60% of the viewport height, at the desktop/motion-enabled breakpoint", () => {
    const { el, querySelector } = runScript({ matches: true, scrollY: 600, innerHeight: 1000 });
    expect(querySelector).toHaveBeenCalledWith(".trust-stage-offset");
    expect(el.style.transform).toBe("none");
  });

  it("leaves the hide in place when scrolled short of that threshold (a fresh/near-top load — the already-correct case)", () => {
    const { el, querySelector } = runScript({ matches: true, scrollY: 100, innerHeight: 1000 });
    expect(querySelector).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("matrix(1, 0, 0, 1, 0, 835)");
  });

  it("does nothing when the breakpoint query doesn't match — mobile or reduced motion, mirrors styles.css's own gating on .trust-stage-offset", () => {
    const { el, querySelector } = runScript({ matches: false, scrollY: 900, innerHeight: 1000 });
    expect(querySelector).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("matrix(1, 0, 0, 1, 0, 835)");
  });

  it("does nothing if .trust-stage-offset isn't found on the page (any other route)", () => {
    const fn = new Function("window", "document", `${RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT}`);
    const querySelector = vi.fn().mockReturnValue(null);
    expect(() =>
      fn(
        { matchMedia: vi.fn().mockReturnValue({ matches: true }), scrollY: 900, innerHeight: 1000 },
        { querySelector },
      ),
    ).not.toThrow();
  });

  it("never throws even if matchMedia/scrollY/innerHeight/querySelector are unavailable (matches STABLE_VH_SCRIPT/JS_ENABLED_SCRIPT's own try/catch convention)", () => {
    const fn = new Function("window", "document", `${RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT}`);
    expect(() => fn({}, {})).not.toThrow();
  });
});

/**
 * REGRESSION — reload-while-already-scrolled-into-Services flash. Confirmed
 * live (frame-by-frame polling of the pinned canvas's computed
 * position/rect across repeated real reloads, at both the broken and fixed
 * states, warm and cold) that the pinned `canvas` div stays
 * `position: relative` at its own one-viewport natural size until GSAP's
 * ScrollTrigger pin takes over a frame or two into hydration — at any
 * restored scroll position deeper than that one viewport into the
 * section's reserved height, the very first painted frame showed nothing
 * but the section's own flat background, not the stage/truck/lamp. See
 * PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT's own comment in ./__root for
 * why this is fixed with a `transform` (never `position`) and why the
 * offset is clamped to `[0, pinDistance]`.
 *
 * This runs the exact shipped script string (not a reimplementation), so
 * it can't silently drift from what the browser actually executes.
 * `sectionRectTop` is the live `#services` element's own
 * getBoundingClientRect().top at the moment the script runs (viewport-
 * relative, like the real DOM) — `scrollY - (sectionRectTop + scrollY)`
 * is how the script derives document-relative section position, so tests
 * pick `sectionRectTop` values consistent with a real `scrollY` the same
 * way the live measurements did (document position 1336 throughout).
 */
function runPinScript(opts: {
  matches: boolean;
  scrollY: number;
  innerHeight: number;
  sectionRectTop: number;
  canvasTransform?: string;
}) {
  const section = { getBoundingClientRect: () => ({ top: opts.sectionRectTop }) };
  const canvas = { style: { transform: opts.canvasTransform ?? "" } };
  const querySelector = vi.fn((selector: string) => {
    if (selector === "#services") return section;
    if (selector === ".services-pin-canvas") return canvas;
    return null;
  });
  const fn = new Function("window", "document", `${PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT}`);
  fn(
    {
      matchMedia: vi.fn().mockReturnValue({ matches: opts.matches }),
      scrollY: opts.scrollY,
      innerHeight: opts.innerHeight,
    },
    { querySelector },
  );
  return { canvas, querySelector };
}

describe("PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT", () => {
  it("does nothing before Services — canvas's own natural position is already correct there", () => {
    // Document position of #services is 1336 throughout (sectionRectTop +
    // scrollY), matching the live-measured case; here scrollY (0) is still
    // short of it.
    const { canvas, querySelector } = runPinScript({
      matches: true,
      scrollY: 0,
      innerHeight: 835,
      sectionRectTop: 1336,
    });
    expect(querySelector).toHaveBeenCalledWith(".services-pin-canvas");
    expect(canvas.style.transform).toBe("");
  });

  it("offsets canvas by exactly how far scrolled into the pin range, matching where the real `position: fixed` pin would show it", () => {
    // The live-measured "middle" case: scrollY 2500, #services at document
    // position 1336 (rect top -1164), pin distance 835 * 2.8 = 2338 — well
    // within range, so offset is the full 2500 - 1336 = 1164, unclamped.
    const { canvas } = runPinScript({
      matches: true,
      scrollY: 2500,
      innerHeight: 835,
      sectionRectTop: -1164,
    });
    expect(canvas.style.transform).toBe("translateY(1164px)");
  });

  it("clamps the offset at the pin's own end distance once scrolled past it, matching canvas's natural post-release position", () => {
    // The live-measured "released" case: scrollY 4100, #services still at
    // document position 1336 (rect top -2764) — past pinDistance (2338),
    // so offset clamps there instead of continuing to grow.
    const { canvas } = runPinScript({
      matches: true,
      scrollY: 4100,
      innerHeight: 835,
      sectionRectTop: -2764,
    });
    expect(canvas.style.transform).toBe("translateY(2338px)");
  });

  it("does nothing when the breakpoint query doesn't match — mobile or reduced motion, the only population canvas is ever pinned for", () => {
    const { canvas, querySelector } = runPinScript({
      matches: false,
      scrollY: 2500,
      innerHeight: 835,
      sectionRectTop: -1164,
    });
    expect(querySelector).not.toHaveBeenCalled();
    expect(canvas.style.transform).toBe("");
  });
});
