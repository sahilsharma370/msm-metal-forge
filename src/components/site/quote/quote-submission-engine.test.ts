import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuoteSubmissionEngine, type QuoteSubmissionOutcome } from "./quote-submission-engine";
import { loadSubmissionAttempt } from "./quote-storage";
import type {
  QuoteTransport,
  InitiateTransportResult,
  UploadTransportResult,
  CompleteTransportResult,
  InitiateUploadSlot,
} from "./quote-submission-transport";
import type { QuoteFormValues, QuoteLocalFile } from "./quote-schema";
import type { QuoteInitialContext } from "./quote-search";

// ---------------------------------------------------------------------------
// sessionStorage stubbing — same pattern as quote-storage.test.ts, so the
// engine is exercised against the REAL persistence layer, not a fake.
// ---------------------------------------------------------------------------

function createMemoryStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function stubWindowWith(storage: Storage): void {
  vi.stubGlobal("window", { sessionStorage: storage } as unknown as Window & typeof globalThis);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Form-value / context fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fake transport builder
// ---------------------------------------------------------------------------

function slot(overrides: Partial<InitiateUploadSlot> & { slotIndex: number }): InitiateUploadSlot {
  return {
    slotId: `slot-${overrides.slotIndex}`,
    kind: "seller_photo",
    status: "pending",
    storagePath: `leads/lead-1/slot-${overrides.slotIndex}`,
    expiresAt: "2026-01-01T00:00:00.000Z",
    originalFilename: `file-${overrides.slotIndex}.jpg`,
    declaredMimeType: "image/jpeg",
    declaredByteSize: 100,
    ...overrides,
  };
}

function initiateOk(uploadSlots: InitiateUploadSlot[], overrides: { idempotentReplay?: boolean } = {}): InitiateTransportResult {
  return {
    ok: true,
    status: 200,
    data: {
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      idempotentReplay: overrides.idempotentReplay ?? false,
      uploadSlots,
    },
  };
}

function uploadOk(slotId: string, replayed = false): UploadTransportResult {
  return {
    ok: true,
    status: 200,
    data: { success: true, slotId, fileId: `file-for-${slotId}`, status: "verified", replayed },
  };
}

function completeOk(overrides: { alreadyCompleted?: boolean } = {}): CompleteTransportResult {
  return {
    ok: true,
    status: 200,
    data: {
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      alreadyCompleted: overrides.alreadyCompleted ?? false,
    },
  };
}

type InitiateFn = QuoteTransport["initiate"];
type UploadFn = QuoteTransport["upload"];
type CompleteFn = QuoteTransport["complete"];

interface FakeTransport extends QuoteTransport {
  initiate: ReturnType<typeof vi.fn<InitiateFn>>;
  upload: ReturnType<typeof vi.fn<UploadFn>>;
  complete: ReturnType<typeof vi.fn<CompleteFn>>;
}

function createFakeTransport(
  overrides: Partial<{ initiate: InitiateFn; upload: UploadFn; complete: CompleteFn }> = {},
): FakeTransport {
  return {
    initiate: vi.fn<InitiateFn>(overrides.initiate ?? (async () => initiateOk([]))),
    upload: vi.fn<UploadFn>(overrides.upload ?? (async (req) => uploadOk(req.slotId))),
    complete: vi.fn<CompleteFn>(overrides.complete ?? (async () => completeOk())),
  };
}

function freshStorage(): void {
  stubWindowWith(createMemoryStorage());
}

// ---------------------------------------------------------------------------
// A. Basic happy paths
// ---------------------------------------------------------------------------

describe("submit — valid seller, zero files", () => {
  it("skips uploads entirely and completes directly", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => initiateOk([]),
      complete: async () => completeOk({ alreadyCompleted: true }),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).not.toHaveBeenCalled();
    expect(transport.initiate).toHaveBeenCalledTimes(1);
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });
});

describe("submit — valid seller, multiple photos", () => {
  it("uploads every declared pending slot and completes", async () => {
    freshStorage();
    const photos = [localFile("a.jpg", "image/jpeg", 100), localFile("b.jpg", "image/jpeg", 200)];
    const slots = [
      slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 }),
      slot({ slotIndex: 1, slotId: "s1", originalFilename: "b.jpg", declaredByteSize: 200 }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: photos }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });
});

