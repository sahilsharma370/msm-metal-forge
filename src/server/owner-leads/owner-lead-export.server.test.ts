import { describe, expect, it, vi } from "vitest";
import {
  buildOwnerLeadExportCsv,
  buildOwnerLeadExportFilename,
  exportOwnerLeadsCsv,
  OWNER_LEAD_EXPORT_MAX_ROWS,
  type OwnerLeadExportRow,
  type OwnerLeadExportServiceDeps,
} from "./owner-lead-export.server";
import type { ParsedOwnerLeadListQuery } from "./owner-leads.server";

function fakeRow(overrides: Partial<OwnerLeadExportRow> = {}): OwnerLeadExportRow {
  return {
    reference: "MSM-260101-ABCDEF",
    intent: "sell",
    status: "new",
    capture_channel: "website",
    material: "copper",
    material_other_text: null,
    material_spec: null,
    submission_completed_at: "2026-01-01T00:05:00.000Z",
    seller_name: "Ahmed Seller",
    seller_company: null,
    seller_phone: "+971501234567",
    seller_email: null,
    seller_preferred_contact: "whatsapp",
    seller_quantity_value: 100,
    seller_quantity_unit: "kg",
    seller_emirate: "dubai",
    seller_area: "Al Quoz",
    seller_description: null,
    seller_notes: null,
    buyer_contact_person: null,
    buyer_company: null,
    buyer_phone: null,
    buyer_email: null,
    buyer_preferred_contact: null,
    buyer_quantity_value: null,
    buyer_quantity_unit: null,
    buyer_destination_emirate: null,
    buyer_destination_area: null,
    buyer_trade_requirement: null,
    buyer_additional_spec: null,
    buyer_notes: null,
    ...overrides,
  };
}

function baseQuery(overrides: Partial<ParsedOwnerLeadListQuery> = {}): ParsedOwnerLeadListQuery {
  return { view: "inbox", limit: 20, ...overrides };
}

describe("buildOwnerLeadExportCsv — header and basic row shape", () => {
  it("emits the exact header row first", () => {
    const csv = buildOwnerLeadExportCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(
      "Reference,Enquiry type,Status,Submitted (UAE),Contact name,Company,Phone,Email,Preferred contact,Material,Other material,Quantity,Emirate,Area,Trade / supply route,Capture channel,Notes / specification",
    );
  });

  it("maps a seller row's contact/material/quantity/location from the seller branch", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow()]);
    expect(csv).toContain("MSM-260101-ABCDEF,Selling,New");
    expect(csv).toContain("Ahmed Seller");
    expect(csv).toContain("100 kg");
  });

  it("maps a buyer row's contact/material/quantity/location from the buyer branch", () => {
    const row = fakeRow({
      intent: "buy",
      seller_name: null,
      seller_phone: null,
      buyer_contact_person: "Fatima Buyer",
      buyer_phone: "+971509999999",
      buyer_quantity_value: 500,
      buyer_quantity_unit: "kg",
      buyer_destination_emirate: "sharjah",
      buyer_destination_area: "Industrial 3",
      buyer_trade_requirement: "import",
    });
    const csv = buildOwnerLeadExportCsv([row]);
    expect(csv).toContain("Fatima Buyer");
    expect(csv).toContain("Import");
  });
});

describe("buildOwnerLeadExportCsv — RFC 4180 quoting", () => {
  it("quotes and doubles internal quotes for a value containing a comma", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_name: "Ahmed, Trading Co" })]);
    expect(csv).toContain('"Ahmed, Trading Co"');
  });

  it("quotes and escapes a value containing a double quote", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_notes: 'He said "call after 5pm"' })]);
    expect(csv).toContain('"He said ""call after 5pm"""');
  });

  it("quotes a value containing a line break", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_notes: "Line one\nLine two" })]);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it("does not quote a plain value with none of the special characters", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_name: "Ahmed Seller" })]);
    expect(csv).toContain(",Ahmed Seller,");
  });
});

