// @vitest-environment jsdom
import type { ReactNode } from "react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

/** OwnerShell now renders OwnerNav (real <Link>s to /owner/overview, /owner, /owner/leads/new) — same stub-Link-as-<a> pattern as OwnerLeadInbox.test.tsx, since there is no real router context in this render. */
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

const { OwnerShell } = await import("./OwnerShell");
import type { RegisterOwnerShellRefresh } from "./OwnerShell";
import type { OwnerAuthClient } from "./owner-auth-client";
import type { OwnerSessionChecker } from "./owner-session-checker";
import { OwnerAuthTimeoutError } from "./owner-auth-timeout";

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
    await screen.findByRole("link", { name: /enquiries/i });
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

  it("does not render a Refresh button when no page registers one", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {() => <p>page content</p>}
      </OwnerShell>,
    );
    await screen.findByText("page content");
    expect(screen.queryByRole("button", { name: /refresh/i })).not.toBeInTheDocument();
  });
});
