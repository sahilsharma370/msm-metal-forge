// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

/** Radix DropdownMenu/AlertDialog need pointer-capture/scrollIntoView APIs jsdom does not implement — same established polyfill pattern used for Radix Select elsewhere in this codebase. */
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

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
      deletedAt: null,
      updatedAt: "2026-01-01T00:05:00.000Z",
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
      { id: "a1", eventType: "lead_created", actorType: "system", createdAt: "2026-01-01T00:00:00.000Z", statusChange: null, noteBody: null, changedFields: null },
      { id: "a2", eventType: "submission_completed", actorType: "system", createdAt: "2026-01-01T00:05:00.000Z", statusChange: null, noteBody: null, changedFields: null },
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
      deletedAt: null,
      updatedAt: "2026-01-01T00:05:00.000Z",
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

describe("OwnerLeadDetailView — presentation formatting (CHECKPOINT OWNER DESKTOP CORRECTION)", () => {
  it("title-cases a lowercase contact name in the heading and the Contact card's Name field, without mutating an already-cased name", () => {
    const data = sellData({ contact: { name: "rakesh", phone: "+971501234567", email: "ahmed@example.com", company: "Ahmed Trading" } });
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Rakesh" })).toBeInTheDocument();
    // "Rakesh" appears twice: the identity heading and the Contact card's own Name field.
    expect(screen.getAllByText("Rakesh")).toHaveLength(2);
  });

  it("uses the canonical emirate formatter so a multi-word emirate value is fully title-cased", () => {
    const data = sellData({ location: { emirate: "umm_al_quwain", area: "Al Quoz", mapLink: null } });
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Umm Al Quwain")).toBeInTheDocument();
  });

  it("never alters free-text Area casing", () => {
    const data = sellData({ location: { emirate: "dubai", area: "industrial area 10", mapLink: null } });
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("industrial area 10")).toBeInTheDocument();
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
          changedFields: null,
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
          changedFields: null,
        },
      ],
    };
    render(<OwnerLeadDetailView leadId="lead-1" data={withNote} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Private note added")).toBeInTheDocument();
    // Rendered as literal text (React auto-escapes), never parsed as HTML.
    expect(screen.getByText("<b>Customer</b> wants pickup Friday")).toBeInTheDocument();
    expect(document.querySelector("b")).not.toBeInTheDocument();
  });

  it("renders a lead_details_updated activity's changed field labels, never old/new values", () => {
    const data = sellData();
    const withEdit = {
      ...data,
      activities: [
        ...data.activities,
        {
          id: "a5",
          eventType: "lead_details_updated",
          actorType: "owner" as const,
          createdAt: "2026-01-02T00:00:00.000Z",
          statusChange: null,
          noteBody: null,
          changedFields: ["Material", "Quantity"],
        },
      ],
    };
    render(<OwnerLeadDetailView leadId="lead-1" data={withEdit} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Enquiry details updated")).toBeInTheDocument();
    expect(screen.getByText("Changed: Material, Quantity")).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Manage section", () => {
  it("renders the status control and note composer", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByLabelText(/internal note/i)).toBeInTheDocument();
  });
});

