// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerShell } from "./OwnerShell";
import type { OwnerAuthClient } from "./owner-auth-client";
import type { OwnerSessionChecker } from "./owner-session-checker";

afterEach(() => {
  cleanup();
});

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
    render(<OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthenticated"));
    expect(sessionChecker.check).not.toHaveBeenCalled();
  });

  it("shows a neutral checking state, never fabricated dashboard content", () => {
    render(<OwnerShell authClient={fakeAuthClient()} sessionChecker={fakeSessionChecker()} onUnauthorized={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/checking your session/i);
    expect(screen.queryByText(/owner workspace/i)).not.toBeInTheDocument();
  });
});

describe("OwnerShell — signed in locally but not authorized server-side", () => {
  it("signs out locally and calls onUnauthorized('unauthorized') when the session check fails", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: false }) });
    render(<OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(sessionChecker.check).toHaveBeenCalledWith("at-1"));
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith("unauthorized"));
  });
});

describe("OwnerShell — authorized", () => {
  it("renders the minimal truthful workspace placeholder, with no fabricated lead/dashboard data", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    render(<OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={vi.fn()} />);
    await screen.findByRole("heading", { name: /owner workspace/i });
    expect(screen.queryByText(/\$[0-9]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/total leads/i)).not.toBeInTheDocument();
  });

  it("logging out calls signOut and onUnauthorized('unauthenticated')", async () => {
    const onUnauthorized = vi.fn();
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const user = userEvent.setup();
    render(<OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized} />);
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
    render(<OwnerShell authClient={authClient} sessionChecker={sessionChecker} onUnauthorized={onUnauthorized} />);
    const logoutButton = await screen.findByRole("button", { name: /log out/i });
    logoutButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled());
  });
});
