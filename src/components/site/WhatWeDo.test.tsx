// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { WhatWeDo } from "./WhatWeDo";

/**
 * REGRESSION — reload-while-already-scrolled-into-Services flash (see
 * __root.test.tsx's own PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT suite
 * for the script half of this fix). That script writes a `translateY`
 * directly onto the server-rendered canvas element, before React ever
 * hydrates — WhatWeDo.tsx's own gsap.context clears it again as its first
 * synchronous action, specifically *before* ScrollTrigger.create ever
 * pins the canvas, so ScrollTrigger's own pin setup (which measures the
 * element's current inline/computed state to know what to restore on
 * unpin) never captures the script's leftover offset as canvas's
 * "original" position.
 *
 * This hydrates real server-rendered markup with that same transform
 * already injected — exactly reproducing what the browser actually does
 * — rather than mounting via a plain CSR render, which would never have a
 * pre-existing transform on canvas to clear in the first place and so
 * couldn't catch a regression where the clear line is deleted or moved
 * after ScrollTrigger.create.
 */
const pinCapture = vi.hoisted(() => ({ canvasTransform: undefined as string | undefined }));

vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {
    create: vi.fn((vars: Record<string, unknown>) => {
      const pin = vars["pin"] as HTMLElement | undefined;
      if (pin) pinCapture.canvasTransform = pin.style.transform;
      return { kill: vi.fn() };
    }),
    refresh: vi.fn(),
    config: vi.fn(),
  },
}));

vi.mock("gsap", () => ({
  gsap: {
    registerPlugin: vi.fn(),
    matchMedia: vi.fn(() => ({
      add: vi.fn((_query: string, cb: () => void) => cb()),
      revert: vi.fn(),
    })),
    context: vi.fn((fn: () => unknown) => {
      fn();
      return { revert: vi.fn() };
    }),
    set: vi.fn(),
    to: vi.fn(),
    quickSetter: vi.fn(() => vi.fn()),
    ticker: { add: vi.fn(), remove: vi.fn() },
  },
}));

describe("WhatWeDo desktop canvas pin setup", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    pinCapture.canvasTransform = undefined;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    window.IntersectionObserver = vi.fn().mockImplementation(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }) as unknown as typeof IntersectionObserver;
    // jsdom has no FontFaceSet; WhatWeDo.tsx's effect unconditionally
    // reads document.fonts.ready (after ScrollTrigger.create has already
    // run, but still synchronously in the same effect) — needs to exist
    // so that read doesn't throw.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("clears the pre-hydration transform before ScrollTrigger pins the canvas", () => {
    const html = renderToString(<WhatWeDo />);
    // Mimics exactly what PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT does
    // to the real server-rendered markup before React ever hydrates it.
    const dirtied = html.replace(
      'class="services-pin-canvas',
      'style="transform:translateY(1234px)" class="services-pin-canvas',
    );
    expect(dirtied).not.toBe(html);
    container.innerHTML = dirtied;

    act(() => {
      root = hydrateRoot(container, <WhatWeDo />);
    });

    expect(pinCapture.canvasTransform).toBe("");
  });
});