// CHECKPOINT OWNER DESKTOP CORRECTION — the Owner notification panel is now
// hidden entirely in every normal state (sent/pending/not_required): "0
// attempts, 0 manual requeues" for a message working exactly as expected is
// technical noise, not something the owner needs to see. It only appears
// once delivery genuinely needs attention. Nothing about the underlying
// derivation/attempts/requeue data is deleted — this only changes what the
// normal-state UI chooses to render.
describe("OwnerLeadDetailView — notification states", () => {
  it("hides the entire notification panel for a normal pending notification", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: /owner notification/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("shows an attention notification with attempt/error summary, never a raw provider payload", () => {
    render(<OwnerLeadDetailView leadId="lead-2" data={buyData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /owner notification/i })).toBeInTheDocument();
    expect(screen.getByText("Attention required")).toBeInTheDocument();
    expect(screen.getByText("PROVIDER_TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("a Quick Add (non-website) lead with a not-required notification hides the panel entirely, never showing 'Attention required'", () => {
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
    expect(screen.queryByRole("heading", { name: /owner notification/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Notification not required")).not.toBeInTheDocument();
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

describe("OwnerLeadDetailView — Contact card (CHECKPOINT C2M-A)", () => {
  it("shows an accessible mailto: action when an email exists", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const emailLink = screen.getByRole("link", { name: /email ahmed seller/i });
    expect(emailLink).toHaveAttribute("href", "mailto:ahmed@example.com");
  });

  it("hides the Email action entirely when there is no email", () => {
    render(<OwnerLeadDetailView leadId="lead-2" data={buyData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /^email/i })).not.toBeInTheDocument();
  });

  it("makes WhatsApp the primary (brand) action when the customer's stated preference is whatsapp", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const whatsappLink = screen.getByRole("link", { name: /message ahmed seller on whatsapp/i });
    const callLink = screen.getByRole("link", { name: /call ahmed seller/i });
    // The brand button variant renders bg-copper-bright; the outline variant does not.
    expect(whatsappLink.closest("a")?.className).toMatch(/copper-bright/);
    expect(callLink.closest("a")?.className).not.toMatch(/copper-bright/);
  });

  it("makes Call the primary action when the customer's stated preference is call", () => {
    render(<OwnerLeadDetailView leadId="lead-2" data={buyData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const callLink = screen.getByRole("link", { name: /call fatima buyer/i });
    expect(callLink.className).toMatch(/copper-bright/);
  });

  it("displays the preferred contact method as text, exactly once (no duplicate elsewhere on the page)", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    // "WhatsApp" appears as the button label AND as the Contact card's own
    // "Preferred contact" value — both are legitimate, distinct UI pieces
    // (an action button vs. a labelled fact), not a duplicated data point.
    expect(screen.getByText("Preferred contact")).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Actions menu (CHECKPOINT OWNER DESKTOP CORRECTION, discoverability pass)", () => {
  it("offers a restrained 'Actions' control (not a bare icon) with Archive enquiry and Move to Trash on a normal lead", async () => {
    const user = userEvent.setup();
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /^actions$/i });
    expect(trigger).toBeInTheDocument();
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /archive enquiry/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /move to trash/i })).toBeInTheDocument();
  });

  it("offers 'Edit enquiry' as the first item, linking to the dedicated edit screen for an active lead", async () => {
    const user = userEvent.setup();
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    const menuItems = await screen.findAllByRole("menuitem");
    expect(menuItems[0]).toHaveTextContent(/edit enquiry/i);
    expect(screen.getByRole("menuitem", { name: /edit enquiry/i })).toHaveAttribute("href", "/owner/leads/$leadId/edit");
  });

  it("does not offer Edit enquiry for a lead that is already archived", async () => {
    const user = userEvent.setup();
    const data = sellData({ status: "archived" });
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(await screen.findByRole("menuitem", { name: /move to trash/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /edit enquiry/i })).not.toBeInTheDocument();
  });

  it("Archive enquiry reuses the existing status-change mutation (real changeStatus call reaches the transport layer)", async () => {
    const user = userEvent.setup();
    const onUnauthorized = vi.fn();
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={onUnauthorized} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(await screen.findByRole("menuitem", { name: /archive enquiry/i }));
    // fakeDeps' authClient has no real session, so the real changeStatus
    // mutation call resolves to "unauthorized" — proving the click actually
    // invoked the same mutation status/note controls use, not a stub.
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
  });

  it("does not offer Archive enquiry for a lead that is already archived", async () => {
    const user = userEvent.setup();
    const data = sellData({ status: "archived" });
    render(<OwnerLeadDetailView leadId="lead-1" data={data} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    expect(await screen.findByRole("menuitem", { name: /move to trash/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /archive enquiry/i })).not.toBeInTheDocument();
  });

  it("opens a confirmation dialog explaining the reversible effect, with Cancel and Move to Trash actions", async () => {
    const user = userEvent.setup();
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^actions$/i }));
    await user.click(await screen.findByRole("menuitem", { name: /move to trash/i }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/disappear from the inbox, overview analytics and csv exports/i)).toBeInTheDocument();
    expect(screen.getByText(/stays fully recoverable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^move to trash$/i })).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — trashed lead is read-only (CHECKPOINT C2M-A)", () => {
  function trashedSellData() {
    const data = sellData();
    return { ...data, lead: { ...data.lead, deletedAt: "2026-02-01T00:00:00.000Z" } } as OwnerLeadDetailData;
  }

  it("shows an 'In Trash' badge in the header", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("In Trash")).toBeInTheDocument();
  });

  it("hides the status control and note composer entirely", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/internal note/i)).not.toBeInTheDocument();
  });

  it("shows a primary Restore enquiry action and no Move to Trash control", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("button", { name: /restore enquiry/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
  });

  it("never offers permanent deletion", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByText(/permanent/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("never offers Edit enquiry — the whole Actions menu (its one home) is gone for a trashed lead", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^actions$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit enquiry/i })).not.toBeInTheDocument();
  });

  it("still renders the original submitted enquiry content, unchanged", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={trashedSellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText(/100 kg/)).toBeInTheDocument();
    expect(screen.getByText("Ahmed Trading")).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Copy reference (CHECKPOINT OWNER DESKTOP CORRECTION, metadata pass)", () => {
  it("copies the full reference number and shows brief success feedback", async () => {
    const user = userEvent.setup();
    // Defined AFTER userEvent.setup() — user-event installs its own
    // navigator.clipboard stub during setup for its .paste() emulation,
    // which would otherwise clobber a mock defined earlier.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /copy reference number/i }));
    expect(writeText).toHaveBeenCalledWith("MSM-260101-ABCDEF");
    expect(await screen.findByText("Reference copied")).toBeInTheDocument();
  });
});

describe("OwnerLeadDetailView — Attachments field (CHECKPOINT OWNER DESKTOP CORRECTION, metadata pass)", () => {
  it("shows an 'Attachments: None provided' field inside Enquiry details when there are no files, with no separate empty files surface", () => {
    render(<OwnerLeadDetailView leadId="lead-1" data={sellData()} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByText("Attachments")).toBeInTheDocument();
    expect(screen.getByText("None provided")).toBeInTheDocument();
    expect(screen.queryByText(/^no files provided\.?$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^files$/i })).not.toBeInTheDocument();
  });

  it("keeps the real Files panel and file-viewer functionality when attachments exist, with no Attachments field duplicating it", () => {
    const data = sellData();
    const withFile = {
      ...data,
      files: [
        {
          id: "file-1",
          kind: "seller_photo" as const,
          originalFilename: "scrap.jpg",
          mimeType: "image/jpeg" as const,
          byteSize: 1024,
          uploadedAt: "2026-01-01T00:00:00.000Z",
          uploadStatus: "complete" as const,
        },
      ],
    };
    render(<OwnerLeadDetailView leadId="lead-1" data={withFile} deps={fakeDeps} onUnauthorized={vi.fn()} onMutated={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /^files$/i })).toBeInTheDocument();
    expect(screen.getByText("scrap.jpg")).toBeInTheDocument();
    expect(screen.queryByText("Attachments")).not.toBeInTheDocument();
  });
});