describe("submit — valid buyer, multiple documents", () => {
  it("uploads every declared pending slot and completes", async () => {
    freshStorage();
    const docs = [
      localFile("invoice.pdf", "application/pdf", 4096),
      localFile("receipt.jpg", "image/jpeg", 1024),
    ];
    const slots = [
      slot({ slotIndex: 0, slotId: "s0", kind: "buyer_document", originalFilename: "invoice.pdf", declaredMimeType: "application/pdf", declaredByteSize: 4096 }),
      slot({ slotIndex: 1, slotId: "s1", kind: "buyer_document", originalFilename: "receipt.jpg", declaredByteSize: 1024 }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseBuyerValues({ buyerDocuments: docs }),
      context: buyerContext,
    });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// B. Fresh attempt / initiate replay
// ---------------------------------------------------------------------------

describe("submit — fresh attempt", () => {
  it("persists a pre_initiate attempt before calling initiate for a genuinely new submission", async () => {
    freshStorage();
    let attemptDuringInitiate: string | undefined;
    const transport = createFakeTransport({
      initiate: async () => {
        attemptDuringInitiate = loadSubmissionAttempt().kind;
        return initiateOk([]);
      },
    });
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(attemptDuringInitiate).toBe("pre_initiate");
  });
});

describe("submit — initiate replay", () => {
  it("calling submit again for the same unchanged, still-incomplete form reuses the same idempotency key", async () => {
    freshStorage();
    // A pending slot with no matching local File never completes (stays at
    // needs_reselection), so the attempt is still there for the second call
    // to find and reuse — a fully-completing submission would legitimately
    // clear its attempt and mint a fresh key next time, which is a
    // different, already-covered scenario.
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const keysUsed: string[] = [];
    const transport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots, { idempotentReplay: keysUsed.length > 1 });
      },
    });

    const values = baseSellerValues();
    const first = await createQuoteSubmissionEngine({ transport }).submit({ values, context: sellerContext });
    expect(first.kind).toBe("needs_reselection");
    const second = await createQuoteSubmissionEngine({ transport }).submit({ values, context: sellerContext });
    expect(second.kind).toBe("needs_reselection");

    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });
});

// ---------------------------------------------------------------------------
// C. Authoritative slot status handling
// ---------------------------------------------------------------------------

describe("submit — verified slots are skipped", () => {
  it("never uploads a slot the server already reports as verified", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "verified", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).not.toHaveBeenCalled();
  });
});

describe("submit — pending slot with a matching File is uploaded", () => {
  it("uploads the pending slot and completes", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(1);
    const [uploadArgs] = transport.upload.mock.calls[0] as unknown as [{ slotId: string; file: File }];
    expect(uploadArgs.slotId).toBe("s0");
    expect(uploadArgs.file).toBe(photo.file);
  });
});

describe("submit — pending slot missing its File", () => {
  it("returns needs_reselection without calling upload or complete", async () => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [] }), context: sellerContext });

    expect(outcome.kind).toBe("needs_reselection");
    if (outcome.kind === "needs_reselection") {
      expect(outcome.slots).toEqual([
        { slotIndex: 0, slotId: "s0", declaration: { originalFilename: "a.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 100 } },
      ]);
    }
    expect(transport.upload).not.toHaveBeenCalled();
    expect(transport.complete).not.toHaveBeenCalled();
  });
});

describe("submit — mixed verified/pending slots", () => {
  it("skips the verified slot, uploads only the pending one, and completes", async () => {
    freshStorage();
    const photoB = localFile("b.jpg", "image/jpeg", 200);
    const slots = [
      slot({ slotIndex: 0, slotId: "s0", status: "verified", originalFilename: "a.jpg", declaredByteSize: 100 }),
      slot({ slotIndex: 1, slotId: "s1", status: "pending", originalFilename: "b.jpg", declaredByteSize: 200 }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [photoB] }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(1);
    const [uploadArgs] = transport.upload.mock.calls[0] as unknown as [{ slotId: string }];
    expect(uploadArgs.slotId).toBe("s1");
  });
});

describe("submit — uploading slot handling", () => {
  it("with a matching File present, attempts the upload (server-authoritative claim/reclaim, never assumed success locally)", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "uploading", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(transport.upload).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("success");
  });

  it("without a matching File, reports needs_reselection rather than guessing completion", async () => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "uploading", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [] }), context: sellerContext });

    expect(outcome.kind).toBe("needs_reselection");
    expect(transport.upload).not.toHaveBeenCalled();
  });

  it("a fresh (still-leased) claim reported by the upload endpoint surfaces as upload_in_progress, not a failure or restart", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "uploading", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => ({ ok: false, status: 409, code: "UPLOAD_IN_PROGRESS", message: "in progress", retryable: true }) satisfies UploadTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(outcome.kind).toBe("upload_in_progress");
    expect(transport.complete).not.toHaveBeenCalled();
  });
});

