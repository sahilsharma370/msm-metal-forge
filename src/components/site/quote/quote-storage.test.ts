import { afterEach, describe, expect, it, vi } from "vitest";
import {
  saveQuoteDraft,
  loadQuoteDraft,
  clearQuoteDraft,
  saveSubmissionAttempt,
  loadSubmissionAttempt,
  clearSubmissionAttempt,
  reconcileSubmissionAttempt,
  toPersistedUploadSlot,
  type QuoteSubmissionAttempt,
} from "./quote-storage";
import type { QuoteFormValues } from "./quote-schema";

const DRAFT_KEY = "msm-quote-draft-v1";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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

function formValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    intent: "sell",
    material: "copper",
    sellerName: "Ahmed Seller",
    sellerPhone: "0501234567",
    sellerPhotos: [],
    buyerDocuments: [],
    ...overrides,
  };
}

const preInitiateAttempt: QuoteSubmissionAttempt = {
  kind: "pre_initiate",
  idempotencyKey: "d0000000-0000-0000-0000-000000000001",
  payloadHash: HASH_A,
  files: [{ originalFilename: "a.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 100 }],
  createdAt: 1000,
  updatedAt: 1000,
};

const initiatedAttempt: QuoteSubmissionAttempt = {
  kind: "initiated",
  idempotencyKey: "d0000000-0000-0000-0000-000000000001",
  payloadHash: HASH_A,
  files: [{ originalFilename: "a.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 100 }],
  leadId: "e0000000-0000-0000-0000-000000000001",
  reference: "MSM-000123",
  uploadSlots: [
    {
      slotId: "f0000000-0000-0000-0000-000000000001",
      slotIndex: 0,
      kind: "seller_photo",
      status: "pending",
      expiresAt: "2026-01-01T00:00:00.000Z",
      originalFilename: "a.jpg",
      declaredMimeType: "image/jpeg",
      declaredByteSize: 100,
    },
  ],
  createdAt: 1000,
  updatedAt: 1000,
};

describe("v1 -> v2 migration", () => {
  it("loads and migrates a v1 draft without answer loss", () => {
    const v1Payload = {
      version: 1,
      step: 3,
      values: { intent: "sell", material: "copper", sellerName: "Ahmed Seller" },
      hadSellerPhotos: true,
      hadBuyerDocuments: false,
      savedAt: Date.now(),
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(v1Payload) }));

    const loaded = loadQuoteDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(2);
    expect(loaded?.step).toBe(3);
    expect(loaded?.values).toEqual(v1Payload.values);
    expect(loaded?.hadSellerPhotos).toBe(true);
    expect(loaded?.hadBuyerDocuments).toBe(false);
    expect(loaded?.attempt).toEqual({ kind: "none" });
  });
});

describe("v2 attempt round-trips", () => {
  it("round-trips a valid pre_initiate attempt alongside typed answers", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(3, formValues());
    saveSubmissionAttempt(preInitiateAttempt);

    expect(loadSubmissionAttempt()).toEqual(preInitiateAttempt);
    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
    expect(loadQuoteDraft()?.step).toBe(3);
  });

  it("round-trips a valid initiated attempt alongside typed answers", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(5, formValues());
    saveSubmissionAttempt(initiatedAttempt);

    const loaded = loadSubmissionAttempt();
    expect(loaded).toEqual(initiatedAttempt);
    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
  });
});

describe("fails closed on bad storage content", () => {
  it("discards malformed JSON without crashing", () => {
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: "{not valid json" }));
    expect(() => loadQuoteDraft()).not.toThrow();
    expect(loadQuoteDraft()).toBeNull();
  });

  it("discards a partial/corrupt attempt (missing required field) safely, without discarding valid typed answers", () => {
    const corrupt = {
      version: 2,
      step: 3,
      values: { sellerName: "Ahmed Seller" },
      hadSellerPhotos: false,
      hadBuyerDocuments: false,
      savedAt: Date.now(),
      // pre_initiate without idempotencyKey — the discriminated union member
      // fails, so the attempt field's own `.catch({kind:"none"})` takes
      // over: the corrupt sub-object is discarded on its own, it does not
      // take otherwise-valid typed answers down with it.
      attempt: { kind: "pre_initiate", payloadHash: HASH_A, files: [], createdAt: 1, updatedAt: 1 },
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(corrupt) }));
    expect(() => loadQuoteDraft()).not.toThrow();
    const loaded = loadQuoteDraft();
    expect(loaded?.attempt).toEqual({ kind: "none" });
    expect(loaded?.values.sellerName).toBe("Ahmed Seller");
  });

  it("discards a fully corrupt envelope (values itself not an object) entirely, without crashing", () => {
    // Every leaf of draftValuesSchema has its own `.catch()`, so a
    // wrong-type *value* inside `values` would just fall back per-field —
    // this instead makes `values` itself the wrong top-level shape, which
    // no per-field catch can rescue.
    const corrupt = {
      version: 2,
      step: 1,
      values: "not-an-object",
      hadSellerPhotos: false,
      hadBuyerDocuments: false,
      savedAt: Date.now(),
      attempt: { kind: "none" },
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(corrupt) }));
    expect(() => loadQuoteDraft()).not.toThrow();
    expect(loadQuoteDraft()).toBeNull();
  });

  it("discards an unknown future version without crashing", () => {
    const future = {
      version: 3,
      step: 1,
      values: {},
      hadSellerPhotos: false,
      hadBuyerDocuments: false,
      savedAt: Date.now(),
      attempt: { kind: "none" },
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(future) }));
    expect(() => loadQuoteDraft()).not.toThrow();
    expect(loadQuoteDraft()).toBeNull();
  });
});

