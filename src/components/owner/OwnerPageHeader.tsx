import type { ReactNode } from "react";

/**
 * CHECKPOINT C2L-V2 — the one shared desktop alignment container (matches
 * OwnerShell's own header container exactly) so a page's title, panels and
 * the header above it all line up on the same left/right edges — used by
 * every owner page body, never redeclared as a second literal elsewhere.
 */
export const OWNER_CONTAINER_CLASS = "mx-auto w-full max-w-[1600px] px-8";

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
}

export function OwnerPageHeader({ title, description, actions }: OwnerPageHeaderProps) {
  return (
    <div className="border-b border-white/10">
      {/* Reduced vertical padding (py-5, not py-7) — the 28px title scale itself is preserved; only the surrounding whitespace shrank. */}
      <div className={`${OWNER_CONTAINER_CLASS} flex flex-wrap items-center justify-between gap-4 py-5`}>
        <div>
          <h2 className="font-display text-[28px] leading-tight font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-foreground/70">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
