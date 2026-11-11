import { describe, expect, it } from "vitest";
import {
  computeOwnerLeadOverview,
  uaeDateKey,
  lastNUaeDateKeys,
  getOwnerLeadOverview,
  type OverviewLeadRow,
  type OwnerLeadOverviewServiceDeps,
} from "./owner-lead-overview.server";
import { OWNER_LEAD_STATUS_VALUES, OWNER_LEAD_MATERIAL_VALUES, OWNER_LEAD_CAPTURE_CHANNEL_VALUES } from "@/lib/owner/owner-leads-contract";

function row(overrides: Partial<OverviewLeadRow> & { id: string }): OverviewLeadRow {
  return {
    reference: `MSM-260101-${overrides.id.slice(0, 6)}`,
    status: "new",
    intent: "sell",
    capture_channel: "website",
    material: "copper",
    created_at: "2026-08-10T10:00:00.000Z",
    submission_completed_at: "2026-08-10T10:00:00.000Z",
    seller_name: null,
    buyer_contact_person: null,
    ...overrides,
  };
}

const NOW = new Date("2026-08-18T12:00:00.000Z"); // 2026-08-18 16:00 Asia/Dubai

describe("uaeDateKey", () => {
  it("converts a UTC instant to its Asia/Dubai calendar date", () => {
    // 2026-08-17T21:00:00Z is 2026-08-18T01:00 in Asia/Dubai (+4) — crosses the day boundary.
    expect(uaeDateKey("2026-08-17T21:00:00.000Z")).toBe("2026-08-18");
    expect(uaeDateKey("2026-08-17T19:00:00.000Z")).toBe("2026-08-17");
  });
});

