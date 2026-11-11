import type { ReactElement } from "react";
import { render as testingLibraryRender, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * PERF — several owner data hooks now read/write a shared cache through
 * the app's own QueryClient (see src/components/owner/owner-data-cache.ts;
 * the client itself is already provided app-wide in production, see
 * src/routes/__root.tsx). A plain `render()` from testing-library has no
 * provider in its tree, so `useQueryClient()` throws. Same exact `render`
 * signature as testing-library's own, so existing call sites only need
 * their import line changed — nothing else — to pick this up; everything
 * else re-exports testing-library's own named exports unchanged.
 *
 * A fresh QueryClient per call: cache state must never leak between
 * tests, exactly like the real app gets one fresh client per page load.
 */
export function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  const queryClient = new QueryClient();
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    ...options,
  });
}

/** For the rarer test that needs to inspect/seed the QueryClient a rendered component reads/writes (e.g. the owner photo viewer's reopen cache) — `render` above stays a same-signature drop-in for every other call site, so this is a separate named export rather than a third parameter on it. */
export function renderWithQueryClient(ui: ReactElement, queryClient: QueryClient, options?: RenderOptions): RenderResult {
  return testingLibraryRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    ...options,
  });
}

export * from "@testing-library/react";
