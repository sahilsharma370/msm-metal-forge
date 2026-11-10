import { createContext, useContext } from "react";
import type { RegisterOwnerShellRefresh } from "./OwnerShell";
import type { OwnerIdentitySummary } from "./owner-session-checker";

/**
 * PERF — split out of src/routes/owner.tsx on purpose. TanStack Router's
 * file-route plugin code-splits every route file into its own chunk; when
 * this Context (and the hook consuming it) lived inside owner.tsx itself,
 * Rollup produced TWO independent copies of that module — one inside
 * owner.tsx's own route chunk, another pulled into whichever chunk each
 * sibling route file's own `import { useOwnerShellContext } from
 * "@/routes/owner"` landed in — so `createContext()` ran twice, giving two
 * unrelated Context objects. A Provider using instance A was invisible to
 * `useContext` calls using instance B: every child route's
 * useOwnerShellContext() threw "must be called from a route rendered
 * inside the /owner layout" even though it very much was — reproduced live
 * in a real browser (confirmed by grepping the built output: the guard
 * string appeared in two separate asset files). A plain, non-route module
 * is never subject to that per-route splitting, so every importer — the
 * layout route and all five child routes — shares exactly one Context
 * instance.
 */

export interface OwnerShellContextValue {
  readonly owner: OwnerIdentitySummary;
  readonly registerRefresh: RegisterOwnerShellRefresh;
  /** For a page's own data call failing with 401 post-mount — always reason "unauthorized" (the shell already proved a token existed and was accepted once; a later failure means no longer authorized, never "never had one"). */
  readonly onUnauthorized: () => void;
}

export const OwnerShellReactContext = createContext<OwnerShellContextValue | null>(null);

export function useOwnerShellContext(): OwnerShellContextValue {
  const ctx = useContext(OwnerShellReactContext);
  if (!ctx) throw new Error("useOwnerShellContext must be called from a route rendered inside the /owner layout.");
  return ctx;
}
