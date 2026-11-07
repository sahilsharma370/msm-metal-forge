// @vitest-environment jsdom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Hero renders real <Link> elements (Get a Quote CTA) — same mock pattern
// as OwnerOverview.test.tsx, since resolving a real href needs a live
// RouterProvider this unit test doesn't set up.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

// jsdom has no matchMedia — Hero's desktop mouse-follow effect calls it
// unconditionally on mount. Same local mock pattern as TrustBar.test.tsx /
// Header.fold.test.tsx.
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia;

const { Hero } = await import("./Hero");

afterEach(() => {
  cleanup();
});

describe("Hero — mobile text-column margin viewport stability", () => {
  it("sizes the text column's top margin off the frozen --app-vh custom property, never a live-tracking svh/dvh unit", () => {
    const { container } = render(<Hero />);
    const textColumn = container.querySelector(".relative.mx-auto.flex.w-full.max-w-4xl");
    expect(textColumn).not.toBeNull();
    const className = (textColumn as HTMLElement).className;

    // MEASURED ROOT CAUSE regression guard (mobile Chrome toolbar-collapse
    // Hero shift) — a live iframe viewport-height probe confirmed raw
    // `30.5svh` here tracks the live, collapsing-toolbar viewport on this
    // browser exactly like `dvh` (same finding VIEWPORT-STABILITY-2, see
    // styles.css, already made for every other flow-affecting viewport
    // unit in this codebase), while the Hero section's own background
    // height is sized off the frozen `--app-vh`. Growing the simulated
    // viewport by 70px (toolbar collapsing) moved this column 21.3px
    // relative to its own unmoving background — 30.5% of 70, exactly the
    // `30.5svh` term. jsdom doesn't run real layout, so this asserts the
    // class string itself, a direct proxy for that measured behavior: no
    // raw `svh`/`dvh` unit may reappear in this margin, and it must be
    // driven by the same frozen custom property as the rest of Hero's
    // viewport-dependent sizing, so a toolbar collapse can never move it
    // again.
    expect(className).not.toMatch(/\d+svh|\d+dvh/);
    expect(className).toContain("var(--app-vh");
  });
});

describe("Hero — mobile background image sizing (image box = Hero section box)", () => {
  // jsdom runs no layout engine, so no test here can assert a real pixel
  // rect or rendered crop — the only authoritative check for that is the
  // live device comparison this fix was validated against. What IS
  // meaningfully checkable without a browser: that the image's height is
  // driven by the exact same --app-vh formula as the Hero section/wrapper
  // itself (byte-identical to the real rule in styles.css, not just "some
  // string containing --app-vh"), and that it can never silently regress
  // back to either of the two states already tried and reverted on the
  // physical device: a percentage height/width (measured 584px instead of
  // 744px, the original hidden-gap/band) or no explicit height at all
  // (reported directly from physical-device visual review as a hard image
  // cut with the bottom-anchored copper-wire composition missing — see
  // Hero.tsx's own comment on this element for the likely replaced-element
  // sizing explanation, which was not separately re-measured).
  const styleSheetPath = resolve(__dirname, "../../styles.css");
  const styleSheetSource = readFileSync(styleSheetPath, "utf8");

  it("extracts the Hero section/wrapper's real --app-vh height formula from styles.css", () => {
    // .hero-stage-height and .hero-stage-min-height share the identical
    // `calc(var(--app-vh, 7.6px) * 100)` formula (see styles.css's own
    // VIEWPORT-STABILITY-2 comment) -- confirms the fixture below is
    // reading the actual, current source rule, not a stale hard-coded copy.
    const heroStageHeightRule = /\.hero-stage-height\s*\{\s*height:\s*calc\(var\(--app-vh,\s*7\.6px\)\s*\*\s*100\)/;
    expect(styleSheetSource).toMatch(heroStageHeightRule);
  });

  it("sizes the mobile background image's height with the identical --app-vh*100 formula as the Hero section, never a percentage or an unconstrained auto height", () => {
    const { container } = render(<Hero />);
    const mobileImg = [...container.querySelectorAll("img")].find((img) => img.className.includes("object-bottom"));
    expect(mobileImg).not.toBeUndefined();
    const imgClassName = (mobileImg as HTMLImageElement).className;

    // Same multiplier (100) and same custom property + fallback (--app-vh,
    // 7.6px) as the Hero section's own real CSS rule, confirmed against
    // styles.css directly above -- a Tailwind arbitrary value, so no
    // internal whitespace around the calc() arguments.
    expect(imgClassName).toContain("h-[calc(var(--app-vh,7.6px)*100)]");
    // Guards against regressing to the previously-tried-and-reverted
    // percentage-height state (measured 584px instead of 744px on the
    // physical device, the original band).
    expect(imgClassName).not.toMatch(/\bh-full\b/);
  });
});
