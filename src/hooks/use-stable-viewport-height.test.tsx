// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useStableViewportHeight } from "./use-stable-viewport-height";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
}

function dispatchResize() {
  window.dispatchEvent(new Event("resize"));
}

function dispatchOrientationChange() {
  window.dispatchEvent(new Event("orientationchange"));
}

function readAppVh() {
  return document.documentElement.style.getPropertyValue("--app-vh");
}

function Harness() {
  useStableViewportHeight();
  return null;
}

// Regression coverage for the actual, physical-device-proven bug: `svh`
// tracked the live, toolbar-sensitive viewport on at least one real iOS
// browser (778px shown / 678px collapsed at a constant 402px width) instead
// of staying fixed, which let a toolbar-only scroll-chrome change alone
// shrink mobile section heights and shift Materials' own scroll-progress
// math. `--app-vh` (this hook's own update half — the initial capture is a
// separate inline script in __root.tsx, not under test here) must only
// change on a genuine width/orientation change, never on a height-only
// (toolbar or keyboard) change.
describe("useStableViewportHeight", () => {
  beforeEach(() => {
    setViewport(402, 778);
    document.documentElement.style.setProperty("--app-vh", "7.78px");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--app-vh");
  });

  it("does not touch --app-vh on mount — the initial value is owned by __root.tsx's inline script", () => {
    render(<Harness />);
    expect(readAppVh()).toBe("7.78px");
  });

  it("ignores a toolbar-only height change at a constant width", () => {
    render(<Harness />);
    // Same 778 -> 678 drop the physical trace recorded, at the same 402px width.
    setViewport(402, 678);
    dispatchResize();
    expect(readAppVh()).toBe("7.78px");
  });

  it("recomputes on a genuine width change", () => {
    render(<Harness />);
    setViewport(768, 700);
    dispatchResize();
    expect(readAppVh()).toBe("7px");
  });

  it("recomputes on orientationchange even if width happens not to differ", () => {
    render(<Harness />);
    setViewport(402, 900);
    dispatchOrientationChange();
    expect(readAppVh()).toBe("9px");
  });
});
