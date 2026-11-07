import { describe, expect, it } from "vitest";
import {
  renderOwnerNotificationEmail,
  sanitizeHeaderValue,
  type OwnerNotificationFileStats,
  type OwnerNotificationLeadData,
} from "./owner-notification-email";
import { EMAIL_LOGO_URL } from "./email-template-shared";

function baseLead(overrides: Partial<OwnerNotificationLeadData> = {}): OwnerNotificationLeadData {
  return {
    reference: "MSM-260817-ABCDEF",
    intent: "sell",
    material: "copper",
    materialSubtype: null,
    materialSubtypeOtherText: null,
    materialOtherText: null,
    materialSpec: null,
    sellerQuantityValue: null,
    sellerQuantityUnit: null,
    sellerQuantityUnitOther: null,
    sellerQuantityUnsure: false,
    sellerCondition: null,
    sellerDescription: null,
    sellerEmirate: null,
    sellerArea: null,
    sellerMapLink: null,
    sellerPickupRequired: null,
    sellerPickupDate: null,
    sellerAccessNote: null,
    sellerName: null,
    sellerPhone: null,
    sellerCompany: null,
    sellerEmail: null,
    sellerPreferredContact: null,
    sellerNotes: null,
    buyerQuantityValue: null,
    buyerQuantityUnit: null,
    buyerQuantityUnitOther: null,
    buyerTradeRequirement: null,
    buyerRequiredByDate: null,
    buyerAdditionalSpec: null,
    buyerDestinationEmirate: null,
    buyerDestinationArea: null,
    buyerDestinationMapLink: null,
    buyerFulfilment: null,
    buyerDestinationCountry: null,
    buyerDestinationCityPort: null,
    buyerPreferredPort: null,
    buyerPreferredPortOther: null,
    buyerOriginCountryPreference: null,
    buyerLogisticsRequirement: null,
    buyerLogisticsNote: null,
    buyerCompany: null,
    buyerContactPerson: null,
    buyerPhone: null,
    buyerEmail: null,
    buyerPreferredContact: null,
    buyerNotes: null,
    submittedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

const noFiles: OwnerNotificationFileStats = { count: 0, status: "none" };

function sellerLead(overrides: Partial<OwnerNotificationLeadData> = {}): OwnerNotificationLeadData {
  return baseLead({
    intent: "sell",
    sellerQuantityValue: "100",
    sellerQuantityUnit: "kg",
    sellerCondition: "clean_separated",
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "no",
    sellerName: "Ahmed Seller",
    sellerPhone: "+971501234567",
    sellerPreferredContact: "whatsapp",
    ...overrides,
  });
}

function buyerLead(overrides: Partial<OwnerNotificationLeadData> = {}): OwnerNotificationLeadData {
  return baseLead({
    intent: "buy",
    material: "aluminium",
    buyerQuantityValue: "500",
    buyerQuantityUnit: "kg",
    buyerTradeRequirement: "local",
    buyerDestinationEmirate: "dubai",
    buyerDestinationArea: "Business Bay",
    buyerFulfilment: "delivery",
    buyerContactPerson: "Fatima Buyer",
    buyerPhone: "+971502345678",
    buyerPreferredContact: "whatsapp",
    ...overrides,
  });
}

describe("sanitizeHeaderValue", () => {
  it("strips CR/LF so a value cannot inject a second header", () => {
    expect(sanitizeHeaderValue("hello\r\nBcc: attacker@example.com")).toBe("hello Bcc: attacker@example.com");
    expect(sanitizeHeaderValue("line1\nline2")).toBe("line1 line2");
  });
});

// ---------------------------------------------------------------------------
// Approved design: logo header
// ---------------------------------------------------------------------------

describe("renderOwnerNotificationEmail — logo header (approved design)", () => {
  it("renders exactly one <img>, the real repository logo asset, with absolute HTTPS src, explicit width/height, and alt text", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    const imgMatches = [...email.html.matchAll(/<img\b[^>]*>/g)];
    expect(imgMatches).toHaveLength(1);
    const img = imgMatches[0]![0];
    expect(img).toContain(`src="${EMAIL_LOGO_URL}"`);
    expect(EMAIL_LOGO_URL.startsWith("https://msmscrap.com/")).toBe(true);
    expect(img).toMatch(/width="\d+"/);
    expect(img).toMatch(/height="\d+"/);
    expect(img).toContain('alt="MSM Scrap"');
  });

  it("the logo's alt text is readable, brand-correct copy — the client-blocked-image fallback never reads as a broken/empty header", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.html).toContain('alt="MSM Scrap"');
    expect(email.html).not.toContain('alt=""');
  });

  it("never contains the literal text 'MSM / SCRAP TRADING' — the header is the logo image only, no text lockup beside it", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.html).not.toMatch(/SCRAP\s*TRADING/i);
  });
});

