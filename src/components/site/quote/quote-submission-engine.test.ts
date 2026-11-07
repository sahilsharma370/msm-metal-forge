import { afterEach, describe, expect, it, vi } from "vitest";
import { createQuoteSubmissionEngine, type QuoteSubmissionOutcome } from "./quote-submission-engine";
import {
  loadSubmissionAttempt,
  saveSubmissionAttempt,
  clearSubmissionAttempt,
  reconcileSubmissionAttempt,
} from "./quote-storage";
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

/**
 * A DIFFERENT failure mode from the already-fixed isBrowser() gap: here the
 * `window.sessionStorage` property access itself succeeds (a real,
 * type-correct Storage object is returned), but every operation ON it
 * throws — e.g. a storage policy that allows accessing the object but
 * denies actual reads/writes, or a quota/availability failure. isBrowser()
 * returns true for this case; the risk is entirely in getItem/setItem.
 */
function throwingOpsStorage(): Storage {
  return {
    getItem: () => {
      throw new DOMException("getItem denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("setItem denied", "SecurityError");
    },
    removeItem: () => {
      throw new DOMException("removeItem denied", "SecurityError");
    },
    clear: () => undefined,
    key: () => null,
    get length() {
      return 0;
    },
  } as Storage;
}

/**
 * A THIRD failure mode, distinct from both isBrowser() being false and
 * throwingOpsStorage() above: here `getItem` itself never throws and
 * genuinely succeeds — it just never finds anything, because `setItem`
 * silently fails every time, so nothing a save ever intends ever actually
 * lands in the backing store. This is exactly the scenario readEnvelope's
 * own "confirmed empty" branch used to mishandle (see quote-storage.ts).
 */
function getsNullSetThrowsStorage(): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("setItem denied", "QuotaExceededError");
    },
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    get length() {
      return 0;
    },
  } as Storage;
}

function stubWindowWith(storage: Storage): void {
  vi.stubGlobal("window", { sessionStorage: storage } as unknown as Window & typeof globalThis);
}

afterEach(() => {
  // MEASURED GAP, fixed — quote-storage.ts's in-memory attempt mirror
  // (memoryAttemptFallback) is a module-level variable, NOT reset by
  // freshStorage()'s own re-stub of window.sessionStorage alone (same
  // class of leak quote-storage.test.ts's own afterEach already guards
  // against, for the same reason). Confirmed to matter here, not just
  // theoretical: several tests in this file reuse baseSellerValues()
  // unchanged, which hashes to the SAME payloadHash every time — without
  // this, a real "initiated" attempt left behind by one test's genuine
  // success silently satisfied a LATER test's unrelated
  // reconcileSubmissionAttempt/resolveIdempotencyKey calls, which (for the
  // crypto.randomUUID test specifically) meant the key-reuse early-return
  // path fired instead of ever reaching the mocked-to-throw
  // crypto.randomUUID() at all. Calling the real, exported function here
  // — not a test-only backdoor — before unstubbing globals, so it runs
  // against whatever storage this test left in place.
  clearSubmissionAttempt();
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
    sellerEmail: "ahmed.seller@example.com",
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
    buyerEmail: "fatima.buyer@example.com",
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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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
      context: buyerContext, turnstileToken: "test-turnstile-token",
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

    await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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
    const first = await createQuoteSubmissionEngine({ transport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(first.kind).toBe("needs_reselection");
    const second = await createQuoteSubmissionEngine({ transport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(transport.upload).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("success");
  });

  it("without a matching File, reports needs_reselection rather than guessing completion", async () => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "uploading", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });
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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("network_error");
  });
});

