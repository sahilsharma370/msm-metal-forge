import { describe, expect, it, vi } from "vitest";
import {
  parseOwnerLeadListQuery,
  encodeCursor,
  decodeCursor,
  deriveNotificationSummaryStatus,
  listOwnerLeads,
  classifySearchTerm,
  DEFAULT_OWNER_LEAD_LIST_LIMIT,
  MAX_OWNER_LEAD_LIST_LIMIT,
  type LeadRow,
  type OwnerLeadsServiceDeps,
} from "./owner-leads.server";
import type { OwnerLeadCaptureChannel } from "@/lib/owner/owner-leads-contract";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parseOwnerLeadListQuery — valid input", () => {
  it("accepts an empty query and defaults limit to 20", () => {
    const result = parseOwnerLeadListQuery(params({}));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query.limit).toBe(DEFAULT_OWNER_LEAD_LIST_LIMIT);
      expect(result.query.status).toBeUndefined();
      expect(result.query.cursor).toBeUndefined();
    }
  });

  it("accepts every documented filter", () => {
    const result = parseOwnerLeadListQuery(
      params({
        status: "contacted",
        intent: "sell",
        material: "copper",
        captureChannel: "website",
        submittedFrom: "2026-01-01T00:00:00.000Z",
        submittedTo: "2026-02-01T00:00:00.000Z",
        q: "Ahmed",
        limit: "35",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toMatchObject({
        status: "contacted",
        intent: "sell",
        material: "copper",
        captureChannel: "website",
        submittedFrom: "2026-01-01T00:00:00.000Z",
        submittedTo: "2026-02-01T00:00:00.000Z",
        search: { kind: "name", value: "Ahmed" },
        limit: 35,
      });
    }
  });

  it("caps limit at 50 by rejecting anything above it", () => {
    const result = parseOwnerLeadListQuery(params({ limit: "51" }));
    expect(result.ok).toBe(false);
  });

  it("accepts the maximum limit of 50", () => {
    const result = parseOwnerLeadListQuery(params({ limit: String(MAX_OWNER_LEAD_LIST_LIMIT) }));
    expect(result.ok).toBe(true);
  });
});

describe("parseOwnerLeadListQuery — view (CHECKPOINT C2M-A)", () => {
  it("defaults view to 'inbox' when omitted", () => {
    const result = parseOwnerLeadListQuery(params({}));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.query.view).toBe("inbox");
  });

  it.each(["inbox", "archived", "trash"])("accepts view=%s", (view) => {
    const result = parseOwnerLeadListQuery(params({ view }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.query.view).toBe(view);
  });

  it("rejects an unrecognized view value", () => {
    expect(parseOwnerLeadListQuery(params({ view: "recycled" })).ok).toBe(false);
  });
});

describe("parseOwnerLeadListQuery — invalid input rejected", () => {
  it("rejects an unrecognized status value", () => {
    expect(parseOwnerLeadListQuery(params({ status: "won" })).ok).toBe(false);
  });

  it("rejects an unrecognized intent value", () => {
    expect(parseOwnerLeadListQuery(params({ intent: "rent" })).ok).toBe(false);
  });

  it("rejects a non-ISO submittedFrom", () => {
    expect(parseOwnerLeadListQuery(params({ submittedFrom: "not-a-date" })).ok).toBe(false);
  });

  it("rejects limit=0 and negative limits", () => {
    expect(parseOwnerLeadListQuery(params({ limit: "0" })).ok).toBe(false);
    expect(parseOwnerLeadListQuery(params({ limit: "-5" })).ok).toBe(false);
  });

  it("rejects a non-numeric limit", () => {
    expect(parseOwnerLeadListQuery(params({ limit: "abc" })).ok).toBe(false);
  });

  it("rejects an opaque-but-garbage cursor", () => {
    expect(parseOwnerLeadListQuery(params({ cursor: "not-valid-base64-json!!" })).ok).toBe(false);
  });

  it("rejects a well-formed-base64 cursor whose payload doesn't match the expected shape", () => {
    const badCursor = btoa(JSON.stringify({ wrong: "shape" }));
    expect(parseOwnerLeadListQuery(params({ cursor: badCursor })).ok).toBe(false);
  });

  describe("search term (q) — the filter-injection surface", () => {
    it.each([
      ["a comma, which would break out of an .or() filter group", "a,b"],
      ["a parenthesis, which would open/close an unintended and() group", "a(b)"],
      ["a percent sign, an unintended SQL LIKE wildcard", "a%b"],
      ["an underscore, an unintended SQL LIKE single-char wildcard", "a_b"],
      ["an asterisk, PostgREST's own stand-in for the % wildcard", "a*b"],
      ["a semicolon", "a;b"],
      ["a double quote", 'a"b'],
      ["a backslash", "a\\b"],
      ["a name-shaped value mixed with digits (neither pure name nor pure phone)", "Ahmed123"],
      ["a single/double-digit fragment (too short to be a phone)", "50"],
    ])("rejects a search term containing %s", (_label, value) => {
      expect(parseOwnerLeadListQuery(params({ q: value })).ok).toBe(false);
    });

    it("rejects an explicitly empty search term (q= with nothing after it)", () => {
      expect(parseOwnerLeadListQuery(params({ q: "" })).ok).toBe(false);
    });

    it("rejects a search term over 60 characters", () => {
      expect(parseOwnerLeadListQuery(params({ q: "a".repeat(61) })).ok).toBe(false);
    });
  });
});