describe("buildOwnerLeadExportCsv — formula-injection neutralisation", () => {
  it.each([
    ["=", "=SUM(A1:A9)"],
    ["+", "+1+1"],
    ["-", "-1+1"],
    ["@", "@SUM(1+1)"],
  ])("prefixes a value beginning with %s with a neutralising apostrophe", (_label, value) => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_notes: value })]);
    expect(csv).toContain(`'${value}`);
    // The raw, un-neutralised formula string must never appear on its own.
    expect(csv.includes(`,${value},`) || csv.includes(`,${value}\r\n`)).toBe(false);
  });

  it("leaves an ordinary value starting with a letter or digit untouched", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow({ seller_notes: "2 tonnes, clean copper" })]);
    expect(csv).not.toContain("'2 tonnes");
  });
});

describe("buildOwnerLeadExportCsv — never exports internal/system fields", () => {
  it("the serialized CSV never contains a forbidden internal field name", () => {
    const csv = buildOwnerLeadExportCsv([fakeRow()]);
    expect(csv).not.toMatch(
      /storage_path|submission_snapshot|payload_hash|idempotency_key|signed.?url|owner_id|owner_user_id|manual_requeue_count|claim_token/i,
    );
  });
});

describe("buildOwnerLeadExportFilename", () => {
  it("includes the view and the UAE calendar date", () => {
    const now = new Date("2026-08-21T22:30:00.000Z"); // past midnight UAE (2026-08-22)
    expect(buildOwnerLeadExportFilename("inbox", now)).toBe("msm-enquiries-inbox-2026-08-22.csv");
    expect(buildOwnerLeadExportFilename("archived", now)).toBe("msm-enquiries-archived-2026-08-22.csv");
  });
});

describe("exportOwnerLeadsCsv — Trash is never exportable", () => {
  it("rejects a trash-view request outright, without ever querying rows", async () => {
    const queryExportRows = vi.fn();
    const deps: OwnerLeadExportServiceDeps = { queryExportRows };
    const result = await exportOwnerLeadsCsv(baseQuery({ view: "trash" }), deps);
    expect(result).toEqual({ ok: false, reason: "invalid_view" });
    expect(queryExportRows).not.toHaveBeenCalled();
  });
});

describe("exportOwnerLeadsCsv — success", () => {
  it("returns the built CSV, filename and row count for an Inbox export", async () => {
    const deps: OwnerLeadExportServiceDeps = { queryExportRows: vi.fn().mockResolvedValue([fakeRow(), fakeRow()]) };
    const now = new Date("2026-08-21T10:00:00.000Z");
    const result = await exportOwnerLeadsCsv(baseQuery({ view: "inbox" }), deps, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(2);
    expect(result.filename).toBe("msm-enquiries-inbox-2026-08-21.csv");
    expect(result.csv.startsWith("Reference,")).toBe(true);
  });

  it("maps a query-layer failure to reason: internal_error", async () => {
    const deps: OwnerLeadExportServiceDeps = { queryExportRows: vi.fn().mockRejectedValue(new Error("db down")) };
    const result = await exportOwnerLeadsCsv(baseQuery(), deps);
    expect(result).toEqual({ ok: false, reason: "internal_error" });
  });
});

describe("exportOwnerLeadsCsv — 5,000-row bound", () => {
  it("exposes the documented cap constant", () => {
    expect(OWNER_LEAD_EXPORT_MAX_ROWS).toBe(5000);
  });

  it("returns exactly as many rows as the query layer provides, up to the cap — the cap itself is enforced by the query layer's own .limit(), verified here by construction", async () => {
    const rows = Array.from({ length: OWNER_LEAD_EXPORT_MAX_ROWS }, () => fakeRow());
    const deps: OwnerLeadExportServiceDeps = { queryExportRows: vi.fn().mockResolvedValue(rows) };
    const result = await exportOwnerLeadsCsv(baseQuery(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rowCount).toBe(OWNER_LEAD_EXPORT_MAX_ROWS);
  });
});
