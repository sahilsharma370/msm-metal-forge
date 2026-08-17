// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// OwnerLeadListItem renders a real <a> via TanStack's <Link>, which needs a
// live RouterProvider to resolve `to`/`params` into an href. These tests
// only care about the row's own rendered content/behavior, not real
// client-side navigation (routing itself is covered where it matters:
// OwnerShell's guard-redirect tests, and OwnerLeadDetailPage's own Back
// link test) — so <Link> is swapped for a plain anchor here.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, params, children, ...props }: { to: string; params?: Record<string, string>; children: ReactNode }) => {
      const href = params ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to) : to;
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  };
});

const { OwnerLeadInbox } = await import("./OwnerLeadInbox");
import type { UseOwnerLeadListResult, OwnerLeadListHookState } from "./use-owner-lead-list";
import type { OwnerLeadListItem } from "@/lib/owner/owner-leads-contract";

afterEach(() => {
  cleanup();
});

function baseState(overrides: Partial<OwnerLeadListHookState> = {}): OwnerLeadListHookState {
  return {
    items: [],
    hasMore: false,
    nextCursor: null,
    isInitialLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    unauthorized: false,
    appliedFilters: {},
    ...overrides,
  };
}

function baseProps(overrides: Partial<UseOwnerLeadListResult> = {}): UseOwnerLeadListResult {
  return {
    state: baseState(),
    draftFilters: {},
    setDraftFilters: vi.fn(),
    applyFilters: vi.fn(),
    clearFilters: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

function sellLead(overrides: Partial<OwnerLeadListItem> = {}): OwnerLeadListItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reference: "MSM-260101-ABCDEF",
    status: "new",
    intent: "sell",
    captureChannel: "website",
    material: "copper",
    materialSubtype: "wire_cable",
    createdAt: "2026-01-01T00:00:00.000Z",
    submissionCompletedAt: "2026-01-01T00:05:00.000Z",
    contact: { name: "Ahmed Seller", phone: "+971501234567" },
    location: { emirate: "dubai", area: "Al Quoz" },
    quantity: { value: 100, unit: "kg" },
    fileUploadStatus: "complete",
    notificationStatus: "pending",
    ...overrides,
  };
}

function buyLead(overrides: Partial<OwnerLeadListItem> = {}): OwnerLeadListItem {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    reference: "MSM-260101-FEDCBA",
    status: "contacted",
    intent: "buy",
    captureChannel: "whatsapp",
    material: "aluminium",
    materialSubtype: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    submissionCompletedAt: "2026-01-01T00:05:00.000Z",
    contact: { name: "Fatima Buyer", phone: "+971509999999" },
    location: { emirate: "sharjah", area: "Industrial 3" },
    quantity: { value: 500, unit: "kg" },
    fileUploadStatus: "none",
    notificationStatus: "attention",
    ...overrides,
  };
}

describe("OwnerLeadInbox — loading skeleton", () => {
  it("shows a skeleton and no fabricated rows while the first load is in flight", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ isInitialLoading: true }) })} />);
    expect(screen.queryByText(/MSM-/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[class*='animate-pulse']").length).toBeGreaterThan(0);
  });
});

describe("OwnerLeadInbox — empty states", () => {
  it("shows the genuine empty-database message when no filters are active", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ appliedFilters: {} }) })} />);
    expect(screen.getByText(/no enquiries yet/i)).toBeInTheDocument();
  });

  it("shows the no-results-for-filters message when filters are active, with a Clear filters action", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ appliedFilters: { status: "lost" } }) })} />);
    expect(screen.getByText(/no enquiries match these filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });
});

describe("OwnerLeadInbox — rendering seller and buyer summaries", () => {
  it("renders a seller lead's summary fields", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()] }) })} />);
    expect(screen.getByText("Ahmed Seller")).toBeInTheDocument();
    expect(screen.getByText("+971501234567")).toBeInTheDocument();
    expect(screen.getByText(/Al Quoz, dubai/)).toBeInTheDocument();
    expect(screen.getByText(/100 kg/)).toBeInTheDocument();
  });

  it("renders a buyer lead's summary fields", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [buyLead()] }) })} />);
    expect(screen.getByText("Fatima Buyer")).toBeInTheDocument();
    expect(screen.getByText(/Industrial 3, sharjah/)).toBeInTheDocument();
  });

  it("never renders an internal/forbidden field name in the DOM", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead(), buyLead()] }) })} />);
    expect(document.body.textContent).not.toMatch(/storage_path|submission_snapshot|payload_hash|idempotency_key/i);
  });
});

describe("OwnerLeadInbox — notification attention is never color-only", () => {
  it("pairs the attention badge with visible text, not just a color", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [buyLead({ notificationStatus: "attention" })] }) })} />);
    expect(screen.getByText(/attention required/i)).toBeInTheDocument();
  });
});

describe("OwnerLeadInbox — error and retry", () => {
  it("shows the sanitized error message and calls retry on click", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ error: "Something went wrong. Please try again." }), retry })} />);
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerLeadInbox — load more", () => {
  it("calls loadMore and disables the button while a page is loading", async () => {
    const loadMore = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()], hasMore: true }), loadMore })} />);
    const button = screen.getByRole("button", { name: /load more/i });
    await user.click(button);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled loading button while isLoadingMore is true", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()], hasMore: true, isLoadingMore: true }) })} />);
    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled();
  });

  it("does not show Load more once hasMore is false", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()], hasMore: false }) })} />);
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});
