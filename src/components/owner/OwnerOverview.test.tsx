// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// The KPI chevrons render a real <a> via TanStack's <Link to="/owner"
// search={...}>, which needs a live RouterProvider to resolve into an href
// — same rationale/pattern as OwnerLeadInbox.test.tsx's own mock. `search`
// is serialized into a query string exactly like the real router would for
// this route's own `{ status? }` search schema, so href assertions below
// reflect the real deep link an owner would land on.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string | undefined>; children: ReactNode }) => {
      const query = search ? Object.entries(search).filter(([, value]) => value !== undefined) : [];
      const href = query.length > 0 ? `${to}?${query.map(([key, value]) => `${key}=${value}`).join("&")}` : to;
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  };
});

// jsdom has no ResizeObserver — recharts' <ResponsiveContainer> needs one to
// mount at all. A no-op stub is enough here: these tests assert on rendered
// text/links, never on actual pixel dimensions.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

const { OwnerOverview, sumDailyCounts, peakDailyCount, formatUaeDateRangeLabel, computeNiceYAxisTicks } = await import("./OwnerOverview");
import type { OwnerLeadOverviewData, OwnerOverviewDailyCount } from "@/lib/owner/owner-lead-overview-contract";
import type { OwnerOverviewProps } from "./OwnerOverview";

afterEach(() => {
  cleanup();
});

function days7(overrides: Partial<Record<string, number>> = {}): OwnerOverviewDailyCount[] {
  const dates = ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
  return dates.map((date) => ({ date, count: overrides[date] ?? 0 }));
}

function days30(): OwnerOverviewDailyCount[] {
  return Array.from({ length: 30 }, (_, index) => {
    const dt = new Date(Date.UTC(2026, 6, 23) + index * 24 * 60 * 60 * 1000);
    const date = dt.toISOString().slice(0, 10);
    return { date, count: 0 };
  });
}

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
    dailyCounts: days7(),
    dailyCounts30: days30(),
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

