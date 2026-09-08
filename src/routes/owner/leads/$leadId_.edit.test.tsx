// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

function fakeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
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
    updatedAt: "2026-01-01T00:05:00.000Z",
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
    ...overrides,
  };
}

let detailState: Record<string, unknown> = { data: null, isLoading: true, error: null, notFound: false, unauthorized: false };
const refreshMock = vi.fn();

vi.mock("@/components/owner/use-owner-lead-detail", () => ({
  useOwnerLeadDetail: () => ({ state: detailState, refresh: refreshMock }),
}));

const submitMock = vi.fn();
const clearErrorMock = vi.fn();
let editState = { isSubmitting: false, error: null as string | null };

vi.mock("@/components/owner/use-owner-lead-edit", () => ({
  useOwnerLeadEdit: () => ({ state: editState, submit: submitMock, clearError: clearErrorMock }),
}));

const { OwnerLeadEditBody } = await import("./$leadId_.edit");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  detailState = { data: null, isLoading: true, error: null, notFound: false, unauthorized: false };
  editState = { isSubmitting: false, error: null };
});

describe("OwnerLeadEditBody — archived/trashed rejection (defense in depth)", () => {
  it("shows a read-only message and never renders the form for a trashed lead", () => {
    detailState = { data: { lead: fakeLead({ deletedAt: "2026-02-01T00:00:00.000Z" }), files: [], activities: [], notification: {} }, isLoading: false, error: null, notFound: false, unauthorized: false };
    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    expect(screen.getByText(/in trash and can't be edited/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/contact name/i)).not.toBeInTheDocument();
  });

  it("shows a read-only message and never renders the form for an archived lead", () => {
    detailState = { data: { lead: fakeLead({ status: "archived" }), files: [], activities: [], notification: {} }, isLoading: false, error: null, notFound: false, unauthorized: false };
    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    expect(screen.getByText(/archived and can't be edited/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/contact name/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadEditBody — prefilled seller mapping and successful save", () => {
  it("prefills the form from the fetched lead and navigates back to detail with a saved indicator on success", async () => {
    const user = userEvent.setup();
    detailState = { data: { lead: fakeLead(), files: [], activities: [], notification: {} }, isLoading: false, error: null, notFound: false, unauthorized: false };
    submitMock.mockResolvedValue({ ok: true, updated: true, updatedAt: "2026-01-01T00:10:00.000Z" });

    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    expect(screen.getByDisplayValue("Ahmed Seller")).toBeInTheDocument();

    await user.type(screen.getByDisplayValue("Ahmed Seller"), " Jr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/owner/leads/$leadId", params: { leadId: LEAD_ID }, search: { saved: "1" } }),
    );
    expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({ contactName: "Ahmed Seller Jr", expectedUpdatedAt: "2026-01-01T00:05:00.000Z" }));
  });

  it("a conflict response refreshes detail in the background without navigating away", async () => {
    const user = userEvent.setup();
    detailState = { data: { lead: fakeLead(), files: [], activities: [], notification: {} }, isLoading: false, error: null, notFound: false, unauthorized: false };
    submitMock.mockResolvedValue({ ok: false, conflict: true, message: "This enquiry was already updated. Please refresh and try again." });

    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    await user.type(screen.getByDisplayValue("Ahmed Seller"), " Jr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(navigateMock).not.toHaveBeenCalledWith(expect.objectContaining({ search: { saved: "1" } }));
    // The owner's typed value is untouched by the background refresh.
    expect(screen.getByDisplayValue("Ahmed Seller Jr")).toBeInTheDocument();
  });

  it("Cancel with no changes navigates straight back to the enquiry detail", async () => {
    const user = userEvent.setup();
    detailState = { data: { lead: fakeLead(), files: [], activities: [], notification: {} }, isLoading: false, error: null, notFound: false, unauthorized: false };
    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/owner/leads/$leadId", params: { leadId: LEAD_ID } });
  });
});

describe("OwnerLeadEditBody — buyer lead prefill omits Location", () => {
  it("does not render an Emirate/Area section for a buyer lead", () => {
    detailState = {
      data: {
        lead: fakeLead({
          intent: "buy",
          contact: { name: "Fatima Buyer", phone: "+971509999999", email: null, company: null },
          location: { emirate: "sharjah", area: "Industrial 3", mapLink: null },
          enquiry: { quantityValue: 500, quantityUnit: "kg", quantityUnitOther: null, notes: null },
        }),
        files: [],
        activities: [],
        notification: {},
      },
      isLoading: false,
      error: null,
      notFound: false,
      unauthorized: false,
    };
    render(<OwnerLeadEditBody leadId={LEAD_ID} onUnauthorized={vi.fn()} />);
    expect(screen.getByDisplayValue("Fatima Buyer")).toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });
});
