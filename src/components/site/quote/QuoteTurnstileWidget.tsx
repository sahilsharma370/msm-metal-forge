import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * CHECKPOINT C2G — hand-rolled Cloudflare Turnstile widget (no new npm
 * dependency). Renders Cloudflare's own "Managed" widget via the global
 * `window.turnstile` API loaded from https://challenges.cloudflare.com/turnstile/v0/api.js.
 *
 * Mirrors TURNSTILE_EXPECTED_ACTION from src/server/turnstile.server.ts as a
 * duplicated literal, never an import — this file is browser code and the
 * project build hard-denies any client-side import resolving under
 * `**\/server/**` (see quote-submission-transport.ts's own doc comment for
 * the full explanation).
 *
 * The token this widget produces is purely ephemeral: it is handed to the
 * caller via onToken and never stored by this component (no state, no ref
 * used for anything but the widget id) — the caller (QuoteExperience) is
 * responsible for holding it only in memory, forwarding it to exactly one
 * initiate() call, and never logging or persisting it.
 */

export const TURNSTILE_ACTION = "quote_submit";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme?: "light" | "dark" | "auto";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
}

interface TurnstileGlobal {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

/** Loads the Turnstile script at most once per page, regardless of how many widget instances mount. */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile_script_failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("turnstile_script_failed"));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

export interface QuoteTurnstileWidgetHandle {
  /** Discards the current challenge and requests a brand-new one — the only way to get a fresh token while this component stays mounted (e.g. retrying without navigating away from Review). */
  reset(): void;
}

export interface QuoteTurnstileWidgetProps {
  /** Public Turnstile site key — safe to expose in the client bundle by design. */
  siteKey: string;
  /** Called with a fresh, single-use token every time the widget successfully completes a challenge. */
  onToken: (token: string) => void;
  /** Called on expiry, in-widget error, or timeout — the caller should treat any current token as no longer usable. */
  onUnusable: () => void;
}

export const QuoteTurnstileWidget = forwardRef<
  QuoteTurnstileWidgetHandle,
  QuoteTurnstileWidgetProps
>(function QuoteTurnstileWidget({ siteKey, onToken, onUnusable }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onUnusableRef = useRef(onUnusable);
  onTokenRef.current = onToken;
  onUnusableRef.current = onUnusable;

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          // C2L-Q4 — the Quote Experience is permanently dark-navy (never
          // a light theme), so "auto" (which follows the visitor's OS/
          // browser colour-scheme preference) could render a jarring
          // white Turnstile box. "dark" is an officially supported
          // Turnstile theme value — this only changes which of
          // Cloudflare's own pre-built widget skins renders, not
          // verification behaviour.
          theme: "dark",
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onUnusableRef.current(),
          "expired-callback": () => onUnusableRef.current(),
          "timeout-callback": () => onUnusableRef.current(),
        });
      })
      .catch(() => onUnusableRef.current());

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  return <div ref={containerRef} data-testid="quote-turnstile-widget" />;
});