describe("renderOwnerNotificationEmail — seller rendering", () => {
  it("includes the genuine reference, seller intent, and core seller fields", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.subject).toBe("New seller enquiry — MSM-260817-ABCDEF");
    expect(email.text).toContain("New seller enquiry.");
    expect(email.text).toContain("MSM-260817-ABCDEF");
    expect(email.text).toContain("Ahmed Seller");
    expect(email.text).toContain("+971501234567");
    expect(email.html).toContain("MSM-260817-ABCDEF");
    expect(email.html).toContain("Ahmed Seller");
    expect(email.html).toContain("New seller enquiry.");
  });

  it("excludes buyer-only fields entirely from a seller email", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ buyerContactPerson: null }), noFiles);
    expect(email.text).not.toMatch(/trade route/i);
    expect(email.text).not.toMatch(/destination/i);
    expect(email.text).not.toMatch(/fulfilment/i);
    expect(email.html).not.toMatch(/trade route/i);
  });

  it("renders material subtype when present, in the subheading line", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ materialSubtype: "wire_cable" }), noFiles);
    expect(email.text).toMatch(/Copper.*Wire Cable/);
    expect(email.html).toMatch(/Copper.*Wire Cable/);
  });

  it("renders 'Not sure' for an unsure quantity instead of a fabricated value", () => {
    const email = renderOwnerNotificationEmail(
      sellerLead({ sellerQuantityUnsure: true, sellerQuantityValue: null, sellerQuantityUnit: null }),
      noFiles,
    );
    expect(email.text).toContain("Not sure");
    expect(email.html).toContain("Not sure");
  });
});

describe("renderOwnerNotificationEmail — buyer rendering", () => {
  it("includes the genuine reference, buyer intent, and core buyer fields", () => {
    const email = renderOwnerNotificationEmail(buyerLead(), noFiles);
    expect(email.subject).toBe("New buyer enquiry — MSM-260817-ABCDEF");
    expect(email.text).toContain("New buyer enquiry.");
    expect(email.text).toContain("Fatima Buyer");
    expect(email.text).toContain("+971502345678");
    expect(email.text).toContain("Business Bay");
    expect(email.html).toContain("New buyer enquiry.");
    expect(email.html).toContain("Fatima Buyer");
  });

  it("excludes seller-only fields entirely from a buyer email", () => {
    const email = renderOwnerNotificationEmail(buyerLead({ sellerName: null }), noFiles);
    expect(email.text).not.toMatch(/condition/i);
    expect(email.text).not.toMatch(/pickup required/i);
    expect(email.html).not.toMatch(/pickup required/i);
  });

  it("renders route-specific fields only for the actual trade route (import)", () => {
    const email = renderOwnerNotificationEmail(
      buyerLead({
        buyerTradeRequirement: "import",
        buyerDestinationArea: null,
        buyerFulfilment: null,
        buyerPreferredPort: "jebel_ali",
        buyerLogisticsRequirement: "delivery",
      }),
      noFiles,
    );
    expect(email.text).toContain("Jebel Ali");
    expect(email.text).not.toMatch(/destination area/i);
  });
});

