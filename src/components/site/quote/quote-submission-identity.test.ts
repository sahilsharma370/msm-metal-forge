import { describe, expect, it } from "vitest";
import {
  buildQuoteSubmissionShape,
  buildOrderedFileDeclarations,
  computeQuoteSubmissionIdentity,
  resolveIdempotencyKey,
  selectRelevantLocalFiles,
} from "./quote-submission-identity";
import type { QuoteFormValues, QuoteLocalFile } from "./quote-schema";
import type { QuoteInitialContext } from "./quote-search";

function localFile(name: string, type: string, size: number): QuoteLocalFile {
  return {
    id: `${name}-${size}-fake-id`,
    file: new File([new Uint8Array(size)], name, { type }),
    previewUrl: `blob:fake-${name}`,
    name,
    size,
  };
}

function baseSellerValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    intent: "sell",
    material: "copper",
    sellerCondition: "clean_separated",
    sellerQuantityValue: "100",
    sellerQuantityUnit: "kg",
    sellerQuantityUnsure: false,
    sellerEmirate: "dubai",
    sellerArea: "Al Quoz Industrial 3",
    sellerPickupRequired: "no",
    sellerName: "Ahmed Seller",
    sellerPhone: "0501234567",
    sellerPreferredContact: "whatsapp",
    sellerPhotos: [],
    buyerDocuments: [],
    ...overrides,
  };
}

function baseBuyerValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    intent: "buy",
    material: "aluminium",
    buyerQuantityValue: "500",
    buyerQuantityUnit: "kg",
    buyerTradeRequirement: "local",
    buyerDestinationEmirate: "dubai",
    buyerDestinationArea: "Business Bay area",
    buyerFulfilment: "delivery",
    buyerContactPerson: "Fatima Buyer",
    buyerPhone: "0502345678",
    buyerPreferredContact: "whatsapp",
    sellerPhotos: [],
    buyerDocuments: [],
    ...overrides,
  };
}

const sellerContext: QuoteInitialContext = { source: "hero" };
const buyerContext: QuoteInitialContext = { source: "materials" };

describe("selectRelevantLocalFiles — seller/buyer file-kind isolation", () => {
  it("returns sellerPhotos for a sell intent, never buyerDocuments", () => {
    const sellerPhoto = localFile("photo.jpg", "image/jpeg", 100);
    const buyerDoc = localFile("doc.pdf", "application/pdf", 200);
    const values = baseSellerValues({ sellerPhotos: [sellerPhoto], buyerDocuments: [buyerDoc] });
    expect(selectRelevantLocalFiles(values, "sell")).toEqual([sellerPhoto]);
  });

  it("returns buyerDocuments for a buy intent, never sellerPhotos", () => {
    const sellerPhoto = localFile("photo.jpg", "image/jpeg", 100);
    const buyerDoc = localFile("doc.pdf", "application/pdf", 200);
    const values = baseBuyerValues({ sellerPhotos: [sellerPhoto], buyerDocuments: [buyerDoc] });
    expect(selectRelevantLocalFiles(values, "buy")).toEqual([buyerDoc]);
  });
});

describe("buildQuoteSubmissionShape", () => {
  it("excludes sellerPhotos/buyerDocuments and the File object/previewUrl/id inside them", () => {
    const values = baseSellerValues({
      sellerPhotos: [localFile("photo.jpg", "image/jpeg", 100)],
    });
    const result = buildQuoteSubmissionShape(values, sellerContext.source);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("sellerPhotos");
    expect(result.data).not.toHaveProperty("buyerDocuments");
    const keys = Object.keys(result.data);
    expect(keys.every((k) => !["file", "previewUrl", "id"].includes(k))).toBe(true);
  });

  it("fails closed (ok: false via safeParse) on an incomplete form rather than throwing", () => {
    const result = buildQuoteSubmissionShape({ sellerPhotos: [], buyerDocuments: [] }, "hero");
    expect(result.success).toBe(false);
  });
});

