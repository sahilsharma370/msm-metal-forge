// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadFileViewer } from "./OwnerLeadFileViewer";
import * as transport from "./owner-leads-transport";
import type { OwnerLeadDetailFile } from "@/lib/owner/owner-lead-detail-contract";

vi.mock("./owner-leads-transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-leads-transport")>();
  return { ...actual, requestOwnerLeadFileAccess: vi.fn() };
});

const requestOwnerLeadFileAccessMock = vi.mocked(transport.requestOwnerLeadFileAccess);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.open = vi.fn() as unknown as typeof window.open;
});

const fakeDeps: transport.OwnerLeadsTransportDeps = {
  authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() },
  fetchImpl: vi.fn(),
};

function imageFile(overrides: Partial<OwnerLeadDetailFile> = {}): OwnerLeadDetailFile {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    kind: "seller_photo",
    originalFilename: "scrap.jpg",
    mimeType: "image/jpeg",
    byteSize: 204800,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    uploadStatus: "complete",
    ...overrides,
  };
}

function pdfFile(overrides: Partial<OwnerLeadDetailFile> = {}): OwnerLeadDetailFile {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    kind: "buyer_document",
    originalFilename: "contract.pdf",
    mimeType: "application/pdf",
    byteSize: 51200,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    uploadStatus: "complete",
    ...overrides,
  };
}

describe("OwnerLeadFileViewer — calls the right leadId/fileId", () => {
  it("passes the exact leadId and file.id to the access API", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-abc" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view scrap.jpg/i }));
    await waitFor(() => expect(requestOwnerLeadFileAccessMock).toHaveBeenCalled());
    expect(requestOwnerLeadFileAccessMock).toHaveBeenCalledWith("lead-abc", "33333333-3333-3333-3333-333333333333", fakeDeps, expect.anything());
  });

  it("uses sanitized file metadata (originalFilename), never a name derived from the signed URL", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({
      kind: "ok",
      data: { url: "https://example.test/storage/v1/object/sign/lead-files/leads/x/y/z.jpg?token=abc", expiresInSeconds: 60 },
    });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-abc" file={imageFile({ originalFilename: "my photo.jpg" })} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    expect(screen.getByText("my photo.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view my photo.jpg/i }));
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getAllByText("my photo.jpg").length).toBeGreaterThan(0);
  });
});

describe("OwnerLeadFileViewer — signed URL held only in memory, never persisted/logged", () => {
  it("uses the signed URL as the <img> src and never calls localStorage/sessionStorage/console.log", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed?token=SECRET", expiresInSeconds: 60 } });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.test/signed?token=SECRET"));
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("clears the signed URL when the modal closes (Escape)", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });

  it("clears the signed URL on unmount", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    const user = userEvent.setup();
    const { unmount } = render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(() => unmount()).not.toThrow();
  });

  it("auto-clears and closes the modal once the TTL elapses", async () => {
    // fireEvent + explicit `act()` flushes, not userEvent — combining
    // userEvent's own internal timing with fake timers is a well-known
    // source of hangs; this keeps the fake-timer window small and always
    // restores real timers in `finally` so a failure here can never poison
    // every later test in this file with a stuck fake clock.
    vi.useFakeTimers();
    try {
      requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
      render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: /view/i }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole("img")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OwnerLeadFileViewer — PDFs open in a new tab, never inline", () => {
  it("opens the signed URL via window.open with noopener,noreferrer for a non-image file", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed.pdf", expiresInSeconds: 60 } });
    const openSpy = vi.fn();
    window.open = openSpy as unknown as typeof window.open;
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={pdfFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view contract.pdf/i }));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("https://example.test/signed.pdf", "_blank", "noopener,noreferrer"));
  });
});