// ---------------------------------------------------------------------------
// Approved design: two sections (MATERIAL & LOGISTICS / CUSTOMER CONTACT)
// ---------------------------------------------------------------------------

describe("renderOwnerNotificationEmail — section hierarchy (approved design)", () => {
  it("renders both section headings for a seller lead with contact fields present", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.html).toMatch(/Material\s*&amp;\s*Logistics/i);
    expect(email.html).toMatch(/Customer Contact/i);
    const materialIdx = email.html.search(/Material\s*&amp;\s*Logistics/i);
    const contactIdx = email.html.search(/Customer Contact/i);
    expect(materialIdx).toBeGreaterThan(-1);
    expect(contactIdx).toBeGreaterThan(materialIdx);
  });

  it("renders the reference block with a visible copper accent and the reference value, before the two sections", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.html).toContain("REFERENCE");
    expect(email.html).toContain("MSM-260817-ABCDEF");
    const refIdx = email.html.indexOf("REFERENCE");
    const materialIdx = email.html.search(/Material\s*&amp;\s*Logistics/i);
    expect(refIdx).toBeLessThan(materialIdx);
  });
});

// ---------------------------------------------------------------------------
// Optional/missing fields
// ---------------------------------------------------------------------------

describe("renderOwnerNotificationEmail — optional/missing fields", () => {
  it("omits rows for every null/empty field, never inventing a value", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerCompany: null, sellerNotes: null }), noFiles);
    expect(email.text).not.toMatch(/^\s*Company:/m);
    expect(email.text).not.toMatch(/^\s*Notes:/m);
    expect(email.html).not.toContain(">Company<");
    expect(email.html).not.toContain(">Notes<");
  });

  it("includes notes when present", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Please call after 5pm" }), noFiles);
    expect(email.text).toContain("Please call after 5pm");
    expect(email.html).toContain("Please call after 5pm");
  });

  it("includes the dashboard link, with an arrow, only when a URL is configured", () => {
    const withoutUrl = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(withoutUrl.text).not.toContain("View in dashboard");
    expect(withoutUrl.html).not.toContain("dashboard");

    const withUrl = renderOwnerNotificationEmail(sellerLead(), noFiles, {
      dashboardUrl: "https://owner.example.com/leads/123",
    });
    expect(withUrl.text).toContain("https://owner.example.com/leads/123");
    expect(withUrl.html).toContain("https://owner.example.com/leads/123");
    expect(withUrl.html).toMatch(/View enquiry in dashboard/i);
  });
});

// ---------------------------------------------------------------------------
// File/photo status
// ---------------------------------------------------------------------------

describe("renderOwnerNotificationEmail — file count/status", () => {
  it("renders a truthful file count and status without any storage path (text: full sentence; html: compact row)", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 2, status: "complete" });
    expect(email.text).toContain("2 files uploaded and verified");
    expect(email.html).toContain("2 attached");
  });

  it("omits the Photos row entirely when status is 'none'", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 0, status: "none" });
    expect(email.html).not.toContain(">Photos<");
  });

  it("never includes a storage_path, signed URL, or object path anywhere in the output", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 1, status: "pending" });
    expect(email.text).not.toMatch(/storage_path|leads\/|quote-uploads\//i);
    expect(email.html).not.toMatch(/storage_path|leads\/|quote-uploads\//i);
    expect(email.html).not.toContain('<a href="blob:');
    expect(email.html).not.toContain("signedUrl");
  });

  it("the only <img> in the document is the logo — never an attachment preview or Storage-linked image", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 3, status: "complete" });
    const imgMatches = [...email.html.matchAll(/<img\b[^>]*src="([^"]*)"/g)];
    expect(imgMatches).toHaveLength(1);
    expect(imgMatches[0]![1]).toBe(EMAIL_LOGO_URL);
  });
});

// ---------------------------------------------------------------------------
// HTML safety / escaping
// ---------------------------------------------------------------------------