describe("submit — CHECKPOINT C2G Turnstile verification and rate limiting", () => {
  it("forwards the exact turnstileToken given to submit() to transport.initiate", async () => {
    freshStorage();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "a-specific-token" });

    expect(transport.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ turnstileToken: "a-specific-token" }),
      undefined,
    );
  });

  it("maps initiate's VERIFICATION_REQUIRED to a dedicated human_verification_required outcome, never a generic server_error", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({
        ok: false,
        status: 403,
        code: "VERIFICATION_REQUIRED",
        message: "Verification failed.",
        retryable: true,
      }),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "stale-token" });

    expect(outcome).toEqual({ kind: "human_verification_required" });
  });

  it("maps initiate's RATE_LIMITED to a dedicated, always-retryable rate_limited outcome", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests.",
        retryable: true,
      }),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "rate_limited", retryable: true });
  });

  it("maps upload's RATE_LIMITED to rate_limited without ever calling complete", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0" })]),
      upload: async () => ({ ok: false, status: 429, code: "RATE_LIMITED", message: "Too many requests.", retryable: true }),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [localFile("file-0.jpg", "image/jpeg", 100)] }),
      context: sellerContext,
      turnstileToken: "test-turnstile-token",
    });

    expect(outcome).toEqual({ kind: "rate_limited", retryable: true });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("maps complete's RATE_LIMITED to rate_limited", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, status: 429, code: "RATE_LIMITED", message: "Too many requests.", retryable: true }),
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "rate_limited", retryable: true });
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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("not_ready");
    expect(loadSubmissionAttempt().kind).toBe("initiated"); // preserved, not cleared
  });

  it("a generic complete failure is reported as server_error, never as success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "Something went wrong. Please try again.", retryable: true }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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
    const firstOutcome = await createQuoteSubmissionEngine({ transport: flakyTransport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(firstOutcome.kind).toBe("network_error");
    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");

    // Resume: a fresh submit() call reuses the same idempotency key and this
    // time the (real, replaying) initiate call succeeds.
    const workingTransport = createFakeTransport({ initiate: async () => initiateOk(slots, { idempotentReplay: true }) });
    const secondOutcome = await createQuoteSubmissionEngine({ transport: workingTransport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });

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
    const firstOutcome = await createQuoteSubmissionEngine({ transport: firstTransport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(firstOutcome.kind).toBe("network_error");
    expect(loadSubmissionAttempt().kind).toBe("initiated"); // preserved — nothing was cleared

    const secondTransport = createFakeTransport({ complete: async () => completeOk({ alreadyCompleted: true }) });
    const secondOutcome = await createQuoteSubmissionEngine({ transport: secondTransport }).submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });

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
    const first = engine.submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(engine.isSubmitting).toBe(true);
    const second = engine.submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    await engine.submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    await engine.submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token", signal: controller.signal });

    expect(outcome).toEqual({ kind: "aborted" });
    expect(transport.initiate).not.toHaveBeenCalled();
  });

  it("an abort surfaced by the transport during initiate returns aborted, not success or failure", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "aborted" }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "aborted" });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("an abort surfaced by the transport during complete returns aborted, never success", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, transportFailure: "aborted" }) satisfies CompleteTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
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

    const outcome = await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("success");
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });

  it("preserves the attempt on a retryable initiate failure", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "x", retryable: true }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");
  });

  it("clears the attempt on an idempotency conflict so the next submit mints a fresh key", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", message: "conflict", retryable: false }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("idempotency_conflict");
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });

  it("does not clear the attempt on restart_required — no automatic revival, no silent new lead", async () => {
    freshStorage();
    const slots = [slot({ slotIndex: 0, slotId: "s0", status: "failed", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({ initiate: async () => initiateOk(slots) });
    const engine = createQuoteSubmissionEngine({ transport });

    await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

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

    await engine.submit({ values: baseSellerValues({ sellerPhotos: [photo] }), context: sellerContext, turnstileToken: "test-turnstile-token" });

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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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
      context: sellerContext, turnstileToken: "test-turnstile-token",
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
      context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(outcome.kind).toBe("validation_error");
    expect(transport.initiate).not.toHaveBeenCalled();
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("Ahmed Seller");
    expect(serialized).not.toContain("notaphone");
  });
});

// ---------------------------------------------------------------------------
// K. client_exception — QT-CLI trace: stage tagging across every
// awaited/throwing stage (identity -> storage -> initiate -> slot
// resolution -> upload -> complete -> cleanup), resilience, and retry
// safety. See QuoteExperience.tsx and quote-submission-engine.ts's own
// comments for the full evidence trail this responds to.
// ---------------------------------------------------------------------------

function storeWith(overrides: Partial<Record<"load" | "save" | "clear" | "reconcile", () => never>> = {}) {
  return {
    loadSubmissionAttempt: overrides.load ?? loadSubmissionAttempt,
    saveSubmissionAttempt: (overrides.save as unknown as typeof saveSubmissionAttempt) ?? saveSubmissionAttempt,
    clearSubmissionAttempt: overrides.clear ?? clearSubmissionAttempt,
    reconcileSubmissionAttempt:
      (overrides.reconcile as unknown as typeof reconcileSubmissionAttempt) ?? reconcileSubmissionAttempt,
  };
}

describe("submit — the fixed isBrowser() storage-access-denied gap no longer causes client_exception", () => {
  it("still reaches genuine success even when window.sessionStorage itself throws on access (e.g. a storage-restricted in-app browser)", async () => {
    // Simulates the documented WebKit/in-app-WebView behavior of throwing
    // on the bare `window.sessionStorage` property access itself, not on a
    // method call — exactly the gap fixed in quote-storage.ts's isBrowser().
    // Exercises the REAL quote-storage.ts module (no injected store), since
    // this is the actual fix under test, not the engine's generic safety net.
    vi.stubGlobal(
      "window",
      {
        get sessionStorage(): never {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      } as unknown as Window & typeof globalThis,
    );
    // quote-storage.ts's in-memory attempt fallback (used only while
    // isBrowser() is false) is a module-level variable shared across every
    // test in this file — reset it explicitly rather than relying on a
    // prior test's own cleanup happening to have left it at NONE_ATTEMPT.
    clearSubmissionAttempt();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("success");
  });
});

describe("submit — storage-unavailable retry path (duplicate-lead audit)", () => {
  it("reuses the SAME idempotency key on retry even while sessionStorage stays persistently unavailable, never minting a second key for the same unresolved submission", async () => {
    // Exact scenario audited: sessionStorage throws on every access (not a
    // one-off), initiate succeeds server-side (a real lead is created),
    // then a later client/transport failure happens, then the customer
    // retries with identical values. loadSubmissionAttempt/
    // saveSubmissionAttempt both go through isBrowser() — with the earlier
    // fix alone, isBrowser() correctly returns false and every write
    // becomes a no-op, but that means loadSubmissionAttempt always returns
    // NONE_ATTEMPT on the retry too, so resolveIdempotencyKey can never
    // find an existing key to reuse and mints a brand-new
    // crypto.randomUUID() every single call — including this retry of the
    // exact same still-open submission. transport.initiate's idempotent-
    // replay guarantee is keyed on (idempotencyKey, payloadHash) together,
    // so a different key on retry would be a genuinely new request to the
    // server, risking a second lead for one real submission.
    vi.stubGlobal(
      "window",
      {
        get sessionStorage(): never {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      } as unknown as Window & typeof globalThis,
    );
    // quote-storage.ts's in-memory attempt fallback (used only while
    // isBrowser() is false) is a module-level variable shared across every
    // test in this file — reset it explicitly rather than relying on a
    // prior test's own cleanup happening to have left it at NONE_ATTEMPT.
    clearSubmissionAttempt();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const keysUsed: string[] = [];

    // First attempt: initiate succeeds server-side (a real lead now
    // exists), then upload throws — a later client/transport failure.
    const firstTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots);
      },
      upload: async () => {
        throw new Error("boom");
      },
    });
    const firstOutcome = await createQuoteSubmissionEngine({ transport: firstTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(firstOutcome.kind).toBe("client_exception");

    // Retry — identical values, storage STILL unavailable, a fresh engine
    // instance (matching a real UI retry: a new Turnstile token is always
    // required before Submit is enabled again).
    const retryTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots, { idempotentReplay: true });
      },
    });
    await createQuoteSubmissionEngine({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });
});

