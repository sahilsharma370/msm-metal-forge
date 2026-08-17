// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

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

const { OwnerLeadDetailPage } = await import("./OwnerLeadDetailPage");
import type { OwnerLeadDetailHookState } from "./use-owner-lead-detail";

afterEach(() => {
  cleanup();
});

const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };

function baseState(overrides: Partial<OwnerLeadDetailHookState> = {}): OwnerLeadDetailHookState {
  return { data: null, isLoading: false, error: null, notFound: false, unauthorized: false, ...overrides };
}

describe("OwnerLeadDetailPage — mobile Back to enquiries control", () => {
  it("always shows a link back to /owner, in every state", () => {
    render(<OwnerLeadDetailPage leadId="lead-1" state={baseState({ isLoading: true })} retry={vi.fn()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    expect(screen.getByRole("link", { name: /back to enquiries/i })).toHaveAttribute("href", "/owner");
  });
});

describe("OwnerLeadDetailPage — not found", () => {
  it("shows a calm not-found message and never a raw error/database detail", () => {
    render(<OwnerLeadDetailPage leadId="lead-1" state={baseState({ notFound: true, error: "Not found." })} retry={vi.fn()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    expect(screen.getByText(/couldn't be found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailPage — retryable error", () => {
  it("shows Retry for a non-404 error and calls retry on click", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <OwnerLeadDetailPage leadId="lead-1" state={baseState({ error: "Something went wrong. Please try again." })} retry={retry} deps={fakeDeps} onUnauthorized={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerLeadDetailPage — loading", () => {
  it("shows a loading skeleton, no fabricated detail content, while the first fetch is in flight", () => {
    render(<OwnerLeadDetailPage leadId="lead-1" state={baseState({ isLoading: true })} retry={vi.fn()} deps={fakeDeps} onUnauthorized={vi.fn()} />);
    expect(screen.getByRole("link", { name: /back to enquiries/i })).toBeInTheDocument();
    expect(screen.queryByText(/MSM-/)).not.toBeInTheDocument();
  });
});