describe("renderOwnerNotificationEmail — HTML safety", () => {
  it("escapes special HTML characters in every rendered field", () => {
    const email = renderOwnerNotificationEmail(
      sellerLead({ sellerName: `A&B <"Trader's">`, sellerCompany: "Tom & Jerry Co." }),
      noFiles,
    );
    expect(email.html).toContain("A&amp;B &lt;&quot;Trader&#39;s&quot;&gt;");
    expect(email.html).toContain("Tom &amp; Jerry Co.");
    expect(email.html).not.toContain(`A&B <"Trader's">`);
  });

  it("renders a script/HTML injection attempt as inert escaped text, never executable markup", () => {
    const malicious = `<script>alert('xss')</script><img src=x onerror=alert(1)>`;
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: malicious }), noFiles);
    // The one legitimate <img> remaining is the logo — confirm the injected
    // payload never became a second, real <img> tag.
    const imgTags = [...email.html.matchAll(/<img\b[^>]*>/g)];
    expect(imgTags).toHaveLength(1);
    expect(imgTags[0]![0]).toContain(EMAIL_LOGO_URL);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toMatch(/<[^&]*onerror=/);
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders multiline notes as escaped, line-broken HTML, never raw newlines that could confuse markup", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Line one\nLine two" }), noFiles);
    expect(email.html).toContain("Line one<br>Line two");
  });

  it("subject cannot be split into a second header by an embedded newline", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("escapes a hostile reference/material-other value rather than injecting markup", () => {
    const email = renderOwnerNotificationEmail(
      sellerLead({ material: "other", materialOtherText: `<svg onload=alert(1)>` }),
      noFiles,
    );
    expect(email.html).not.toContain("<svg");
    expect(email.html).toContain("&lt;svg onload=alert(1)&gt;");
  });
});

describe("renderOwnerNotificationEmail — text/html both produced", () => {
  it("produces both a readable plain-text version and a full HTML document", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Some notes here" }), noFiles);
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text).not.toContain("<");
    expect(email.text).toContain("Some notes here");
    expect(email.html).toMatch(/^<!doctype html>/i);
    expect(email.html).toContain("<table");
  });

  it("the html is table-based (no flexbox/grid) — every direct layout container is a <table>/<tr>/<td>", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.html).not.toMatch(/display:\s*flex/i);
    expect(email.html).not.toMatch(/display:\s*grid/i);
    expect(email.html).toContain('role="presentation"');
  });
});

describe("renderOwnerNotificationEmail — Submitted date", () => {
  it("the header eyebrow shows the UAE-local date (day/month/year, no time) in the html", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ submittedAt: "2026-08-17T10:00:00.000Z" }), noFiles);
    // 2026-08-17T10:00:00Z is 2026-08-17 in Asia/Dubai (+4, no DST).
    expect(email.html).toMatch(/17 AUG 2026/);
  });

  it("the plain-text alternative carries the full UAE date+time, not a raw ISO string", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ submittedAt: "2026-08-17T10:00:00.000Z" }), noFiles);
    expect(email.text).toContain("Submitted: 17 Aug 2026, 02:00 PM (UAE time)");
    expect(email.text).not.toContain("2026-08-17T10:00:00.000Z");
  });

  it("rolls over to the next Asia/Dubai calendar day for a late-UTC-evening timestamp", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ submittedAt: "2026-08-25T22:11:13.541639+00:00" }), noFiles);
    expect(email.text).toContain("Submitted: 26 Aug 2026, 02:11 AM (UAE time)");
    expect(email.html).toMatch(/26 AUG 2026/);
  });

  it("falls back to the raw value rather than showing an invalid date for an unparseable submittedAt", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ submittedAt: "not-a-real-timestamp" }), noFiles);
    expect(email.text).toContain("Submitted: not-a-real-timestamp");
    expect(email.text).not.toContain("Invalid Date");
    expect(email.html).not.toContain("Invalid Date");
  });
});
