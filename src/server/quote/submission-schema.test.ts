import { describe, expect, it } from "vitest";
import {
  initiateQuoteRequestSchema,
  checkSubmissionCompleteness,
  checkFilesAgainstIntent,
  normalizeSubmission,
  type SubmissionShape,
} from "./submission-schema";

const validSeller = {
  intent: "sell",
  source: "hero",
  material: "copper",
  sellerCondition: "clean_separated",
  sellerQuantityValue: "100",
  sellerQuantityUnit: "kg",
  sellerQuantityUnsure: false,
  sellerEmirate: "dubai",
  sellerArea: "Al Quoz Industrial 3",
  sellerPickupRequired: "no",
  sellerName: "Ahmed Seller",
  sellerPhone: "+971501234567",
  sellerPreferredContact: "whatsapp",
};

const validBuyerLocal = {
  intent: "buy",
  source: "materials",
  material: "aluminium",
  buyerQuantityValue: "500",
  buyerQuantityUnit: "kg",
  buyerTradeRequirement: "local",
  buyerDestinationEmirate: "dubai",
  buyerDestinationArea: "Business Bay area",
  buyerFulfilment: "delivery",
  buyerContactPerson: "Fatima Buyer",
  buyerPhone: "+971502345678",
  buyerPreferredContact: "whatsapp",
};

function validRequestBody(
  overrides: Partial<{
    idempotencyKey: string;
    submission: object;
    files: object[];
    turnstileToken: string;
  }> = {},
) {
  return {
    idempotencyKey: "d0000000-0000-0000-0000-000000000001",
    submission: validSeller,
    files: [],
    turnstileToken: "valid-turnstile-token",
    ...overrides,
  };
}

describe("initiateQuoteRequestSchema — shape and unknown keys", () => {
  it("accepts a valid minimal request body", () => {
    const result = initiateQuoteRequestSchema.safeParse(validRequestBody());
    expect(result.success).toBe(true);
  });

  it("rejects a missing turnstileToken — CHECKPOINT C2G requires it on every initiate request", () => {
    const { turnstileToken: _turnstileToken, ...withoutToken } = validRequestBody();
    expect(initiateQuoteRequestSchema.safeParse(withoutToken).success).toBe(false);
  });

  it("rejects an empty-string turnstileToken", () => {
    expect(
      initiateQuoteRequestSchema.safeParse(validRequestBody({ turnstileToken: "" })).success,
    ).toBe(false);
  });

  it("rejects a non-UUID idempotencyKey", () => {
    const result = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ idempotencyKey: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const result = initiateQuoteRequestSchema.safeParse({
      ...validRequestBody(),
      somethingUnexpected: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payloadHash supplied by the caller (not a declared key)", () => {
    const result = initiateQuoteRequestSchema.safeParse({
      ...validRequestBody(),
      payloadHash: "a".repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown submission key", () => {
    const result = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, somethingUnexpected: "x" } }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts an absent honeypot", () => {
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody()).success).toBe(true);
  });

  it("accepts an empty-string honeypot", () => {
    expect(
      initiateQuoteRequestSchema.safeParse({ ...validRequestBody(), honeypot: "" }).success,
    ).toBe(true);
  });

  it("rejects a non-empty honeypot", () => {
    expect(
      initiateQuoteRequestSchema.safeParse({ ...validRequestBody(), honeypot: "bot-filled-this" })
        .success,
    ).toBe(false);
  });
});

describe("submissionSchema — branch isolation", () => {
  it("rejects a sell-intent submission carrying a buyer-only field", () => {
    const result = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, buyerQuantityValue: "50" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a buy-intent submission carrying a seller-only field", () => {
    const result = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validBuyerLocal, sellerName: "Ahmed" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a buy-intent submission with sellerQuantityUnsure: true", () => {
    const result = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validBuyerLocal, sellerQuantityUnsure: true } }),
    );
    expect(result.success).toBe(false);
  });
});

describe("checkSubmissionCompleteness", () => {
  it("returns no issues for a fully valid seller submission", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(validRequestBody());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(checkSubmissionCompleteness(parsed.data.submission)).toHaveLength(0);
  });

  it("returns no issues for a fully valid buyer-local submission", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: validBuyerLocal }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(checkSubmissionCompleteness(parsed.data.submission)).toHaveLength(0);
  });

  it("flags a seller submission missing a required field (name)", () => {
    const { sellerName: _sellerName, ...incomplete } = validSeller;
    const parsed = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: incomplete }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(checkSubmissionCompleteness(parsed.data.submission).length).toBeGreaterThan(0);
  });
});

