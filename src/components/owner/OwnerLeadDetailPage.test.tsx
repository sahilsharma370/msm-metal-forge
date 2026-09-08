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

// Owner "Edit enquiry" — the transient success banner shown for one render
// right after a save redirects back here (see routes/owner/leads/$leadId.tsx).
describe("OwnerLeadDetailPage — Edit enquiry success banner", () => {
  const fullLeadData = {
    lead: {
      id: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      status: "new",
      intent: "sell",
      captureChannel: "website",
      material: "copper",
      materialSubtype: null,
      materialSubtypeOtherText: null,
      materialOtherText: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      fileUploadStatus: "complete",
      deletedAt: null,
      updatedAt: "2026-01-01T00:10:00.000Z",
      contact: { name: "Ahmed Seller", phone: "+971501234567", email: null, company: null },
      location: { emirate: "dubai", area: "Al Quoz", mapLink: null },
      enquiry: {
        quantityValue: 100,
        quantityUnit: "kg",
        quantityUnitOther: null,
        quantityUnsure: false,
        condition: "clean_separated",
        description: null,
        pickupRequired: "yes",
        pickupDate: null,
        accessNote: null,
        preferredContact: "whatsapp",
        notes: null,
      },
    },
    files: [],
    activities: [],
    notification: { status: "pending", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null },
  };

  it("shows a dismissible 'Enquiry updated.' banner when showSavedBanner is true", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <OwnerLeadDetailPage
        leadId="lead-1"
        state={baseState({ data: fullLeadData as never })}
        retry={vi.fn()}
        deps={fakeDeps}
        onUnauthorized={vi.fn()}
        showSavedBanner
        onDismissSavedBanner={onDismiss}
      />,
    );
    expect(screen.getByText("Enquiry updated.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows no banner when showSavedBanner is false", () => {
    render(
      <OwnerLeadDetailPage leadId="lead-1" state={baseState({ data: fullLeadData as never })} retry={vi.fn()} deps={fakeDeps} onUnauthorized={vi.fn()} />,
    );
    expect(screen.queryByText("Enquiry updated.")).not.toBeInTheDocument();
  });
});