describe("submit — failed/expired slots return restart_required without creating a new lead", () => {
  it.each(["failed", "expired"] as const)("status=%s", async (status) => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status, originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("restart_required");
    if (outcome.kind === "restart_required") {
      expect(outcome.leadId).toBe("11111111-1111-1111-1111-111111111111");
      expect(outcome.slotId).toBe("s0");
    }
    expect(transport.upload).not.toHaveBeenCalled();
    expect(transport.complete).not.toHaveBeenCalled();
    // Exactly one initiate call — no second lead was ever created.
    expect(transport.initiate).toHaveBeenCalledTimes(1);
  });

  it("a slot discovered unavailable only when actually uploaded (SLOT_UNAVAILABLE) also surfaces restart_required, not a generic failure", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => ({ ok: false, status: 409, code: "SLOT_UNAVAILABLE", message: "gone", retryable: false }) satisfies UploadTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });
    expect(outcome.kind).toBe("restart_required");
  });
});

// ---------------------------------------------------------------------------
// D. Exact matching / isolation
// ---------------------------------------------------------------------------

describe("submit — correct file-to-slot matching", () => {
  it("never assigns the same duplicate-metadata File to two different slots", async () => {
    freshStorage();
    const declaration = { name: "dup.jpg", type: "image/jpeg", size: 100 };
    const fileA = localFile(declaration.name, declaration.type, declaration.size);
    const fileB = localFile(declaration.name, declaration.type, declaration.size);
    const slots = [
      slot({ slotIndex: 0, slotId: "s0", originalFilename: declaration.name, declaredByteSize: declaration.size }),
      slot({ slotIndex: 1, slotId: "s1", originalFilename: declaration.name, declaredByteSize: declaration.size }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [fileA, fileB] }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(2);
    const uploadedFiles = transport.upload.mock.calls.map((c) => (c[0] as { file: File }).file);
    expect(new Set(uploadedFiles).size).toBe(2); // each real File object used exactly once
  });
});

describe("submit — seller/buyer isolation", () => {
  it("a sell-intent submission never considers buyerDocuments for matching, even when it has files", async () => {
    freshStorage();
    const sellerPhoto = localFile("a.jpg", "image/jpeg", 100);
    const buyerDoc = localFile("a.jpg", "image/jpeg", 100); // identical metadata, wrong bucket
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [sellerPhoto], buyerDocuments: [buyerDoc] }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("success");
    const [uploadArgs] = transport.upload.mock.calls[0] as unknown as [{ file: File }];
    expect(uploadArgs.file).toBe(sellerPhoto.file);
  });
});

// ---------------------------------------------------------------------------
// E. Network / malformed-response / upload / completion failures
// ---------------------------------------------------------------------------

describe("submit — initiate network failure", () => {
  it("returns a retryable network_error and preserves the pre_initiate attempt", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "network_error" }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome).toEqual({ kind: "network_error", retryable: true });
    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");
  });
});

describe("submit — malformed initiate response", () => {
  it("is treated as a network_error outcome, never as success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "malformed_response" }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("network_error");
  });
});

describe("submit — upload failure midway", () => {
  it("stops without calling complete, and does not mark the failed slot verified locally", async () => {
    freshStorage();
    const photoA = localFile("a.jpg", "image/jpeg", 100);
    const photoB = localFile("b.jpg", "image/jpeg", 200);
    const slots = [
      slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 }),
      slot({ slotIndex: 1, slotId: "s1", originalFilename: "b.jpg", declaredByteSize: 200 }),
    ];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async (req: { slotId: string }) =>
        req.slotId === "s0"
          ? uploadOk("s0")
          : ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", retryable: false } satisfies UploadTransportResult),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [photoA, photoB] }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("upload_failed");
    expect(transport.complete).not.toHaveBeenCalled();

    const attempt = loadSubmissionAttempt();
    expect(attempt.kind).toBe("initiated");
    if (attempt.kind === "initiated") {
      expect(attempt.uploadSlots.find((s) => s.slotId === "s0")?.status).toBe("verified");
      expect(attempt.uploadSlots.find((s) => s.slotId === "s1")?.status).not.toBe("verified");
    }
  });
});

