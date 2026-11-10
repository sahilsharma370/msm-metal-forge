import type { QueryClient } from "@tanstack/react-query";

/**
 * PERF — a thin, imperative cache layer built on the app's own already-
 * provided QueryClient (see src/router.tsx/__root.tsx — it wraps the whole
 * app, previously unused by any owner code). Deliberately NOT a switch to
 * the `useQuery` hook API: use-owner-lead-list.ts's filter/view/pagination
 * state machine is large and already has its own extensive test coverage;
 * rewriting it to `useQuery`/`useInfiniteQuery` would be a much bigger,
 * riskier change than this task calls for. Instead, each read hook keeps
 * its own existing state machine and fetch logic exactly as before, and
 * just consults this cache at the start of a load (synchronous, no network)
 * and writes the fresh result back to it on success — the QueryClient is
 * used purely as a keyed store with a last-write timestamp, nothing more.
 *
 * Freshness window matches OwnerShell's own session-check cache (30s) —
 * same "safe to trust immediately for in-app navigation, never stale
 * enough to meaningfully diverge from the real data" judgement call.
 */
export const OWNER_DATA_CACHE_FRESH_MS = 30_000;

export function ownerListQueryKey(view: string, filters: unknown): readonly unknown[] {
  return ["owner", "leads", "list", view, filters];
}
export function ownerDetailQueryKey(leadId: string): readonly unknown[] {
  return ["owner", "leads", "detail", leadId];
}
export function ownerOverviewQueryKey(): readonly unknown[] {
  return ["owner", "leads", "overview"];
}

export function getCachedOwnerData<T>(queryClient: QueryClient, key: readonly unknown[]): T | undefined {
  return queryClient.getQueryData<T>(key as unknown[]);
}

export function setCachedOwnerData<T>(queryClient: QueryClient, key: readonly unknown[], value: T): void {
  queryClient.setQueryData<T>(key as unknown[], value);
}

/** True only when a cached entry exists AND was written within the freshness window — never true for a present-but-stale entry (that case is for the caller to decide: serve it immediately while revalidating in the background, never block on network first). */
export function isOwnerDataFresh(queryClient: QueryClient, key: readonly unknown[]): boolean {
  const state = queryClient.getQueryState(key as unknown[]);
  if (!state || state.dataUpdatedAt === 0) return false;
  return Date.now() - state.dataUpdatedAt < OWNER_DATA_CACHE_FRESH_MS;
}

/**
 * Invalidation after a mutation — always removes (never just marks stale)
 * the affected entries, so the next read unconditionally hits the network
 * for fresh data rather than relying on react-query's own observer-driven
 * stale/refetch machinery, which nothing here is set up to use (no
 * `useQuery` observers exist for these keys). A status/note/trash/restore/
 * edit/create on any lead can change which filtered list views it
 * appears under and always changes the Overview KPIs — rather than
 * guessing which exact (view, filters) list-cache entries are affected,
 * every list/overview cache entry is cleared outright; this is a
 * low-traffic admin tool, not a scale target worth the precision.
 */
export function invalidateOwnerLeadCaches(queryClient: QueryClient, leadId?: string): void {
  queryClient.removeQueries({ queryKey: ["owner", "leads", "list"] });
  queryClient.removeQueries({ queryKey: ["owner", "leads", "overview"] });
  if (leadId) queryClient.removeQueries({ queryKey: ownerDetailQueryKey(leadId) });
}
