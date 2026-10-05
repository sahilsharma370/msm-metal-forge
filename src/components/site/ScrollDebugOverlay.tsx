import { useEffect, useRef, useState } from "react";

/**
 * TEMPORARY DIAGNOSTIC — activated only by `?debugScroll=1` on a DEV build
 * (gated at the mount site in routes/index.tsx via `import.meta.env.DEV`,
 * so this component's code is dead-code-eliminated from production bundles
 * entirely, not just inert). Purpose: capture what the real device actually
 * measures during the reported upward-scroll jerk around What We Trade,
 * since the previous viewport fix (svh-based Hero height, resize/hysteresis
 * guards) passed build but did not resolve it on a physical iPhone — this
 * does not change or guess at a fix, it only observes.
 *
 * Reads are entirely independent of Materials.tsx's own React state: it
 * re-derives `progress`/`range`/`active` from the DOM using the *exact same
 * formula* Materials.tsx's own `useMobileMaterialProgress` uses internally
 * (see that file), via two ids added there purely for this purpose
 * (`#materials-mobile-narrative`, `#materials-mobile-sticky`) plus the
 * pre-existing `#materials`/`#home` ids and the mobile tab buttons' own
 * `aria-selected` state — zero behavioural change to Materials.tsx, and if
 * this diagnostic is ever removed, deleting this file plus its one mount
 * line is the entire cleanup (the two ids are inert markup otherwise).
 *
 * No layout impact (fixed-position, zero document-flow footprint), no
 * touch/scroll interception (every listener is passive; the container is
 * `pointer-events-none` except its own small controls), no network calls,
 * no customer data — only page geometry and scroll numbers, kept in memory
 * and exposed via a copy button (when the Clipboard API actually works) and
 * an always-present, always-selectable textarea fallback (the LAN HTTP
 * origin this is reproduced over is not a secure context, so
 * `navigator.clipboard` may not exist or may silently reject at all).
 */

type Sample = {
  t: number;
  scrollY: number;
  vw: number;
  vh: number;
  vvh: number | null;
  docH: number;
  heroBottom: number | null;
  materialsTop: number | null;
  stickyTop: number | null;
  stickyHeight: number | null;
  narrativeHeight: number | null;
  progress: number | null;
  range: number | null;
  computedActive: number | null;
  domActiveKey: string | null;
  domActiveIndex: number | null;
  reason: "scroll" | "resize" | "active-change" | "init";
};

const MAX_SAMPLES = 150;
const SCROLL_SAMPLE_MIN_INTERVAL_MS = 250;
// Mirrors MATERIALS' own key order in Materials.tsx (copper, aluminium,
// steel, lead) purely so the DOM-observed active tab's key can be compared
// against `computedActive`'s numeric index — not a shared import, since
// this file must stay a read-only observer of Materials.tsx, not a
// consumer of its internals.
const MATERIAL_KEY_ORDER = ["copper", "aluminium", "steel", "lead"];

function readDomActiveMaterial(): { key: string | null; index: number | null } {
  const tabs = document.querySelectorAll('[id^="material-tab-mobile-"]');
  for (const tab of tabs) {
    if (tab.getAttribute("aria-selected") === "true") {
      const key = tab.id.replace("material-tab-mobile-", "");
      const index = MATERIAL_KEY_ORDER.indexOf(key);
      return { key, index: index === -1 ? null : index };
    }
  }
  return { key: null, index: null };
}

function measure(): Omit<Sample, "t" | "reason"> {
  const hero = document.getElementById("home");
  const materials = document.getElementById("materials");
  const narrative = document.getElementById("materials-mobile-narrative");
  const sticky = document.getElementById("materials-mobile-sticky");

  let progress: number | null = null;
  let range: number | null = null;
  let computedActive: number | null = null;
  let stickyTop: number | null = null;
  let stickyHeight: number | null = null;
  let narrativeHeight: number | null = null;

  if (narrative && sticky) {
    // Mirrors Materials.tsx's own useMobileMaterialProgress measure()/
    // update() exactly — same getComputedStyle read, same clamp, same
    // formula — so this reflects what production is actually doing, not an
    // approximation.
    stickyTop = parseFloat(getComputedStyle(sticky).top) || 0;
    stickyHeight = sticky.offsetHeight;
    narrativeHeight = narrative.offsetHeight;
    range = Math.max(1, narrativeHeight - stickyHeight);
    const rect = narrative.getBoundingClientRect();
    progress = Math.min(1, Math.max(0, (stickyTop - rect.top) / range));
    computedActive = Math.round(progress * 3);
  }

  const domActive = readDomActiveMaterial();

  return {
    scrollY: window.scrollY,
    vw: window.innerWidth,
    vh: window.innerHeight,
    vvh: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    docH: document.documentElement.scrollHeight,
    heroBottom: hero ? Math.round(hero.getBoundingClientRect().bottom) : null,
    materialsTop: materials ? Math.round(materials.getBoundingClientRect().top) : null,
    stickyTop,
    stickyHeight,
    narrativeHeight,
    progress: progress == null ? null : Math.round(progress * 1000) / 1000,
    range,
    computedActive,
    domActiveKey: domActive.key,
    domActiveIndex: domActive.index,
  };
}

function isMeaningfullyDifferent(a: Sample | undefined, b: Omit<Sample, "t" | "reason">) {
  if (!a) return true;
  return (
    a.scrollY !== b.scrollY ||
    a.vw !== b.vw ||
    a.vh !== b.vh ||
    a.vvh !== b.vvh ||
    a.docH !== b.docH ||
    a.heroBottom !== b.heroBottom ||
    a.materialsTop !== b.materialsTop ||
    a.stickyTop !== b.stickyTop ||
    a.stickyHeight !== b.stickyHeight ||
    a.narrativeHeight !== b.narrativeHeight ||
    a.progress !== b.progress ||
    a.computedActive !== b.computedActive ||
    a.domActiveKey !== b.domActiveKey
  );
}

