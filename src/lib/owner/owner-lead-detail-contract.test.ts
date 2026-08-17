import { describe, expect, it } from "vitest";
import {
  ownerLeadDetailSchema,
  ownerLeadDetailFileSchema,
  ownerLeadDetailActivitySchema,
  ownerLeadDetailNotificationSchema,
  ownerLeadDetailSuccessBodySchema,
  ownerLeadFileAccessSuccessBodySchema,
  ownerLeadStatusChangeRequestSchema,
  ownerLeadStatusChangeSuccessBodySchema,
  ownerLeadNoteCreateRequestSchema,
  ownerLeadNoteCreateSuccessBodySchema,
  OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS,
  OWNER_LEAD_NOTE_MAX_LENGTH,
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
  const BASE_ACTIVITY = {
    id: "44444444-4444-4444-4444-444444444444",
    eventType: "submission_completed",
    actorType: "system",
    createdAt: "2026-01-01T00:00:00.000Z",
    statusChange: null,
    noteBody: null,
  };

  it("accepts a valid activity item with statusChange/noteBody both null", () => {
    expect(ownerLeadDetailActivitySchema.safeParse(BASE_ACTIVITY).success).toBe(true);
  });

  it("rejects a raw metadata field leaking through", () => {
    expect(ownerLeadDetailActivitySchema.safeParse({ ...BASE_ACTIVITY, metadata: {} }).success).toBe(false);
  });

  it("rejects an actorType outside system/owner", () => {
    expect(ownerLeadDetailActivitySchema.safeParse({ ...BASE_ACTIVITY, actorType: "customer" }).success).toBe(false);
  });

  it("rejects a missing statusChange/noteBody (not optional — every activity must carry both, even as null)", () => {
    const { statusChange: _statusChange, ...withoutStatusChange } = BASE_ACTIVITY;
    expect(ownerLeadDetailActivitySchema.safeParse(withoutStatusChange).success).toBe(false);
    const { noteBody: _noteBody, ...withoutNoteBody } = BASE_ACTIVITY;
    expect(ownerLeadDetailActivitySchema.safeParse(withoutNoteBody).success).toBe(false);
  });

  it("accepts a status_changed activity with a populated statusChange", () => {
    const activity = { ...BASE_ACTIVITY, eventType: "status_changed", statusChange: { from: "new", to: "contacted", reason: null } };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(true);
  });

  it("rejects a statusChange carrying a status value outside the canonical vocabulary", () => {
    const activity = { ...BASE_ACTIVITY, eventType: "status_changed", statusChange: { from: "new", to: "bogus", reason: null } };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(false);
  });

  it("accepts a note_added activity with a populated noteBody", () => {
    const activity = { ...BASE_ACTIVITY, eventType: "note_added", noteBody: "Customer called twice." };
    expect(ownerLeadDetailActivitySchema.safeParse(activity).success).toBe(true);
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

// ---------------------------------------------------------------------------
// CHECKPOINT C2J-E — status change + private notes
// ---------------------------------------------------------------------------

describe("ownerLeadStatusChangeRequestSchema", () => {
  it("accepts a real transition with no lostReason", () => {
    const body = { expectedStatus: "new", newStatus: "contacted" };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(true);
  });

  it("accepts a same-status resubmission (the no-op shape)", () => {
    const body = { expectedStatus: "contacted", newStatus: "contacted" };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(true);
  });

  it("accepts a transition to lost with a non-blank reason", () => {
    const body = { expectedStatus: "new", newStatus: "lost", lostReason: "Went with a competitor" };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a transition to lost with no lostReason", () => {
    const body = { expectedStatus: "new", newStatus: "lost" };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a transition to lost with a whitespace-only lostReason", () => {
    const body = { expectedStatus: "new", newStatus: "lost", lostReason: "   " };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a lostReason over 300 characters", () => {
    const body = { expectedStatus: "new", newStatus: "lost", lostReason: "x".repeat(301) };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a status value outside the canonical vocabulary", () => {
    expect(ownerLeadStatusChangeRequestSchema.safeParse({ expectedStatus: "new", newStatus: "bogus" }).success).toBe(false);
  });

  it("rejects an unknown key (e.g. a client-supplied ownerUserId or activity metadata)", () => {
    const body = { expectedStatus: "new", newStatus: "contacted", ownerUserId: "11111111-1111-1111-1111-111111111111" };
    expect(ownerLeadStatusChangeRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("ownerLeadStatusChangeSuccessBodySchema", () => {
  it("accepts a real-transition response", () => {
    const body = { ok: true, data: { changed: true, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" } };
    expect(ownerLeadStatusChangeSuccessBodySchema.safeParse(body).success).toBe(true);
  });

  it("accepts a no-op response (changed: false)", () => {
    const body = { ok: true, data: { changed: false, status: "contacted", lostReason: null, closedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" } };
    expect(ownerLeadStatusChangeSuccessBodySchema.safeParse(body).success).toBe(true);
  });
});

describe("ownerLeadNoteCreateRequestSchema", () => {
  const REQUEST_ID = "44444444-4444-4444-4444-444444444444";

  it("accepts a well-formed note body with a requestId", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "Customer wants pickup Friday.", requestId: REQUEST_ID }).success).toBe(true);
  });

  it("trims surrounding whitespace before length validation", () => {
    const parsed = ownerLeadNoteCreateRequestSchema.safeParse({ body: "  hello  ", requestId: REQUEST_ID });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.body).toBe("hello");
  });

  it("rejects an empty body", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "", requestId: REQUEST_ID }).success).toBe(false);
  });

  it("rejects a whitespace-only body", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "   ", requestId: REQUEST_ID }).success).toBe(false);
  });

  it(`rejects a body over ${OWNER_LEAD_NOTE_MAX_LENGTH} characters`, () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "n".repeat(OWNER_LEAD_NOTE_MAX_LENGTH + 1), requestId: REQUEST_ID }).success).toBe(false);
  });

  it("accepts unicode and punctuation", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: 'Client café — "urgent", 50% off? مرحبا', requestId: REQUEST_ID }).success).toBe(true);
  });

  it("rejects a missing requestId", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "hello" }).success).toBe(false);
  });

  it("rejects a non-UUID requestId", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "hello", requestId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(ownerLeadNoteCreateRequestSchema.safeParse({ body: "hello", requestId: REQUEST_ID, ownerUserId: "x" }).success).toBe(false);
  });
});

describe("ownerLeadNoteCreateSuccessBodySchema", () => {
  it("accepts a well-formed response", () => {
    const body = { ok: true, data: { activityId: "44444444-4444-4444-4444-444444444444", note: "hello", createdAt: "2026-01-01T00:00:00.000Z" } };
    expect(ownerLeadNoteCreateSuccessBodySchema.safeParse(body).success).toBe(true);
  });
});
