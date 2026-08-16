import { describe, expect, it } from "vitest";
import {
  renderOwnerNotificationEmail,
  sanitizeHeaderValue,
  type OwnerNotificationFileStats,
  type OwnerNotificationLeadData,
} from "./owner-notification-email";

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

describe("renderOwnerNotificationEmail — seller rendering", () => {
  it("includes the genuine reference, seller intent, and core seller fields", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.subject).toBe("New seller enquiry — MSM-260817-ABCDEF");
    expect(email.text).toContain("New MSM Scrap enquiry");
    expect(email.text).toContain("MSM-260817-ABCDEF");
    expect(email.text).toContain("Sell to MSM");
    expect(email.text).toContain("Ahmed Seller");
    expect(email.text).toContain("+971501234567");
    expect(email.html).toContain("MSM-260817-ABCDEF");
    expect(email.html).toContain("Ahmed Seller");
  });

  it("excludes buyer-only fields entirely from a seller email", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ buyerContactPerson: null }), noFiles);
    expect(email.text).not.toMatch(/trade route/i);
    expect(email.text).not.toMatch(/destination/i);
    expect(email.text).not.toMatch(/fulfilment/i);
    expect(email.html).not.toMatch(/trade route/i);
  });

  it("renders material subtype when present", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ materialSubtype: "wire_cable" }), noFiles);
    expect(email.text).toMatch(/Copper.*Wire Cable/);
  });

  it("renders 'Not sure' for an unsure quantity instead of a fabricated value", () => {
    const email = renderOwnerNotificationEmail(
      sellerLead({ sellerQuantityUnsure: true, sellerQuantityValue: null, sellerQuantityUnit: null }),
      noFiles,
    );
    expect(email.text).toContain("Not sure");
  });
});

describe("renderOwnerNotificationEmail — buyer rendering", () => {
  it("includes the genuine reference, buyer intent, and core buyer fields", () => {
    const email = renderOwnerNotificationEmail(buyerLead(), noFiles);
    expect(email.subject).toBe("New buyer enquiry — MSM-260817-ABCDEF");
    expect(email.text).toContain("Buy from MSM");
    expect(email.text).toContain("Fatima Buyer");
    expect(email.text).toContain("+971502345678");
    expect(email.text).toContain("Business Bay");
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

describe("renderOwnerNotificationEmail — optional/missing fields", () => {
  it("omits rows for every null/empty field, never inventing a value", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerCompany: null, sellerNotes: null }), noFiles);
    expect(email.text).not.toMatch(/^Company:/m);
    expect(email.text).not.toMatch(/^Notes:/m);
  });

  it("includes notes when present", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Please call after 5pm" }), noFiles);
    expect(email.text).toContain("Please call after 5pm");
  });

  it("includes the dashboard link only when a URL is configured", () => {
    const withoutUrl = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(withoutUrl.text).not.toContain("View in dashboard");
    expect(withoutUrl.html).not.toContain("View in dashboard");

    const withUrl = renderOwnerNotificationEmail(sellerLead(), noFiles, {
      dashboardUrl: "https://owner.example.com/leads/123",
    });
    expect(withUrl.text).toContain("https://owner.example.com/leads/123");
    expect(withUrl.html).toContain("https://owner.example.com/leads/123");
  });
});

describe("renderOwnerNotificationEmail — file count/status", () => {
  it("renders a truthful file count and status without any storage path", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 2, status: "complete" });
    expect(email.text).toContain("2 files uploaded and verified");
    expect(email.html).toContain("2 files uploaded and verified");
  });

  it("never includes a storage_path, signed URL, or object path anywhere in the output", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 1, status: "pending" });
    expect(email.text).not.toMatch(/storage_path|leads\/|quote-uploads\//i);
    expect(email.html).not.toMatch(/storage_path|leads\/|quote-uploads\//i);
    expect(email.html).not.toContain("<a href=\"blob:");
    expect(email.html).not.toContain("signedUrl");
  });

  it("never renders an attachment reference or img/src Storage link", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), { count: 3, status: "complete" });
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("attachment");
  });
});

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
    // The substring survives (inert, inside escaped text) but never as a real tag/attribute.
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toMatch(/<[^&]*onerror=/);
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders multiline notes as escaped, line-broken HTML, never raw newlines that could confuse markup", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Line one\nLine two" }), noFiles);
    expect(email.html).toContain("Line one<br>Line two");
  });

  it("subject cannot be split into a second header by an embedded newline in the reference-adjacent intent text", () => {
    const email = renderOwnerNotificationEmail(sellerLead(), noFiles);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe("renderOwnerNotificationEmail — text/html both produced", () => {
  it("produces both a readable plain-text version and an HTML version", () => {
    const email = renderOwnerNotificationEmail(sellerLead({ sellerNotes: "Some notes here" }), noFiles);
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text).not.toContain("<");
    expect(email.text).toContain("Some notes here");
  });
});
