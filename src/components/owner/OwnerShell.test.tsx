// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerShell, type RegisterOwnerShellRefresh } from "./OwnerShell";
import type { OwnerAuthClient } from "./owner-auth-client";
import type { OwnerSessionChecker } from "./owner-session-checker";

afterEach(() => {
  cleanup();
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

describe("OwnerShell — authorized", () => {
  it("renders the persistent workspace header and hands the verified owner identity to its children, with no fabricated lead/dashboard data of its own", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    render(
      <OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()}>
        {(owner) => <p>signed in as {owner.role}</p>}
      </OwnerShell>,
    );
    await screen.findByRole("heading", { name: /msm owner workspace/i });
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
