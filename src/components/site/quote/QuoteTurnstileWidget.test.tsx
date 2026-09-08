// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  QuoteTurnstileWidget,
  TURNSTILE_ACTION,
  type QuoteTurnstileWidgetHandle,
} from "./QuoteTurnstileWidget";

interface CapturedRenderOptions {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
}

function installFakeTurnstile() {
  const renderMock = vi
    .fn<(container: HTMLElement, options: CapturedRenderOptions) => string>()
    .mockReturnValue("widget-1");
  const resetMock = vi.fn();
  const removeMock = vi.fn();
  window.turnstile = { render: renderMock, reset: resetMock, remove: removeMock };
  return { renderMock, resetMock, removeMock };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

describe("QuoteTurnstileWidget — script loading", () => {
  beforeEach(() => {
    delete (window as { turnstile?: unknown }).turnstile;
  });

  it("appends the Cloudflare Turnstile script exactly once, then renders once it becomes available", async () => {
    vi.resetModules();
    const { QuoteTurnstileWidget: FreshWidget } = await import("./QuoteTurnstileWidget");

    let capturedScript: HTMLScriptElement | undefined;
    const appendChildSpy = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      capturedScript = node as HTMLScriptElement;
      return node;
    });

    render(<FreshWidget siteKey="test-site-key" onToken={vi.fn()} onUnusable={vi.fn()} />);

    expect(capturedScript?.src).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(appendChildSpy).toHaveBeenCalledTimes(1);

    const { renderMock } = installFakeTurnstile();
    capturedScript?.onload?.(new Event("load"));

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]?.[1];
    expect(options?.sitekey).toBe("test-site-key");
    expect(options?.action).toBe(TURNSTILE_ACTION);
  });

  it("calls onUnusable if the script fails to load", async () => {
    vi.resetModules();
    const { QuoteTurnstileWidget: FreshWidget } = await import("./QuoteTurnstileWidget");

    let capturedScript: HTMLScriptElement | undefined;
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      capturedScript = node as HTMLScriptElement;
      return node;
    });

    const onUnusable = vi.fn();
    render(<FreshWidget siteKey="test-site-key" onToken={vi.fn()} onUnusable={onUnusable} />);

    capturedScript?.onerror?.(new Event("error"));

    await waitFor(() => expect(onUnusable).toHaveBeenCalledTimes(1));
  });
});

describe("QuoteTurnstileWidget — rendered widget lifecycle", () => {
  it("renders with the configured site key and the shared quote_submit action", async () => {
    const { renderMock } = installFakeTurnstile();
    render(<QuoteTurnstileWidget siteKey="my-site-key" onToken={vi.fn()} onUnusable={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]?.[1];
    expect(options?.sitekey).toBe("my-site-key");
    expect(options?.action).toBe("quote_submit");
  });

  // C2L-Q4 — the Quote Experience is permanently dark-navy, so the widget
  // requests Cloudflare's own "dark" theme rather than "auto" (which would
  // otherwise follow the visitor's OS/browser colour-scheme and could
  // render a jarring white box). Purely a visual-skin parameter passed to
  // the real Turnstile API — not a change to verification behaviour.
  it("requests Cloudflare's dark theme, matching the permanently dark shell", async () => {
    const { renderMock } = installFakeTurnstile();
    render(<QuoteTurnstileWidget siteKey="my-site-key" onToken={vi.fn()} onUnusable={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]?.[1] as { theme?: string };
    expect(options.theme).toBe("dark");
  });

  it("forwards a completed challenge's token to onToken, verbatim", async () => {
    const { renderMock } = installFakeTurnstile();
    const onToken = vi.fn();
    render(<QuoteTurnstileWidget siteKey="k" onToken={onToken} onUnusable={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]?.[1];
    options?.callback("a-fresh-token");

    expect(onToken).toHaveBeenCalledWith("a-fresh-token");
    expect(onToken).toHaveBeenCalledTimes(1);
  });

  it.each(["error-callback", "expired-callback", "timeout-callback"] as const)(
    "calls onUnusable when Turnstile reports %s",
    async (callbackName) => {
      const { renderMock } = installFakeTurnstile();
      const onUnusable = vi.fn();
      render(<QuoteTurnstileWidget siteKey="k" onToken={vi.fn()} onUnusable={onUnusable} />);

      await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
      const options = renderMock.mock.calls[0]?.[1];
      options?.[callbackName]();

      expect(onUnusable).toHaveBeenCalledTimes(1);
    },
  );

  it("reset() via the imperative handle asks Turnstile to reset the exact rendered widget id, requesting a fresh challenge", async () => {
    const { renderMock, resetMock } = installFakeTurnstile();
    const ref = createRef<QuoteTurnstileWidgetHandle>();
    render(<QuoteTurnstileWidget ref={ref} siteKey="k" onToken={vi.fn()} onUnusable={vi.fn()} />);

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    ref.current?.reset();

    expect(resetMock).toHaveBeenCalledWith("widget-1");
  });

  it("removes the widget on unmount so a stale, already-consumed challenge is never left behind", async () => {
    const { renderMock, removeMock } = installFakeTurnstile();
    const { unmount } = render(
      <QuoteTurnstileWidget siteKey="k" onToken={vi.fn()} onUnusable={vi.fn()} />,
    );

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    unmount();

    expect(removeMock).toHaveBeenCalledWith("widget-1");
  });

  it("never renders the token anywhere in the DOM — only ever hands it to onToken", async () => {
    const { renderMock } = installFakeTurnstile();
    const { container } = render(
      <QuoteTurnstileWidget siteKey="k" onToken={vi.fn()} onUnusable={vi.fn()} />,
    );

    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const options = renderMock.mock.calls[0]?.[1];
    options?.callback("super-secret-token-value");

    expect(container.innerHTML).not.toContain("super-secret-token-value");
  });
});
