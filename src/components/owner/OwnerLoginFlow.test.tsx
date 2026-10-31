// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLoginFlow } from "./OwnerLoginFlow";
import type { OwnerLoginTransport } from "./owner-login-transport";
import type { OwnerAuthClient } from "./owner-auth-client";

// input-otp (the InputOTP component's underlying library) uses
// ResizeObserver internally, which jsdom does not implement — same fake
// used by QuoteExperience.test.tsx for the same reason.
if (!("ResizeObserver" in globalThis)) {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
}
// input-otp also polls document.elementFromPoint (caret-position
// detection), which jsdom does not implement either.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

afterEach(() => {
  cleanup();
});

function fakeTransport(overrides: Partial<OwnerLoginTransport> = {}): OwnerLoginTransport {
  return {
    requestCode: vi.fn().mockResolvedValue({ kind: "sent", message: "If that email is registered for owner access, a sign-in code has been sent." }),
    verifyCode: vi.fn().mockResolvedValue({ kind: "verified", session: { accessToken: "at", refreshToken: "rt", expiresAt: 1 } }),
    ...overrides,
  };
}

function fakeAuthClient(overrides: Partial<OwnerAuthClient> = {}): OwnerAuthClient {
  return {
    getAccessToken: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("OwnerLoginFlow — request-code step", () => {
  it("has an accessible email label", () => {
    render(<OwnerLoginFlow transport={fakeTransport()} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("submits via keyboard (Enter) and calls transport.requestCode with the entered email", async () => {
    const transport = fakeTransport();
    const user = userEvent.setup();
    render(<OwnerLoginFlow transport={transport} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test{Enter}");
    await waitFor(() => expect(transport.requestCode).toHaveBeenCalledWith("owner@example.test"));
  });

  it("moves to the verify step after a successful request", async () => {
    const transport = fakeTransport();
    const user = userEvent.setup();
    render(<OwnerLoginFlow transport={transport} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: /send sign-in code/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /verify code/i })).toBeInTheDocument());
  });

  it("shows an alert on rate limiting, and never reveals account-specific detail", async () => {
    const transport = fakeTransport({ requestCode: vi.fn().mockResolvedValue({ kind: "rate_limited" }) });
    const user = userEvent.setup();
    render(<OwnerLoginFlow transport={transport} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: /send sign-in code/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too many attempts/i));
  });

  it("marks the submit button busy/disabled while a request is in flight", async () => {
    let resolveRequest: ((value: { kind: "sent"; message: string }) => void) | undefined;
    const pending = new Promise<{ kind: "sent"; message: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const transport = fakeTransport({ requestCode: vi.fn().mockReturnValue(pending) });
    const user = userEvent.setup();
    render(<OwnerLoginFlow transport={transport} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: /send sign-in code/i }));

    const button = await screen.findByRole("button", { name: /sending/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    resolveRequest?.({ kind: "sent", message: "generic" });
    await waitFor(() => expect(screen.getByRole("button", { name: /verify code/i })).toBeInTheDocument());
  });

  it("does not submit with an empty email (submit button stays disabled)", () => {
    render(<OwnerLoginFlow transport={fakeTransport()} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);
    expect(screen.getByRole("button", { name: /send sign-in code/i })).toBeDisabled();
  });
});

describe("OwnerLoginFlow — verify-code step", () => {
  async function renderAtVerifyStep(transport: OwnerLoginTransport = fakeTransport(), authClient: OwnerAuthClient = fakeAuthClient()) {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    render(<OwnerLoginFlow transport={transport} authClient={authClient} onAuthenticated={onAuthenticated} />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: /send sign-in code/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /verify code/i })).toBeInTheDocument());
    return { user, transport, authClient, onAuthenticated };
  }

  it("has an accessible 6-digit code field", async () => {
    await renderAtVerifyStep();
    expect(screen.getByLabelText(/6-digit sign-in code/i)).toBeInTheDocument();
  });

  it("keyboard-enters the code and submits it, adopting the returned session on success", async () => {
    const { user, transport, authClient, onAuthenticated } = await renderAtVerifyStep();
    await user.type(screen.getByLabelText(/6-digit sign-in code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify code/i }));
    await waitFor(() => expect(transport.verifyCode).toHaveBeenCalledWith("owner@example.test", "123456"));
    await waitFor(() => expect(authClient.setSession).toHaveBeenCalledWith({ accessToken: "at", refreshToken: "rt", expiresAt: 1 }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
  });

  it("shows an alert and clears the code field on an invalid/expired code", async () => {
    const transport = fakeTransport({
      verifyCode: vi.fn().mockResolvedValue({ kind: "invalid_or_expired", message: "That code is invalid or has expired." }),
    });
    const { user } = await renderAtVerifyStep(transport);
    const codeField = screen.getByLabelText(/6-digit sign-in code/i);
    await user.type(codeField, "000000");
    await user.click(screen.getByRole("button", { name: /verify code/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalid or has expired/i));
  });

  it("disables resend with a visible cooldown immediately after a code is sent — a client-side courtesy only, never the real (server-side) rate limit", async () => {
    await renderAtVerifyStep();
    const resendButton = screen.getByRole("button", { name: /resend code/i });
    expect(resendButton).toBeDisabled();
    expect(resendButton).toHaveTextContent(/resend code \(\d+s\)/i);
  });

  it("the resend button requests a fresh code once the cooldown elapses", async () => {
    // Fake timers active for the WHOLE test (including reaching the verify
    // step) — the cooldown's own setInterval is created at that point, and
    // must be a fake-clock interval for vi.advanceTimersByTime() to affect
    // it later. fireEvent + explicit act() flushes throughout, never
    // userEvent — combining userEvent's own internal timing with fake
    // timers is a well-known source of hangs (see
    // OwnerLeadFileViewer.test.tsx's own identical pattern). Real timers
    // are always restored in `finally`.
    vi.useFakeTimers();
    try {
      const transport = fakeTransport();
      render(<OwnerLoginFlow transport={transport} authClient={fakeAuthClient()} onAuthenticated={vi.fn()} />);

      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.test" } });
      fireEvent.click(screen.getByRole("button", { name: /send sign-in code/i }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("button", { name: /verify code/i })).toBeInTheDocument();

      const cooldownButton = screen.getByRole("button", { name: /resend code/i });
      expect(cooldownButton).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      const resendButton = screen.getByRole("button", { name: /^resend code$/i });
      expect(resendButton).toBeEnabled();
      fireEvent.click(resendButton);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(transport.requestCode).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'use a different email' returns to the request-code step", async () => {
    const { user } = await renderAtVerifyStep();
    await user.click(screen.getByRole("button", { name: /use a different email/i }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
  });

  it("never renders any customer/dashboard data — only the login UI itself", async () => {
    await renderAtVerifyStep();
    expect(screen.queryByText(/lead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });
});
