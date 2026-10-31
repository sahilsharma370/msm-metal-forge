// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { OwnerOverview } = await import("./OwnerOverview");
import type { OwnerLeadOverviewData } from "@/lib/owner/owner-lead-overview-contract";
import type { OwnerOverviewProps } from "./OwnerOverview";

afterEach(() => {
  cleanup();
});

function zeroData(overrides: Partial<OwnerLeadOverviewData> = {}): OwnerLeadOverviewData {
  return {
    generatedAt: "2026-08-21T02:33:00.000Z",
    totals: { total: 0, new: 0, open: 0, completed: 0 },
    byStatus: {
      new: 0,
      needs_information: 0,
      contacted: 0,
      inspection: 0,
      quote_sent: 0,
      pickup_delivery: 0,
      completed: 0,
      lost: 0,
      archived: 0,
    },
    byIntent: { sell: 0, buy: 0 },
    byMaterial: { copper: 0, aluminium: 0, steel_iron: 0, lead: 0, other: 0 },
    byCaptureChannel: { website: 0, phone: 0, whatsapp: 0, walk_in: 0, owner_manual: 0 },
    dailyCounts: [
      { date: "2026-08-15", count: 0 },
      { date: "2026-08-16", count: 0 },
      { date: "2026-08-17", count: 0 },
      { date: "2026-08-18", count: 0 },
      { date: "2026-08-19", count: 0 },
      { date: "2026-08-20", count: 0 },
      { date: "2026-08-21", count: 0 },
    ],
    stale: { thresholdHours: 72, count: 0 },
    attentionCount: 0,
    attentionLeads: [],
    ...overrides,
  };
}

function renderOverview(data: OwnerLeadOverviewData): void {
  const props: OwnerOverviewProps = { state: { data, isLoading: false, error: null, unauthorized: false }, refresh: vi.fn() };
  render(<OwnerOverview {...props} />);
}

describe("OwnerOverview — KPI row (action-first order, no icons, no drill-down affordance)", () => {
  it("renders New, Open, Completed, Total in that order, all as plain non-link cards", () => {
    renderOverview(zeroData({ totals: { total: 4, new: 1, open: 2, completed: 1 } }));
    // Scoped to <p> — KPI labels render as <p>; breakdown category labels
    // (which may repeat "New" as a Status row, CHECKPOINT C2M-A always
    // renders the full category set) render as <span>, so this stays
    // exclusively the four KPI cards regardless of breakdown content.
    const labels = screen.getAllByText(/^(New|Open|Completed|Total enquiries)$/, { selector: "p" });
    expect(labels.map((el) => el.textContent)).toEqual(["New", "Open", "Completed", "Total enquiries"]);
    // None of the four KPI values navigate anywhere — Enquiries has no
    // URL-driven filter support to deep-link a "New"/"Open"/"Completed"/
    // "Total" view into, so none of these are links.
    expect(screen.queryByRole("link", { name: /total enquiries/i })).not.toBeInTheDocument();
  });
});

describe("OwnerOverview — Follow-ups due section removed", () => {
  it("never renders a Follow-ups due section (heading, positive strip, or per-lead rows), even when the API response carries attention/stale/attentionLeads data, while the KPI/breakdown/sparkline sections remain", () => {
    renderOverview(
      zeroData({
        totals: { total: 1, new: 1, open: 1, completed: 0 },
        stale: { thresholdHours: 72, count: 1 },
        attentionCount: 1,
        attentionLeads: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            reference: "MSM-260101-ABCDEF",
            status: "contacted",
            contactName: "rakesh",
            material: "copper",
            lastActivityAt: "2026-08-15T00:00:00.000Z",
            hoursSinceActivity: 96,
            reasons: ["stale"],
          },
        ],
      }),
    );
    expect(screen.queryByText(/follow-ups due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing needs attention right now/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Rakesh · Copper")).not.toBeInTheDocument();
    expect(screen.queryByText("MSM-260101-ABCDEF")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view/i })).not.toBeInTheDocument();

    // The approved sections remain, unaffected by the removal.
    const kpiLabels = screen.getAllByText(/^(New|Open|Completed|Total enquiries)$/, { selector: "p" });
    expect(kpiLabels).toHaveLength(4);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Material")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Enquiry type")).toBeInTheDocument();
    expect(screen.getByText("Enquiries — last 7 days")).toBeInTheDocument();
  });
});

