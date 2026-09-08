// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLoginRouteBody, type OwnerLoginAuthClient, type OwnerLoginSessionChecker } from "./login";

afterEach(() => {
  cleanup();
});

function fakeAuthClient(overrides: Partial<OwnerLoginAuthClient> = {}): OwnerLoginAuthClient {
  return {
    getAccessToken: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function fakeSessionChecker(overrides: Partial<OwnerLoginSessionChecker> = {}): OwnerLoginSessionChecker {
  return {
    check: vi.fn().mockResolvedValue({ ok: false }),
    ...overrides,
  };
}

describe("OwnerLoginRouteBody — existing-session bypass", () => {
  it("a valid existing session bypasses the login screen entirely — the form is never shown", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("at-1") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: true, owner: { userId: "u1", role: "owner" } }) });
    const onAlreadySignedIn = vi.fn();

    render(
      <OwnerLoginRouteBody
        onAuthenticated={vi.fn()}
        onAlreadySignedIn={onAlreadySignedIn}
        authClient={authClient}
        sessionChecker={sessionChecker}
      />,
    );

    await waitFor(() => expect(onAlreadySignedIn).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("no local session: shows the request-code form (checking phase resolves to it)", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue(null) });
    render(<OwnerLoginRouteBody onAuthenticated={vi.fn()} onAlreadySignedIn={vi.fn()} authClient={authClient} sessionChecker={fakeSessionChecker()} />);
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
  });

  it("an invalid/expired local session also falls through to the form, never a silent bypass", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockResolvedValue("stale-token") });
    const sessionChecker = fakeSessionChecker({ check: vi.fn().mockResolvedValue({ ok: false }) });
    const onAlreadySignedIn = vi.fn();
    render(
      <OwnerLoginRouteBody
        onAuthenticated={vi.fn()}
        onAlreadySignedIn={onAlreadySignedIn}
        authClient={authClient}
        sessionChecker={sessionChecker}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(onAlreadySignedIn).not.toHaveBeenCalled();
  });
});

describe("OwnerLoginRouteBody — passwordless, never implies a password", () => {
  it("renders no password field, label or affordance anywhere", async () => {
    render(<OwnerLoginRouteBody onAuthenticated={vi.fn()} onAlreadySignedIn={vi.fn()} authClient={fakeAuthClient()} sessionChecker={fakeSessionChecker()} />);
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeInTheDocument();
  });
});

describe("OwnerLoginRouteBody — reason-specific copy", () => {
  it("shows the session-ended copy when reason is 'unauthorized'", async () => {
    render(
      <OwnerLoginRouteBody
        reason="unauthorized"
        onAuthenticated={vi.fn()}
        onAlreadySignedIn={vi.fn()}
        authClient={fakeAuthClient()}
        sessionChecker={fakeSessionChecker()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/session has ended or is not authorized/i)).toBeInTheDocument());
  });

  it("shows the default copy with no reason", async () => {
    render(<OwnerLoginRouteBody onAuthenticated={vi.fn()} onAlreadySignedIn={vi.fn()} authClient={fakeAuthClient()} sessionChecker={fakeSessionChecker()} />);
    await waitFor(() => expect(screen.getByText(/enter your email to receive a 6-digit sign-in code/i)).toBeInTheDocument());
  });
});

describe("OwnerLoginRouteBody — bootstrap sequence throws (never an indefinite 'checking' spinner)", () => {
  it("a rejected getAccessToken() lands on a styled, retriable error state instead of hanging on 'checking' forever", async () => {
    const authClient = fakeAuthClient({ getAccessToken: vi.fn().mockRejectedValue(new Error("network down")) });
    render(<OwnerLoginRouteBody onAuthenticated={vi.fn()} onAlreadySignedIn={vi.fn()} authClient={authClient} sessionChecker={fakeSessionChecker()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't verify your session/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("clicking Retry re-runs the bootstrap sequence, and a subsequent success falls through to the sign-in form", async () => {
    const user = userEvent.setup();
    const getAccessToken = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(null);
    const authClient = fakeAuthClient({ getAccessToken });
    render(<OwnerLoginRouteBody onAuthenticated={vi.fn()} onAlreadySignedIn={vi.fn()} authClient={authClient} sessionChecker={fakeSessionChecker()} />);
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    await user.click(retryButton);
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });
});
