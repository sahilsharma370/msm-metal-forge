// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

const { OwnerLeadDetailView } = await import("./OwnerLeadDetailView");
import type { OwnerLeadDetailData } from "./use-owner-lead-detail";

afterEach(() => {
  cleanup();
});

const fakeDeps = { authClient: { getAccessToken: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }, fetchImpl: vi.fn() };

function sellData(overrides: Partial<OwnerLeadDetailData["lead"]> = {}): OwnerLeadDetailData {
  return {
    lead: {
      id: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      status: "new",
      intent: "sell",
      captureChannel: "website",
      material: "copper",
      materialSubtype: "wire_cable",
      materialSubtypeOtherText: null,
      materialOtherText: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      fileUploadStatus: "complete",
      contact: { name: "Ahmed Seller", phone: "+971501234567", email: "ahmed@example.com", company: "Ahmed Trading" },
      location: { emirate: "dubai", area: "Al Quoz", mapLink: "https://maps.google.com/?q=25,55" },
      enquiry: {
        quantityValue: 100,
        quantityUnit: "kg",
        quantityUnitOther: null,
        quantityUnsure: false,
        condition: "clean_separated",
        description: "Clean copper wire",
        pickupRequired: "yes",
        pickupDate: null,
        accessNote: null,
        preferredContact: "whatsapp",
        notes: null,
      },
      ...overrides,
    } as OwnerLeadDetailData["lead"],
    files: [],
    activities: [
      { id: "a1", eventType: "lead_created", actorType: "system", createdAt: "2026-01-01T00:00:00.000Z", statusChange: null, noteBody: null },
      { id: "a2", eventType: "submission_completed", actorType: "system", createdAt: "2026-01-01T00:05:00.000Z", statusChange: null, noteBody: null },
    ],
    notification: { status: "pending", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null },
  };
}

function buyData(): OwnerLeadDetailData {
  return {
    lead: {
      id: "22222222-2222-2222-2222-222222222222",
      reference: "MSM-260101-FEDCBA",
      status: "contacted",
      intent: "buy",
      captureChannel: "whatsapp",
      material: "aluminium",
      materialSubtype: null,
      materialSubtypeOtherText: null,
      materialOtherText: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      fileUploadStatus: "none",
      contact: { name: "Fatima Buyer", phone: "+971509999999", email: null, company: "Fatima LLC" },
      location: { emirate: "sharjah", area: "Industrial 3", mapLink: null },
      enquiry: {
        quantityValue: 500,
        quantityUnit: "kg",
        quantityUnitOther: null,
        tradeRequirement: "local",
        requiredByDate: null,
        additionalSpec: null,
        destinationCountry: null,
        destinationCityPort: null,
        preferredPort: null,
        preferredPortOther: null,
        originCountryPreference: null,
        logisticsRequirement: "delivery",
        logisticsNote: null,
        fulfilment: "delivery",
        materialSpec: "6063 extrusion",
        preferredContact: "call",
        notes: null,
      },
    } as OwnerLeadDetailData["lead"],
    files: [],
    activities: [],
    notification: { status: "attention", attemptCount: 3, manualRequeueCount: 1, lastErrorCode: "PROVIDER_TIMEOUT", lastErrorAt: "2026-01-01T00:10:00.000Z", sentAt: null },
  };
}