describe("parseOwnerLeadListQuery — unknown query parameters are rejected (CHECKPOINT C2J-A1 part C)", () => {
  it("rejects a single unknown parameter", () => {
    const result = parseOwnerLeadListQuery(params({ utm_source: "newsletter" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a known parameter combined with an unknown one", () => {
    const result = parseOwnerLeadListQuery(params({ status: "new", foo: "bar" }));
    expect(result.ok).toBe(false);
  });

  it("still accepts a request containing every valid parameter and none unknown", () => {
    const result = parseOwnerLeadListQuery(
      params({
        status: "new",
        intent: "sell",
        material: "copper",
        captureChannel: "website",
        submittedFrom: "2026-01-01T00:00:00.000Z",
        submittedTo: "2026-02-01T00:00:00.000Z",
        q: "Ahmed",
        cursor: encodeCursor({ submissionCompletedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", id: "11111111-1111-1111-1111-111111111111" }),
        limit: "10",
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("classifySearchTerm — reference / phone / name classification", () => {
  it("classifies a full reference as a reference search, normalized to uppercase", () => {
    expect(classifySearchTerm("msm-260101-abcdef")).toEqual({ kind: "reference", value: "MSM-260101-ABCDEF" });
  });

  it("classifies a partial (prefix) reference as a reference search", () => {
    expect(classifySearchTerm("MSM-260101")).toEqual({ kind: "reference", value: "MSM-260101" });
  });

  it("classifies a formatted UAE phone number as a phone search, normalized to digits only", () => {
    expect(classifySearchTerm("+971 50 123 4567")).toEqual({ kind: "phone", digits: "971501234567" });
    expect(classifySearchTerm("(050) 123 4567")).toEqual({ kind: "phone", digits: "971501234567" });
    expect(classifySearchTerm("+971-50-123-4567")).toEqual({ kind: "phone", digits: "971501234567" });
  });

  it("falls back to raw digits when a phone-charset value doesn't normalize (still safe — digits only)", () => {
    expect(classifySearchTerm("123-456")).toEqual({ kind: "phone", digits: "123456" });
  });

  it("classifies an Arabic name as a name search, unchanged", () => {
    expect(classifySearchTerm("محمد")).toEqual({ kind: "name", value: "محمد" });
    expect(classifySearchTerm("أحمد علي")).toEqual({ kind: "name", value: "أحمد علي" });
  });

  it("classifies an accented Latin name as a name search", () => {
    expect(classifySearchTerm("José")).toEqual({ kind: "name", value: "José" });
  });

  it("classifies an apostrophe name as a name search", () => {
    expect(classifySearchTerm("O'Neil")).toEqual({ kind: "name", value: "O'Neil" });
  });

  it("classifies a hyphenated name as a name search", () => {
    expect(classifySearchTerm("Al-Ruwais")).toEqual({ kind: "name", value: "Al-Ruwais" });
  });

  it("returns null (reject) for input matching none of the three safe shapes", () => {
    expect(classifySearchTerm("a,b")).toBeNull();
    expect(classifySearchTerm("a(b)")).toBeNull();
    expect(classifySearchTerm("50%")).toBeNull();
    expect(classifySearchTerm("a_b")).toBeNull();
    expect(classifySearchTerm("12")).toBeNull();
  });
});

describe("cursor encode/decode", () => {
  it("round-trips exactly", () => {
    const original = { submissionCompletedAt: "2026-01-05 10:20:30.123456+00", createdAt: "2026-01-05 10:20:29.000000+00", id: "11111111-1111-1111-1111-111111111111" };
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(original);
  });

  it("is opaque — not plain readable JSON/base64 of an obviously-parseable value without decoding", () => {
    const encoded = encodeCursor({ submissionCompletedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", id: "11111111-1111-1111-1111-111111111111" });
    expect(encoded).not.toContain("{");
    expect(encoded).not.toContain("2026-01-01");
  });

  it("rejects a decoded id that is not a valid UUID", () => {
    const encoded = btoa(JSON.stringify({ s: "2026-01-01T00:00:00Z", c: "2026-01-01T00:00:00Z", i: "not-a-uuid" }));
    expect(decodeCursor(encoded)).toBeNull();
  });

  it("rejects a decoded timestamp containing filter-syntax-significant characters", () => {
    const encoded = btoa(JSON.stringify({ s: "2026-01-01,DROP TABLE leads", c: "2026-01-01T00:00:00Z", i: "11111111-1111-1111-1111-111111111111" }));
    expect(decodeCursor(encoded)).toBeNull();
  });
});

describe("deriveNotificationSummaryStatus", () => {
  it("maps sent -> sent, regardless of channel", () => {
    expect(deriveNotificationSummaryStatus("sent", "website")).toBe("sent");
    expect(deriveNotificationSummaryStatus("sent", "phone")).toBe("sent");
  });
  it.each(["pending", "processing", "retry_wait"])("maps %s -> pending, regardless of channel", (status) => {
    expect(deriveNotificationSummaryStatus(status, "website")).toBe("pending");
    expect(deriveNotificationSummaryStatus(status, "walk_in")).toBe("pending");
  });
  it("maps dead_letter -> attention, regardless of channel", () => {
    expect(deriveNotificationSummaryStatus("dead_letter", "website")).toBe("attention");
    expect(deriveNotificationSummaryStatus("dead_letter", "whatsapp")).toBe("attention");
  });
  it("maps a missing row on a WEBSITE lead -> attention, never a healthy default", () => {
    expect(deriveNotificationSummaryStatus(undefined, "website")).toBe("attention");
  });
  it.each(["phone", "whatsapp", "walk_in", "owner_manual"])(
    "maps a missing row on a %s (non-website) lead -> not_required, an honest neutral state, never attention",
    (channel) => {
      expect(deriveNotificationSummaryStatus(undefined, channel as OwnerLeadCaptureChannel)).toBe("not_required");
    },
  );
});

function fakeLeadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reference: "MSM-260101-ABCDEF",
    status: "new",
    intent: "sell",
    capture_channel: "website",
    material: "copper",
    material_subtype: "wire_cable",
    created_at: "2026-01-01T00:00:00.000Z",
    submission_completed_at: "2026-01-01T00:05:00.000Z",
    file_upload_status: "complete",
    deleted_at: null,
    seller_name: "Ahmed Seller",
    seller_phone: "+971501234567",
    seller_emirate: "dubai",
    seller_area: "Al Quoz",
    seller_quantity_value: 100,
    seller_quantity_unit: "kg",
    buyer_contact_person: null,
    buyer_phone: null,
    buyer_destination_emirate: null,
    buyer_destination_area: null,
    buyer_quantity_value: null,
    buyer_quantity_unit: null,
    ...overrides,
  };
}

function fakeDeps(rows: LeadRow[], notificationStatuses: Map<string, string> = new Map()): OwnerLeadsServiceDeps {
  return {
    queryLeadsPage: vi.fn().mockResolvedValue(rows),
    queryNotificationStatuses: vi.fn().mockResolvedValue(notificationStatuses),
  };
}

describe("listOwnerLeads — seller/buyer branch mapping", () => {
  it("maps a sell lead's contact/location/quantity from seller fields", async () => {
    const row = fakeLeadRow();
    const deps = fakeDeps([row]);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads[0]).toMatchObject({
      contact: { name: "Ahmed Seller", phone: "+971501234567" },
      location: { emirate: "dubai", area: "Al Quoz" },
      quantity: { value: 100, unit: "kg" },
    });
  });

  it("maps a buy lead's contact/location/quantity from buyer fields", async () => {
    const row = fakeLeadRow({
      intent: "buy",
      seller_name: null,
      seller_phone: null,
      seller_emirate: null,
      seller_area: null,
      seller_quantity_value: null,
      seller_quantity_unit: null,
      buyer_contact_person: "Fatima Buyer",
      buyer_phone: "+971509999999",
      buyer_destination_emirate: "sharjah",
      buyer_destination_area: "Industrial 3",
      buyer_quantity_value: 500,
      buyer_quantity_unit: "kg",
    });
    const deps = fakeDeps([row]);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads[0]).toMatchObject({
      contact: { name: "Fatima Buyer", phone: "+971509999999" },
      location: { emirate: "sharjah", area: "Industrial 3" },
      quantity: { value: 500, unit: "kg" },
    });
  });

  it("never invents a buyer quantity when none exists (e.g. an import-route buyer lead with no structured quantity)", async () => {
    const row = fakeLeadRow({ intent: "buy", buyer_quantity_value: null, buyer_quantity_unit: null, buyer_contact_person: "X", buyer_phone: "+971500000000" });
    const deps = fakeDeps([row]);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads[0]?.quantity).toEqual({ value: null, unit: null });
  });
});

describe("listOwnerLeads — pagination (limit+1 trick)", () => {
  it("hasMore:false and nextCursor:null when fewer rows than limit are returned", async () => {
    const deps = fakeDeps([fakeLeadRow()]);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.leads).toHaveLength(1);
  });

  it("hasMore:true and a non-null nextCursor when limit+1 rows come back, slicing back to exactly limit", async () => {
    const rows = [
      fakeLeadRow({ id: "11111111-1111-1111-1111-111111111111" }),
      fakeLeadRow({ id: "22222222-2222-2222-2222-222222222222" }),
      fakeLeadRow({ id: "33333333-3333-3333-3333-333333333333" }),
    ];
    const deps = fakeDeps(rows);
    const result = await listOwnerLeads({ view: "inbox", limit: 2 }, deps);
    expect(result.leads).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    // nextCursor is built from the LAST RETURNED (2nd) row, not the 3rd/dropped one.
    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded?.id).toBe("22222222-2222-2222-2222-222222222222");
  });
});

describe("listOwnerLeads — notification status merge", () => {
  it("attaches the correct derived status per lead, defaulting missing rows to attention", async () => {
    const rows = [
      fakeLeadRow({ id: "11111111-1111-1111-1111-111111111111" }),
      fakeLeadRow({ id: "22222222-2222-2222-2222-222222222222" }),
      fakeLeadRow({ id: "33333333-3333-3333-3333-333333333333" }),
    ];
    const statuses = new Map([
      ["11111111-1111-1111-1111-111111111111", "sent"],
      ["22222222-2222-2222-2222-222222222222", "dead_letter"],
      // 33333333... deliberately has no row at all
    ]);
    const deps = fakeDeps(rows, statuses);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads.map((l) => l.notificationStatus)).toEqual(["sent", "attention", "attention"]);
  });

  it("queries notification statuses only for the returned page's lead ids", async () => {
    const rows = [fakeLeadRow({ id: "11111111-1111-1111-1111-111111111111" })];
    const deps = fakeDeps(rows);
    await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(deps.queryNotificationStatuses).toHaveBeenCalledWith(["11111111-1111-1111-1111-111111111111"]);
  });

  it("a completed Quick Add (non-website) lead missing its notification row shows not_required, never attention", async () => {
    const rows = [fakeLeadRow({ id: "11111111-1111-1111-1111-111111111111", capture_channel: "phone" })];
    const deps = fakeDeps(rows); // no notification row for this lead
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads[0]?.notificationStatus).toBe("not_required");
  });

  it("a completed website lead missing its notification row still shows attention (a genuine anomaly)", async () => {
    const rows = [fakeLeadRow({ id: "11111111-1111-1111-1111-111111111111", capture_channel: "website" })];
    const deps = fakeDeps(rows); // no notification row for this lead
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    expect(result.leads[0]?.notificationStatus).toBe("attention");
  });
});

describe("listOwnerLeads — serialized shape never leaks forbidden fields", () => {
  it("the returned item never contains storage_path, submission_snapshot, payload_hash, idempotency_key, checksum, or any snake_case column name", async () => {
    const deps = fakeDeps([fakeLeadRow()]);
    const result = await listOwnerLeads({ view: "inbox", limit: 20 }, deps);
    const serialized = JSON.stringify(result.leads);
    expect(serialized).not.toMatch(/storage_path|submission_snapshot|payload_hash|idempotency_key|checksum|claim_token|provider_message_id/i);
  });
});