describe("lastNUaeDateKeys", () => {
  it("returns exactly 7 dates, oldest first, ending on the UAE-local today", () => {
    const keys = lastNUaeDateKeys(NOW, 7);
    expect(keys).toHaveLength(7);
    expect(keys[6]).toBe("2026-08-18");
    expect(keys[0]).toBe("2026-08-12");
    // strictly increasing, no gaps
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${keys[i]}T00:00:00Z`).getTime();
      expect(cur - prev).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("computeOwnerLeadOverview — zero data", () => {
  it("produces honest zeros for every count, never omitting a vocabulary key, in both windows", () => {
    const result = computeOwnerLeadOverview([], new Map(), new Map(), NOW);

    for (const dataWindow of [result.sevenDay, result.thirtyDay]) {
      expect(dataWindow.totals).toEqual({ total: 0, new: 0, open: 0, completed: 0 });
      for (const status of OWNER_LEAD_STATUS_VALUES) expect(dataWindow.byStatus[status]).toBe(0);
      for (const material of OWNER_LEAD_MATERIAL_VALUES) expect(dataWindow.byMaterial[material]).toBe(0);
      for (const channel of OWNER_LEAD_CAPTURE_CHANNEL_VALUES) expect(dataWindow.byCaptureChannel[channel]).toBe(0);
      expect(dataWindow.dailyCounts.every((day) => day.count === 0)).toBe(true);
    }
    expect(result.sevenDay.dailyCounts).toHaveLength(7);
    expect(result.thirtyDay.dailyCounts).toHaveLength(30);
    expect(result.stale).toEqual({ thresholdHours: 72, count: 0 });
    expect(result.attentionCount).toBe(0);
    expect(result.attentionLeads).toEqual([]);
  });
});

describe("computeOwnerLeadOverview — status/open/closed definitions", () => {
  it("counts 'completed' status exactly, and open as everything outside {completed, lost, archived}", () => {
    // submission_completed_at defaults to 2026-08-10 — inside the 30-day
    // window ending 2026-08-18 (NOW), outside the 7-day one (starts
    // 2026-08-12) — asserted against thirtyDay so this test's own intent
    // (status/open/closed categorisation) stays independent of the
    // date-window boundary covered separately below.
    const rows: OverviewLeadRow[] = [
      row({ id: "11111111-1111-1111-1111-111111111111", status: "new" }),
      row({ id: "22222222-2222-2222-2222-222222222222", status: "contacted" }),
      row({ id: "33333333-3333-3333-3333-333333333333", status: "completed" }),
      row({ id: "44444444-4444-4444-4444-444444444444", status: "lost" }),
      row({ id: "55555555-5555-5555-5555-555555555555", status: "archived" }),
    ];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map(), NOW);

    expect(result.thirtyDay.totals.total).toBe(5);
    expect(result.thirtyDay.totals.new).toBe(1);
    expect(result.thirtyDay.totals.completed).toBe(1);
    expect(result.thirtyDay.totals.open).toBe(2); // new + contacted only
  });
});

describe("computeOwnerLeadOverview — PERF/CORRECTNESS: the selected window governs totals/breakdowns too, not just dailyCounts (regression for the live '17 vs 61' report)", () => {
  it("buckets by submission_completed_at converted to its Asia/Dubai calendar day, and excludes a lead entirely from a window its submission date falls outside — including from that window's own totals/breakdowns, not just its daily buckets", () => {
    const rows: OverviewLeadRow[] = [
      // Falls in today's UAE bucket (2026-08-18) despite being 17th in UTC — inside both the 7-day and 30-day windows.
      row({ id: "11111111-1111-1111-1111-111111111111", submission_completed_at: "2026-08-17T21:30:00.000Z" }),
      // Falls outside even the 30-day window entirely — must not appear in either window's totals, breakdowns, or daily buckets.
      row({ id: "22222222-2222-2222-2222-222222222222", submission_completed_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map(), NOW);

    const today7 = result.sevenDay.dailyCounts.find((day) => day.date === "2026-08-18");
    expect(today7?.count).toBe(1);
    const today30 = result.thirtyDay.dailyCounts.find((day) => day.date === "2026-08-18");
    expect(today30?.count).toBe(1);

    // The regression this test guards: previously `totals.total` counted
    // BOTH rows regardless of window (the live "61" symptom), while only
    // dailyCounts was ever actually windowed (the live "17" symptom). Now
    // the out-of-window row contributes to neither window's totals at all.
    expect(result.sevenDay.totals.total).toBe(1);
    expect(result.thirtyDay.totals.total).toBe(1);

    expect(result.sevenDay.dailyCounts).toHaveLength(7);
    expect(result.thirtyDay.dailyCounts).toHaveLength(30);
    // The last 7 of the 30-day series must equal the 7-day series exactly — same underlying bucket map, same boundary.
    expect(result.thirtyDay.dailyCounts.slice(-7)).toEqual(result.sevenDay.dailyCounts);
  });
});

describe("computeOwnerLeadOverview — stale rule (72h, provisional)", () => {
  const leadId = "11111111-1111-1111-1111-111111111111";
  // capture_channel: "phone" isolates the stale-only rule from
  // deriveNotificationSummaryStatus's own "website + no row -> attention"
  // behavior (see the "notification attention" describe block below for
  // that case) — a phone/whatsapp/walk_in lead with no notification row is
  // "not_required", never "attention".

  it("does not flag an open lead just under the 72h threshold", () => {
    const lastActivity = new Date(NOW.getTime() - 71 * 60 * 60 * 1000).toISOString();
    const rows = [row({ id: leadId, status: "new", capture_channel: "phone" })];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, lastActivity]]), new Map(), NOW);
    expect(result.stale.count).toBe(0);
    expect(result.attentionLeads).toHaveLength(0);
  });

  it("flags an open lead exactly at the 72h threshold", () => {
    const lastActivity = new Date(NOW.getTime() - 72 * 60 * 60 * 1000).toISOString();
    const rows = [row({ id: leadId, status: "new", capture_channel: "phone" })];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, lastActivity]]), new Map(), NOW);
    expect(result.stale.count).toBe(1);
    expect(result.attentionLeads[0]?.reasons).toEqual(["stale"]);
  });

  it("never flags a closed lead as stale, regardless of inactivity", () => {
    const longAgo = new Date(NOW.getTime() - 1000 * 60 * 60 * 1000).toISOString();
    const rows = [row({ id: leadId, status: "completed", capture_channel: "phone" })];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, longAgo]]), new Map(), NOW);
    expect(result.stale.count).toBe(0);
    expect(result.attentionLeads).toHaveLength(0);
  });

  it("falls back to submission_completed_at when a lead has no known activity", () => {
    const rows = [
      row({
        id: leadId,
        status: "new",
        capture_channel: "phone",
        submission_completed_at: new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map(), NOW);
    expect(result.stale.count).toBe(1);
  });
});

describe("computeOwnerLeadOverview — notification attention", () => {
  const leadId = "11111111-1111-1111-1111-111111111111";

  it("counts a dead_letter notification as attention regardless of open/closed status", () => {
    const rows = [row({ id: leadId, status: "completed", capture_channel: "website" })];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map([[leadId, "dead_letter"]]), NOW);
    expect(result.attentionCount).toBe(1);
    expect(result.attentionLeads[0]?.reasons).toEqual(["notification_attention"]);
  });

  it("does not count a pending/sent notification as attention", () => {
    const rows = [row({ id: leadId, capture_channel: "website" })];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map([[leadId, "sent"]]), NOW);
    expect(result.attentionCount).toBe(0);
  });

  it("a non-website lead with no notification row is not_required, never attention", () => {
    const rows = [row({ id: leadId, capture_channel: "phone" })];
    const result = computeOwnerLeadOverview(rows, new Map(), new Map(), NOW);
    expect(result.attentionCount).toBe(0);
  });

  it("merges stale and notification-attention reasons for the same lead without duplicating it", () => {
    const staleActivity = new Date(NOW.getTime() - 200 * 60 * 60 * 1000).toISOString();
    const rows = [row({ id: leadId, status: "new", capture_channel: "website" })];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, staleActivity]]), new Map([[leadId, "dead_letter"]]), NOW);
    expect(result.attentionLeads).toHaveLength(1);
    expect(result.attentionLeads[0]?.reasons.sort()).toEqual(["notification_attention", "stale"]);
  });
});

describe("computeOwnerLeadOverview — attentionLeads carries contact name and material (CHECKPOINT OWNER DESKTOP CORRECTION — Follow-ups row)", () => {
  const leadId = "11111111-1111-1111-1111-111111111111";

  it("uses seller_name for a sell lead", () => {
    const lastActivity = new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString();
    const rows = [row({ id: leadId, status: "new", intent: "sell", material: "aluminium", seller_name: "Ahmed Khan" })];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, lastActivity]]), new Map(), NOW);
    expect(result.attentionLeads[0]?.contactName).toBe("Ahmed Khan");
    expect(result.attentionLeads[0]?.material).toBe("aluminium");
  });

  it("uses buyer_contact_person for a buy lead, never falling back to seller_name", () => {
    const lastActivity = new Date(NOW.getTime() - 100 * 60 * 60 * 1000).toISOString();
    const rows = [
      row({ id: leadId, status: "new", intent: "buy", material: "steel_iron", seller_name: "Ignored", buyer_contact_person: "Fatima Noor" }),
    ];
    const result = computeOwnerLeadOverview(rows, new Map([[leadId, lastActivity]]), new Map(), NOW);
    expect(result.attentionLeads[0]?.contactName).toBe("Fatima Noor");
    expect(result.attentionLeads[0]?.material).toBe("steel_iron");
  });
});

describe("computeOwnerLeadOverview — attentionLeads cap and ordering", () => {
  it("returns at most 5 leads, most-hours-since-activity first", () => {
    const rows: OverviewLeadRow[] = [];
    const activity = new Map<string, string>();
    for (let i = 0; i < 8; i++) {
      const id = `1111111${i}-1111-1111-1111-11111111111${i}`;
      rows.push(row({ id, status: "new" }));
      // Staggered staleness: lead i is (100 + i) hours stale.
      activity.set(id, new Date(NOW.getTime() - (100 + i) * 60 * 60 * 1000).toISOString());
    }
    const result = computeOwnerLeadOverview(rows, activity, new Map(), NOW);
    expect(result.attentionLeads).toHaveLength(5);
    const hours = result.attentionLeads.map((lead) => lead.hoursSinceActivity);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
    expect(result.stale.count).toBe(8); // stale.count reflects the full set, not just the top-5 shown
  });
});

describe("getOwnerLeadOverview — wiring", () => {
  it("only queries activity/notification status for the returned lead ids, and only activity for open ids", async () => {
    const openId = "11111111-1111-1111-1111-111111111111";
    const closedId = "22222222-2222-2222-2222-222222222222";
    const rows: OverviewLeadRow[] = [row({ id: openId, status: "new" }), row({ id: closedId, status: "completed" })];

    let activityQueriedWith: readonly string[] = [];
    let notificationQueriedWith: readonly string[] = [];

    const deps: OwnerLeadOverviewServiceDeps = {
      queryOwnerVisibleLeads: async () => rows,
      queryLatestActivityAt: async (leadIds) => {
        activityQueriedWith = leadIds;
        return new Map();
      },
      queryNotificationStatuses: async (leadIds) => {
        notificationQueriedWith = leadIds;
        return new Map();
      },
    };

    const result = await getOwnerLeadOverview(deps, NOW);

    expect(activityQueriedWith).toEqual([openId]);
    expect(notificationQueriedWith.slice().sort()).toEqual([closedId, openId].sort());
    // Both rows' default submission_completed_at (2026-08-10) falls inside the 30-day window ending "now", outside the 7-day one.
    expect(result.thirtyDay.totals.total).toBe(2);
  });
});