describe("buildOrderedFileDeclarations", () => {
  it("omits the File object, previewUrl and client-only id — only declared metadata survives", () => {
    const files = [localFile("a.jpg", "image/jpeg", 111), localFile("b.png", "image/png", 222)];
    const declarations = buildOrderedFileDeclarations(files);
    expect(declarations).toEqual([
      { original_filename: "a.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 111 },
      { original_filename: "b.png", declared_mime_type: "image/png", declared_byte_size: 222 },
    ]);
    for (const d of declarations) {
      expect(d).not.toHaveProperty("file");
      expect(d).not.toHaveProperty("previewUrl");
      expect(d).not.toHaveProperty("id");
    }
  });

  it("preserves array order exactly (never sorts)", () => {
    const files = [localFile("z.jpg", "image/jpeg", 1), localFile("a.jpg", "image/jpeg", 2)];
    const declarations = buildOrderedFileDeclarations(files);
    expect(declarations.map((d) => d.original_filename)).toEqual(["z.jpg", "a.jpg"]);
  });
});

describe("computeQuoteSubmissionIdentity — hash/idempotency behavior", () => {
  it("produces the same payload hash for two calls with an identical normalized form and files", async () => {
    const values = baseSellerValues();
    const first = await computeQuoteSubmissionIdentity(values, sellerContext);
    const second = await computeQuoteSubmissionIdentity(baseSellerValues(), sellerContext);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.identity.payloadHash).toBe(second.identity.payloadHash);
  });

  it("treats equivalent phone formatting (per CHECKPOINT C2F-B) as the same identity", async () => {
    const plain = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhone: "0501234567" }),
      sellerContext,
    );
    const formatted = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhone: "+971 50 123 4567" }),
      sellerContext,
    );
    expect(plain.ok).toBe(true);
    expect(formatted.ok).toBe(true);
    if (!plain.ok || !formatted.ok) return;
    expect(plain.identity.payloadHash).toBe(formatted.identity.payloadHash);
  });

  it("produces a different hash when a material field changes", async () => {
    const a = await computeQuoteSubmissionIdentity(baseSellerValues({ material: "copper" }), sellerContext);
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ material: "aluminium" }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when the contact name changes", async () => {
    const a = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerName: "Ahmed Seller" }),
      sellerContext,
    );
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerName: "Different Name" }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when the location changes", async () => {
    const a = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerArea: "Al Quoz Industrial 3" }),
      sellerContext,
    );
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerArea: "A different area entirely" }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when the source changes", async () => {
    const a = await computeQuoteSubmissionIdentity(baseSellerValues(), { source: "hero" });
    const b = await computeQuoteSubmissionIdentity(baseSellerValues(), { source: "direct" });
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when file order changes", async () => {
    const fileA = localFile("a.jpg", "image/jpeg", 100);
    const fileB = localFile("b.jpg", "image/jpeg", 200);
    const forward = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [fileA, fileB] }),
      sellerContext,
    );
    const reversed = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [fileB, fileA] }),
      sellerContext,
    );
    if (!forward.ok || !reversed.ok) throw new Error("expected both to succeed");
    expect(forward.identity.payloadHash).not.toBe(reversed.identity.payloadHash);
  });

  it("produces a different hash when a file name changes", async () => {
    const a = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("a.jpg", "image/jpeg", 100)] }),
      sellerContext,
    );
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("different.jpg", "image/jpeg", 100)] }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when a file type changes", async () => {
    const a = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("a.jpg", "image/jpeg", 100)] }),
      sellerContext,
    );
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("a.jpg", "image/png", 100)] }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("produces a different hash when a file size changes", async () => {
    const a = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("a.jpg", "image/jpeg", 100)] }),
      sellerContext,
    );
    const b = await computeQuoteSubmissionIdentity(
      baseSellerValues({ sellerPhotos: [localFile("a.jpg", "image/jpeg", 999)] }),
      sellerContext,
    );
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.identity.payloadHash).not.toBe(b.identity.payloadHash);
  });

  it("works identically for the buyer branch", async () => {
    const result = await computeQuoteSubmissionIdentity(baseBuyerValues(), buyerContext);
    expect(result.ok).toBe(true);
  });
});

describe("resolveIdempotencyKey", () => {
  it("reuses the existing key when the payload hash is unchanged", () => {
    const key = resolveIdempotencyKey("a".repeat(64), {
      payloadHash: "a".repeat(64),
      idempotencyKey: "d0000000-0000-0000-0000-000000000001",
    });
    expect(key).toBe("d0000000-0000-0000-0000-000000000001");
  });

  it("generates a new key when the payload hash changes", () => {
    const key = resolveIdempotencyKey("b".repeat(64), {
      payloadHash: "a".repeat(64),
      idempotencyKey: "d0000000-0000-0000-0000-000000000001",
    });
    expect(key).not.toBe("d0000000-0000-0000-0000-000000000001");
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates a new key when there is no existing attempt", () => {
    const key = resolveIdempotencyKey("a".repeat(64), null);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