describe("submit — completion failure", () => {
  it("not_ready is reported distinctly and never as success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, status: 409, code: "NOT_READY", message: "not ready", retryable: true }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("not_ready");
    expect(loadSubmissionAttempt().kind).toBe("initiated"); // preserved, not cleared
  });

  it("a generic complete failure is reported as server_error, never as success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", retryable: true }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("server_error");
  });
});

// ---------------------------------------------------------------------------
// F. Resume scenarios
// ---------------------------------------------------------------------------

describe("submit — lost initiate response then resume", () => {
  it("a second submit() call after the first never received the initiate response still reaches success via server-side replay", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];

    // First attempt: initiate "succeeds" server-side but the browser never
    // sees the response (simulated as a network_error transport failure).
    const flakyTransport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "network_error" }) satisfies InitiateTransportResult,
    });
    const firstOutcome = await createQuoteSubmissionEngine({ transport: flakyTransport }).submit({ values, context: sellerContext });
    expect(firstOutcome.kind).toBe("network_error");
    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");

    // Resume: a fresh submit() call reuses the same idempotency key and this
    // time the (real, replaying) initiate call succeeds.
    const workingTransport = createFakeTransport({ initiate: async () => initiateOk(slots, { idempotentReplay: true }) });
    const secondOutcome = await createQuoteSubmissionEngine({ transport: workingTransport }).submit({ values, context: sellerContext });

    expect(secondOutcome.kind).toBe("success");
    const [firstArgs] = flakyTransport.initiate.mock.calls[0] as unknown as [{ idempotencyKey: string }];
    const [secondArgs] = workingTransport.initiate.mock.calls[0] as unknown as [{ idempotencyKey: string }];
    expect(firstArgs.idempotencyKey).toBe(secondArgs.idempotencyKey);
  });
});

describe("submit — lost completion response then resume", () => {
  it("a second submit() call safely re-confirms completion via the idempotent complete endpoint", async () => {
    freshStorage();
    const values = baseSellerValues();

    const firstTransport = createFakeTransport({
      complete: async () => ({ ok: false, transportFailure: "network_error" }) satisfies CompleteTransportResult,
    });
    const firstOutcome = await createQuoteSubmissionEngine({ transport: firstTransport }).submit({ values, context: sellerContext });
    expect(firstOutcome.kind).toBe("network_error");
    expect(loadSubmissionAttempt().kind).toBe("initiated"); // preserved — nothing was cleared

    const secondTransport = createFakeTransport({ complete: async () => completeOk({ alreadyCompleted: true }) });
    const secondOutcome = await createQuoteSubmissionEngine({ transport: secondTransport }).submit({ values, context: sellerContext });

    expect(secondOutcome.kind).toBe("success");
    if (secondOutcome.kind === "success") {
      expect(secondOutcome.alreadyCompleted).toBe(true);
    }
    expect(loadSubmissionAttempt().kind).toBe("none"); // cleared only after this genuine success
  });
});

// ---------------------------------------------------------------------------
// G. Single-flight / abort
// ---------------------------------------------------------------------------

describe("submit — duplicate-click/single-flight behavior", () => {
  it("a second concurrent submit() call shares the same in-flight result instead of starting a second run", async () => {
    freshStorage();
    let resolveInitiate!: (value: InitiateTransportResult) => void;
    const initiateGate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => initiateGate });
    const engine = createQuoteSubmissionEngine({ transport });

    const values = baseSellerValues();
    const first = engine.submit({ values, context: sellerContext });
    expect(engine.isSubmitting).toBe(true);
    const second = engine.submit({ values, context: sellerContext });

    resolveInitiate(initiateOk([]));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(transport.initiate).toHaveBeenCalledTimes(1);
    expect(engine.isSubmitting).toBe(false);
  });

  it("a new submit() after the previous one finished starts a genuinely new run", async () => {
    freshStorage();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });
    const values = baseSellerValues();

    await engine.submit({ values, context: sellerContext });
    await engine.submit({ values, context: sellerContext });

    expect(transport.initiate).toHaveBeenCalledTimes(2);
  });
});