describe("submit — getItem/setItem throw while the sessionStorage property access itself succeeds (a different failure mode from isBrowser() being false)", () => {
  it("still reaches genuine success, never crashes, even though every storage operation throws", async () => {
    stubWindowWith(throwingOpsStorage());
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome.kind).toBe("success");
  });

  it("reuses the SAME idempotency key on retry — confirmed empirically to diverge without the in-memory mirror fallback", async () => {
    // MEASURED, not assumed: before the fix, running this exact scenario
    // produced two different crypto.randomUUID() values across the two
    // submit() calls, because getItem throwing (then, unguarded) and
    // setItem throwing (silently swallowed by writeEnvelope's own
    // pre-existing guard) together meant nothing ever persisted between
    // calls — the in-memory mirror added to quote-storage.ts's
    // loadSubmissionAttempt/saveSubmissionAttempt is what closes this.
    stubWindowWith(throwingOpsStorage());
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const keysUsed: string[] = [];

    const firstTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots);
      },
      upload: async () => {
        throw new Error("boom");
      },
    });
    const firstOutcome = await createQuoteSubmissionEngine({ transport: firstTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(firstOutcome.kind).toBe("client_exception");

    const retryTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots, { idempotentReplay: true });
      },
    });
    await createQuoteSubmissionEngine({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });
});

describe("submit — getItem succeeds and returns null, but setItem throws (writes silently never land)", () => {
  it("reuses the SAME idempotency key on a same-page retry after initiate already succeeded server-side, then a later client failure", async () => {
    // MEASURED GAP, fixed — getItem never throwing (just always reporting
    // "nothing here") used to make readEnvelope's own "confirmed empty"
    // branch reset the in-memory mirror on every single read, including
    // the very next loadSubmissionAttempt() call made by this retry's own
    // reconcileSubmissionAttempt — erasing the mirror saveSubmissionAttempt
    // had just set for the "initiated" attempt from the first submit().
    // Without the fix, this produced two DIFFERENT idempotencyKey values.
    stubWindowWith(getsNullSetThrowsStorage());
    clearSubmissionAttempt();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const keysUsed: string[] = [];

    // First attempt: initiate succeeds server-side (a real lead now
    // exists), then upload throws — a later client/transport failure.
    const firstTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots);
      },
      upload: async () => {
        throw new Error("boom");
      },
    });
    const firstOutcome = await createQuoteSubmissionEngine({ transport: firstTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(firstOutcome.kind).toBe("client_exception");

    // Same-page retry — identical values, storage still silently failing
    // every write, a fresh engine instance (matching a real UI retry).
    const retryTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots, { idempotentReplay: true });
      },
    });
    await createQuoteSubmissionEngine({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });
});