describe("24-hour expiry", () => {
  it("clears both typed answers and submission-attempt recovery state once expired", () => {
    const expired = {
      version: 2,
      step: 4,
      values: { sellerName: "Ahmed Seller" },
      hadSellerPhotos: false,
      hadBuyerDocuments: false,
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
      attempt: preInitiateAttempt,
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(expired) }));

    expect(loadQuoteDraft()).toBeNull();
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });
});

describe("no stored reference can produce success state", () => {
  it("an initiated attempt exposes leadId/reference for display only, never a success/confirmed flag", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(5, formValues());
    saveSubmissionAttempt(initiatedAttempt);

    const attempt = loadSubmissionAttempt();
    expect(attempt).not.toHaveProperty("success");
    expect(attempt).not.toHaveProperty("confirmed");
    expect(attempt).not.toHaveProperty("isSuccess");
  });

  it("merely loading a stored attempt with a leadId does not clear or otherwise mutate the draft", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(5, formValues({ sellerName: "Ahmed Seller" }));
    saveSubmissionAttempt(initiatedAttempt);

    loadSubmissionAttempt();
    loadSubmissionAttempt();

    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
    expect(loadSubmissionAttempt()).toEqual(initiatedAttempt);
  });
});

describe("form change clears stale attempt but retains typed answers", () => {
  it("reconcileSubmissionAttempt clears a stale attempt while values remain", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(3, formValues({ sellerName: "Ahmed Seller" }));
    saveSubmissionAttempt(preInitiateAttempt); // payloadHash: HASH_A

    const result = reconcileSubmissionAttempt(HASH_B);
    expect(result).toEqual({ kind: "none" });
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
  });

  it("reconcileSubmissionAttempt keeps a still-valid attempt when the hash is unchanged", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(3, formValues());
    saveSubmissionAttempt(preInitiateAttempt); // payloadHash: HASH_A

    const result = reconcileSubmissionAttempt(HASH_A);
    expect(result).toEqual(preInitiateAttempt);
    expect(loadSubmissionAttempt()).toEqual(preInitiateAttempt);
  });

  it("saveQuoteDraft on its own (typed-answer edits) preserves an existing attempt untouched", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(3, formValues());
    saveSubmissionAttempt(preInitiateAttempt);

    saveQuoteDraft(3, formValues({ sellerName: "Edited Name" }));

    expect(loadSubmissionAttempt()).toEqual(preInitiateAttempt);
    expect(loadQuoteDraft()?.values.sellerName).toBe("Edited Name");
  });
});

describe("genuine success / start-over clears both draft and submission identity", () => {
  it("clearQuoteDraft removes typed answers and the submission attempt together", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(5, formValues());
    saveSubmissionAttempt(initiatedAttempt);

    clearQuoteDraft();

    expect(loadQuoteDraft()).toBeNull();
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
  });

  it("clearSubmissionAttempt clears only the attempt, keeping typed answers", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(5, formValues({ sellerName: "Ahmed Seller" }));
    saveSubmissionAttempt(preInitiateAttempt);

    clearSubmissionAttempt();

    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
  });
});

describe("same-tab refresh recovery behavior", () => {
  it("typed answers and the submission attempt both survive a simulated reload (same underlying storage)", () => {
    const storage = createMemoryStorage();
    stubWindowWith(storage);
    saveQuoteDraft(4, formValues({ sellerName: "Ahmed Seller" }));
    saveSubmissionAttempt(preInitiateAttempt);

    // "Reload": re-stub window against the SAME storage instance — real
    // sessionStorage survives a same-tab reload identically.
    stubWindowWith(storage);

    expect(loadQuoteDraft()?.values.sellerName).toBe("Ahmed Seller");
    expect(loadQuoteDraft()?.step).toBe(4);
    expect(loadSubmissionAttempt()).toEqual(preInitiateAttempt);
  });
});

