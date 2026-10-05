import type { ReactNode } from "react";

/**
 * CHECKPOINT C2L-V2 — the one shared desktop alignment container (matches
 * OwnerShell's own header container exactly) so a page's title, panels and
 * the header above it all line up on the same left/right edges — used by
 * every owner page body, never redeclared as a second literal elsewhere.
 */
export const OWNER_CONTAINER_CLASS = "mx-auto w-full max-w-[1760px] px-8 lg:px-12";

/**
 * One consistent page title/subtitle/actions header, used at the top of
 * every primary owner page (Enquiries, Overview, Quick Add) so title scale,
 * placement and action alignment never vary page to page. Title sits at the
 * page-title scale (28px/600, General Sans) — a page title, not a small
 * table-row label.
 */
export interface OwnerPageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  /** The Enquiries page only — the reference has no divider under this region at desktop. Mobile/tablet and every other page keep the divider. */
  readonly noDesktopDivider?: boolean;
}

export function OwnerPageHeader({ title, description, actions, noDesktopDivider = false }: OwnerPageHeaderProps) {
  return (
    <div className={`border-b border-white/10 ${noDesktopDivider ? "lg:border-b-0" : ""}`}>
      {/* Reduced vertical padding (py-5, not py-7) — the 28px title scale itself is preserved; only the surrounding whitespace shrank.
          lg: — a larger title scale to match the reference's dominant page
          heading, and tighter py so the command bar below sits higher. */}
      <div className={`${OWNER_CONTAINER_CLASS} flex flex-wrap items-center justify-between gap-4 py-5 lg:py-4`}>
        <div>
          <h2 className="font-display text-[28px] leading-tight font-semibold text-foreground lg:text-4xl">{title}</h2>
          {description ? <p className="mt-1 text-sm text-foreground/70">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