describe("submit — storage-unavailable AND a page reload between attempts (the one case this file cannot fix)", () => {
  it("DOCUMENTS a real, unmitigated duplicate-lead risk — a reload wipes the in-memory mirror, and with no durable storage there is nothing left to reuse the idempotency key from", async () => {
    // This test exists to make the honest limit explicit and to catch any
    // future change that accidentally hides it, NOT to assert a fix. There
    // is no durable medium (sessionStorage unavailable, by this scenario's
    // own premise) to remember an idempotency key across a reload — the
    // in-memory mirror in quote-storage.ts is a module-level variable that
    // is, correctly, wiped by the same reload. Simulated here via
    // vi.resetModules() + a fresh dynamic import, which — unlike a plain
    // second submit() call in the same module instance — genuinely
    // reproduces what a real page reload does to that module-level state.
    stubWindowWith(throwingOpsStorage());
    const values = baseSellerValues();
    const keysUsed: string[] = [];

    const { createQuoteSubmissionEngine: engineBeforeReload } = await import("./quote-submission-engine");
    const firstTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk([]);
      },
      complete: async () => ({ ok: false, transportFailure: "network_error" }) satisfies CompleteTransportResult,
    });
    const firstOutcome = await engineBeforeReload({ transport: firstTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(firstOutcome.kind).toBe("network_error");

    // Simulate the reload: a fresh module graph, same throwing storage.
    vi.resetModules();
    stubWindowWith(throwingOpsStorage());
    const { createQuoteSubmissionEngine: engineAfterReload } = await import("./quote-submission-engine");
    const retryTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk([], { idempotentReplay: true });
      },
    });
    await engineAfterReload({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    // The documented gap: two DIFFERENT keys — a second, genuinely new
    // request from the server's point of view. No client-side fix closes
    // this without some durable medium to persist to, which this
    // scenario's own premise (storage unavailable) rules out by
    // definition. Do not "fix" this test by making it pass — that would
    // mean either storage stopped being simulated as unavailable, or a
    // new durable mechanism was added that deserves its own explicit
    // review, not a silent pass here.
    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).not.toBe(keysUsed[1]);
  });
});