describe("explicit duplicate-tab limitation", () => {
  it("two tabs seeded with identical sessionStorage diverge as soon as one writes", () => {
    stubWindowWith(createMemoryStorage());
    saveQuoteDraft(2, formValues({ sellerName: "Original Tab" }));
    // Capture what a "duplicate tab" would have received at this instant.
    const snapshotRaw = window.sessionStorage.getItem(DRAFT_KEY) ?? "";

    const tabA = createMemoryStorage({ [DRAFT_KEY]: snapshotRaw });
    const tabB = createMemoryStorage({ [DRAFT_KEY]: snapshotRaw }); // "duplicated" tab

    // Tab A continues editing.
    stubWindowWith(tabA);
    saveQuoteDraft(2, formValues({ sellerName: "Edited only in Tab A" }));

    // Tab B never sees Tab A's write — sessionStorage is not live-shared.
    stubWindowWith(tabB);
    expect(loadQuoteDraft()?.values.sellerName).toBe("Original Tab");

    // Confirm the divergence is real, not a fixture mistake.
    stubWindowWith(tabA);
    expect(loadQuoteDraft()?.values.sellerName).toBe("Edited only in Tab A");
  });
});

describe("SSR / window-unavailable behavior", () => {
  it("every write function no-ops safely with no window global", () => {
    expect(() => saveQuoteDraft(1, formValues())).not.toThrow();
    expect(() => saveSubmissionAttempt(preInitiateAttempt)).not.toThrow();
    expect(() => clearQuoteDraft()).not.toThrow();
    expect(() => clearSubmissionAttempt()).not.toThrow();
  });

  it("every read function returns a safe default with no window global", () => {
    expect(loadQuoteDraft()).toBeNull();
    expect(loadSubmissionAttempt()).toEqual({ kind: "none" });
    expect(reconcileSubmissionAttempt(HASH_A)).toEqual({ kind: "none" });
  });
});

describe("toPersistedUploadSlot", () => {
  it("never carries a storagePath-shaped key through to the persisted slot, and carries status through unchanged", () => {
    const persisted = toPersistedUploadSlot({
      slotId: "f0000000-0000-0000-0000-000000000001",
      slotIndex: 0,
      kind: "seller_photo",
      status: "verified",
      expiresAt: "2026-01-01T00:00:00.000Z",
      originalFilename: "a.jpg",
      declaredMimeType: "image/jpeg",
      declaredByteSize: 100,
    });
    expect(persisted).not.toHaveProperty("storagePath");
    expect(persisted.status).toBe("verified");
    expect(Object.keys(persisted).sort()).toEqual(
      [
        "slotId",
        "slotIndex",
        "kind",
        "status",
        "expiresAt",
        "originalFilename",
        "declaredMimeType",
        "declaredByteSize",
      ].sort(),
    );
  });
});

describe("persisted upload slot status — CHECKPOINT C2F-C1 fail-closed on a corrupt/unknown status", () => {
  it("discards the whole attempt (falls back to none) when a persisted upload slot has an unrecognized status value, while typed answers survive", () => {
    const corrupt = {
      version: 2,
      step: 5,
      values: { sellerName: "Ahmed Seller" },
      hadSellerPhotos: true,
      hadBuyerDocuments: false,
      savedAt: Date.now(),
      attempt: {
        kind: "initiated",
        idempotencyKey: "d0000000-0000-0000-0000-000000000001",
        payloadHash: HASH_A,
        files: [{ originalFilename: "a.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 100 }],
        leadId: "e0000000-0000-0000-0000-000000000001",
        reference: "MSM-000123",
        uploadSlots: [
          {
            slotId: "f0000000-0000-0000-0000-000000000001",
            slotIndex: 0,
            kind: "seller_photo",
            status: "not_a_real_status",
            expiresAt: "2026-01-01T00:00:00.000Z",
            originalFilename: "a.jpg",
            declaredMimeType: "image/jpeg",
            declaredByteSize: 100,
          },
        ],
        createdAt: 1000,
        updatedAt: 1000,
      },
    };
    stubWindowWith(createMemoryStorage({ [DRAFT_KEY]: JSON.stringify(corrupt) }));

    expect(() => loadQuoteDraft()).not.toThrow();
    const loaded = loadQuoteDraft();
    expect(loaded?.attempt).toEqual({ kind: "none" });
    expect(loaded?.values.sellerName).toBe("Ahmed Seller");
  });
});
