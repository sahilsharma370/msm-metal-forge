// @vitest-environment jsdom
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@/test-utils/render-with-query-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

/**
 * OwnerShell now renders OwnerNav (real <Link>s to /owner/overview, /owner,
 * /owner/leads/new) — same stub-Link-as-<a> pattern as OwnerLeadInbox.test.tsx,
 * since there is no real router context in this render. OwnerNav also now
 * calls `useRouterState` directly (CHECKPOINT OWNER ENQUIRIES SIX-CIRCLE PASS
 * — computing its own active-section state instead of relying on Link's own
 * activeProps/exact matching), which throws outside a real router; stubbed
 * to a fixed "/owner" pathname here — these tests exercise OwnerShell's own
 * auth/session/cache behaviour, never which nav link happens to be
 * highlighted.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useRouterState: () => "/owner",
  };
});

const { OwnerShell, __resetOwnerShellSessionCacheForTests } = await import("./OwnerShell");
import type { RegisterOwnerShellRefresh } from "./OwnerShell";
import type { OwnerAuthClient } from "./owner-auth-client";
import type { OwnerSessionChecker } from "./owner-session-checker";
import { OwnerAuthTimeoutError } from "./owner-auth-timeout";

// The in-app-navigation session cache (see OwnerShell.tsx's own comment) is
// module-level by design — it must survive an OwnerShell unmount/remount in
// production. Every test here starts from a clean cache so one test's
// cached token (most reuse the literal "at-1") can never let a later
// test's bootstrap skip its own sessionChecker.check() call.
beforeEach(() => {
  __resetOwnerShellSessionCacheForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mirrors how a real page (OwnerLeadInbox/OwnerLeadDetailPage's route wrapper) installs a header refresh action. */
function PageWithRefresh({ registerRefresh, onRefresh }: { readonly registerRefresh: RegisterOwnerShellRefresh; readonly onRefresh: () => void }) {
  useEffect(() => {
    registerRefresh(onRefresh, false);
    return () => registerRefresh(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p>page content</p>;
}

function fakeAuthClient(overrides: Partial<OwnerAuthClient> = {}): OwnerAuthClient {
  return {
    getAccessToken: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeSessionChecker(overrides: Partial<OwnerSessionChecker> = {}): OwnerSessionChecker {
  return {
    check: vi.fn().mockResolvedValue({ ok: false }),
    ...overrides,
  };
}

describe("OwnerShell — unauthenticated (no local session)", () => {
  it("calls onUnauthorized('unauthenticated') without ever calling the session checker", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue(null) });
    const sessionChecker = fakeSessionChecker();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthenticated"));
    expect(sessionChecker.check).not.toHaveBeenCalled();
  });

  it("shows a neutral checking state, never fabricated dashboard content", () => {
    render(
      <OwnerShell authClient={fakeAuthClient()} sessionChecker={fakeSessionChecker()} onUnauthorized={vi.fn()}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i);
    expect(screen.queryByText(/owner workspace/i)).not.toBeInTheDocument();
  });
});

describe("OwnerShell — signed in locally but not authorized server-side", () => {
  it("signs out locally and calls onUnauthorized('unauthorized') when the session check fails", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: false }) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    await waitFor(() => expect(sessionChecker.check).toHaveBeenCalledWith("at-1"));
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthorized"));
  });
});

describe("OwnerShell — bootstrap sequence throws (never an indefinite 'checking' spinner)", () => {
  it("a rejected getAccessToken() lands on a styled, retriable error state instead of hanging on 'checking' forever", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockRejectedValue(new Error("network down")) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={fakeSessionChecker()} onUnauthorized={vi.fn()}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't verify your session/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a rejected signOut() (during an expired-session sign-out) also lands on the error state, never a silent unhandled rejection", async () => {
    const authClient = fakeAuthClient({
      getAccessToken: vi.fn().mockResolvedValue("at-1"),
      signOut: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: false }) });
    const onUnauthorized = vi.fn();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't verify your session/i);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("clicking Retry re-runs the bootstrap sequence, and a subsequent success reaches the authorized dashboard", async () => {
    const user = userEvent.setup();
    const getAccessToken = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce("at-1");
    const authClient = fakeAuthClient({ getAccessToken });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    await user.click(retryButton);
    await screen.findByText(/signed in as owner/i);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("a genuine OwnerAuthTimeoutError (the exact type the real bounded getAccessToken()/check() throw — see owner-auth-client.test.ts / owner-session-checker.test.ts for the timer mechanics proven in isolation) reaches Retry, and a successful retry reaches the authorized dashboard", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockRejectedValueOnce(new OwnerAuthTimeoutError()).mockResolvedValueOnce("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const user = userEvent.setup();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>signed in as {owner.role}</p>}
      </OwnerShell>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't verify your session/i);

    const retryButton = screen.getByRole("button", { name: /retry/i });
    await user.click(retryButton);
    await screen.findByText(/signed in as owner/i);
    expect(authClient.getAccessToken).toHaveBeenCalledTimes(2);
  });
});