describe("OwnerOverview — pure helpers", () => {
  it("sumDailyCounts / peakDailyCount", () => {
    const days = [
      { date: "2026-08-15", count: 0 },
      { date: "2026-08-16", count: 3 },
      { date: "2026-08-17", count: 11 },
    ];
    expect(sumDailyCounts(days)).toBe(14);
    expect(peakDailyCount(days)).toBe(11);
    expect(peakDailyCount([])).toBe(0);
  });

  it("formatUaeDateRangeLabel formats the first/last day of the series", () => {
    expect(formatUaeDateRangeLabel(days7())).toBe("15 Aug — 21 Aug");
    expect(formatUaeDateRangeLabel([])).toBe("");
  });

  it("computeNiceYAxisTicks produces 5 evenly-spaced rounded ticks, matching the reference's 0/3/6/9/12 for a peak of 11", () => {
    expect(computeNiceYAxisTicks(11)).toEqual([0, 3, 6, 9, 12]);
    expect(computeNiceYAxisTicks(0)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("OwnerOverview — KPI row", () => {
  it("renders Total/New/Open/Completed with real values and a chevron link to Enquiries for each", () => {
    renderOverview(zeroData({ totals: { total: 42, new: 35, open: 37, completed: 3 } }));
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view total enquiries in enquiries/i })).toHaveAttribute("href", "/owner");
    expect(screen.getByRole("link", { name: /view new in enquiries/i })).toHaveAttribute("href", "/owner?status=new");
    expect(screen.getByRole("link", { name: /view completed in enquiries/i })).toHaveAttribute("href", "/owner?status=completed");
  });

  it("Open shows the active-statuses hint", () => {
    renderOverview(zeroData());
    expect(screen.getByText(/includes new & other active statuses/i)).toBeInTheDocument();
  });
});

describe("OwnerOverview — status pipeline", () => {
  it("renders all 9 statuses in business order, including zero ones", () => {
    renderOverview(
      zeroData({
        byStatus: {
          new: 35,
          needs_information: 0,
          contacted: 2,
          inspection: 0,
          quote_sent: 0,
          pickup_delivery: 0,
          completed: 3,
          lost: 0,
          archived: 2,
        },
      }),
    );
    const pipeline = screen.getByText("Status pipeline").closest("div") as HTMLElement;
    const labels = ["New", "Needs information", "Contacted", "Inspection", "Quote sent", "Pickup / delivery", "Completed", "Lost", "Archived"];
    for (const label of labels) expect(within(pipeline).getByText(label)).toBeInTheDocument();
  });
});

describe("OwnerOverview — material mix / source", () => {
  it("renders material and source panels with real counts", () => {
    renderOverview(
      zeroData({
        byMaterial: { copper: 21, aluminium: 14, steel_iron: 6, lead: 1, other: 0 },
        byCaptureChannel: { website: 40, phone: 1, whatsapp: 1, walk_in: 0, owner_manual: 0 },
      }),
    );
    expect(screen.getByText("Material mix")).toBeInTheDocument();
    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });
});

describe("OwnerOverview — enquiry type donut", () => {
  it("shows Selling/Buying counts and percentages that sum to 100", () => {
    renderOverview(zeroData({ byIntent: { sell: 25, buy: 17 } }));
    expect(screen.getByText("Selling")).toBeInTheDocument();
    expect(screen.getByText("Buying")).toBeInTheDocument();
    // 25/42 rounds to 60%; buyPercent is the exact remainder (40%), never independently rounded, so the pair can never drift off 100.
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("rounds a count split the same way the approved reference does (11/16 -> 69%, 5/16 -> 31%)", () => {
    renderOverview(zeroData({ byIntent: { sell: 11, buy: 5 } }));
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("69%")).toBeInTheDocument();
    expect(screen.getByText("31%")).toBeInTheDocument();
  });

  it("shows a TOTAL label beneath the centred total, not the old 'Total enquiries' copy", () => {
    renderOverview(zeroData({ byIntent: { sell: 11, buy: 5 } }));
    const card = screen.getByText("Enquiry type").closest("div") as HTMLElement;
    expect(within(card).getByText("Total")).toBeInTheDocument();
    expect(within(card).queryByText("Total enquiries")).not.toBeInTheDocument();
  });

  it("renders the Selling/Buying markers as squares, not circles", () => {
    renderOverview(zeroData({ byIntent: { sell: 11, buy: 5 } }));
    const card = screen.getByText("Enquiry type").closest("div") as HTMLElement;
    const markers = within(card).getAllByText("", { selector: "span[aria-hidden='true'].size-2\\.5" });
    expect(markers.length).toBe(2);
    for (const marker of markers) expect(marker.className).toContain("rounded-[2px]");
  });

  it("handles a zero total without NaN or a broken ring", () => {
    renderOverview(zeroData({ byIntent: { sell: 0, buy: 0 } }));
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getAllByText("0%")).toHaveLength(2);
  });

  it("handles a one-sided total (all Selling, zero Buying) without NaN", () => {
    renderOverview(zeroData({ byIntent: { sell: 5, buy: 0 } }));
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

describe("OwnerOverview — trend panel", () => {
  it("titles the panel 'Enquiries — last 7 days' by default and shows the period total/peak", () => {
    renderOverview(zeroData({ dailyCounts: days7({ "2026-08-17": 1, "2026-08-20": 11 }) }));
    expect(screen.getByText("Enquiries — last 7 days")).toBeInTheDocument();
    expect(screen.getByText(/12 enquiries · Peak 11/)).toBeInTheDocument();
  });
});

describe("OwnerOverview — loading/error states", () => {
  it("shows a retry button on error with no data", () => {
    const props: OwnerOverviewProps = { state: { data: null, isLoading: false, error: "Something went wrong.", unauthorized: false }, refresh: vi.fn() };
    render(<OwnerOverview {...props} />);
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders nothing but the header while loading with no data yet", () => {
    const props: OwnerOverviewProps = { state: { data: null, isLoading: true, error: null, unauthorized: false }, refresh: vi.fn() };
    render(<OwnerOverview {...props} />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.queryByText("Enquiry type")).not.toBeInTheDocument();
  });
});
