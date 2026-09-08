// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TrustBar } from "./TrustBar";

/**
 * CHECKPOINT C2L (track record glass + counter finalization) — gsap's real
 * ticker drives animation off requestAnimationFrame in real time, which
 * would make these tests slow and timing-flaky. This fake resolves every
 * timeline/tween synchronously (immediately applying the tween's final
 * `val`/vars and firing onUpdate/onComplete once) so the tests exercise the
 * component's own guard logic (started-once, reduced-motion branch, no
 * `steps()` easing) deterministically instead of racing real time.
 */
vi.mock("gsap", () => {
  const timeline = vi.fn((_opts?: Record<string, unknown>) => {
    const tl = {
      fromTo: vi.fn(() => tl),
      to: vi.fn((target: { val?: number }, vars: Record<string, unknown>) => {
        if (typeof vars["val"] === "number") target.val = vars["val"];
        (vars["onUpdate"] as (() => void) | undefined)?.();
        (vars["onComplete"] as (() => void) | undefined)?.();
        return tl;
      }),
      kill: vi.fn(),
    };
    return tl;
  });
  const fromTo = vi.fn(() => ({ kill: vi.fn() }));
  const set = vi.fn();
  return { gsap: { timeline, fromTo, set, to: vi.fn() } };
});

import { gsap } from "gsap";

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallback: IOCallback | null = null;

function mockMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  ioCallback = null;
  window.IntersectionObserver = vi.fn().mockImplementation(function (cb: IOCallback) {
    ioCallback = cb;
    return { observe: vi.fn(), disconnect: vi.fn() };
  }) as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrustBar stat reveal", () => {
  it("animates counters to their exact target and shows the static TRANSPARENT text once cards settle", () => {
    mockMatchMedia(false);
    render(<TrustBar />);

    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });

    expect(screen.getByText("14+")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("500+")).toBeInTheDocument();
    expect(screen.getByText("TRANSPARENT")).toBeInTheDocument();
    expect(screen.getByText("Weighing")).toBeInTheDocument();

    // Approved choreography: 14+ delay 0/duration 850, 7 delay 80/duration
    // 750, 500+ delay 240/duration 950 (finishing last at ~1190ms).
    const timelineCalls = vi.mocked(gsap.timeline).mock.calls as [Record<string, unknown>][];
    expect(timelineCalls.map((c) => c[0]?.["delay"])).toEqual([0, 0.08, 0.24]);

    const durations = vi
      .mocked(gsap.timeline)
      .mock.results.map((r) => (r.value.to.mock.calls[0][1] as Record<string, unknown>)["duration"]);
    expect(durations).toEqual([0.85, 0.75, 0.95]);

    for (const call of vi.mocked(gsap.timeline).mock.results) {
      const toCalls = call.value.to.mock.calls as [unknown, Record<string, unknown>][];
      for (const [, vars] of toCalls) {
        expect(String(vars["ease"])).not.toMatch(/steps/);
      }
    }

    // TRANSPARENT's fade-up: delay 160/duration 700, power2.out, y 6->0, no scale.
    const [, fromVars, toVars] = vi.mocked(gsap.fromTo).mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(fromVars).toMatchObject({ opacity: 0, y: 6 });
    expect(fromVars["scale"]).toBeUndefined();
    expect(toVars).toMatchObject({ opacity: 1, y: 0, delay: 0.16, duration: 0.7, ease: "power2.out" });
  });

  it("does not restart an already-started counter on a later re-render", () => {
    mockMatchMedia(false);
    const { rerender } = render(<TrustBar />);

    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const startedCount = vi.mocked(gsap.timeline).mock.calls.length;
    expect(startedCount).toBeGreaterThan(0);

    rerender(<TrustBar />);

    expect(vi.mocked(gsap.timeline).mock.calls.length).toBe(startedCount);
  });

  it("renders final values immediately under prefers-reduced-motion, with no timeline animation", () => {
    mockMatchMedia(true);
    render(<TrustBar />);

    expect(screen.getByText("14+")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("500+")).toBeInTheDocument();
    expect(screen.getByText("TRANSPARENT")).toBeInTheDocument();
    expect(gsap.timeline).not.toHaveBeenCalled();
    expect(gsap.set).toHaveBeenCalled();
  });
});