describe("submit — abort", () => {
  it("aborting before any call starts returns aborted immediately, with no persistence", async () => {
    freshStorage();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });
    const controller = new AbortController();
    controller.abort();

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, signal: controller.signal });

    expect(outcome).toEqual({ kind: "aborted" });
    expect(transport.initiate).not.toHaveBeenCalled();
  });

  it("an abort surfaced by the transport during initiate returns aborted, not success or failure", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "aborted" }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });
    expect(outcome).toEqual({ kind: "aborted" });
  });

  it("an abort surfaced by the transport during upload returns aborted without calling complete", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => ({ ok: false, transportFailure: "aborted" }) satisfies UploadTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(outcome).toEqual({ kind: "aborted" });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("an abort surfaced by the transport during complete returns aborted, never success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, transportFailure: "aborted" }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });
    expect(outcome).toEqual({ kind: "aborted" });
  });
});

// ---------------------------------------------------------------------------
// H. No premature success
// ---------------------------------------------------------------------------

describe("submit — no premature genuine success", () => {
  it("never returns kind:success unless transport.complete itself returned ok:true", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      // upload succeeds, but complete is never actually called successfully
      complete: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "x", retryable: true }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    expect(outcome.kind).not.toBe("success");
    expect(transport.upload).toHaveBeenCalledTimes(1); // upload did happen
    expect(transport.complete).toHaveBeenCalledTimes(1); // complete was attempted
  });
});

// ---------------------------------------------------------------------------
// I. Attempt persistence/clearing + no storagePath persisted
// ---------------------------------------------------------------------------

describe("submit — attempt persistence/clearing rules", () => {
  it("clears the persisted attempt only after genuine completion", async () => {
    freshStorage();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("success");
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });

  it("preserves the attempt on a retryable initiate failure", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "x", retryable: true }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");
  });

  it("clears the attempt on an idempotency conflict so the next submit mints a fresh key", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", message: "conflict", retryable: false }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(outcome.kind).toBe("idempotency_conflict");
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });

  it("does not clear the attempt on restart_required — no automatic revival, no silent new lead", async () => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "failed", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext });

    expect(loadSubmissionAttempt().kind).toBe("initiated");
  });
});

describe("submit — no storagePath persisted", () => {
  it("the persisted initiated attempt never carries a storagePath key on any slot", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100, storagePath: "leads/lead-1/slot-0-secret" })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    // Fail at complete so the attempt is not cleared and we can inspect it.
    transport.complete.mockResolvedValue({
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "x",
      retryable: true,
    } satisfies CompleteTransportResult);

    await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext });

    const raw = window.sessionStorage.getItem("msm-quote-draft-v1") ?? "";
    expect(raw).not.toContain("storagePath");
    expect(raw).not.toContain("leads/lead-1/slot-0-secret");
  });
});

// ---------------------------------------------------------------------------
// J. No raw error/PII leakage
// ---------------------------------------------------------------------------

describe("submit — no raw error/PII leakage", () => {
  it("never logs to the console at any point during a full run, including failures", async () => {
    freshStorage();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "boom", retryable: true }) satisfies InitiateTransportResult,
    });
    await createQuoteSubmissionEngine({ transport }).submit({
      values: baseSellerValues({ sellerName: "Ahmed Seller", sellerPhone: "0501234567" }),
      context: sellerContext,
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("a network_error/server_error outcome never contains the customer's phone, name or a raw server message beyond the sanitized one already provided", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "network_error" }) satisfies InitiateTransportResult,
    });
    const outcome: QuoteSubmissionOutcome = await createQuoteSubmissionEngine({ transport }).submit({
      values: baseSellerValues({ sellerName: "Ahmed Seller", sellerPhone: "0501234567" }),
      context: sellerContext,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("Ahmed");
    expect(serialized).not.toContain("0501234567");
  });

  it("a validation_error outcome carries only field paths/messages, never the submitted values themselves", async () => {
    freshStorage();
    const transport = createFakeTransport();
    // submissionShapeSchema requires `intent` — an explicitly-missing one
    // fails shape validation inside computeQuoteSubmissionIdentity itself,
    // before any network call, unlike a merely badly-formatted phone number
    // (only checked server-side by checkSubmissionCompleteness, which this
    // engine correctly surfaces as a separate server_rejected outcome).
    const outcome = await createQuoteSubmissionEngine({ transport }).submit({
      values: baseSellerValues({ intent: undefined, sellerName: "Ahmed Seller", sellerPhone: "0501234567" }),
      context: sellerContext,
    });

    expect(outcome.kind).toBe("validation_error");
    expect(transport.initiate).not.toHaveBeenCalled();
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("Ahmed Seller");
    expect(serialized).not.toContain("notaphone");
  });
});
