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
import type { OwnerLeadInboxProps } from "./OwnerLeadInbox";
import type { OwnerLeadListHookState } from "./use-owner-lead-list";
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
    view: "inbox",
    ...overrides,
  };
}

function baseProps(overrides: Partial<OwnerLeadInboxProps> = {}): OwnerLeadInboxProps {
  return {
    state: baseState(),
    draftFilters: {},
    setDraftFilters: vi.fn(),
    applyFilters: vi.fn(),
    clearFilters: vi.fn(),
    setView: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    exportState: { isExporting: false, error: null },
    onExportCsv: vi.fn().mockResolvedValue(undefined),
    onClearExportError: vi.fn(),
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
    deletedAt: null,
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
    deletedAt: null,
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
    // CHECKPOINT C2M-A — displayed phone is now grouped for readability
    // ("+971 50 123 4567"), while the canonical E.164 form still drives the
    // tel:/WhatsApp hrefs elsewhere (see owner-lead-format.test.ts).
    expect(screen.getByText("+971 50 123 4567")).toBeInTheDocument();
    // CHECKPOINT OWNER DESKTOP CORRECTION (hierarchy pass) — location is now
    // two separate lines (emirate primary, area secondary) rather than one
    // combined "area, emirate" string. CHECKPOINT OWNER DESKTOP CORRECTION
    // (small fixes pass) — the raw stored "dubai" now displays in
    // presentation case, "Dubai".
    expect(screen.getByText("Dubai")).toBeInTheDocument();
    expect(screen.getByText("Al Quoz")).toBeInTheDocument();
    expect(screen.getByText(/100 kg/)).toBeInTheDocument();
  });

  it("renders a buyer lead's summary fields", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [buyLead()] }) })} />);
    expect(screen.getByText("Fatima Buyer")).toBeInTheDocument();
    expect(screen.getByText("Sharjah")).toBeInTheDocument();
    expect(screen.getByText("Industrial 3")).toBeInTheDocument();
  });

  it("shows one restrained 'Not provided' line for a wholly missing location, never two stacked em-dashes", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead({ location: { emirate: null, area: null } })] }) })} />);
    expect(screen.getByText("Not provided")).toBeInTheDocument();
    expect(screen.queryAllByText("—")).toHaveLength(0);
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

describe("OwnerLeadInbox — notification UI only for genuine attention (CHECKPOINT C2L-V4)", () => {
  it.each(["sent", "pending", "not_required"] as const)("shows no notification badge on a normal '%s' row", (notificationStatus) => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead({ notificationStatus })] }) })} />);
    expect(screen.queryByText(/notification not required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^sent$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^pending$/i)).not.toBeInTheDocument();
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

describe("OwnerLeadInbox — end-of-list footer only when pagination was ever real (CHECKPOINT C2L-V4)", () => {
  it("hides 'reached the end' for a short first page (fewer than one full page, nothing more to load)", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead(), buyLead()], hasMore: false }) })} />);
    expect(screen.queryByText(/reached the end/i)).not.toBeInTheDocument();
  });

  it("shows 'reached the end' once a genuine full page was loaded and there is truly nothing more", () => {
    const items = Array.from({ length: 20 }, (_, index) => sellLead({ id: `${index}`.padStart(8, "0") + "-1111-1111-1111-111111111111" }));
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items, hasMore: false }) })} />);
    expect(screen.getByText(/reached the end/i)).toBeInTheDocument();
  });
});

// CHECKPOINT OWNER DESKTOP CORRECTION — the page-level "+ Add enquiry" was
// removed: the persistent OwnerShell header is now the one canonical copy
// (see OwnerShell.test.tsx), so this page must never duplicate it.
describe("OwnerLeadInbox — no duplicate Add enquiry action (CHECKPOINT OWNER DESKTOP CORRECTION)", () => {
  it("does not render its own page-level Add enquiry action when results are loaded", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()] }) })} />);
    expect(screen.queryByRole("link", { name: /^add enquiry$/i })).not.toBeInTheDocument();
  });

  it("still offers Record an enquiry from the genuine empty (no-filter) state", () => {
    render(<OwnerLeadInbox {...baseProps()} />);
    const link = screen.getByRole("link", { name: /record an enquiry/i });
    expect(link).toHaveAttribute("href", "/owner/leads/new");
  });
});

describe("OwnerLeadInbox — Inbox/Archived/Trash view control (CHECKPOINT C2M-A)", () => {
  it("renders all three view tabs with Inbox selected by default", () => {
    render(<OwnerLeadInbox {...baseProps()} />);
    expect(screen.getByRole("tab", { name: /inbox/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /archived/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /trash/i })).toHaveAttribute("aria-selected", "false");
  });

  it("calls setView with the clicked tab", async () => {
    const setView = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadInbox {...baseProps({ setView })} />);
    await user.click(screen.getByRole("tab", { name: /trash/i }));
    expect(setView).toHaveBeenCalledWith("trash");
  });

  it("does not refetch when clicking the already-active tab", async () => {
    const setView = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadInbox {...baseProps({ setView })} />);
    await user.click(screen.getByRole("tab", { name: /inbox/i }));
    expect(setView).not.toHaveBeenCalled();
  });

  it("shows the empty-Trash copy and no 'Record an enquiry' action in the Trash view", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ view: "trash" }) })} />);
    expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /record an enquiry/i })).not.toBeInTheDocument();
  });

  it("shows the empty-Archived copy in the Archived view", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ view: "archived" }) })} />);
    expect(screen.getByText(/no archived enquiries/i)).toBeInTheDocument();
  });
});

describe("OwnerLeadInbox — Export CSV (CHECKPOINT C2M-A)", () => {
  it("offers Export CSV in the Inbox and Archived views", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ view: "inbox" }) })} />);
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
    cleanup();
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ view: "archived" }) })} />);
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("never offers Export CSV in the Trash view — nothing in Trash is exportable", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ view: "trash" }) })} />);
    expect(screen.queryByRole("button", { name: /export csv/i })).not.toBeInTheDocument();
  });

  it("calls onExportCsv with the current view and applied filters", async () => {
    const onExportCsv = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <OwnerLeadInbox
        {...baseProps({ state: baseState({ view: "archived", appliedFilters: { material: "copper", q: "Ahmed" } }), onExportCsv })}
      />,
    );
    await user.click(screen.getByRole("button", { name: /export csv/i }));
    expect(onExportCsv).toHaveBeenCalledWith({ view: "archived", material: "copper", q: "Ahmed" });
  });

  it("shows an exporting state and disables the button while isExporting is true", () => {
    render(<OwnerLeadInbox {...baseProps({ exportState: { isExporting: true, error: null } })} />);
    expect(screen.getByRole("button", { name: /exporting/i })).toBeDisabled();
  });

  it("shows an inline dismissible error when the export fails", async () => {
    const onClearExportError = vi.fn();
    const user = userEvent.setup();
    render(<OwnerLeadInbox {...baseProps({ exportState: { isExporting: false, error: "Couldn't export the CSV. Please try again." }, onClearExportError })} />);
    expect(screen.getByText("Couldn't export the CSV. Please try again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onClearExportError).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerLeadInbox — column heading discloses UAE once, not per row (CHECKPOINT C2M-A)", () => {
  it("shows 'Received (UAE)' in the column heading", () => {
    render(<OwnerLeadInbox {...baseProps({ state: baseState({ items: [sellLead()] }) })} />);
    expect(screen.getByText(/received \(uae\)/i)).toBeInTheDocument();
  });
});