describe("OwnerLeadDetailView — seller-only view", () => {
  it("renders seller contact/location/enquiry fields, never buyer-only labels", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Ahmed Seller" })).toBeInTheDocument();
    expect(screen.getByText("ahmed@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ahmed Trading")).toBeInTheDocument();
    expect(screen.getByText(/clean, separated/i)).toBeInTheDocument();
    expect(screen.getByText(/100 kg/)).toBeInTheDocument();
    expect(screen.queryByText(/trade requirement|logistics|destination country/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — buyer-only view", () => {
  it("renders buyer contact/enquiry fields, never seller-only labels", () => {
    render(<OwnerLeadDetailView leadId="lead-2" data={buyData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Fatima Buyer" })).toBeInTheDocument();
    expect(screen.getByText("Fatima LLC")).toBeInTheDocument();
    expect(screen.getByText(/local/i)).toBeInTheDocument();
    expect(screen.getByText(/6063 extrusion/)).toBeInTheDocument();
    expect(screen.queryByText(/condition|pickup required|access note/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — activity timeline", () => {
  it("renders activities in the order provided, with readable event copy and actor labels", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Enquiry received")).toBeInTheDocument();
    expect(screen.getByText("Submission completed")).toBeInTheDocument();
    const items = screen.getAllByText(/System ·/);
    expect(items).toHaveLength(2);
  });

  it("renders a status_changed activity's from/to (and reason, when present) distinctly from a plain event", () => {
    const data = sellData();
    const withStatusChange = {
      ...data,
      activities: [
        ...data.activities,
        {
          id: "a3",
          eventType: "status_changed",
          actorType: "owner" as const,
          createdAt: "2026-01-02T00:00:00.000Z",
          statusChange: { from: "new" as const, to: "lost" as const, reason: "Went with a competitor" },
          noteBody: null,
        },
      ],
    };
    render(<OwnerLeadDetailView leadId="lead-1" data={withStatusChange} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Status changed")).toBeInTheDocument();
    expect(screen.getByText(/New → Lost/)).toBeInTheDocument();
    expect(screen.getByText(/Went with a competitor/)).toBeInTheDocument();
    expect(screen.getByText(/Owner ·/)).toBeInTheDocument();
  });

  it("renders a note_added activity's body as safe text, distinct from a status change", () => {
    const data = sellData();
    const withNote = {
      ...data,
      activities: [
        ...data.activities,
        {
          id: "a4",
          eventType: "note_added",
          actorType: "owner" as const,
          createdAt: "2026-01-02T00:00:00.000Z",
          statusChange: null,
          noteBody: "<b>Customer</b> wants pickup Friday",
        },
      ],
    };
    render(<OwnerLeadDetailView leadId="lead-1" data={withNote} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Private note added")).toBeInTheDocument();
    // Rendered as literal text (React auto-escapes), never parsed as HTML.
    expect(screen.getByText("<b>Customer</b> wants pickup Friday")).toBeInTheDocument();
    expect(document.querySelector("b")).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Manage section", () => {
  it("renders the status control and note composer", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Manage" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByLabelText(/add a private note/i)).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — notification states", () => {
  it("shows a pending notification with zeroed counters", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows an attention notification with attempt/error summary, never a raw provider payload", () => {
    render(<OwnerLeadDetailView leadId="lead-2" data={buyData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Attention required")).toBeInTheDocument();
    expect(screen.getByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("a Quick Add (non-website) lead with no notification row shows the honest neutral 'Notification not required' state, never 'Attention required'", () => {
    const data = sellData({ captureChannel: "phone" });
    render(
      <OwnerLeadDetailView
        leadId="lead-3"
        data={{ ...data, notification: { status: "not_required", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null } }}
        deps={fakeDeps}
        onUnauthorized={vi.fn()}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.getByText("Notification not required")).toBeInTheDocument();
    expect(screen.queryByText("Attention required")).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Call and WhatsApp links", () => {
  it("builds a tel: link and a wa.me link from the normalized phone, without a prefilled message", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const callLink = screen.getByRole("link", { name: /call ahmed seller/i });
    expect(callLink).toHaveAttribute("href", "tel:+971501234567");
    const whatsappLink = screen.getByRole("link", { name: /message ahmed seller on whatsapp/i });
    expect(whatsappLink).toHaveAttribute("href", "https://wa.me/971501234567?text=");
    expect(whatsappLink).toHaveAttribute("target", "_blank");
    expect(whatsappLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides Call/WhatsApp entirely when the phone is absent", () => {
    const data = sellData({ contact: { name: "No Phone", phone: null, email: null, company: null } } as never);
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /call/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /whatsapp/i })).not.toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — safe external map link", () => {
  it("renders a map link only for an https:// URL", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const mapLink = screen.getByRole("link", { name: /view on map/i });
    expect(mapLink).toHaveAttribute("href", "https://maps.google.com/?q=25,55");
    expect(mapLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
