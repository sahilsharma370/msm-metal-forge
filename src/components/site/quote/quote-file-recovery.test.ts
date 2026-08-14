import { describe, expect, it } from "vitest";
import {
  determineFileRecoveryStatus,
  determineSlotRecoveryStatus,
  doesFileMatchDeclaration,
  isSlotKnownVerified,
  type RecoverableFileDeclaration,
  type UploadSlotStatus,
} from "./quote-file-recovery";
import { selectRelevantLocalFiles } from "./quote-submission-identity";
import type { QuoteFormValues, QuoteLocalFile } from "./quote-schema";

function localFile(name: string, type: string, size: number): QuoteLocalFile {
  return {
    id: `${name}-${size}-fake-id`,
    file: new File([new Uint8Array(size)], name, { type }),
    previewUrl: `blob:fake-${name}`,
    name,
    size,
  };
}

const oneDeclaration: RecoverableFileDeclaration[] = [
  { originalFilename: "photo.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 12345 },
];

describe("determineFileRecoveryStatus", () => {
  it("reports none_intended when no files were declared", () => {
    expect(determineFileRecoveryStatus([], 0)).toEqual({ kind: "none_intended" });
  });

  it("reports lost when files were declared but no File objects are currently present (guaranteed true after any reload)", () => {
    expect(determineFileRecoveryStatus(oneDeclaration, 0)).toEqual({
      kind: "lost",
      declarations: oneDeclaration,
    });
  });

  it("reports present when files were declared and File objects are currently present", () => {
    expect(determineFileRecoveryStatus(oneDeclaration, 1)).toEqual({ kind: "present" });
  });

  it("reports none_intended even if currentFileCount is somehow nonzero with no declarations (declarations are authoritative for intent)", () => {
    expect(determineFileRecoveryStatus([], 3)).toEqual({ kind: "none_intended" });
  });
});

describe("doesFileMatchDeclaration", () => {
  const declaration: RecoverableFileDeclaration = {
    originalFilename: "receipt.pdf",
    declaredMimeType: "application/pdf",
    declaredByteSize: 500,
  };

  it("matches when name, type and size are all identical", () => {
    const file = new File([new Uint8Array(500)], "receipt.pdf", { type: "application/pdf" });
    expect(doesFileMatchDeclaration(file, declaration)).toBe(true);
  });

  it("does not match a different filename", () => {
    const file = new File([new Uint8Array(500)], "different.pdf", { type: "application/pdf" });
    expect(doesFileMatchDeclaration(file, declaration)).toBe(false);
  });

  it("does not match a different declared MIME type", () => {
    const file = new File([new Uint8Array(500)], "receipt.pdf", { type: "image/jpeg" });
    expect(doesFileMatchDeclaration(file, declaration)).toBe(false);
  });

  it("does not match a different byte size", () => {
    const file = new File([new Uint8Array(999)], "receipt.pdf", { type: "application/pdf" });
    expect(doesFileMatchDeclaration(file, declaration)).toBe(false);
  });

  it("a nonmatching reselected file must not be treated as filling that slot", () => {
    const wrongFile = new File([new Uint8Array(1)], "wrong.pdf", { type: "application/pdf" });
    const matches = doesFileMatchDeclaration(wrongFile, declaration);
    expect(matches).toBe(false);
    // The caller's contract: a false result here means "do not upload this
    // file to this slot" — asserted at the type/behavior level, not just
    // the boolean, so a future refactor can't silently invert the meaning.
    if (matches) throw new Error("must not be reached: a mismatched file must never be usable for this slot");
  });
});

describe("isSlotKnownVerified — CHECKPOINT C2F-C1 authoritative status", () => {
  it("returns true only for status === 'verified'", () => {
    expect(isSlotKnownVerified("verified")).toBe(true);
  });

  it("returns false for pending, uploading, failed and expired", () => {
    const nonVerified: UploadSlotStatus[] = ["pending", "uploading", "failed", "expired"];
    for (const status of nonVerified) {
      expect(isSlotKnownVerified(status)).toBe(false);
    }
  });

  it("never infers verified from anything other than the status argument itself — no reference/local-state shortcut exists in this function's signature", () => {
    // isSlotKnownVerified takes only a status value — there is no leadId,
    // reference or other local-state parameter it could even read, so
    // "inferred from local state" is structurally impossible here, not
    // merely avoided by convention.
    expect(isSlotKnownVerified.length).toBe(1);
  });
});

describe("determineSlotRecoveryStatus — CHECKPOINT C2F-C1 status-driven recovery", () => {
  const declaration: RecoverableFileDeclaration = {
    originalFilename: "photo.jpg",
    declaredMimeType: "image/jpeg",
    declaredByteSize: 12345,
  };

  it("verified slot is skipped (never needs reselection), regardless of local file presence", () => {
    expect(determineSlotRecoveryStatus("verified", declaration, 0)).toEqual({ kind: "verified" });
    expect(determineSlotRecoveryStatus("verified", declaration, 1)).toEqual({ kind: "verified" });
  });

  it("pending slot with no local file requests reselection", () => {
    expect(determineSlotRecoveryStatus("pending", declaration, 0)).toEqual({
      kind: "needs_reselection",
      declaration,
    });
  });

  it("pending slot with a local file present is reported as present, not requested again", () => {
    expect(determineSlotRecoveryStatus("pending", declaration, 1)).toEqual({ kind: "present" });
  });

  it("uploading is represented as its own in-progress state, never guessed complete and never folded into needs_reselection", () => {
    const result = determineSlotRecoveryStatus("uploading", declaration, 0);
    expect(result).toEqual({ kind: "uploading" });
    expect(result.kind).not.toBe("verified");
    expect(result.kind).not.toBe("needs_reselection");
  });

  it("failed is represented as restart_required, carrying the original declaration for display, never a plain reselection prompt", () => {
    expect(determineSlotRecoveryStatus("failed", declaration, 0)).toEqual({
      kind: "restart_required",
      declaration,
    });
  });

  it("expired is represented as restart_required, distinct from failed only by the input status, never conflated with needs_reselection", () => {
    const result = determineSlotRecoveryStatus("expired", declaration, 0);
    expect(result).toEqual({ kind: "restart_required", declaration });
    expect(result.kind).not.toBe("needs_reselection");
  });

  it("introduces no fake reset/revival behavior: failed/expired never becomes present or needs_reselection even with a local file currently selected", () => {
    expect(determineSlotRecoveryStatus("failed", declaration, 1)).toEqual({
      kind: "restart_required",
      declaration,
    });
    expect(determineSlotRecoveryStatus("expired", declaration, 1)).toEqual({
      kind: "restart_required",
      declaration,
    });
  });

  it("mixed partial-upload recovery: each slot's own status is independently reflected, never conflated across slots", () => {
    const slots: { status: UploadSlotStatus; currentFileCount: number }[] = [
      { status: "verified", currentFileCount: 0 },
      { status: "pending", currentFileCount: 0 },
      { status: "uploading", currentFileCount: 0 },
      { status: "failed", currentFileCount: 0 },
    ];
    const results = slots.map((s) => determineSlotRecoveryStatus(s.status, declaration, s.currentFileCount));
    expect(results.map((r) => r.kind)).toEqual([
      "verified",
      "needs_reselection",
      "uploading",
      "restart_required",
    ]);
  });
});

describe("seller/buyer file-kind isolation (via selectRelevantLocalFiles)", () => {
  function values(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
    return { sellerPhotos: [], buyerDocuments: [], ...overrides };
  }

  it("a sell-intent recovery status is computed only from sellerPhotos, never buyerDocuments", () => {
    const sellerPhoto = localFile("s.jpg", "image/jpeg", 10);
    const buyerDoc = localFile("b.pdf", "application/pdf", 20);
    const form = values({ sellerPhotos: [], buyerDocuments: [buyerDoc] });
    const relevant = selectRelevantLocalFiles(form, "sell");
    const status = determineFileRecoveryStatus(oneDeclaration, relevant.length);
    // sellerPhotos is empty even though buyerDocuments has one file — a
    // sell-intent recovery check must still see "lost", not "present",
    // proving buyerDocuments was never consulted.
    expect(status).toEqual({ kind: "lost", declarations: oneDeclaration });
    expect(sellerPhoto).toBeDefined(); // fixture sanity, unused on purpose
  });

  it("a buy-intent recovery status is computed only from buyerDocuments, never sellerPhotos", () => {
    const sellerPhoto = localFile("s.jpg", "image/jpeg", 10);
    const form = values({ sellerPhotos: [sellerPhoto], buyerDocuments: [] });
    const relevant = selectRelevantLocalFiles(form, "buy");
    const status = determineFileRecoveryStatus(oneDeclaration, relevant.length);
    expect(status).toEqual({ kind: "lost", declarations: oneDeclaration });
  });
});
