import type { CSSProperties } from "react";
import msmLogo from "@/assets/msm-logo.svg";

/**
 * The one loading/error screen shown while an Owner route's auth guard is
 * resolving — OwnerShell.tsx's own guard, and routes/owner/login.tsx's
 * already-signed-in check. Every style here is a plain inline `style`
 * object, never a Tailwind class: this is the very first thing painted for
 * any Owner route, frequently before the external stylesheet has finished
 * loading (or, against a stale-served build whose HTML references a
 * stylesheet hash that no longer exists on disk, before it ever loads at
 * all) — so it cannot depend on any external CSS to render correctly.
 *
 * This is the actual fix for the "unstyled white screen with a giant
 * malformed logo" regression: the previous markup used bg-[#080A1D] and
 * h-7 w-auto Tailwind classes for this exact screen. With no stylesheet
 * applied, the browser falls back to its own defaults (white background,
 * serif black text) and — critically — the <img>'s own `width`/`height`
 * HTML attributes (1174x417, the SVG's real intrinsic size) become its
 * actual rendered size once the `h-7 w-auto` class that would normally
 * constrain it never applies. Inline styles need no separate network
 * request and cannot 404 or race against anything, so this screen is
 * structurally immune to that failure mode regardless of stylesheet timing.
 */

export interface OwnerAuthBootstrapScreenProps {
  readonly status: "checking" | "error";
  readonly message: string;
  /** Only rendered when status is "error" — a "checking" screen has nothing to retry yet. */
  readonly onRetry?: () => void;
  /** Matches each call site's own established logo height (OwnerShell: 28px / h-7, the login screen: 32px / h-8) rather than picking one value for both. */
  readonly logoHeightPx?: number;
}

const SHELL_STYLE: CSSProperties = {
  display: "flex",
  minHeight: "100vh",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "16px",
  paddingLeft: "16px",
  paddingRight: "16px",
  backgroundColor: "#080A1D",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const TEXT_STYLE: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: "20px",
  color: "rgba(255, 255, 255, 0.7)",
  textAlign: "center",
};

/** The codebase's own --copper-bright token (oklch(0.72 0.13 60)) inlined verbatim — oklch() is native CSS the browser itself parses, not something that needs Tailwind/PostCSS to understand, so this stays on-brand without depending on the stylesheet either. */
const RETRY_BUTTON_STYLE: CSSProperties = {
  marginTop: "4px",
  padding: "8px 18px",
  fontSize: "14px",
  lineHeight: "20px",
  fontWeight: 600,
  color: "#080A1D",
  backgroundColor: "oklch(0.72 0.13 60)",
  border: "none",
  borderRadius: "9999px",
  cursor: "pointer",
};

export function OwnerAuthBootstrapScreen({ status, message, onRetry, logoHeightPx = 28 }: OwnerAuthBootstrapScreenProps) {
  return (
    <div style={SHELL_STYLE}>
      <img src={msmLogo} alt="MSM Scrap" width={1174} height={417} style={{ height: `${logoHeightPx}px`, width: "auto", display: "block" }} />
      <p role={status === "error" ? "alert" : "status"} aria-live="polite" style={TEXT_STYLE}>
        {message}
      </p>
      {status === "error" && onRetry ? (
        <button type="button" onClick={onRetry} style={RETRY_BUTTON_STYLE}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
