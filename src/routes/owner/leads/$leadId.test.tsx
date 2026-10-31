// @vitest-environment jsdom
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// OwnerLeadDetailPage's Back-to-enquiries control renders a real <Link>,
// which needs a live RouterProvider to resolve. This test only cares about
// the fetch-identity/render-loop behavior, not real navigation — see
// OwnerLeadDetailPage.test.tsx for the same established substitution.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

import * as transport from "@/components/owner/owner-leads-transport";
import type { RegisterOwnerShellRefresh } from "@/components/owner/OwnerShell";

/**
 * CHECKPOINT C2J-D1 — the detail route's equivalent of
 * routes/owner/index.test.tsx: proves OwnerLeadDetailBody's own useMemo
 * fix prevents the identical dependency-identity render loop (see that
 * file's own header comment for the full mechanism and the harness's own
 * rationale — it is not a simplification; a bare `vi.fn()` registerRefresh
 * does not reproduce the bug because it never triggers the re-render that
 * is the actual trigger).
 */
vi.mock("@/components/owner/owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/owner/owner-leads-transport")>();
  return { ...actual, fetchOwnerLeadDetail: vi.fn() };
});

const fetchOwnerLeadDetailMock = vi.mocked(transport.fetchOwnerLeadDetail);

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

const NOT_FOUND_LEAD_ID = "11111111-1111-1111-1111-111111111111";

describe("OwnerLeadDetailBody — dependency-identity stability", () => {
  it("one initial render causes exactly one request for the given leadId", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "error", message: "Not found.", status: 404 });
    const { OwnerLeadDetailBody } = await import("./$leadId");
    render(
      <ShellRefreshHarness
        onUnauthorized={vi.fn()}
        renderBody={(props) => <OwnerLeadDetailBody leadId={NOT_FOUND_LEAD_ID} {...props} />}
      />,
    );
    await waitFor(() => expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(1));
    expect(fetchOwnerLeadDetailMock).toHaveBeenCalledWith(NOT_FOUND_LEAD_ID, expect.anything(), expect.anything());
    await flush();
    await flush();
    expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(1);
  });

  it("the registerRefresh call count converges — no unbroken render loop", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "error", message: "Not found.", status: 404 });
    let registerCount = 0;
    const { OwnerLeadDetailBody } = await import("./$leadId");
    render(
      <ShellRefreshHarness
        onUnauthorized={vi.fn()}
        onRegisterCall={() => {
          registerCount += 1;
        }}
        renderBody={(props) => <OwnerLeadDetailBody leadId={NOT_FOUND_LEAD_ID} {...props} />}
      />,
    );
    await waitFor(() => expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(1));
    await flush();
    const countAfterFirstSettle = registerCount;
    await flush();
    await flush();
    expect(registerCount).toBe(countAfterFirstSettle);
    expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(1);
  });

  it("explicit Refresh causes exactly one additional request", async () => {
    fetchOwnerLeadDetailMock.mockResolvedValue({ kind: "error", message: "Not found.", status: 404 });
    const { OwnerLeadDetailBody } = await import("./$leadId");
    const user = userEvent.setup();
    render(
      <ShellRefreshHarness
        onUnauthorized={vi.fn()}
        renderBody={(props) => <OwnerLeadDetailBody leadId={NOT_FOUND_LEAD_ID} {...props} />}
      />,
    );
    await waitFor(() => expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(1));
    await flush();

    await user.click(screen.getByRole("button", { name: /trigger registered refresh/i }));
    await waitFor(() => expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(2));
    await flush();
    expect(fetchOwnerLeadDetailMock).toHaveBeenCalledTimes(2);
  });
});
