import { describe, expect, it } from "vitest";
import {
  ownerLeadListItemSchema,
  ownerLeadListSuccessBodySchema,
  ownerLeadListErrorBodySchema,
  OWNER_LEAD_LIST_QUERY_PARAMS,
} from "./owner-leads-contract";

const VALID_ITEM = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "MSM-260101-ABCDEF",
  status: "new",
  intent: "sell",
  captureChannel: "website",
  material: "copper",
  materialSubtype: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  submissionCompletedAt: "2026-01-01T00:05:00.000Z",
  contact: { name: "Ahmed Seller", phone: "+971501234567" },
  location: { emirate: "dubai", area: "Al Quoz" },
  quantity: { value: 100, unit: "kg" },
  fileUploadStatus: "complete",
  notificationStatus: "sent",
};

describe("ownerLeadListItemSchema — accepts the intended sanitized shape", () => {
  it("accepts a fully-populated valid item", () => {
    expect(ownerLeadListItemSchema.safeParse(VALID_ITEM).success).toBe(true);
  });

  it("accepts nullable fields set to null", () => {
    const item = {
      ...VALID_ITEM,
      materialSubtype: null,
      contact: { name: null, phone: null },
      location: { emirate: null, area: null },
      quantity: { value: null, unit: null },
    };
    expect(ownerLeadListItemSchema.safeParse(item).success).toBe(true);
  });
});

describe("ownerLeadListItemSchema — rejects forbidden/incorrect shapes", () => {
  it("rejects an unknown top-level field (e.g. a stray storage/internal field)", () => {
    const withForbiddenField = { ...VALID_ITEM, storagePath: "leads/11111111/file.pdf" };
    expect(ownerLeadListItemSchema.safeParse(withForbiddenField).success).toBe(false);
  });

  it("rejects a raw submission_snapshot field leaking through", () => {
    const withSnapshot = { ...VALID_ITEM, submission_snapshot: { anything: true } };
    expect(ownerLeadListItemSchema.safeParse(withSnapshot).success).toBe(false);
  });

  it("rejects an unknown nested field inside contact/location/quantity", () => {
    expect(
      ownerLeadListItemSchema.safeParse({ ...VALID_ITEM, contact: { ...VALID_ITEM.contact, email: "x@example.com" } })
        .success,
    ).toBe(false);
  });

  it("rejects a status value outside the fixed vocabulary", () => {
    expect(ownerLeadListItemSchema.safeParse({ ...VALID_ITEM, status: "won" }).success).toBe(false);
  });

  it("rejects an intent value outside sell/buy", () => {
    expect(ownerLeadListItemSchema.safeParse({ ...VALID_ITEM, intent: "rent" }).success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    expect(ownerLeadListItemSchema.safeParse({ ...VALID_ITEM, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { reference: _reference, ...withoutReference } = VALID_ITEM;
    expect(ownerLeadListItemSchema.safeParse(withoutReference).success).toBe(false);
  });
});

describe("ownerLeadListSuccessBodySchema / ownerLeadListErrorBodySchema", () => {
  it("accepts a well-formed success envelope", () => {
    const body = { ok: true, data: { leads: [VALID_ITEM], page: { nextCursor: null, hasMore: false } } };
    expect(ownerLeadListSuccessBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects a success envelope with an extra top-level field", () => {
    const body = { ok: true, data: { leads: [], page: { nextCursor: null, hasMore: false } }, extra: 1 };
    expect(ownerLeadListSuccessBodySchema.safeParse(body).success).toBe(false);
  });

  it("accepts a well-formed error envelope", () => {
    const body = { ok: false, error: { code: "VALIDATION_ERROR", message: "The request could not be validated." } };
    expect(ownerLeadListErrorBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects an error envelope with an unrecognized error code", () => {
    const body = { ok: false, error: { code: "NOT_A_REAL_CODE", message: "x" } };
    expect(ownerLeadListErrorBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("OWNER_LEAD_LIST_QUERY_PARAMS — the fixed allowlist", () => {
  it("contains exactly the nine documented parameters", () => {
    expect([...OWNER_LEAD_LIST_QUERY_PARAMS].sort()).toEqual(
      ["status", "intent", "material", "captureChannel", "submittedFrom", "submittedTo", "q", "cursor", "limit"].sort(),
    );
  });
});