function domActiveChanged(a: Sample | undefined, b: Omit<Sample, "t" | "reason">) {
  return !a || a.domActiveKey !== b.domActiveKey || a.domActiveIndex !== b.domActiveIndex;
}

function formatTrace(samples: Sample[]) {
  const header =
    "t,reason,scrollY,vw,vh,vvh,docH,heroBottom,materialsTop,stickyTop,stickyHeight,narrativeHeight,progress,range,computedActive,domActiveKey,domActiveIndex";
  const rows = samples.map((s) =>
    [
      s.t,
      s.reason,
      s.scrollY,
      s.vw,
      s.vh,
      s.vvh ?? "",
      s.docH,
      s.heroBottom ?? "",
      s.materialsTop ?? "",
      s.stickyTop ?? "",
      s.stickyHeight ?? "",
      s.narrativeHeight ?? "",
      s.progress ?? "",
      s.range ?? "",
      s.computedActive ?? "",
      s.domActiveKey ?? "",
      s.domActiveIndex ?? "",
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export function ScrollDebugOverlay() {
  // `?debugScroll=1` is the activation switch (checked client-side only —
  // this must never evaluate `window`/`location` during SSR). Starts
  // inactive on every render (server and the initial client hydration
  // pass, so markup matches) and flips on in an effect if the query param
  // is present, same pattern this codebase already uses for other
  // client-only checks (e.g. `useReducedMotion`).
  const [active, setActive] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const lastRef = useRef<Sample | undefined>(undefined);
  const lastScrollSampleAtRef = useRef(0);
  const startRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setActive(new URLSearchParams(window.location.search).get("debugScroll") === "1");
    setClipboardAvailable(typeof navigator !== "undefined" && !!navigator.clipboard?.writeText);
  }, []);

  useEffect(() => {
    if (!active) return;
    startRef.current = performance.now();
    lastScrollSampleAtRef.current = 0;

    const push = (reason: Sample["reason"], m: Omit<Sample, "t" | "reason">) => {
      if (reason !== "init" && !isMeaningfullyDifferent(lastRef.current, m)) return;
      const sample: Sample = { t: Math.round(performance.now() - startRef.current), reason, ...m };
      lastRef.current = sample;
      setSamples((prev) => {
        const next = prev.length >= MAX_SAMPLES ? prev.slice(prev.length - MAX_SAMPLES + 1) : prev;
        return [...next, sample];
      });
    };

    push("init", measure());

    // Scroll is rate-limited to at most one sample per
    // SCROLL_SAMPLE_MIN_INTERVAL_MS — but an actual metal-state change
    // (the DOM's own `aria-selected` tab flipping) always bypasses that
    // limit and is captured immediately, on the very scroll event that
    // caused it, same as a resize.
    const onScroll = () => {
      const m = measure();
      if (domActiveChanged(lastRef.current, m)) {
        push("active-change", m);
        lastScrollSampleAtRef.current = performance.now();
        return;
      }
      const now = performance.now();
      if (now - lastScrollSampleAtRef.current < SCROLL_SAMPLE_MIN_INTERVAL_MS) return;
      lastScrollSampleAtRef.current = now;
      push("scroll", m);
    };
    const onResize = () => push("resize", measure());

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize);

    // Safety net for a metal-state change that settles with no further
    // scroll/resize event at all (e.g. right as inertia stops).
    const activeCheck = window.setInterval(() => {
      const m = measure();
      push(domActiveChanged(lastRef.current, m) ? "active-change" : "scroll", m);
    }, SCROLL_SAMPLE_MIN_INTERVAL_MS);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.clearInterval(activeCheck);
    };
  }, [active]);

  if (!active) return null;

  const trace = formatTrace(samples);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[999] flex flex-col items-end gap-1 p-2">
      <div className="pointer-events-auto flex max-h-[40vh] w-[min(92vw,480px)] flex-col gap-1 rounded bg-black/90 p-2 shadow">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-white/70">{samples.length} samples</span>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded bg-white/15 px-2 py-1 font-mono text-[10px] text-white"
              onClick={() => {
                const el = textareaRef.current;
                if (!el) return;
                el.focus();
                el.select();
              }}
            >
              Select all
            </button>
            {clipboardAvailable && (
              <button
                type="button"
                className="rounded bg-white/15 px-2 py-1 font-mono text-[10px] text-white"
                onClick={() => {
                  navigator.clipboard.writeText(trace).then(
                    () => {
                      setCopyState("copied");
                      window.setTimeout(() => setCopyState("idle"), 1500);
                    },
                    () => {
                      // Never show "Copied" on failure — the textarea above
                      // is the always-available fallback.
                      setCopyState("idle");
                    },
                  );
                }}
              >
                {copyState === "copied" ? "Copied" : "Copy trace"}
              </button>
            )}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          readOnly
          value={trace}
          // 16px is the iOS Safari threshold below which focusing a text
          // input triggers the page's own auto-zoom — this textarea is
          // meant to be tapped/selected on the phone mid-reproduction, so
          // it must stay at or above that size.
          className="h-32 w-full resize-none overflow-x-auto rounded bg-black/60 p-1 font-mono text-[16px] leading-tight whitespace-pre text-white/90"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </div>
  );
}
