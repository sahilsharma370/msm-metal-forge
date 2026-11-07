import { describe, expect, it } from "vitest";
import {
  renderCustomerReceiptEmail,
  CUSTOMER_RECEIPT_BODY_PARAGRAPH,
  type CustomerReceiptLeadData,
} from "./customer-receipt-email";
import { EMAIL_LOGO_URL } from "./email-template-shared";

function baseLead(overrides: Partial<CustomerReceiptLeadData> = {}): CustomerReceiptLeadData {
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

function sellerLead(overrides: Partial<CustomerReceiptLeadData> = {}): CustomerReceiptLeadData {
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
    sellerEmail: "ahmed.seller@example.com",
    sellerPreferredContact: "whatsapp",
    sellerNotes: "Please call before 5pm — this must never appear in the receipt.",
    ...overrides,
  });
}

function buyerLead(overrides: Partial<CustomerReceiptLeadData> = {}): CustomerReceiptLeadData {
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
    buyerEmail: "fatima.buyer@example.com",
    buyerPreferredContact: "whatsapp",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Approved design: logo header
// ---------------------------------------------------------------------------

describe("renderCustomerReceiptEmail — logo header (approved design)", () => {
  it("renders exactly one <img>, the real repository logo asset, absolute HTTPS src, width/height, alt text", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    const imgMatches = [...email.html.matchAll(/<img\b[^>]*>/g)];
    expect(imgMatches).toHaveLength(1);
    const img = imgMatches[0]![0];
    expect(img).toContain(`src="${EMAIL_LOGO_URL}"`);
    expect(EMAIL_LOGO_URL.startsWith("https://msmscrap.com/")).toBe(true);
    expect(img).toMatch(/width="\d+"/);
    expect(img).toMatch(/height="\d+"/);
    expect(img).toContain('alt="MSM Scrap"');
  });

  it("never contains the literal text 'MSM / SCRAP TRADING' — header is the logo image only", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.html).not.toMatch(/SCRAP\s*TRADING/i);
  });

  it("the logo is the real repository SVG rasterized — not a crop of the mockup (same URL/dimensions as the owner template's logo)", async () => {
    const { EMAIL_LOGO_URL: ownerLogoUrl } = await import("./email-template-shared");
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.html).toContain(ownerLogoUrl);
  });
});

// ---------------------------------------------------------------------------
// Content allowlist — Sell/Buy, reference, material, quantity, fixed copy
// ---------------------------------------------------------------------------

