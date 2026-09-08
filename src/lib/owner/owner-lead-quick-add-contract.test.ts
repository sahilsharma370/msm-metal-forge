import { describe, expect, it } from "vitest";
import {
  ownerLeadQuickAddRequestSchema,
  ownerLeadQuickAddFormValuesSchema,
  ownerLeadQuickAddSuccessBodySchema,
  QUICK_ADD_CHANNEL_VALUES,
} from "./owner-lead-quick-add-contract";

const VALID_SELLER_REQUEST = {
  requestId: "11111111-1111-1111-1111-111111111111",
  intent: "sell" as const,
  channel: "phone" as const,
  material: "copper" as const,
  contactName: "Ahmed",
  contactPhone: "+971501234567",
  quantityValue: 100,
  quantityUnit: "kg" as const,
  sellerEmirate: "dubai" as const,
  sellerArea: "Al Quoz",
};

const VALID_BUYER_REQUEST = {
  requestId: "22222222-2222-2222-2222-222222222222",
  intent: "buy" as const,
  channel: "whatsapp" as const,
  material: "aluminium" as const,
  contactName: "Fatima Traders",
  contactPhone: "+971521112222",
};

describe("ownerLeadQuickAddRequestSchema — accepts valid submissions", () => {
  it("accepts a fully-populated seller request", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse(VALID_SELLER_REQUEST).success).toBe(true);
  });

  it("accepts a minimal buyer request (only required fields)", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse(VALID_BUYER_REQUEST).success).toBe(true);
  });

  it("accepts every canonical Quick Add channel", () => {
    for (const channel of QUICK_ADD_CHANNEL_VALUES) {
      expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, channel }).success).toBe(true);
    }
  });
});

describe("ownerLeadQuickAddRequestSchema — rejects invalid/forbidden shapes", () => {
  it("rejects a missing requestId", () => {
    const { requestId, ...rest } = VALID_SELLER_REQUEST;
    expect(ownerLeadQuickAddRequestSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, ownerUserId: "sneaky" }).success).toBe(false);
  });

  it("rejects the 'website' channel — that belongs to the Quote Experience alone", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, channel: "website" }).success).toBe(false);
  });

  it("rejects the 'owner_manual' channel — reserved for a distinct future backfill feature", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, channel: "owner_manual" }).success).toBe(false);
  });

  it("rejects an empty contact name", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, contactName: "  " }).success).toBe(false);
  });

  it("rejects an invalid phone number", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, contactPhone: "not-a-phone" }).success).toBe(false);
  });

  it("rejects material='other' with no materialOtherText", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, material: "other" }).success).toBe(false);
  });

  it("accepts material='other' with materialOtherText provided", () => {
    expect(
      ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, material: "other", materialOtherText: "PVC-coated cable" }).success,
    ).toBe(true);
  });

  it("rejects quantityUnit='other' with no quantityUnitOther", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, quantityUnit: "other" }).success).toBe(false);
  });

  it("rejects quantityUnitOther supplied when quantityUnit isn't 'other'", () => {
    expect(
      ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, quantityUnit: "kg", quantityUnitOther: "sacks" }).success,
    ).toBe(false);
  });

  it("rejects a buyer request carrying seller-only location fields (branch isolation)", () => {
    expect(
      ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_BUYER_REQUEST, sellerEmirate: "dubai" }).success,
    ).toBe(false);
  });

  it("rejects a non-positive quantity value", () => {
    expect(ownerLeadQuickAddRequestSchema.safeParse({ ...VALID_SELLER_REQUEST, quantityValue: 0 }).success).toBe(false);
  });
});

describe("ownerLeadQuickAddFormValuesSchema — the same rules, without requestId", () => {
  it("accepts the request fields minus requestId", () => {
    const { requestId, ...formValues } = VALID_SELLER_REQUEST;
    expect(ownerLeadQuickAddFormValuesSchema.safeParse(formValues).success).toBe(true);
  });

  it("rejects a requestId field being present (not part of the form's own shape)", () => {
    expect(ownerLeadQuickAddFormValuesSchema.safeParse(VALID_SELLER_REQUEST).success).toBe(false);
  });
});

describe("ownerLeadQuickAddSuccessBodySchema", () => {
  it("accepts a well-formed success body", () => {
    const body = { ok: true, data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false } };
    expect(ownerLeadQuickAddSuccessBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects a stray internal field on the data envelope", () => {
    const body = {
      ok: true,
      data: { leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF", idempotentReplay: false, payloadHash: "leak" },
    };
    expect(ownerLeadQuickAddSuccessBodySchema.safeParse(body).success).toBe(false);
  });
});