describe("file declarations", () => {
  const validFile = {
    original_filename: "photo.jpg",
    declared_mime_type: "image/jpeg",
    declared_byte_size: 1024,
  };

  it("accepts up to 5 files", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      ...validFile,
      original_filename: `photo${i}.jpg`,
    }));
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(true);
  });

  it("rejects more than 5 files", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      ...validFile,
      original_filename: `photo${i}.jpg`,
    }));
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects an unexpected key on a file object", () => {
    const files = [{ ...validFile, slot_index: 0 }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects a storage_path supplied by the caller", () => {
    const files = [{ ...validFile, storage_path: "leads/evil/path" }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects an invalid MIME type", () => {
    const files = [{ ...validFile, declared_mime_type: "image/gif" }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects a zero declared_byte_size", () => {
    const files = [{ ...validFile, declared_byte_size: 0 }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects a declared_byte_size over 8 MiB", () => {
    const files = [{ ...validFile, declared_byte_size: 8 * 1024 * 1024 + 1 }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects a path-traversal-shaped filename", () => {
    const files = [{ ...validFile, original_filename: "../../etc/passwd" }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("rejects a filename containing a control character", () => {
    const files = [{ ...validFile, original_filename: "\tphoto.jpg" }];
    expect(initiateQuoteRequestSchema.safeParse(validRequestBody({ files })).success).toBe(false);
  });

  it("checkFilesAgainstIntent rejects a PDF for a sell-intent submission", () => {
    const issues = checkFilesAgainstIntent("sell", [
      { ...validFile, declared_mime_type: "application/pdf" },
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("checkFilesAgainstIntent accepts a PDF for a buy-intent submission", () => {
    const issues = checkFilesAgainstIntent("buy", [
      { ...validFile, declared_mime_type: "application/pdf" },
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("normalizeSubmission", () => {
  it("fills every known key, using null for absent fields", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(validRequestBody());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["buyerContactPerson"]).toBeNull();
    expect(normalized["sellerName"]).toBe("Ahmed Seller");
    expect(Object.keys(normalized)).toContain("source");
  });

  it("leaves every unrelated field exactly as provided — no contract drift beyond the phone fields", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(validRequestBody());
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["material"]).toBe("copper");
    expect(normalized["sellerCondition"]).toBe("clean_separated");
    expect(normalized["sellerQuantityValue"]).toBe("100");
    expect(normalized["sellerEmirate"]).toBe("dubai");
    expect(normalized["sellerArea"]).toBe("Al Quoz Industrial 3");
    expect(normalized["sellerPreferredContact"]).toBe("whatsapp");
    expect(normalized["source"]).toBe("hero");
  });
});

describe("normalizeSubmission — CHECKPOINT C2F-B phone canonicalization", () => {
  it("canonicalizes a UAE local seller number (050...) to +971...", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, sellerPhone: "0501234567" } }),
    );
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["sellerPhone"]).toBe("+971501234567");
  });

  it("canonicalizes a UAE local buyer number (050...) to +971...", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validBuyerLocal, buyerPhone: "0502345678" } }),
    );
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["buyerPhone"]).toBe("+971502345678");
  });

  it("leaves an already-canonical international number unchanged", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, sellerPhone: "+14155552671" } }),
    );
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["sellerPhone"]).toBe("+14155552671");
  });

  it("normalizes spaces/dashes/parentheses to the same canonical form as the plain digit string", () => {
    const plain = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, sellerPhone: "0501234567" } }),
    );
    const formatted = initiateQuoteRequestSchema.safeParse(
      validRequestBody({ submission: { ...validSeller, sellerPhone: "050-123 (4567)" } }),
    );
    if (!plain.success || !formatted.success) throw new Error("fixtures must parse");
    const normalizedPlain = normalizeSubmission(plain.data.submission as SubmissionShape);
    const normalizedFormatted = normalizeSubmission(formatted.data.submission as SubmissionShape);
    expect(normalizedFormatted["sellerPhone"]).toBe(normalizedPlain["sellerPhone"]);
    expect(normalizedFormatted["sellerPhone"]).toBe("+971501234567");
  });

  it("does not populate buyerPhone when normalizing a seller submission", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(validRequestBody({ submission: validSeller }));
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["buyerPhone"]).toBeNull();
  });

  it("does not populate sellerPhone when normalizing a buyer submission", () => {
    const parsed = initiateQuoteRequestSchema.safeParse(validRequestBody({ submission: validBuyerLocal }));
    if (!parsed.success) throw new Error("fixture must parse");
    const normalized = normalizeSubmission(parsed.data.submission as SubmissionShape);
    expect(normalized["sellerPhone"]).toBeNull();
  });
});
