// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMobileHeaderFold } from "./Header";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
}

function dispatchScroll() {
  window.dispatchEvent(new Event("scroll"));
}

function dispatchTouchStart(y: number) {
  const e = new Event("touchstart") as unknown as TouchEvent;
  Object.defineProperty(e, "touches", { value: [{ clientY: y }] });
  window.dispatchEvent(e);
}

function dispatchTouchMove(y: number) {
  const e = new Event("touchmove") as unknown as TouchEvent;
  Object.defineProperty(e, "touches", { value: [{ clientY: y }] });
  window.dispatchEvent(e);
}

function dispatchTouchEnd() {
  window.dispatchEvent(new Event("touchend"));
}

// jsdom doesn't implement `matchMedia` — same local mock pattern as
// TrustBar.test.tsx. These tests exercise the mobile fold path, so the
// narrow-viewport query useMobileHeaderFold's own useIsNarrowViewport
// checks must report `true` for the hook to do anything at all.
function mockMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// Drives a downward drag from y=200 to y=160 in 10px steps — comfortably
// past GESTURE_THRESHOLD (6px) on the very first move — then completes the
// animation by advancing the fake rAF clock past FOLD_DURATION_MS (1100ms).
// Finger moving up the screen (y decreasing) == content scrolling down ==
// "down" intent, per onTouchMove's own dy convention.
function foldDownViaGesture() {
  dispatchTouchStart(200);
  for (let i = 1; i <= 4; i++) {
    act(() => {
      dispatchTouchMove(200 - i * 10);
    });
  }
  act(() => {
    dispatchTouchEnd();
  });
  act(() => {
    vi.advanceTimersByTime(1200);
  });
}

// The mirror image: finger moving down the screen (y increasing) == "up"
// intent. Used both for the top-only unfold and for confirming an upward
// gesture elsewhere is a no-op.
function swipeUpViaGesture() {
  dispatchTouchStart(200);
  for (let i = 1; i <= 4; i++) {
    act(() => {
      dispatchTouchMove(200 + i * 10);
    });
  }
  act(() => {
    dispatchTouchEnd();
  });
  act(() => {
    vi.advanceTimersByTime(1200);
  });
}

describe("useMobileHeaderFold state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    mockMatchMedia();
    setScrollY(0);
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
  });

  // State 1 — starting state: full navbar at the document top; the first
  // deliberate downward gesture folds it to the line.
  it("starts open at the document top, and a deliberate downward gesture folds it to the line", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));

    expect(result.current).toBe(0);
    // Waiting at the top for the first gesture is still the one
    // intentionally-locked wait state — unchanged by this correction.
    expect(document.documentElement.style.overflow).toBe("hidden");

    foldDownViaGesture();

    expect(result.current).toBe(1);
    expect(document.documentElement.style.overflow).toBe("");
  });

  // State 2 — once folded, ordinary scrolling (any direction, any depth,
  // including arriving back at the absolute top) is never locked and never
  // reveals the navbar by itself. This is the actual correction: the
  // previous `scrollY <= TOP_TOLERANCE` auto-unfold on plain `scroll`/
  // `scrollend` events is gone.
  it("once folded, reverse scrolling anywhere — including arriving at the absolute top — never reveals the navbar and never locks scrolling", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));
    foldDownViaGesture();
    expect(result.current).toBe(1);

    setScrollY(2000);
    act(() => dispatchScroll());
    expect(result.current).toBe(1);
    expect(document.documentElement.style.overflow).toBe("");

    setScrollY(400);
    act(() => dispatchScroll());
    expect(result.current).toBe(1);
    expect(document.documentElement.style.overflow).toBe("");

    // Arriving at the exact top by scroll position alone — still folded.
    setScrollY(0);
    act(() => dispatchScroll());
    expect(result.current).toBe(1);
    expect(document.documentElement.style.overflow).toBe("");
  });

  // State 3 — at the top, the next separate upward gesture (not the scroll
  // event that brought scrollY to 0) unfolds the line back to the full
  // navbar.
  it("at the top, a separate upward gesture unfolds the line back to the full navbar", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));
    foldDownViaGesture();
    setScrollY(0);
    act(() => dispatchScroll());
    expect(result.current).toBe(1); // arrival alone — still folded (state 2)

    swipeUpViaGesture();

    expect(result.current).toBe(0);
    // Back to "idle-open", waiting at the top again — locked, same as the
    // original starting state.
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  // An upward gesture anywhere that isn't the top must be a no-op — this is
  // the gate that keeps "reverse scrolling anywhere must not reveal the
  // navbar" true even when an actual gesture (not just a scroll event)
  // happens mid-page.
  it("an upward gesture away from the top does nothing", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));
    foldDownViaGesture();
    setScrollY(1500); // e.g. Trust/Services
    act(() => dispatchScroll());
    expect(result.current).toBe(1);

    swipeUpViaGesture();

    expect(result.current).toBe(1);
  });

  // "At top with navbar open, further upward input must do nothing."
  it("at the top with the navbar already open, further upward input does nothing", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));
    expect(result.current).toBe(0);

    swipeUpViaGesture();

    expect(result.current).toBe(0);
  });

  // State 4 — a later downward intent repeats the cycle.
  it("a later downward gesture repeats the fold cycle", () => {
    const { result } = renderHook(() => useMobileHeaderFold(false, false, "/"));
    foldDownViaGesture();
    setScrollY(0);
    act(() => dispatchScroll());
    swipeUpViaGesture();
    expect(result.current).toBe(0);

    foldDownViaGesture();

    expect(result.current).toBe(1);
  });
});