describe("OwnerOverview — seven-day sparkline", () => {
  it("titles the panel 'Enquiries — last 7 days'", () => {
    renderOverview(zeroData());
    expect(screen.getByText("Enquiries — last 7 days")).toBeInTheDocument();
  });

  it("shows a deliberate empty-window message when all seven days are zero", () => {
    renderOverview(zeroData());
    expect(screen.getByText(/no enquiries in this window/i)).toBeInTheDocument();
  });

  it("still shows every day's count and date as plain readable text", () => {
    renderOverview(
      zeroData({
        dailyCounts: [
          { date: "2026-08-15", count: 0 },
          { date: "2026-08-16", count: 3 },
          { date: "2026-08-17", count: 0 },
          { date: "2026-08-18", count: 0 },
          { date: "2026-08-19", count: 0 },
          { date: "2026-08-20", count: 0 },
          { date: "2026-08-21", count: 1 },
        ],
      }),
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("16 Aug")).toBeInTheDocument();
    expect(screen.getByText("21 Aug")).toBeInTheDocument();
  });
});

describe("OwnerOverview — breakdown panels (CHECKPOINT C2M-A: full category set, percentage-of-total bars)", () => {
  it("renders every category in the vocabulary, including zero ones — never hidden, just muted with no bar", () => {
    renderOverview(
      zeroData({
        totals: { total: 2, new: 2, open: 2, completed: 0 },
        byStatus: {
          new: 2,
          needs_information: 0,
          contacted: 0,
          inspection: 0,
          quote_sent: 0,
          pickup_delivery: 0,
          completed: 0,
          lost: 0,
          archived: 0,
        },
      }),
    );
    // Zero categories remain visible so the owner can see the complete
    // system, not just what happens to be non-zero right now.
    const needsInfoRow = screen.getByText("Needs information").closest("li");
    const archivedRow = screen.getByText("Archived").closest("li");
    expect(needsInfoRow).toHaveTextContent("0");
    expect(archivedRow).toHaveTextContent("0");
    // A zero category shows a plain "0", never a fabricated percentage.
    expect(needsInfoRow).not.toHaveTextContent("%");
    expect(archivedRow).not.toHaveTextContent("%");
  });

  it("a non-zero category shows its exact count only — no percentage text (CHECKPOINT OWNER DESKTOP CORRECTION)", () => {
    renderOverview(
      zeroData({
        totals: { total: 4, new: 1, open: 4, completed: 0 },
        byStatus: {
          new: 1,
          needs_information: 0,
          contacted: 2,
          inspection: 0,
          quote_sent: 0,
          pickup_delivery: 0,
          completed: 0,
          lost: 0,
          archived: 0,
        },
      }),
    );
    const newRow = screen.getByText("New", { selector: "span" }).closest("li");
    const contactedRow = screen.getByText("Contacted").closest("li");
    expect(newRow).toHaveTextContent("1");
    expect(newRow).not.toHaveTextContent("%");
    expect(contactedRow).toHaveTextContent("2");
    expect(contactedRow).not.toHaveTextContent("%");
  });

  it("explains the two-enquiry demo dataset accurately: both New/Selling/Copper/Phone", () => {
    renderOverview(
      zeroData({
        totals: { total: 2, new: 2, open: 2, completed: 0 },
        byStatus: {
          new: 2,
          needs_information: 0,
          contacted: 0,
          inspection: 0,
          quote_sent: 0,
          pickup_delivery: 0,
          completed: 0,
          lost: 0,
          archived: 0,
        },
        byIntent: { sell: 2, buy: 0 },
        byMaterial: { copper: 2, aluminium: 0, steel_iron: 0, lead: 0, other: 0 },
        byCaptureChannel: { website: 0, phone: 2, whatsapp: 0, walk_in: 0, owner_manual: 0 },
      }),
    );
    expect(screen.getByText("Selling")).toBeInTheDocument();
    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("renames Seller vs buyer -> Enquiry type and Capture channel -> Source", () => {
    renderOverview(zeroData());
    expect(screen.getByText("Enquiry type")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.queryByText("Seller vs buyer")).not.toBeInTheDocument();
    expect(screen.queryByText("Capture channel")).not.toBeInTheDocument();
  });
});