describe("OwnerShell — authorized", () => {
  it("renders the persistent workspace header and hands the verified owner identity to its children, with no fabricated lead/dashboard data of its own", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByAltText(/msm scrap/i);
    // CHECKPOINT OWNER ENQUIRIES REFERENCE PASS — two "Enquiries" nav
    // links now exist in the DOM at once (the mobile/tablet glass-pill
    // nav and the desktop underline nav, toggled via `lg:hidden`/
    // `hidden lg:flex` — only one is ever visible/exposed to assistive
    // tech at a given real viewport; jsdom has no layout engine so both
    // are present here), so this asserts at least one rather than
    // exactly one.
    expect((await screen.findAllByRole("link", { name: /enquiries/i })).length).toBeGreaterThan(0);
    await screen.findByText(/signed in as owner/i);
    expect(screen.queryByText(/\$[0-9]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/total leads/i)).not.toBeInTheDocument();
  });

  it("logging out calls signOut and onUnauthorized('unauthenticated')", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const user = userEvent.setup();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    await user.click(logoutButton);
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled());
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthenticated"));
  });

  it("the logout button is keyboard-operable (Enter activates it)", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const user = userEvent.setup();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    logoutButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled());
  });

  it("shows a header Refresh button when a page registers one via registerRefresh, and calls it back", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(_owner, registerRefresh) => <PageWithRefresh registerRefresh={registerRefresh} onRefresh={onRefresh} />}
      </OwnerShell>,
    );
    const refreshButton = await screen.findByRole("button", { name: /refresh/i });
    await user.click(refreshButton);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("a second OwnerShell mount with the same still-fresh access token skips the network re-check (PERF — in-app navigation keeps the shell visible)", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const check = vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } });
    const sessionChecker = fakeSessionChecker({ check });

    const first = render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>first mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/first mount, signed in as owner/i);
    expect(check).toHaveBeenCalledTimes(1);
    first.unmount();

    // Simulates the route-level remount every owner-to-owner navigation
    // currently causes (see OwnerShell.tsx's own PERF comment) — a brand
    // new OwnerShell instance, same OwnerAuthClient/token.
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>second mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/second mount, signed in as owner/i);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("a second OwnerShell mount with a different access token always re-checks (no stale cross-identity trust)", async () => {
    const getAccessToken = vi.fn().mockResolvedValueOnce("at-1").mockResolvedValueOnce("at-2");
    const authClient = fakeAuthClient({ getAccessToken });
    const check = vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } });
    const sessionChecker = fakeSessionChecker({ check });

    const first = render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>first mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/first mount, signed in as owner/i);
    first.unmount();

    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>second mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/second mount, signed in as owner/i);
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenNthCalledWith(2, "at-2");
  });

  it("a cached check older than the TTL is not trusted — re-checks instead of staying stale indefinitely", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);

    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const check = vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } });
    const sessionChecker = fakeSessionChecker({ check });

    const first = render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>first mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/first mount, signed in as owner/i);
    first.unmount();

    nowSpy.mockReturnValue(1_000_000 + 31_000); // past the 30s TTL
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>second mount, signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByText(/second mount, signed in as owner/i);
    expect(check).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it("does not render a Refresh button when no page registers one, and never leaves the orphan divider behind it either (CHECKPOINT OWNER ENQUIRIES SIX-CIRCLE PASS)", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const { container } = render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    await screen.findByText("page content");
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
    // The divider between Refresh and Log out is `aria-hidden`, so it is
    // queried directly rather than via role — it must not render at all
    // once Log out is the only right-side control.
    expect(container.querySelector("span[aria-hidden='true'].w-px")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("renders the divider once a page registers a Refresh handler — grouping it with Log out, never orphaned", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const { container } = render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(_owner, registerRefresh) => <PageWithRefresh registerRefresh={registerRefresh} onRefresh={vi.fn()} />}
      </OwnerShell>,
    );
    await screen.findByRole("button", { name: /refresh/i });
    expect(container.querySelector("span[aria-hidden='true'].w-px")).toBeInTheDocument();
  });
});

describe("OwnerShell — PERF/isolation: owner data cache is cleared on logout and unauthorized, never leaked to the next sign-in", () => {
  it("logging out clears the shared owner data cache (list/detail/overview), not just the local session", async () => {
    const queryClient = new QueryClient();
    // Seed a fake cached leads-list snapshot, the same shape
    // use-owner-lead-list.ts itself writes — simulating "owner A was
    // looking at their leads" before logging out.
    queryClient.setQueryData(["owner", "leads", "list", "inbox", {}], { items: [{ id: "owner-a-lead" }], hasMore: false, nextCursor: null });

    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const onUnauthorized = vi.fn();
    const user = userEvent.setup();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    );
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    await user.click(logoutButton);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthenticated"));

    expect(queryClient.getQueryData(["owner", "leads", "list", "inbox", {}])).toBeUndefined();
  });

  it("a server-side unauthorized rejection (session revoked mid-session) also clears the shared owner data cache before redirecting", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["owner", "leads", "detail", "lead-1"], { lead: { id: "lead-1" } });

    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: false }) });
    const onUnauthorized = vi.fn();
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    );
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthorized"));

    expect(queryClient.getQueryData(["owner", "leads", "detail", "lead-1"])).toBeUndefined();
  });

  it("no local session at all (unauthenticated) also clears any leftover cached data before redirecting", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["owner", "leads", "overview"], { totals: { total: 1 } });

    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue(null) });
    const onUnauthorized = vi.fn();
    render(
      <OwnerShell authClient={authClient} sessionChecker={fakeSessionChecker()} onUnauthorized={onUnauthorized}>
        {() => <p>page content</p>}
      </OwnerShell>,
      { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> },
    );
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthenticated"));

    expect(queryClient.getQueryData(["owner", "leads", "overview"])).toBeUndefined();
  });
});
