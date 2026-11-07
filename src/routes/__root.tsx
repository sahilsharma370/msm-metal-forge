import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import faviconIcon from "../assets/favicon-msmready.svg";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { useStableViewportHeight } from "../hooks/use-stable-viewport-height";
import { classifyRenderPath, logUnhandledError } from "../lib/error-capture";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  logUnhandledError(error, classifyRenderPath(router.state.location.pathname));
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MSM Scrap | Metal Scrap Trading in Sharjah, UAE" },
      {
        name: "description",
        content:
          "Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, exporting and importing metal scrap across the UAE.",
      },
      { name: "author", content: "MSM Scrap" },
      { property: "og:title", content: "MSM Scrap | Metal Scrap Trading in Sharjah, UAE" },
      {
        property: "og:description",
        content: "Transparent weighing and UAE-wide pickup for copper, aluminium, steel and lead.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: faviconIcon, type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Cormorant+Garamond:ital,wght@1,300&display=swap",
      },
      { rel: "stylesheet", href: "https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// A physical-device trace proved `svh` is not actually fixed at the
// browser's collapsed-toolbar height on this iOS browser — it tracks the
// live viewport exactly like `dvh`, which let toolbar-only scroll-chrome
// changes alone shrink Hero/WhatWeDo/Materials' mobile height and shift
// Materials' own scroll-progress math (see those files' own comments on
// `--app-vh`). This script is the one place `--app-vh` is ever *set*: it
// runs synchronously, before any stylesheet-driven layout of the body, and
// captures 1% of `window.innerHeight` at that moment — a fresh page load's
// toolbar is shown by default (the browser only collapses it once the user
// scrolls), so this naturally captures the small, shown-toolbar viewport,
// exactly as required. It is intentionally the *only* write here; ongoing
// updates (width/orientation changes only, never toolbar-only height
// changes) are handled by the effect in RootComponent below, not by this
// script re-running.
const STABLE_VH_SCRIPT = `(function(){try{document.documentElement.style.setProperty('--app-vh',(window.innerHeight/100)+'px');}catch(e){}})();`;

// Marks "JS actually runs here" before first paint, same technique and
// timing as STABLE_VH_SCRIPT above — no measurement, no logic, just a
// class. Used by styles.css to pre-apply ScrollStack.tsx's initial
// `yPercent: 100` offset to TrustBar (see `.trust-stage-offset` there) only
// where GSAP will actually exist to take over and later animate it back —
// true no-JS loads never add this class, so TrustBar keeps its normal,
// fully visible fallback layout there untouched.
const JS_ENABLED_SCRIPT = `(function(){try{document.documentElement.classList.add('js');}catch(e){}})();`;

// MEASURED ROOT CAUSE (reload-while-already-scrolled-past-Trust flash) —
// confirmed live via instrumented position/transform + img.complete
// polling across a reload at that scroll position: the crane image was
// already fully loaded throughout (ruling out an image-fetch delay). The
// actual defect: `.js .trust-stage-offset` in styles.css (see its own
// comment) applies its `translateY(100%)` hide unconditionally — correct
// for a fresh load at scrollY 0 (where hydration has nothing to correct,
// exactly as that rule's own comment describes), but wrong when the
// browser restores scroll already past this section's entry distance.
//
// Two candidate fixes were measured live and ruled out before this one:
//   1. Reading `window.scrollY` from a script this early (same position as
//      STABLE_VH_SCRIPT/JS_ENABLED_SCRIPT, in <head>) always saw 0, even on
//      a reload the browser went on to restore to a real scrolled
//      position — the browser hadn't performed its own restoration yet at
//      that point.
//   2. Setting `history.scrollRestoration = 'manual'` to take over
//      restoration entirely had no effect on a plain reload — the browser
//      still restored scrollY to the pre-reload position regardless;
//      `scrollRestoration` does not appear to govern same-URL reloads the
//      way it does back/forward navigation in this browser.
// A third probe (a synchronous script placed at the END of <body>, after
// the SSR'd markup but before the hydration bundle's own <Scripts/> tag —
// still mid-parse, still before first paint, just later than <head>)
// measured `window.scrollY` ALREADY matching the real restored position on
// the very same reload where <head> saw 0 — so the browser performs its
// restoration synchronously, during HTML parsing, somewhere between
// </head> and here. This script reads it at that point and applies the
// release directly, inline, as plain CSS text content — not a class
// toggle plus a separate stylesheet rule, since that would still need the
// stylesheet rule to win the cascade reliably; setting the transform
// directly on the element removes any ordering question entirely. Scoped
// to the exact same `(min-width: 1024px) and (prefers-reduced-motion: no-
// preference)` population `.trust-stage-offset` itself targets, and to the
// same 60%-of-viewport-height entry distance `.hero-stage-height` bakes
// into CSS there (via the same `--app-vh` STABLE_VH_SCRIPT sets above) —
// the same threshold ScrollStack.tsx's own `stageA` trigger treats as
// progress 1. With this applied, the very first painted frame already
// matches hydration's own "released" state in this case too, with nothing
// left for it to visibly correct — same outcome the original rule's
// comment already claims for the scrollY-0 case, now true for this one as
// well.
export const RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT = `(function(){try{
  var mq = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');
  if (!mq.matches) return;
  if (window.scrollY < window.innerHeight * 0.6) return;
  var el = document.querySelector('.trust-stage-offset');
  if (el) el.style.transform = 'none';
} catch(e) {}})();`;

// MEASURED ROOT CAUSE (reload-while-already-scrolled-into-Services flash) —
// same end-of-<body> technique as RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT
// above, confirmed live via frame-by-frame polling of the pinned canvas's
// computed position/rect and the stage image's own `complete`/visibility
// across a reload deep in WhatWeDo.tsx's Services journey: the stage image
// was already fully loaded in the very first captured frame (ruling out a
// missing-asset cause), but the pinned `canvas` div is still
// `position: relative`, sitting at its own natural (un-pinned) document
// position — one viewport tall — until GSAP's `ScrollTrigger` pin (see
// `pin: canvas` there) converts it to `position: fixed` a frame or two
// later. At any restored scroll position deeper than that one natural
// viewport into the section's now-correctly-reserved 3.8-viewport height
// (`.services-stage-height` in styles.css), canvas's un-pinned box sits
// entirely above the viewport, so the very first painted frame shows
// nothing but the section's own flat background — not the stage/truck/lamp
// — until the pin catches up.
//
// Fixed with a `transform`, not `position`, and deliberately not by baking
// `position: fixed` into this early script: ScrollTrigger's pin setup
// measures the pinned element's *current* inline/computed state the moment
// it runs, to know what to restore on unpin/teardown (e.g. scrolling back
// above the section, or this `gsap.matchMedia` match reverting on a
// desktop -> mobile breakpoint switch) — if this script had already forced
// `position: fixed` here, that would be the wrong "original" position for
// ScrollTrigger to capture and later revert to. A `transform` on canvas is
// never written or read by its own pin setup (pin positioning is
// position/top/left, not transform), so it can't corrupt that bookkeeping,
// as long as WhatWeDo.tsx's own gsap.context clears it again as its very
// first synchronous action — before ScrollTrigger.create ever runs — which
// it now does.
//
// `offset` is clamped to `[0, pinDistance]` (`pinDistance` mirrors
// WhatWeDo.tsx's own `window.innerHeight * 2.8` pin end distance exactly)
// because this covers all three zones with one formula: at/above the
// section (offset 0, canvas's natural position is already correct),
// anywhere inside the pinned range (offset == how far scrolled past the
// section start, matching exactly where the real `position: fixed` pin
// would show it), and past the pin's end, already scrolled into where
// canvas resumes normal flow after release (offset pinned at the max —
// its own natural post-release position, not a still-growing one).
// Gated to the same `(min-width: 1024px) and (prefers-reduced-motion:
// no-preference)` population the pin itself only ever activates for (see
// WhatWeDo.tsx's `reduced` early-return and its `mm.add("(min-width:
// 1024px)", ...)`) — outside that population canvas is never pinned at
// all, so pre-offsetting it here would never get cleared.
export const PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT = `(function(){try{
  var mq = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');
  if (!mq.matches) return;
  var section = document.querySelector('#services');
  var canvas = document.querySelector('.services-pin-canvas');
  if (!section || !canvas) return;
  var sectionTop = section.getBoundingClientRect().top + window.scrollY;
  var pinDistance = window.innerHeight * 2.8;
  var offset = window.scrollY - sectionTop;
  if (offset < 0) offset = 0;
  if (offset > pinDistance) offset = pinDistance;
  if (offset > 0) canvas.style.transform = 'translateY(' + offset + 'px)';
} catch(e) {}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: STABLE_VH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: JS_ENABLED_SCRIPT }} />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: RELEASE_TRUST_IF_ALREADY_PAST_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PIN_SERVICES_CANVAS_IF_ALREADY_PAST_SCRIPT }} />
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useStableViewportHeight();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
