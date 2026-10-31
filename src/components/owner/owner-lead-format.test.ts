import { describe, expect, it } from "vitest";
import {
  formatUaeDateTimeConcise,
  formatPhoneForDisplay,
  buildOwnerMailtoHref,
  resolvePrimaryContactAction,
  formatEmirateLabel,
  formatPersonName,
} from "./owner-lead-format";

describe("formatEmirateLabel — CHECKPOINT OWNER DESKTOP CORRECTION (small fixes pass)", () => {
  it("presents a stored lowercase emirate value in title case", () => {
    expect(formatEmirateLabel("dubai")).toBe("Dubai");
    expect(formatEmirateLabel("sharjah")).toBe("Sharjah");
    expect(formatEmirateLabel("umm_al_quwain")).toBe("Umm Al Quwain");
    expect(formatEmirateLabel("ras_al_khaimah")).toBe("Ras Al Khaimah");
  });

  it("returns null for a null emirate", () => {
    expect(formatEmirateLabel(null)).toBeNull();
  });
});

describe("formatPersonName — CHECKPOINT OWNER DESKTOP CORRECTION (capitalization pass)", () => {
  it("title-cases an all-lowercase name", () => {
    expect(formatPersonName("rakesh")).toBe("Rakesh");
    expect(formatPersonName("mohammed al farsi")).toBe("Mohammed Al Farsi");
  });

  it("capitalizes each side of a hyphenated name independently", () => {
    expect(formatPersonName("al-farsi")).toBe("Al-Farsi");
  });

  it("leaves an already-title-cased name unchanged", () => {
    expect(formatPersonName("Ahmed Seller")).toBe("Ahmed Seller");
  });

  it("does not damage a word with intentional internal capitalization (e.g. McDonald)", () => {
    expect(formatPersonName("McDonald")).toBe("McDonald");
  });

  it("returns null for a null name", () => {
    expect(formatPersonName(null)).toBeNull();
  });
});

describe("formatUaeDateTimeConcise — CHECKPOINT C2M-A", () => {
  const now = new Date("2026-08-21T10:00:00.000Z"); // 2026-08-21 14:00 UAE

  it("returns 'Today, <time>' for a timestamp on the same UAE calendar day", () => {
    expect(formatUaeDateTimeConcise("2026-08-21T02:35:00.000Z", now)).toBe("Today, 6:35 AM");
  });

  it("returns 'Yesterday, <time>' for a timestamp exactly one UAE calendar day earlier", () => {
    expect(formatUaeDateTimeConcise("2026-08-20T13:03:00.000Z", now)).toBe("Yesterday, 5:03 PM");
  });

  it("returns 'DD Mon, <time>' with no year for an older date in the current UAE year", () => {
    expect(formatUaeDateTimeConcise("2026-08-18T13:03:00.000Z", now)).toBe("18 Aug, 5:03 PM");
  });

  it("includes the year only when it differs from the current UAE year", () => {
    expect(formatUaeDateTimeConcise("2025-12-31T13:03:00.000Z", now)).toBe("31 Dec 2025, 5:03 PM");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatUaeDateTimeConcise("not-a-date", now)).toBeNull();
  });

  it("returns null for a null timestamp", () => {
    expect(formatUaeDateTimeConcise(null, now)).toBeNull();
  });
});

describe("formatPhoneForDisplay — CHECKPOINT C2M-A", () => {
  it("groups a canonical UAE number as +971 XX XXX XXXX", () => {
    expect(formatPhoneForDisplay("+971501234567")).toBe("+971 50 123 4567");
  });

  it("returns a non-UAE E.164 number unchanged rather than guessing a grouping", () => {
    expect(formatPhoneForDisplay("+14155552671")).toBe("+14155552671");
  });

  it("returns null for a null phone", () => {
    expect(formatPhoneForDisplay(null)).toBeNull();
  });
});

describe("buildOwnerMailtoHref", () => {
  it("builds a plain mailto: link", () => {
    expect(buildOwnerMailtoHref("ahmed@example.com")).toBe("mailto:ahmed@example.com");
  });

  it("returns null when there is no email", () => {
    expect(buildOwnerMailtoHref(null)).toBeNull();
  });
});

describe("resolvePrimaryContactAction — CHECKPOINT C2M-A", () => {
  it("prefers WhatsApp when the customer stated it and a phone exists", () => {
    expect(resolvePrimaryContactAction({ preferredContact: "whatsapp", captureChannel: "website", hasPhone: true, hasEmail: false })).toBe(
      "whatsapp",
    );
  });

  it("prefers Call when the customer stated it and a phone exists", () => {
    expect(resolvePrimaryContactAction({ preferredContact: "call", captureChannel: "website", hasPhone: true, hasEmail: false })).toBe("call");
  });

  it("prefers Email when the customer stated it and an email exists", () => {
    expect(resolvePrimaryContactAction({ preferredContact: "email", captureChannel: "website", hasPhone: true, hasEmail: true })).toBe("email");
  });

  it("ignores a stated preference whose underlying value is missing, falling back to what's available", () => {
    expect(resolvePrimaryContactAction({ preferredContact: "email", captureChannel: "website", hasPhone: true, hasEmail: false })).toBe("call");
  });

  it("uses the capture channel as a safe hint only when preferredContact is absent (Quick Add)", () => {
    expect(resolvePrimaryContactAction({ preferredContact: null, captureChannel: "whatsapp", hasPhone: true, hasEmail: false })).toBe(
      "whatsapp",
    );
    expect(resolvePrimaryContactAction({ preferredContact: null, captureChannel: "phone", hasPhone: true, hasEmail: false })).toBe("call");
  });

  it("does not guess from an ambiguous capture channel (walk_in/website/owner_manual)", () => {
    expect(resolvePrimaryContactAction({ preferredContact: null, captureChannel: "walk_in", hasPhone: true, hasEmail: false })).toBe("call");
  });

  it("falls back to Call, then Email, when no preference or channel hint applies", () => {
    expect(resolvePrimaryContactAction({ preferredContact: null, captureChannel: "website", hasPhone: true, hasEmail: true })).toBe("call");
    expect(resolvePrimaryContactAction({ preferredContact: null, captureChannel: "website", hasPhone: false, hasEmail: true })).toBe("email");
  });

  it("returns null when no contact method has any underlying value", () => {
    expect(resolvePrimaryContactAction({ preferredContact: "whatsapp", captureChannel: "website", hasPhone: false, hasEmail: false })).toBeNull();
  });
});