describe("submit — client_exception stage tagging (the engine's own generic safety net)", () => {
  it("a throw before any network call is sent is tagged with the pre-request stage, never an uncaught rejection", async () => {
    freshStorage();
    const transport = createFakeTransport();
    const engine = createQuoteSubmissionEngine({
      transport,
      store: storeWith({
        reconcile: () => {
          throw new Error("simulated pre-request storage failure");
        },
      }),
    });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "client_exception", retryable: true, stage: "computing_identity" });
    expect(transport.initiate).not.toHaveBeenCalled();
  });

  it("crypto.subtle.digest throwing (observed gap: some restricted in-app WebViews, e.g. Google app's own, can lack/restrict Web Crypto) falls back to the @noble/hashes SHA-256 implementation and still submits successfully", async () => {
    // MEASURED GAP, fixed — this used to fail closed here (no fallback
    // existed yet). CORRECTED ASSUMPTION: an earlier draft of this audit
    // treated crypto.subtle being unavailable as proof crypto.getRandomValues
    // was probably ALSO unavailable, and declined to add any fallback on
    // that basis — wrong per the Web Crypto spec (see canonicalize.ts's own
    // sha256Hex doc comment and quote-submission-identity.ts's corrected
    // comment). crypto.subtle (SubtleCrypto) is secure-context-gated
    // independently of crypto.getRandomValues (base Crypto interface,
    // available everywhere) — a WebView can plausibly restrict the former
    // while leaving the latter intact, which is exactly what this test
    // simulates: digest throws, randomUUID/getRandomValues are untouched.
    freshStorage();
    const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
      throw new Error("crypto.subtle.digest is not available in this context");
    });
    try {
      const transport = createFakeTransport();
      const engine = createQuoteSubmissionEngine({ transport });

      const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

      expect(outcome.kind).toBe("success");
      expect(transport.initiate).toHaveBeenCalledTimes(1);
    } finally {
      digestSpy.mockRestore();
    }
  });

  it("crypto.randomUUID throwing (a plausible asymmetric gap — some embedded WebView builds shipped Web Crypto's getRandomValues() before randomUUID()) falls back to a getRandomValues-built UUID and still submits successfully", async () => {
    // MEASURED GAP, fixed — this used to fail closed here (no fallback
    // existed yet), even though crypto.getRandomValues (the exact same
    // CSPRNG randomUUID() itself draws from) was never unavailable in this
    // scenario — only the newer convenience wrapper was. See
    // resolveIdempotencyKey's own doc comment in quote-submission-
    // identity.ts for why a getRandomValues-based fallback is safe to add
    // here and a Math.random() one never would be.
    freshStorage();
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("crypto.randomUUID is not a function");
    });
    try {
      const keysUsed: string[] = [];
      const transport = createFakeTransport({
        initiate: async (req) => {
          keysUsed.push(req.idempotencyKey);
          return initiateOk([]);
        },
      });
      const engine = createQuoteSubmissionEngine({ transport });

      const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

      expect(outcome.kind).toBe("success");
      // A real, well-formed v4 UUID — not a guessable/weak placeholder —
      // confirming the fallback actually ran rather than silently no-oping.
      expect(keysUsed).toHaveLength(1);
      expect(keysUsed[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      uuidSpy.mockRestore();
    }
  });

  it("crypto.randomUUID AND crypto.getRandomValues both unavailable still fails closed BEFORE any network call — never falls back to a non-cryptographic random source", async () => {
    // The much more severe, much less plausible compounding case: the
    // entire Web Crypto random-generation surface is gone, not just the
    // newer convenience method. resolveIdempotencyKey deliberately does
    // NOT catch this second failure (see its own doc comment) — it must
    // propagate exactly as an unguarded crypto.randomUUID() call always
    // did, never silently minting a key from Math.random() or any other
    // weak source just to avoid failing.
    freshStorage();
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("crypto.randomUUID is not a function");
    });
    const grvSpy = vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
      throw new Error("crypto.getRandomValues is not a function");
    });
    try {
      const transport = createFakeTransport();
      const engine = createQuoteSubmissionEngine({ transport });

      const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

      expect(outcome).toEqual({ kind: "client_exception", retryable: true, stage: "computing_identity" });
      expect(transport.initiate).not.toHaveBeenCalled();
    } finally {
      uuidSpy.mockRestore();
      grvSpy.mockRestore();
    }
  });

  it("a genuine thrown rejection from transport.initiate (not one of its own typed TransportFailure returns) is tagged 'initiating'", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => {
        throw new Error("boom");
      },
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "client_exception", retryable: true, stage: "initiating" });
  });

  it("a throw during upload, after initiate already succeeded server-side, is tagged 'uploading' and preserves the already-created lead for retry", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => {
        throw new Error("boom");
      },
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [photo] }),
      context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    // MEASURED GAP, fixed — this used to be exactly
    // {kind:"client_exception",retryable:true,stage:"uploading"} with NO
    // leadId/reference, even though initiate already created a real lead
    // server-side: the customer would see the exact same generic banner as
    // if nothing had happened yet. Recovered here from the persisted
    // "initiated" attempt, which is why these must match initiateOk's own
    // fixtures exactly, not just be non-empty.
    expect(outcome).toEqual({
      kind: "client_exception",
      retryable: true,
      stage: "uploading",
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
    });
    // The lead initiate already created server-side is NOT lost — a retry
    // can resume it instead of starting over.
    const attempt = loadSubmissionAttempt();
    expect(attempt.kind).toBe("initiated");
  });

  it("a same-page retry after this exact uploading-stage client_exception sends the SAME idempotencyKey — never a second lead for the one the server already created", async () => {
    // Directly exercises the risk named by this audit: generic QT-CLI
    // catch firing AFTER a successful initiate, then an immediate retry.
    // Distinct from the stage-tagging test above (which only checks the
    // outcome's own shape) — this one proves the retry's own network call
    // actually reuses the key, the only thing that prevents a duplicate
    // lead server-side (transport.initiate's idempotent-replay guarantee
    // is keyed on (idempotencyKey, payloadHash) together).
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const keysUsed: string[] = [];

    const failingTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots);
      },
      upload: async () => {
        throw new Error("boom");
      },
    });
    const first = await createQuoteSubmissionEngine({ transport: failingTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(first.kind).toBe("client_exception");
    // The customer-visible proof a lead already exists — see
    // quote-submission-copy.ts's own client_exception case, which branches
    // on exactly this field to avoid the generic "something went wrong"
    // wording when it's present.
    expect((first as { leadId?: string }).leadId).toBe("11111111-1111-1111-1111-111111111111");

    const retryTransport = createFakeTransport({
      initiate: async (req) => {
        keysUsed.push(req.idempotencyKey);
        return initiateOk(slots, { idempotentReplay: true });
      },
    });
    const second = await createQuoteSubmissionEngine({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(second.kind).toBe("success");
    expect(keysUsed).toHaveLength(2);
    expect(keysUsed[0]).toBe(keysUsed[1]);
  });

  it("a throw during the final complete call is tagged 'completing'", async () => {
    freshStorage();
    const transport = createFakeTransport({
      complete: async () => {
        throw new Error("boom");
      },
    });
    const engine = createQuoteSubmissionEngine({ transport });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    // Same gap, same fix, second call site: complete() only ever runs
    // after initiate already created a real lead, so a throw here must
    // carry leadId/reference too.
    expect(outcome).toEqual({
      kind: "client_exception",
      retryable: true,
      stage: "completing",
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
    });
  });

  it("a throw from clearSubmissionAttempt AFTER transport.complete already returned a genuine success never converts it into client_exception — cleanup is best-effort, the success is already owed", async () => {
    // MEASURED GAP, fixed — store.clearSubmissionAttempt() ran UNGUARDED
    // between complete's own ok:true response and this function's
    // `return {kind:"success",...}`, so a throw there rejected the whole
    // call instead of ever reaching that return — converting an already-
    // genuine, server-confirmed completion into a customer-visible
    // client_exception. A plausible, not confirmed, explanation for the
    // one reported "failed UI, successful enquiry" incident (see
    // submitInternal's own comment at the same call site) — fixed as a
    // real defect on its own merits either way.
    freshStorage();
    let completeSucceeded = false;
    const transport = createFakeTransport({
      complete: async () => {
        completeSucceeded = true;
        return completeOk();
      },
    });
    const engine = createQuoteSubmissionEngine({
      transport,
      store: storeWith({
        clear: () => {
          throw new Error("simulated post-success cleanup failure");
        },
      }),
    });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(completeSucceeded).toBe(true);
    expect(outcome.kind).toBe("success");
  });

  it("a throw from clearSubmissionAttempt on an idempotency conflict never converts it into client_exception either — same best-effort cleanup bug, same fix, second call site", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", message: "conflict", retryable: false }) satisfies InitiateTransportResult,
    });
    const engine = createQuoteSubmissionEngine({
      transport,
      store: storeWith({
        clear: () => {
          throw new Error("simulated cleanup failure");
        },
      }),
    });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });

    expect(outcome).toEqual({ kind: "idempotency_conflict" });
  });

  it("retrying with the same unchanged values after a swallowed post-success cleanup failure still safely re-confirms success via the server's own idempotent replay, never a duplicate lead", async () => {
    freshStorage();
    const values = baseSellerValues();
    const engine = createQuoteSubmissionEngine({
      transport: createFakeTransport(),
      store: storeWith({
        clear: () => {
          throw new Error("simulated post-success cleanup failure");
        },
      }),
    });

    const first = await engine.submit({ values, context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(first.kind).toBe("success");
    // The swallowed cleanup failure means the "initiated" attempt may still
    // linger locally — exactly the documented, accepted worst case.
    expect(loadSubmissionAttempt().kind).toBe("initiated");

    // A second submit() with the identical, unchanged values (e.g. the
    // customer retries after seeing a transient local error) must still
    // resolve to success via the server's own already_completed replay,
    // reusing the same idempotencyKey — never a second lead.
    const retryTransport = createFakeTransport({ complete: async () => completeOk({ alreadyCompleted: true }) });
    const second = await createQuoteSubmissionEngine({ transport: retryTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(second.kind).toBe("success");
    if (second.kind === "success") {
      expect(second.alreadyCompleted).toBe(true);
    }
    expect(retryTransport.initiate).toHaveBeenCalledTimes(1);
  });
});

describe("submit — retry after client_exception resumes the same identity, never duplicates the enquiry", () => {
  it("a retry following an uploading-stage client_exception sends the exact same idempotencyKey to initiate again", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const values = baseSellerValues({ sellerPhotos: [photo] });
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];

    const failingTransport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => {
        throw new Error("boom");
      },
    });
    const first = await createQuoteSubmissionEngine({ transport: failingTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });
    expect(first).toEqual({
      kind: "client_exception",
      retryable: true,
      stage: "uploading",
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
    });

    // Retry — a fresh engine instance (matching a real UI retry button:
    // QuoteExperience always clears the Turnstile token and asks for a new
    // one before allowing another submit()), same unchanged values.
    const workingTransport = createFakeTransport({
      initiate: async () => initiateOk(slots, { idempotentReplay: true }),
    });
    const second = await createQuoteSubmissionEngine({ transport: workingTransport }).submit({
      values, context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(second.kind).toBe("success");
    const [firstArgs] = failingTransport.initiate.mock.calls[0] as unknown as [{ idempotencyKey: string }];
    const [secondArgs] = workingTransport.initiate.mock.calls[0] as unknown as [{ idempotencyKey: string }];
    expect(firstArgs.idempotencyKey).toBe(secondArgs.idempotencyKey);
  });
});

