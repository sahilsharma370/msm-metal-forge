import { describe, expect, it } from "vitest";
import {
  ownerLeadDetailSchema,
  ownerLeadDetailFileSchema,
  ownerLeadDetailActivitySchema,
  ownerLeadDetailNotificationSchema,
  ownerLeadDetailSuccessBodySchema,
  ownerLeadFileAccessSuccessBodySchema,
  OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS,
} from "./owner-lead-detail-contract";

const VALID_SELL_LEAD = {
  id: "11111111-1111-1111-1111-111111111111",
  reference: "MSM-260101-ABCDEF",
  status: "new",
  intent: "sell",
  captureChannel: "website",
  material: "copper",
  materialSubtype: null,
  materialSubtypeOtherText: null,
  materialOtherText: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  submissionCompletedAt: "2026-01-01T00:05:00.000Z",
  fileUploadStatus: "complete",
  contact: { name: "Ahmed Seller", phone: "+971501234567", email: null, company: null },
  location: { emirate: "dubai", area: "Al Quoz", mapLink: null },
  enquiry: {
    quantityValue: 100,
    quantityUnit: "kg",
    quantityUnitOther: null,
    quantityUnsure: false,
    condition: "clean_separated",
    description: null,
    pickupRequired: "yes",
    pickupDate: null,
    accessNote: null,
    preferredContact: "whatsapp",
    notes: null,
  },
};

const VALID_BUY_LEAD = {
  id: "22222222-2222-2222-2222-222222222222",
  reference: "MSM-260101-FEDCBA",
  status: "new",
  intent: "buy",
  captureChannel: "website",
  material: "aluminium",
  materialSubtype: null,
  materialSubtypeOtherText: null,
  materialOtherText: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  submissionCompletedAt: "2026-01-01T00:05:00.000Z",
  fileUploadStatus: "none",
  contact: { name: "Fatima Buyer", phone: "+971509999999", email: null, company: null },
  location: { emirate: "sharjah", area: "Industrial 3", mapLink: null },
  enquiry: {
    quantityValue: 500,
    quantityUnit: "kg",
    quantityUnitOther: null,
    tradeRequirement: "local",
    requiredByDate: null,
    additionalSpec: null,
    destinationCountry: null,
    destinationCityPort: null,
    preferredPort: null,
    preferredPortOther: null,
    originCountryPreference: null,
    logisticsRequirement: "delivery",
    logisticsNote: null,
    fulfilment: "delivery",
    materialSpec: null,
    preferredContact: "whatsapp",
    notes: null,
  },
};

describe("ownerLeadDetailSchema — accepts the intended sanitized shape", () => {
  it("accepts a valid sell lead", () => {
    expect(ownerLeadDetailSchema.safeParse(VALID_SELL_LEAD).success).toBe(true);
  });

  it("accepts a valid buy lead", () => {
    expect(ownerLeadDetailSchema.safeParse(VALID_BUY_LEAD).success).toBe(true);
  });
});