describe("renderCustomerReceiptEmail — content allowlist", () => {
  it("subject includes the reference", () => {
    const email = renderCustomerReceiptEmail(sellerLead({ reference: "MSM-261104-999999" }));
    expect(email.subject).toContain("MSM-261104-999999");
  });

  it("seller: text and html include reference, Sell, material, approximate quantity, and the fixed body paragraph", () => {
    const lead = sellerLead({ reference: "MSM-261104-000001" });
    const email = renderCustomerReceiptEmail(lead);
    expect(email.text).toContain("MSM-261104-000001");
    expect(email.text).toContain("Sell to MSM");
    expect(email.text).toContain("Copper");
    expect(email.text).toContain("100 kg");
    expect(email.text).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
    expect(email.html).toContain("MSM-261104-000001");
    expect(email.html).toContain("Sell to MSM");
    expect(email.html).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
  });

  it("buyer: text includes Buy, material, approximate quantity, and the fixed body paragraph", () => {
    const email = renderCustomerReceiptEmail(buyerLead({ reference: "MSM-261104-000002" }));
    expect(email.text).toContain("Buy from MSM");
    expect(email.text).toContain("Aluminium");
    expect(email.text).toContain("500 kg");
    expect(email.text).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
  });

  it("seller: shows 'Not sure' for quantity when sellerQuantityUnsure is true", () => {
    const email = renderCustomerReceiptEmail(
      sellerLead({ sellerQuantityUnsure: true, sellerQuantityValue: null, sellerQuantityUnit: null }),
    );
    expect(email.text).toContain("Approx. quantity: Not sure");
    expect(email.html).toContain("Not sure");
  });

  it("omits the Approx. quantity row entirely when no quantity info exists (buy, defensive)", () => {
    const email = renderCustomerReceiptEmail(
      buyerLead({ buyerQuantityValue: null, buyerQuantityUnit: null }),
    );
    expect(email.html).not.toContain("APPROX. QUANTITY");
    expect(email.text).not.toMatch(/^Approx\. quantity:/m);
  });

  it("never includes phone", () => {
    const seller = renderCustomerReceiptEmail(sellerLead());
    expect(seller.text).not.toContain("+971501234567");
    expect(seller.html).not.toContain("+971501234567");
    const buyer = renderCustomerReceiptEmail(buyerLead());
    expect(buyer.text).not.toContain("+971502345678");
  });

  it("never includes exact location (emirate, area, or map link)", () => {
    const email = renderCustomerReceiptEmail(sellerLead({ sellerMapLink: "https://maps.google.com/?q=secret" }));
    expect(email.text).not.toContain("Al Quoz Industrial 3");
    expect(email.text).not.toMatch(/dubai/i);
    expect(email.text).not.toContain("maps.google.com");
    expect(email.html).not.toContain("maps.google.com");
  });

  it("never includes name, company, or notes", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text).not.toContain("Ahmed Seller");
    expect(email.text).not.toContain("Please call before 5pm");
    expect(email.html).not.toContain("Please call before 5pm");
  });

  it("never includes the customer's own email address", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text).not.toContain("ahmed.seller@example.com");
    expect(email.html).not.toContain("ahmed.seller@example.com");
  });

  it("never includes file/photo status", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text.toLowerCase()).not.toContain("photo");
    expect(email.text.toLowerCase()).not.toMatch(/\bfile\b/);
  });

  it("never includes a dashboard link", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text).not.toContain("dashboard");
    expect(email.html).not.toContain("dashboard");
  });

  it("never includes a price or response-time promise", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text.toLowerCase()).not.toMatch(/price|aed|\$|within \d+ (hour|minute|day)/);
  });

  it("the exact approved follow-up sentence appears verbatim, never varied or combined with a promise", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
    expect(email.html).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
  });

  it("includes 'Please keep this reference for any follow-up.'", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text).toContain("Please keep this reference for any follow-up.");
    expect(email.html).toContain("Please keep this reference for any follow-up.");
  });
});

// ---------------------------------------------------------------------------
// HTML safety / escaping
// ---------------------------------------------------------------------------

describe("renderCustomerReceiptEmail — HTML safety", () => {
  it("html-escapes a hostile material-other-text value rather than injecting markup", () => {
    const email = renderCustomerReceiptEmail(sellerLead({ material: "other", materialOtherText: "<script>alert(1)</script>" }));
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("html-escapes a hostile reference value (defense in depth; reference is always server-generated)", () => {
    const email = renderCustomerReceiptEmail(sellerLead({ reference: `<img src=x onerror=alert(1)>` }));
    const imgTags = [...email.html.matchAll(/<img\b[^>]*>/g)];
    // Only the one legitimate logo <img> — the hostile "reference" never becomes a second real tag.
    expect(imgTags).toHaveLength(1);
    expect(imgTags[0]![0]).toContain(EMAIL_LOGO_URL);
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("strips CR/LF from the subject so a reference could never inject a second header", () => {
    const email = renderCustomerReceiptEmail(sellerLead({ reference: "MSM-261104-000003" }));
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe("renderCustomerReceiptEmail — text/html both produced", () => {
  it("produces both a readable plain-text version and a full HTML document", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
    expect(email.text).not.toContain("<");
    expect(email.html).toMatch(/^<!doctype html>/i);
  });

  it("the html is table-based (no flexbox/grid)", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    expect(email.html).not.toMatch(/display:\s*flex/i);
    expect(email.html).not.toMatch(/display:\s*grid/i);
    expect(email.html).toContain('role="presentation"');
  });

  it("is not a single giant screenshot image as the email body — the body is real text content, not solely an <img>", () => {
    const email = renderCustomerReceiptEmail(sellerLead());
    const withoutImgTags = email.html.replace(/<img\b[^>]*>/g, "");
    expect(withoutImgTags).toContain("Your enquiry is in.");
    expect(withoutImgTags).toContain(CUSTOMER_RECEIPT_BODY_PARAGRAPH);
  });
});