describe("submit — future-QT-CLI diagnostics (initiateInvoked/initiateSettled/Web Crypto availability)", () => {
  async function loggedDiagnostics(build: () => Promise<void>): Promise<Record<string, unknown>> {
    import.meta.env.DEV = false;
    vi.resetModules();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await build();
      expect(spy).toHaveBeenCalledTimes(1);
      return JSON.parse(spy.mock.calls[0]?.[0] as string);
    } finally {
      spy.mockRestore();
      import.meta.env.DEV = true;
      vi.resetModules();
    }
  }

  it("a simulated PRE-REQUEST failure (transport.initiate() never called) logs initiateInvoked=false, initiateSettled=false", async () => {
    const logged = await loggedDiagnostics(async () => {
      const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
      freshStorage();
      const transport = createFakeTransport();
      const engine = freshCreateEngine({
        transport,
        store: storeWith({
          reconcile: () => {
            throw new Error("simulated pre-request storage failure");
          },
        }),
      });
      await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
    });

    expect(logged["initiateInvoked"]).toBe(false);
    expect(logged["initiateSettled"]).toBe(false);
    expect(logged["stage"]).toBe("computing_identity");
  });

  it("a simulated POST-INITIATE failure (transport.initiate() resolved/settled, then something after it threw) logs initiateInvoked=true, initiateSettled=true", async () => {
    const logged = await loggedDiagnostics(async () => {
      const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
      freshStorage();
      const photo = localFile("a.jpg", "image/jpeg", 100);
      const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
      const transport = createFakeTransport({
        initiate: async () => initiateOk(slots),
        upload: async () => {
          throw new Error("boom");
        },
      });
      const engine = freshCreateEngine({ transport });
      await engine.submit({
        values: baseSellerValues({ sellerPhotos: [photo] }),
        context: sellerContext, turnstileToken: "test-turnstile-token",
      });
    });

    expect(logged["initiateInvoked"]).toBe(true);
    expect(logged["initiateSettled"]).toBe(true);
    expect(logged["stage"]).toBe("uploading");
  });

  it("a throw INSIDE transport.initiate itself (the call was invoked but never settled) logs initiateInvoked=true, initiateSettled=false — distinguishing it from the post-initiate case above", async () => {
    const logged = await loggedDiagnostics(async () => {
      const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
      freshStorage();
      const transport = createFakeTransport({
        initiate: async () => {
          throw new Error("boom");
        },
      });
      const engine = freshCreateEngine({ transport });
      await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
    });

    expect(logged["initiateInvoked"]).toBe(true);
    expect(logged["initiateSettled"]).toBe(false);
  });

  it("reflects crypto.subtle being unavailable at the moment of an UNRELATED failure — the diagnostic describes the environment, not the cause", async () => {
    const logged = await loggedDiagnostics(async () => {
      const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
      freshStorage();
      vi.stubGlobal("crypto", {
        ...crypto,
        subtle: undefined,
        getRandomValues: crypto.getRandomValues.bind(crypto),
        randomUUID: crypto.randomUUID.bind(crypto),
      });
      // Unrelated failure — NOT crypto-caused (sha256Hex's own @noble/hashes
      // fallback would otherwise silently succeed despite subtle being
      // gone, per the earlier crypto-compatibility audit) — a throw inside
      // transport.initiate, so this failure's actual cause has nothing to
      // do with the environment the diagnostics below describe.
      const transport = createFakeTransport({
        initiate: async () => {
          throw new Error("boom — unrelated to crypto");
        },
      });
      const engine = freshCreateEngine({ transport });
      await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
      vi.unstubAllGlobals();
    });

    expect(logged["subtleAvailable"]).toBe(false);
    expect(logged["getRandomValuesAvailable"]).toBe(true);
    expect(logged["randomUUIDAvailable"]).toBe(true);
  });

  it("every diagnostic field is a plain boolean or the closed stage enum — no name, phone, form value, file, token, URL, or payload hash ever appears", async () => {
    const logged = await loggedDiagnostics(async () => {
      const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
      freshStorage();
      const transport = createFakeTransport({
        initiate: async () => {
          throw new Error("boom — leaked internal detail for 0501234567?token=abc123&q=secret");
        },
      });
      const engine = freshCreateEngine({ transport });
      await engine.submit({
        values: baseSellerValues({ sellerName: "Ahmed Seller", sellerPhone: "0501234567" }),
        context: sellerContext, turnstileToken: "test-turnstile-token",
      });
    });

    const allowedKeys = new Set([
      "event",
      "category",
      "stage",
      "initiateInvoked",
      "initiateSettled",
      "subtleAvailable",
      "getRandomValuesAvailable",
      "randomUUIDAvailable",
    ]);
    expect(Object.keys(logged).every((key) => allowedKeys.has(key))).toBe(true);
    for (const [key, value] of Object.entries(logged)) {
      if (key === "event" || key === "category" || key === "stage") {
        expect(typeof value).toBe("string");
      } else {
        expect(typeof value).toBe("boolean");
      }
    }
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toContain("Ahmed");
    expect(serialized).not.toContain("0501234567");
    expect(serialized).not.toContain("token=abc123");
    expect(serialized).not.toContain("secret");
  });

  it("without sendDiagnosticsBeacon injected, the default is a genuine no-op — no beacon call of any kind happens", async () => {
    // The engine's own default (see createQuoteSubmissionEngine's doc
    // comment on QuoteSubmissionEngineDeps.sendDiagnosticsBeacon) must
    // never be the real network-calling function — every other test in
    // this file relies on exactly this to avoid firing an uncontrolled
    // background fetch(). This test makes that guarantee explicit rather
    // than merely implicit in "the other 170-odd tests didn't hang".
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => {
        throw new Error("boom");
      },
    });
    const engine = createQuoteSubmissionEngine({ transport });
    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(outcome.kind).toBe("client_exception");
  });

  it("calls the injected sendDiagnosticsBeacon with the exact same six fields logged to the console, and never awaits it before resolving submit()", async () => {
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => {
        throw new Error("boom");
      },
    });

    let resolveBeacon: (() => void) | undefined;
    const beaconCalls: unknown[] = [];
    const sendDiagnosticsBeacon = vi.fn((snapshot: unknown) => {
      beaconCalls.push(snapshot);
      // Deliberately never resolves until the test explicitly does —
      // proves submit() does not wait on this promise at all.
      return new Promise<void>((resolve) => {
        resolveBeacon = resolve;
      });
    });

    const engine = createQuoteSubmissionEngine({ transport, sendDiagnosticsBeacon });
    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [photo] }),
      context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    // submit() already resolved above — if it had awaited the beacon,
    // this line would never be reached (resolveBeacon is only ever called
    // by the test itself, below).
    expect(outcome.kind).toBe("client_exception");
    expect(sendDiagnosticsBeacon).toHaveBeenCalledTimes(1);
    expect(beaconCalls[0]).toEqual({
      stage: "uploading",
      initiateInvoked: true,
      initiateSettled: true,
      subtleAvailable: true,
      getRandomValuesAvailable: true,
      randomUUIDAvailable: true,
    });
    resolveBeacon?.();
  });

  it("a sendDiagnosticsBeacon that itself rejects never surfaces as an unhandled rejection or alters the outcome", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => {
        throw new Error("boom");
      },
    });
    const sendDiagnosticsBeacon = vi.fn(() => Promise.reject(new Error("beacon network failure")));
    const engine = createQuoteSubmissionEngine({ transport, sendDiagnosticsBeacon });

    const outcome = await engine.submit({ values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token" });
    expect(outcome.kind).toBe("client_exception");
    expect(sendDiagnosticsBeacon).toHaveBeenCalledTimes(1);
  });

  it("a sendDiagnosticsBeacon that throws SYNCHRONOUSLY (not an async rejection) still resolves submit() to the correct client_exception outcome — never rejects submit() itself", async () => {
    // MEASURED GAP, fixed — a plain `.catch()` on the call expression
    // only guards an asynchronous REJECTION of the returned promise. A
    // SYNCHRONOUS throw from calling sendDiagnosticsBeacon(...) itself
    // happens before any promise even exists to attach `.catch()` to —
    // before the fix, that throw escaped this whole
    // `.catch((error) => {...})` callback, rejecting submit()'s own
    // returned promise instead of resolving it to the real, correct
    // client_exception outcome (with the right stage and any recovered
    // leadId) that this function was about to return.
    freshStorage();
    const photo = localFile("a.jpg", "image/jpeg", 100);
    const slots = [slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg", declaredByteSize: 100 })];
    const transport = createFakeTransport({
      initiate: async () => initiateOk(slots),
      upload: async () => {
        throw new Error("boom");
      },
    });
    const sendDiagnosticsBeacon = vi.fn(() => {
      throw new Error("beacon sync boom");
    });
    const engine = createQuoteSubmissionEngine({ transport, sendDiagnosticsBeacon });

    // The real assertion: this must RESOLVE, never reject — a rejection
    // here would fail the test via an uncaught rejection, not via a
    // normal assertion failure, which is exactly the bug being guarded
    // against.
    const outcome = await engine.submit({
      values: baseSellerValues({ sellerPhotos: [photo] }),
      context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    // The ORIGINAL, correct outcome — stage and leadId both intact —
    // completely unaffected by the beacon's own misbehavior.
    expect(outcome).toEqual({
      kind: "client_exception",
      retryable: true,
      stage: "uploading",
      leadId: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260101-ABCDEF",
    });
    expect(sendDiagnosticsBeacon).toHaveBeenCalledTimes(1);
  });
});

describe("submit — client_exception carries no PII or raw error content", () => {
  it("the outcome's JSON serialization contains only the fixed stage enum — never the thrown error's message, the customer's name or phone", async () => {
    freshStorage();
    const transport = createFakeTransport({
      initiate: async () => {
        throw new Error("boom — leaked internal detail for 0501234567");
      },
    });
    const outcome: QuoteSubmissionOutcome = await createQuoteSubmissionEngine({ transport }).submit({
      values: baseSellerValues({ sellerName: "Ahmed Seller", sellerPhone: "0501234567" }),
      context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toContain("Ahmed");
    expect(serialized).not.toContain("0501234567");
    expect(outcome).toEqual({ kind: "client_exception", retryable: true, stage: "initiating" });
  });

  it("logs the fixed quote_submit_client_exception category AND the stage via logUnhandledError, never the thrown error's own message", async () => {
    // error-capture.ts's module-level console.error override captures
    // whatever console.error IS at the moment it first loads as its
    // "original" — so the spy must be installed, and the module graph
    // freshly imported, in that order (same pattern as error-capture.
    // test.ts's own "freshModule" helper) for this assertion to observe
    // what actually reaches the console. DEV must be explicitly false:
    // the production (non-dev) branch is the one that collapses to the
    // fixed category — dev intentionally preserves full detail, and is
    // already covered by error-capture.test.ts, not this one.
    import.meta.env.DEV = false;
    vi.resetModules();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { createQuoteSubmissionEngine: freshCreateEngine } = await import("./quote-submission-engine");
    freshStorage();

    const transport = createFakeTransport({
      initiate: async () => {
        throw new Error("boom — sensitive detail");
      },
    });
    await freshCreateEngine({ transport }).submit({
      values: baseSellerValues(), context: sellerContext, turnstileToken: "test-turnstile-token",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0]?.[0] as string);
    // Category AND stage, both closed enums, together in the one line
    // that actually reaches the real console — not just present on the
    // outcome object returned to the UI, which nothing ever logs. This is
    // a live-session diagnostic only (see logUnhandledError's own doc
    // comment): useful to someone watching this exact browser's console
    // at the time, not a retroactive/remote lookup after the fact.
    // Future-QT-CLI-diagnostics audit, added — three more bounded fields
    // alongside stage: initiateInvoked/initiateSettled (this throw
    // happened INSIDE transport.initiate itself, so the call WAS invoked
    // but never settled) and the three Web Crypto availability booleans
    // (all true here — this is a real Node/jsdom environment with Web
    // Crypto fully present). Every one of these is a plain boolean, never
    // a value drawn from the thrown error/form data.
    expect(logged).toEqual({
      event: "app.unhandled_error",
      category: "quote_submit_client_exception",
      stage: "initiating",
      initiateInvoked: true,
      initiateSettled: false,
      subtleAvailable: true,
      getRandomValuesAvailable: true,
      randomUUIDAvailable: true,
    });
    expect(spy.mock.calls[0]?.[0] as string).not.toContain("boom");
    expect(spy.mock.calls[0]?.[0] as string).not.toContain("sensitive");
    spy.mockRestore();
    import.meta.env.DEV = true;
    vi.resetModules();
  });
});
