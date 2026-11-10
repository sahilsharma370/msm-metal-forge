// @vitest-environment jsdom
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@/test-utils/render-with-query-client";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as transport from "@/components/owner/owner-leads-transport";
import type { RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";

// TEST-HARNESS FIX (full-suite timeout flake) — every `userEvent.setup()`
// here uses `{ delay: null }`; see OwnerLeadQuickAddForm.test.tsx's own
// top-of-file comment for the measured root cause (a timed-out test's
// orphaned real-timer keystroke delays keep firing into whichever test
// runs next). No application code changed.
// CHECKPOINT C2J-F: OwnerLeadInbox now always renders a real <Link> (the
// "Add enquiry" Quick Add entry point), which needs a live RouterProvider to
// resolve — this harness renders OwnerInboxBody without one (see the header
// comment below), so <Link> is swapped for a plain anchor here, matching the
// same substitution OwnerLeadInbox.test.tsx and routes/owner/leads/$leadId.test.tsx
// already use for the identical reason.
// CHECKPOINT (test-harness fix) — OwnerInboxBody calls Route.useSearch()
// directly (added for the ?status= deep-link filter), which needs a real
// RouterProvider to resolve; this harness renders OwnerInboxBody without
// one (see the header comment above), so createFileRoute's returned Route
// is stubbed with a fixed useSearch() here, same substitution rationale as
// the existing Link stub below.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      useSearch: () => ({}),
    }),
  };
});

/**
 * CHECKPOINT C2J-D1 — regression test proving the route wrapper does not
 * cause a repeated-render/repeated-fetch loop. `OwnerInboxBody` is the
 * real production component (exported specifically so this test can render
 * it without a full TanStack RouterProvider — its one router dependency,
 * Route.useSearch(), is stubbed above exactly like the Link substitution
 * is); only the transport module's network call is mocked, exactly like
 * use-owner-lead-list.test.ts.
 *
 * `ShellRefreshHarness` below is not a simplification — it is a faithful
 * miniature of OwnerShell's own registerRefresh mechanism (see
 * OwnerShell.tsx: registerRefresh -> setRefreshHandler/setIsRefreshing ->
 * re-render -> children(...) called again). A plain `vi.fn()` passed as
 * registerRefresh would silently hide the real bug this test targets: it
 * would record calls without ever causing the re-render that is the actual
 * trigger, so an early version of this test (registerRefresh as a bare
 * spy) passed even against the pre-fix, unmemoized `deps` — verified by
 * temporarily reverting the useMemo fix and re-running: it failed to
 * detect the loop until the harness below was used instead.
 */
vi.mock("@/components/owner/owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/owner/owner-leads-transport")>();
  return { ...actual, fetchOwnerLeadList: vi.fn() };
});

const fetchOwnerLeadListMock = vi.mocked(transport.fetchOwnerLeadList);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function ShellRefreshHarness({
  onUnauthorized,
  onRegisterCall,
  renderBody,
}: {
  readonly onUnauthorized: () => void;
  readonly onRegisterCall?: () => void;
  readonly renderBody: (props: { onUnauthorized: () => void; registerRefresh: RegisterOwnerShellRefresh }) => React.ReactNode;
}) {
  const [refreshHandler, setRefreshHandler] = useState<(() => void) | null>(null);
  const [, setIsRefreshing] = useState(false);

  const registerRefresh = useCallback<RegisterOwnerShellRefresh>(
    (handler, refreshing) => {
      onRegisterCall?.();
      setRefreshHandler(() => handler);
      setIsRefreshing(refreshing);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <>
      {refreshHandler ? (
        <button type="button" onClick={refreshHandler}>
          Trigger registered refresh
        </button>
      ) : null}
      {renderBody({ onUnauthorized, registerRefresh })}
    </>
  );
}

describe("OwnerInboxBody — dependency-identity stability", () => {
  it("one initial render causes exactly one request", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const { OwnerInboxBody } = await import("./index");
    render(
      <ShellRefreshHarness onUnauthorized={vi.fn()} renderBody={(props) => <OwnerInboxBody {...props} />} />,
    );
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1));
    await flush();
    await flush();
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);
  });

  it("the registerRefresh call count converges — no unbroken render loop through real OwnerShell-shaped state", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    let registerCount = 0;
    const { OwnerInboxBody } = await import("./index");
    render(
      <ShellRefreshHarness
        onUnauthorized={vi.fn()}
        onRegisterCall={() => {
          registerCount += 1;
        }}
        renderBody={(props) => <OwnerInboxBody {...props} />}
      />,
    );
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1));
    await flush();
    const countAfterFirstSettle = registerCount;
    await flush();
    await flush();
    // Pre-fix, this grows every tick (each registerRefresh call sets new
    // state -> re-renders OwnerInboxBody -> rebuilds `deps` -> new
    // `refresh` identity -> the effect fires again -> registerRefresh
    // again -> ...). Fixed, it must be identical here.
    expect(registerCount).toBe(countAfterFirstSettle);
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);
  });

  it("an unrelated rerender of the harness does not cause another request", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const { OwnerInboxBody } = await import("./index");
    const { rerender } = render(
      <ShellRefreshHarness onUnauthorized={vi.fn()} renderBody={(props) => <OwnerInboxBody {...props} />} />,
    );
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1));
    rerender(<ShellRefreshHarness onUnauthorized={vi.fn()} renderBody={(props) => <OwnerInboxBody {...props} />} />);
    await flush();
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1);
  });

  it("explicit Refresh (the registered header handler) causes exactly one additional request", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const { OwnerInboxBody } = await import("./index");
    const user = userEvent.setup({ delay: null });
    render(
      <ShellRefreshHarness onUnauthorized={vi.fn()} renderBody={(props) => <OwnerInboxBody {...props} />} />,
    );
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1));
    await flush();

    await user.click(screen.getByRole("button", { name: /trigger registered refresh/i }));
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(2);
  });

  // CHECKPOINT OWNER DESKTOP CORRECTION (compact filters pass) — there is no
  // Apply button any more; typing in the search box applies automatically
  // after a short debounce (see OwnerLeadFilters.tsx's own SEARCH_DEBOUNCE_MS).
  it("typing in the search box causes exactly one additional (debounced) request", async () => {
    fetchOwnerLeadListMock.mockResolvedValue({ kind: "ok", data: { leads: [], page: { nextCursor: null, hasMore: false } } });
    const { OwnerInboxBody } = await import("./index");
    const user = userEvent.setup({ delay: null });
    render(
      <ShellRefreshHarness onUnauthorized={vi.fn()} renderBody={(props) => <OwnerInboxBody {...props} />} />,
    );
    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText(/search/i), "Ahmed");

    await waitFor(() => expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await flush();
    expect(fetchOwnerLeadListMock).toHaveBeenCalledTimes(2);
  });
});