describe("ownerLeadDetailSchema — rejects forbidden/incorrect shapes", () => {
  it("rejects a sell lead carrying a buyer-only enquiry field", () => {
    const withBuyerField = { ...VALID_SELL_LEAD, enquiry: { ...VALID_SELL_LEAD.enquiry, tradeRequirement: "local" } };
    expect(ownerLeadDetailSchema.safeParse(withBuyerField).success).toBe(false);
  });

  it("rejects a buy lead carrying a seller-only enquiry field", () => {
    const withSellerField = { ...VALID_BUY_LEAD, enquiry: { ...VALID_BUY_LEAD.enquiry, condition: "clean_separated" } };
    expect(ownerLeadDetailSchema.safeParse(withSellerField).success).toBe(false);
  });

  it("rejects a raw submission_snapshot field leaking through", () => {
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, submission_snapshot: {} }).success).toBe(false);
  });

  it("rejects a raw storage_path/payload_hash/idempotency_key field", () => {
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, storage_path: "x" }).success).toBe(false);
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, payload_hash: "x" }).success).toBe(false);
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, idempotency_key: "x" }).success).toBe(false);
  });

  it("rejects an intent value outside sell/buy", () => {
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, intent: "rent" }).success).toBe(false);
  });

  it("rejects a non-UUID id", () => {
    expect(ownerLeadDetailSchema.safeParse({ ...VALID_SELL_LEAD, id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("ownerLeadDetailFileSchema", () => {
  const VALID_FILE = {
    id: "33333333-3333-3333-3333-333333333333",
    kind: "seller_photo",
    originalFilename: "scrap.jpg",
    mimeType: "image/jpeg",
    byteSize: 1024,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    uploadStatus: "complete",
  };

  it("accepts a valid file item", () => {
    expect(ownerLeadDetailFileSchema.safeParse(VALID_FILE).success).toBe(true);
  });

  it("rejects a storage_path/checksum field leaking through", () => {
    expect(ownerLeadDetailFileSchema.safeParse({ ...VALID_FILE, storage_path: "leads/x" }).success).toBe(false);
    expect(ownerLeadDetailFileSchema.safeParse({ ...VALID_FILE, checksum_sha256: "a".repeat(64) }).success).toBe(false);
  });

  it("rejects a lead_id field leaking through", () => {
    expect(ownerLeadDetailFileSchema.safeParse({ ...VALID_FILE, lead_id: "11111111-1111-1111-1111-111111111111" }).success).toBe(false);
  });
});

describe("ownerLeadDetailActivitySchema", () => {
  it("accepts a valid activity item", () => {
    const activity = { id: "44444444-4444-4444-4444-444444444444", eventType: "submission_completed", actorType: "system", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(true);
  });

  it("rejects a raw metadata field leaking through", () => {
    const activity = { id: "44444444-4444-4444-4444-444444444444", eventType: "submission_completed", actorType: "system", createdAt: "2026-01-01T00:00:00.000Z", metadata: {} };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(false);
  });

  it("rejects an actorType outside system/owner", () => {
    const activity = { id: "44444444-4444-4444-4444-444444444444", eventType: "submission_completed", actorType: "customer", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(false);
  });
});

describe("ownerLeadDetailNotificationSchema", () => {
  it("accepts a well-formed notification summary", () => {
    const notification = { status: "sent", attemptCount: 1, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: "2026-01-01T00:00:00.000Z" };
    expect(ownerLeadDetailNotificationSchema.safeParse(notification).success).toBe(true);
  });

  it("rejects a status outside sent/pending/attention", () => {
    const notification = { status: "queued", attemptCount: 1, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null };
    expect(ownerLeadDetailNotificationSchema.safeParse(notification).success).toBe(false);
  });
});

describe("ownerLeadDetailSuccessBodySchema", () => {
  it("accepts a well-formed full envelope", () => {
    const body = {
      ok: true,
      data: {
        lead: VALID_SELL_LEAD,
        files: [],
        activities: [],
        notification: { status: "attention", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null },
      },
    };
    expect(ownerLeadDetailSuccessBodySchema.safeParse(body).success).toBe(true);
  });
});

describe("ownerLeadFileAccessSuccessBodySchema", () => {
  it("accepts the exact url + expiresInSeconds shape with the fixed 60s TTL", () => {
    const body = { ok: true, data: { url: "https://example.test/signed", expiresInSeconds: OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS } };
    expect(ownerLeadFileAccessSuccessBodySchema.safeParse(body).success).toBe(true);
    expect(OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS).toBe(60);
  });

  it("rejects a response carrying a storage_path field", () => {
    const body = { ok: true, data: { url: "https://example.test/signed", expiresInSeconds: 60, storage_path: "leads/x" } };
    expect(ownerLeadFileAccessSuccessBodySchema.safeParse(body).success).toBe(false);
  });

  it("rejects a non-60 expiresInSeconds", () => {
    const body = { ok: true, data: { url: "https://example.test/signed", expiresInSeconds: 300 } };
    expect(ownerLeadFileAccessSuccessBodySchema.safeParse(body).success).toBe(false);
  });
});