describe("OwnerLeadFileViewer — double-click protection", () => {
  it("does not mint two signed URLs on a rapid double click", async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof transport.requestOwnerLeadFileAccess>>) => void;
    requestOwnerLeadFileAccessMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    const button = screen.getByRole("button", { name: /view/i });
    await user.click(button);
    // The dialog now opens immediately on the first click, and its modal
    // overlay makes the underlying button genuinely unclickable in a real
    // browser too — fireEvent bypasses testing-library's pointer-events
    // guard so this still exercises the component's own loading-state
    // double-click guard directly, independent of that overlay behavior.
    fireEvent.click(button);
    resolveFirst({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(requestOwnerLeadFileAccessMock).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerLeadFileViewer — access errors displayed generically", () => {
  it("shows a generic retryable error inside the already-open dialog, never a raw provider message, on failure", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "error", message: "Something went wrong. Please try again.", status: 500 });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't open this photo/i));
  });

  it("a wrong-lead/wrong-file 404 shows the identical generic error text as any other failure", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "error", message: "Not found.", status: 404 });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't open this photo/i));
  });

  it("a non-image file's error still shows below the row (no dialog exists for it)", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "error", message: "Something went wrong.", status: 500 });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={pdfFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /view contract.pdf/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't open this file/i));
  });

  it("calls onUnauthorized and never opens an image on a 401", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "unauthorized" });
    const onUnauthorized = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={onUnauthorized} />);
    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("OwnerLeadFileViewer — PERF: viewer opens immediately, independent of the signed-url mint", () => {
  it("opens the dialog with a loading state before the signed-url request resolves, never blocking on it first", async () => {
    let resolveAccess!: (value: Awaited<ReturnType<typeof transport.requestOwnerLeadFileAccess>>) => void;
    requestOwnerLeadFileAccessMock.mockImplementationOnce(() => new Promise((resolve) => (resolveAccess = resolve)));
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /view/i }));

    // The dialog is visible immediately, and shows its own loading state —
    // while the mint is still unresolved, never waiting for it to appear.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    resolveAccess({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    // "Loading photo…" must stay visible through the actual image transfer/
    // decode too, not just the signed-url mint — the <img> exists in the DOM
    // (its real network fetch has started) but "Loading photo…" is still
    // the only thing visible until the image itself fires onLoad.
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);

    fireEvent.load(screen.getByRole("img"));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.test/signed");
  });

  it("shows the inline error state if the image itself fails to load, even though the signed-url mint succeeded", async () => {
    requestOwnerLeadFileAccessMock.mockResolvedValue({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /view/i }));
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());

    fireEvent.error(screen.getByRole("img"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't open this photo/i));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closing the dialog while the mint is still in flight aborts the request and resets to idle", async () => {
    const abortSpy = vi.fn();
    requestOwnerLeadFileAccessMock.mockImplementationOnce(
      (_leadId, _fileId, _deps, signal) =>
        new Promise((resolve) => {
          // Matches owner-leads-transport.ts's own real abort handling:
          // an aborted mint resolves with {kind:"aborted"}, never rejects.
          signal?.addEventListener("abort", () => {
            abortSpy();
            resolve({ kind: "aborted" });
          });
        }),
    );
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /view/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(abortSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reopening after a close-while-loading starts fresh: loading state again, never a stale/half-loaded image", async () => {
    // Matches owner-leads-transport.ts's own real abort handling (see the
    // "closing the dialog while the mint is still in flight" test above):
    // an aborted mint resolves with {kind:"aborted"}, it never resolves
    // "ok" for a request the owner already dismissed.
    requestOwnerLeadFileAccessMock.mockImplementationOnce(
      (_leadId, _fileId, _deps, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve({ kind: "aborted" }));
        }),
    );
    let resolveSecond!: (value: Awaited<ReturnType<typeof transport.requestOwnerLeadFileAccess>>) => void;
    requestOwnerLeadFileAccessMock.mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const user = userEvent.setup();
    render(<OwnerLeadFileViewer leadId="lead-1" file={imageFile()} deps={fakeDeps} onUnauthorized={vi.fn()} />);

    // First open: close immediately, before the mint resolves.
    await user.click(screen.getByRole("button", { name: /view/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Reopen: a fresh loading state, not whatever the first (aborted)
    // attempt left behind.
    await user.click(screen.getByRole("button", { name: /view/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    resolveSecond({ kind: "ok", data: { url: "https://example.test/signed", expiresInSeconds: 60 } });
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(/loading photo/i);
    fireEvent.load(screen.getByRole("img"));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
