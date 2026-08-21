// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { QuoteExperience } from "./QuoteExperience";
import { saveQuoteDraft, loadQuoteDraft, loadSubmissionAttempt } from "./quote-storage";
import type { QuoteFormValues } from "./quote-schema";
import type { QuoteInitialContext } from "./quote-search";
import type {
  QuoteTransport,
  InitiateTransportResult,
  UploadTransportResult,
  CompleteTransportResult,
  InitiateUploadSlot,
} from "./quote-submission-transport";
import type { QuoteTurnstileWidgetHandle, QuoteTurnstileWidgetProps } from "./QuoteTurnstileWidget";

/**
 * CHECKPOINT C2G — deterministic stand-in for the real, script-loading,
 * network-backed QuoteTurnstileWidget, injected via QuoteExperience's
 * `turnstileWidget` test-only prop (mirrors the existing `transport`
 * injection point). Delivers a token synchronously on mount and again on
 * every reset() call, so every existing click-driven test keeps working
 * without racing a real async script load, while still exercising
 * QuoteExperience's own real token-lifecycle wiring (state, disabling,
 * clearing, reset-after-every-attempt).
 */
const FakeTurnstileWidget = forwardRef<QuoteTurnstileWidgetHandle, QuoteTurnstileWidgetProps>(
  function FakeTurnstileWidget({ onToken }, ref) {
    const counter = useRef(0);
    useImperativeHandle(
      ref,
      () => ({
        reset() {
          counter.current += 1;
          onToken(`fake-turnstile-token-${counter.current}`);
        },
      }),
      [onToken],
    );
    useEffect(() => {
      onToken(`fake-turnstile-token-${counter.current}`);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
);

// ---------------------------------------------------------------------------
// jsdom gaps Radix/the picker rely on — standard, minimal polyfills only.
// ---------------------------------------------------------------------------
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined;
  }
  if (!("ResizeObserver" in globalThis)) {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  }
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:fake";
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => undefined;
  }
});

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validSellerValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
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

function validBuyerValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
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

const LEAD_ID = "11111111-1111-1111-1111-111111111111";

function initiateOk(uploadSlots: InitiateUploadSlot[] = []): InitiateTransportResult {
  return {
    ok: true,
    status: 200,
    data: { leadId: LEAD_ID, reference: "MSM-260101-ABCDEF", idempotentReplay: false, uploadSlots },
  };
}

function uploadOk(slotId: string): UploadTransportResult {
  return {
    ok: true,
    status: 200,
    data: { success: true, slotId, fileId: `file-${slotId}`, status: "verified", replayed: false },
  };
}

function completeOk(): CompleteTransportResult {
  return {
    ok: true,
    status: 200,
    data: {
      leadId: LEAD_ID,
      reference: "MSM-260101-ABCDEF",
      submissionCompletedAt: "2026-01-01T00:05:00.000Z",
      alreadyCompleted: false,
    },
  };
}

type InitiateFn = QuoteTransport["initiate"];
type UploadFn = QuoteTransport["upload"];
type CompleteFn = QuoteTransport["complete"];

function createFakeTransport(
  overrides: Partial<{ initiate: InitiateFn; upload: UploadFn; complete: CompleteFn }> = {},
) {
  return {
    initiate: vi.fn<InitiateFn>(overrides.initiate ?? (async () => initiateOk())),
    upload: vi.fn<UploadFn>(overrides.upload ?? (async (req) => uploadOk(req.slotId))),
    complete: vi.fn<CompleteFn>(overrides.complete ?? (async () => completeOk())),
  };
}

/** Renders the wizard already hydrated onto the Review step with valid, ready-to-submit values. Internal step 6 -> stage 5 (Review) via `stageOf` — unchanged by the C2L-Q1 5-stage migration mapping. */
function renderOnReview(
  values: QuoteFormValues,
  context: QuoteInitialContext,
  transport: ReturnType<typeof createFakeTransport>,
) {
  saveQuoteDraft(6, values);
  const onClose = vi.fn();
  const utils = render(
    <QuoteExperience
      mode="standalone"
      initialContext={context}
      onClose={onClose}
      transport={transport}
      turnstileWidget={FakeTurnstileWidget}
    />,
  );
  return { ...utils, onClose };
}

function submitButton() {
  return screen.getByRole("button", { name: /submit request|retry submission/i });
}

/** C2L-Q5 — the evidence uploader now lives behind a closed-by-default disclosure; opens it (a no-op if the fixture already opened it, e.g. an unresolved-file/restored-draft case) before any file interaction. */
async function openEvidenceDisclosure(branch: "seller" | "buyer") {
  const trigger = screen.getByRole("button", {
    name: branch === "seller" ? /photos \(optional\)/i : /documents \(optional\)/i,
  });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(trigger);
  }
}

/** The desktop rail's close control specifically — the one closeButtonRef refers to for focus restoration. Both the desktop and mobile close buttons are always present in jsdom (no real CSS/media-query evaluation), so an unqualified query is ambiguous; this always picks the first (desktop) one, matching the component's own focus-restoration target. */
function desktopCloseButton() {
  return screen.getAllByRole("button", { name: /close quote experience/i })[0]!;
}

/** QuoteProgress renders its "Step X of Y" eyebrow in both the desktop rail and the mobile sticky header unconditionally — jsdom applies no real CSS, so both are always present in the DOM at once; this asserts every occurrence agrees. `stage` is the C2L-Q1 5-stage number (1-5), not the internal wizard step. */
function expectStageLabel(stage: number) {
  const matches = screen.getAllByText(new RegExp(`step ${stage} of 5`, "i"));
  expect(matches.length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// 1. Engine instance stability
// ---------------------------------------------------------------------------

describe("engine lifetime", () => {
  it("does not recreate the engine (or issue a second transport call) across rerenders", async () => {
    const transport = createFakeTransport({
      initiate: async () => new Promise(() => undefined), // never resolves — we only assert call counts
    });
    const { rerender } = renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    expect(transport.initiate).toHaveBeenCalledTimes(1);

    rerender(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    rerender(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );

    // Still exactly one in-flight call — rerendering never spun up a second engine/run.
    expect(transport.initiate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2/3. Real success is the only path to confirmation; fake path removed
// ---------------------------------------------------------------------------

describe("real submission is the only path to confirmation", () => {
  it("shows the confirmation screen only after the engine's success outcome resolves, with the authoritative server reference", async () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);

    expect(screen.queryByText(/enquiry received/i)).not.toBeInTheDocument();
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument();
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });

  it("never renders a dev-only preview/fake confirmation control", () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);
    expect(screen.queryByText(/preview confirmation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prototype preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no request was sent/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 4/5. Double-click / Enter+click cannot double-submit
// ---------------------------------------------------------------------------

describe("duplicate-submission prevention", () => {
  it("a double click calls initiate exactly once", async () => {
    let resolveInitiate!: (v: InitiateTransportResult) => void;
    const gate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => gate });
    renderOnReview(validSellerValues(), sellerContext, transport);

    const button = submitButton();
    await userEvent.click(button);
    await userEvent.click(button); // button is now disabled, but click the same target again defensively

    resolveInitiate(initiateOk());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.initiate).toHaveBeenCalledTimes(1);
  });

  it("the submit button is disabled and aria-busy while a submission is in flight", async () => {
    const transport = createFakeTransport({ initiate: async () => new Promise(() => undefined) });
    renderOnReview(validSellerValues(), sellerContext, transport);

    const button = submitButton();
    await userEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

// ---------------------------------------------------------------------------
// 6. Success locks the form
// ---------------------------------------------------------------------------

describe("success locks the form", () => {
  it("clicking anywhere the submit button used to be after success does not start a new enquiry", async () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /submit request/i })).not.toBeInTheDocument();
    expect(transport.initiate).toHaveBeenCalledTimes(1);
  });

  it("clears the draft on genuine success so a refresh cannot restore a submit-ready form", async () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());

    expect(loadQuoteDraft()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Progress phases
// ---------------------------------------------------------------------------

describe("progress phases", () => {
  it("renders truthful phase text while submitting, sourced from the real engine's onProgress", async () => {
    let resolveInitiate!: (v: InitiateTransportResult) => void;
    const gate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => gate });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    // computing_identity resolves near-instantly (pure, synchronous-ish
    // validation), so it can flash and pass before the first poll — the
    // fake transport's gate reliably stalls at "initiating" instead, which
    // is what's asserted here. The computing_identity -> "Validating
    // details…" text mapping itself is covered directly and deterministically
    // in quote-submission-copy.test.ts.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/creating or recovering your enquiry/i),
    );

    resolveInitiate(initiateOk());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
  });

  it("uploading shows file-count progress, never a fabricated percentage", async () => {
    const photoSlots = [
      slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg" }),
      slot({ slotIndex: 1, slotId: "s1", originalFilename: "b.jpg" }),
    ];
    let resolveFirstUpload!: (v: UploadTransportResult) => void;
    const gate = new Promise<UploadTransportResult>((resolve) => {
      resolveFirstUpload = resolve;
    });
    let uploadCalls = 0;
    const transport = createFakeTransport({
      initiate: async () => initiateOk(photoSlots),
      upload: async (req) => {
        uploadCalls += 1;
        if (uploadCalls === 1) return gate;
        return uploadOk(req.slotId);
      },
    });

    const values = validSellerValues();
    saveQuoteDraft(5, values);
    const onClose = vi.fn();
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={onClose}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );

    const fileA = new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" });
    const fileB = new File([new Uint8Array(100)], "b.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("seller");
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    await userEvent.upload(input, [fileA, fileB]);

    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/uploading file 1 of 2/i),
    );
    resolveFirstUpload(uploadOk("s0"));
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 8/9/10. Zero-file, multi-photo seller, multi-document buyer
// ---------------------------------------------------------------------------

describe("submission by scenario", () => {
  it("zero-file seller succeeds without ever calling upload", async () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.upload).not.toHaveBeenCalled();
  });

  it("seller multi-photo flow uploads every declared photo and succeeds", async () => {
    const photoSlots = [
      slot({ slotIndex: 0, slotId: "s0", originalFilename: "a.jpg" }),
      slot({ slotIndex: 1, slotId: "s1", originalFilename: "b.jpg" }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(photoSlots) });
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );

    const fileA = new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" });
    const fileB = new File([new Uint8Array(100)], "b.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("seller");
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [
      fileA,
      fileB,
    ]);
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });

  it("buyer multi-document flow uploads every declared document and succeeds", async () => {
    const docSlots = [
      slot({
        slotIndex: 0,
        slotId: "s0",
        kind: "buyer_document",
        originalFilename: "invoice.pdf",
        declaredMimeType: "application/pdf",
      }),
      slot({ slotIndex: 1, slotId: "s1", kind: "buyer_document", originalFilename: "receipt.jpg" }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(docSlots) });
    saveQuoteDraft(5, validBuyerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );

    const invoice = new File([new Uint8Array(100)], "invoice.pdf", { type: "application/pdf" });
    const receipt = new File([new Uint8Array(100)], "receipt.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("buyer");
    await userEvent.upload(
      screen.getByLabelText("Add a supporting document or image", { selector: "input" }),
      [invoice, receipt],
    );
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 11/12. Resume: verified slots skipped, pending unresolved requests reselection
// ---------------------------------------------------------------------------

describe("resume behavior", () => {
  it("a slot already reported verified is never re-uploaded", async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "verified" })]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.upload).not.toHaveBeenCalled();
  });

  it("a pending slot with no matching local File routes to the photo step and names only the unresolved file", async () => {
    const transport = createFakeTransport({
      initiate: async () =>
        initiateOk([
          slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "missing.jpg" }),
        ]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/how should we contact you/i)).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("missing.jpg");
    expect(transport.upload).not.toHaveBeenCalled();
    expect(transport.complete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 13. Correct seller/buyer step receives focus/navigation on validation
// ---------------------------------------------------------------------------

describe("validation navigation", () => {
  // Note: the Submit button is itself disabled whenever isReadyForReview(values)
  // is false, and isReadyForReview is composed from the exact same per-step
  // schemas findFirstInvalidStep re-checks — so with genuinely invalid answers
  // (e.g. an empty sellerPhone) the button can never be clicked in the first
  // place, and the engine's own client-side identity check
  // (submissionShapeSchema, shape-only) is even more permissive than those
  // step schemas. A validation_error/server_rejected reaching this handler
  // with values that still fail an earlier step is therefore not reachable
  // through real interaction; what IS reachable is the fallback banner for
  // the case where every step schema already agrees locally but the server
  // still rejected the request — asserted here.
  it("server_rejected with values that pass every local step schema falls back to a Review banner instead of doing nothing", async () => {
    const transport = createFakeTransport({
      initiate: async () => ({
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        message: "The request could not be validated.",
        retryable: false,
        fieldErrors: [{ path: "sellerPhone", message: "Enter a valid phone or WhatsApp number." }],
      }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByText(/couldn't be validated — please review/i)).toBeInTheDocument(),
    );
    // Still on Review — there was nowhere earlier to navigate to.
    expect(
      screen.getByRole("heading", { name: /review and send your request/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 14. Upload-in-progress UI and retry
// ---------------------------------------------------------------------------

describe("upload_in_progress", () => {
  it("explains the file is still processing, offers Retry, and never marks complete", async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "uploading" })]),
      upload: async () => ({
        ok: false,
        status: 409,
        code: "UPLOAD_IN_PROGRESS",
        message: "in progress",
        retryable: true,
      }),
    });
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("seller");
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/still being processed/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry submission/i })).toBeInTheDocument();
    expect(transport.complete).not.toHaveBeenCalled();
    expect(screen.queryByText(/enquiry received/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 15/16/17/18. Failures preserve the attempt; Retry reuses it
// ---------------------------------------------------------------------------

describe("retryable failures preserve the attempt", () => {
  it("a network failure during initiate preserves the attempt, and Retry reuses the same idempotency key", async () => {
    const keys: string[] = [];
    const transport = createFakeTransport({
      initiate: async (req) => {
        keys.push(req.idempotencyKey);
        return keys.length === 1 ? { ok: false, transportFailure: "network_error" } : initiateOk();
      },
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/couldn't reach msm scrap/i)).toBeInTheDocument());
    expect(loadSubmissionAttempt().kind).toBe("pre_initiate");

    await userEvent.click(screen.getByRole("button", { name: /retry submission/i }));
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(keys[0]).toBe(keys[1]);
  });

  it("an upload failure midway leaves complete uncalled and shows a retryable banner", async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0" })]),
      upload: async () => ({
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        message: "x",
        retryable: true,
      }),
    });
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={transport}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("seller");
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/couldn't be uploaded/i)).toBeInTheDocument());
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("a completion failure shows a retryable banner, never success", async () => {
    const transport = createFakeTransport({
      complete: async () => ({
        ok: false,
        status: 500,
        code: "INTERNAL_ERROR",
        message: "x",
        retryable: true,
      }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByText(/something went wrong on our end/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/enquiry received/i)).not.toBeInTheDocument();
  });

  it("a lost completion response, replayed on Retry, reaches genuine success", async () => {
    let completeCalls = 0;
    const transport = createFakeTransport({
      complete: async () => {
        completeCalls += 1;
        return completeCalls === 1
          ? { ok: false, transportFailure: "network_error" }
          : completeOk();
      },
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/couldn't reach msm scrap/i)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /retry submission/i }));
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 19. Failed/expired conservative terminal UI
// ---------------------------------------------------------------------------

describe("restart_required", () => {
  it("shows a conservative terminal explanation, no retry affordance, and never claims a new lead was made", async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "failed" })]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't be completed with the files provided/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /retry submission/i })).not.toBeInTheDocument();
    expect(loadSubmissionAttempt().kind).toBe("initiated"); // not silently cleared
  });
});

// ---------------------------------------------------------------------------
// 20. Idempotency conflict does not auto-reset
// ---------------------------------------------------------------------------

describe("idempotency_conflict", () => {
  it("shows a support message with no retry button, and does not auto-resubmit", async () => {
    const transport = createFakeTransport({
      initiate: async () => ({
        ok: false,
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "conflict",
        retryable: false,
      }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByText(/couldn't be confirmed automatically/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /retry submission/i })).not.toBeInTheDocument();
    expect(transport.initiate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// C2L (surgical review layout fix). The four required Review action-area
// states: verification pending, submitting, verification rejection, and a
// general (terminal) error.
// ---------------------------------------------------------------------------

const PendingTurnstileWidget = forwardRef<QuoteTurnstileWidgetHandle, QuoteTurnstileWidgetProps>(
  function PendingTurnstileWidget(_props, ref) {
    useImperativeHandle(ref, () => ({ reset() {} }), []);
    return null;
  },
);

describe("C2L Review action-area states", () => {
  it("verification pending: the primary CTA stays disabled until a Turnstile token arrives", () => {
    saveQuoteDraft(6, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={PendingTurnstileWidget}
      />,
    );
    expect(submitButton()).toBeDisabled();
  });

  it("submitting: progress is announced in a polite status region while the primary CTA is disabled", async () => {
    let resolveInitiate!: (v: InitiateTransportResult) => void;
    const gate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => gate });
    renderOnReview(validSellerValues(), sellerContext, transport);

    const button = submitButton();
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/./));
    expect(button).toBeDisabled();

    resolveInitiate(initiateOk());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
  });

  it("verification rejection: surfaces as a retryable status (not an alert) and offers Retry", async () => {
    const transport = createFakeTransport({
      initiate: async () => ({
        ok: false,
        status: 403,
        code: "VERIFICATION_REQUIRED",
        message: "verify",
        retryable: true,
      }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() =>
      expect(screen.getByText(/complete the verification check/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/complete the verification check/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry submission/i })).toBeInTheDocument();
  });

  it('general error: a terminal failure surfaces as role="alert" and moves focus onto it', async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "failed" })]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't be completed with the files/i);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });
});

// ---------------------------------------------------------------------------
// 21. Abort during initiate/upload/complete
// ---------------------------------------------------------------------------

describe("abort", () => {
  it("never shows success or a generic failure banner after an abort", async () => {
    const transport = createFakeTransport({
      initiate: async () => ({ ok: false, transportFailure: "aborted" }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).not.toBeDisabled());
    expect(screen.queryByText(/enquiry received/i)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

// ---------------------------------------------------------------------------
// OWNER/QUOTE MATTE PASS. "Leave this quote?" exit-confirmation action
// hierarchy: Keep editing is now the primary (safe/default) action; Save &
// close and Discard and close keep their exact prior behaviour.
// ---------------------------------------------------------------------------

describe('"Leave this quote?" exit-confirmation hierarchy', () => {
  it("Keep editing (the primary action) closes the dialog and restores focus to the close button", async () => {
    const user = userEvent.setup();
    renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    const closeButton = desktopCloseButton();
    await user.click(closeButton);
    expect(screen.getByText(/leave this quote/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^keep editing$/i }));
    expect(screen.queryByText(/leave this quote/i)).not.toBeInTheDocument();
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it("Save & close (secondary) still calls onClose, preserving the saved draft", async () => {
    const user = userEvent.setup();
    const { onClose } = renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    await user.click(desktopCloseButton());
    await user.click(screen.getByRole("button", { name: /^save & close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(loadQuoteDraft()).not.toBeNull();
  });

  it("Discard and close (quiet destructive) still resets to a blank step-1 draft and calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    await user.click(desktopCloseButton());
    await user.click(screen.getByRole("button", { name: /discard and close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // handleStartOver clears the old draft, resets the form, then the
    // step-change effect immediately persists a fresh blank one — so the
    // observable result is a step-1 draft with none of the discarded
    // values, not a literal null (unchanged from this action's prior
    // behaviour; this test only pins it down).
    expect(loadQuoteDraft()?.step).toBe(1);
    expect(loadQuoteDraft()?.values.sellerName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 22/23/24. Close guard: Continue path, Stop-and-close path
// ---------------------------------------------------------------------------

describe("close guard while submitting", () => {
  it("Continue submitting keeps the same in-flight run alive", async () => {
    let resolveInitiate!: (v: InitiateTransportResult) => void;
    const gate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => gate });
    const { onClose } = renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await userEvent.click(desktopCloseButton());

    expect(screen.getByText(/still submitting your request/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /continue submitting/i }));

    expect(screen.queryByText(/still submitting your request/i)).not.toBeInTheDocument();
    resolveInitiate(initiateOk());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Stop and close aborts, waits for the safe aborted outcome, preserves recovery state, then closes", async () => {
    let rejectInitiate: ((reason?: unknown) => void) | undefined;
    const transport = createFakeTransport({
      initiate: (_req, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () =>
            resolve({ ok: false, transportFailure: "aborted" }),
          );
          rejectInitiate = () => resolve({ ok: false, transportFailure: "aborted" });
        }),
    });
    const { onClose } = renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await userEvent.click(desktopCloseButton());
    await userEvent.click(screen.getByRole("button", { name: /stop and close/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(loadSubmissionAttempt().kind).toBe("pre_initiate"); // preserved, not corrupted
    void rejectInitiate;
  });
});

// ---------------------------------------------------------------------------
// 25/26. Focus and aria-live/aria-busy
// ---------------------------------------------------------------------------

describe("focus and aria-live", () => {
  it("focuses Continue submitting on open, and restores focus to the close button on Continue", async () => {
    const transport = createFakeTransport({ initiate: async () => new Promise(() => undefined) });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    const closeButton = desktopCloseButton();
    await userEvent.click(closeButton);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue submitting/i })).toHaveFocus(),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue submitting/i }));
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it("the status region is a single persistent aria-live=polite node", () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });
});

// ---------------------------------------------------------------------------
// C2L-Q. Review scroll architecture fix: Review shares the same static
// QuoteNavigation footer as every other stage instead of owning its own
// sticky one.
// ---------------------------------------------------------------------------

describe("C2L-Q shared footer on Review", () => {
  it("renders exactly one Submit/Retry action, and Back jumps to the previous stage", async () => {
    const user = userEvent.setup();
    renderOnReview(validSellerValues(), sellerContext, createFakeTransport());

    expect(
      screen.getAllByRole("button", { name: /submit request|retry submission/i }),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByText(/how should we contact you/i)).toBeInTheDocument();
  });

  it("Back does not navigate away while a submission is in flight", async () => {
    const user = userEvent.setup();
    let resolveInitiate!: (v: InitiateTransportResult) => void;
    const gate = new Promise<InitiateTransportResult>((resolve) => {
      resolveInitiate = resolve;
    });
    const transport = createFakeTransport({ initiate: async () => gate });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await user.click(submitButton());
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByText(/review and send your request/i)).toBeInTheDocument();

    resolveInitiate(initiateOk());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// 27. No sensitive values rendered or logged
// ---------------------------------------------------------------------------

describe("no sensitive values rendered or logged", () => {
  it("never logs to the console during a full successful submission", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("the confirmation screen never renders the leadId, idempotency key or a storage path", async () => {
    const transport = createFakeTransport();
    const { container } = renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());

    expect(container.textContent).not.toContain(LEAD_ID);
    expect(container.textContent).not.toContain("leads/");
  });
});

// ---------------------------------------------------------------------------
// 28/29. Draft hydration, corrupt/expired draft fail-closed
// ---------------------------------------------------------------------------

describe("draft hydration", () => {
  it("hydrates saved values and step on mount", () => {
    saveQuoteDraft(5, validSellerValues({ sellerName: "Restored Name" }));
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    // internal step 5 -> stage 4 (Contact & Evidence) via stageOf.
    expectStageLabel(4);
  });

  it("fails closed on a corrupt draft without crashing the UI", () => {
    window.sessionStorage.setItem("msm-quote-draft-v1", "{not valid json");
    expect(() =>
      render(
        <QuoteExperience
          mode="standalone"
          initialContext={sellerContext}
          onClose={vi.fn()}
          transport={createFakeTransport()}
          turnstileWidget={FakeTurnstileWidget}
        />,
      ),
    ).not.toThrow();
    expectStageLabel(1);
  });

  it("fails closed on an expired draft, starting fresh at step 1", () => {
    const expired = {
      version: 2,
      step: 5,
      values: { sellerName: "Old Name" },
      hadSellerPhotos: false,
      hadBuyerDocuments: false,
      savedAt: Date.now() - 25 * 60 * 60 * 1000,
      attempt: { kind: "none" },
    };
    window.sessionStorage.setItem("msm-quote-draft-v1", JSON.stringify(expired));
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expectStageLabel(1);
  });
});

// ---------------------------------------------------------------------------
// C2L-Q1. Five-stage presentation: labels, combined stage-2 validation,
// legacy six-step draft migration, stage Edit mappings, WhatsApp gating.
// ---------------------------------------------------------------------------

describe("C2L-Q1 five-stage presentation", () => {
  it("shows 5 total stages and the Enquiry Type title on mount", () => {
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expectStageLabel(1);
    expect(screen.getAllByText(/request type/i).length).toBeGreaterThan(0);
  });

  it("legacy internal step 2 (old Material) and step 3 (old Material Details) both land on stage 2, not a separate stage 3", () => {
    saveQuoteDraft(3, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expectStageLabel(2);
    expect(screen.getAllByText(/material details/i).length).toBeGreaterThan(0);
  });

  it("a fresh 5-stage draft (internal step 4, Location & Logistics) is not remapped again — stays on the same stage across a remount", () => {
    saveQuoteDraft(4, validSellerValues());
    const { unmount } = render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expectStageLabel(3);
    unmount();
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expectStageLabel(3);
  });

  it("Continue on the combined Material & Requirements stage validates both material and quantity/condition together, focusing the first invalid field", async () => {
    const user = userEvent.setup();
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    await user.click(screen.getByRole("radio", { name: /sell scrap to msm/i }));
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expectStageLabel(2);
    // Neither material nor condition/quantity has been chosen yet — Continue must not advance.
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expectStageLabel(2);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("buyer local/import/export logistics stages render their own required destination fields", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(
      4,
      validBuyerValues({ buyerTradeRequirement: "import", buyerDestinationEmirate: undefined }),
    );
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByText(/where should the imported material arrive/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("seller pickup 'Yes' still requires a valid (non-past) pickup date before Continue advances", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(
      4,
      validSellerValues({ sellerPickupRequired: "yes", sellerPickupDate: "2000-01-01" }),
    );
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expectStageLabel(3);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("Review's Edit actions map to the correct new stage (material/details -> 2, location/logistics -> 3, contact/evidence -> 4)", async () => {
    const user = userEvent.setup();
    renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    await user.click(editButtons[1]!); // Material
    expectStageLabel(2);
  });

  it("never shows a pre-submission WhatsApp control on Review", () => {
    renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    expect(screen.queryByRole("link", { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  it("offers a WhatsApp follow-up carrying the reference only after genuine success", async () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);
    await userEvent.click(submitButton());
    const link = await screen.findByRole("link", { name: /whatsapp/i });
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain("MSM-260101-ABCDEF");
  });
});

// ---------------------------------------------------------------------------
// 30. File objects/storagePath remain unpersisted (component-level proof;
// the exhaustive schema-level proof already lives in quote-storage.test.ts)
// ---------------------------------------------------------------------------

describe("no File objects or storagePath persisted", () => {
  it("the persisted draft after typing never contains a storagePath key, and typed answers round-trip as plain data", async () => {
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
    await openEvidenceDisclosure("seller");
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);

    const raw = window.sessionStorage.getItem("msm-quote-draft-v1") ?? "";
    expect(raw).not.toContain("storagePath");
    expect(raw).not.toMatch(/"file":\s*{/); // no File/Blob object ever serialized
  });
});

// ---------------------------------------------------------------------------
// 31. Responsive structure (component-level only — jsdom does no real layout)
// ---------------------------------------------------------------------------

describe("responsive structure", () => {
  // C2L-Q2 — the former separate desktop-rail/mobile-sticky-header pair was
  // replaced by one compact top header shared by every viewport, so there
  // is now exactly one close control, not two.
  it("renders exactly one close control from the shared compact header", () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);
    const closeButtons = screen.getAllByRole("button", { name: /close quote experience/i });
    expect(closeButtons).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// C2L-Q2. Compact header, Contact-stage Email/Company disclosure.
// ---------------------------------------------------------------------------

describe("C2L-Q2 shell polish", () => {
  it("no longer renders a persistent answered-values list ('Your Request')", () => {
    // Exact-string, case-sensitive match — deliberately not a case-insensitive
    // regex, since Review's own heading legitimately contains the lowercase
    // substring "your request" ("Review and send your request").
    renderOnReview(validSellerValues(), sellerContext, createFakeTransport());
    expect(screen.queryByText("Your Request")).not.toBeInTheDocument();
  });

  it("Email is hidden by default on Contact & Evidence and reveals once Email is chosen as preferred contact", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues({ sellerPreferredContact: "whatsapp" }));
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /^email$/i }));
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
  });

  it("a restored draft with an existing email reopens the Email field even though Email isn't the preferred contact", () => {
    saveQuoteDraft(
      5,
      validSellerValues({ sellerPreferredContact: "whatsapp", sellerEmail: "ahmed@example.com" }),
    );
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByLabelText(/^email/i)).toHaveValue("ahmed@example.com");
  });

  // CHECKPOINT C2J-E — the seller Email label now matches the schema's own
  // conditional requirement (sellerPreferredContact === "email" makes
  // sellerEmail required, see quote-schema.ts) instead of always reading
  // "(optional)" even when the field was actually required to submit.
  it("labels Email 'required' once Email is chosen as preferred contact", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues({ sellerPreferredContact: "whatsapp" }));
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    await user.click(screen.getByRole("radio", { name: /^email$/i }));
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it("labels Email 'optional' when it's visible but not the preferred contact", () => {
    saveQuoteDraft(
      5,
      validSellerValues({ sellerPreferredContact: "whatsapp", sellerEmail: "ahmed@example.com" }),
    );
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("Company is hidden behind 'Add company details (optional)' until opened", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.queryByLabelText(/^company/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add company details/i }));
    expect(screen.getByLabelText(/^company/i)).toBeInTheDocument();
  });

  it("Start over is hidden until an enquiry type has been chosen", () => {
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.queryByRole("button", { name: /^start over$/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// C2L-Q3. Start over moved from the header into the footer beside Back.
// ---------------------------------------------------------------------------

describe("C2L-Q3 footer Start over", () => {
  it("once meaningful progress exists, Start over is reachable from the footer (beside Back) and still resets to Step 1", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(3, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const startOver = screen.getByRole("button", { name: /^start over$/i });
    const backButton = screen.getByRole("button", { name: /^back$/i });
    // Same footer row as Back, not the header.
    expect(startOver.closest("div")).toBe(backButton.closest("div"));

    await user.click(startOver);
    await user.click(screen.getByRole("button", { name: /discard and start over/i }));
    expectStageLabel(1);
  });
});

// ---------------------------------------------------------------------------
// C2L-Q4. Evidence panel visibly communicates "recommended, not required".
// ---------------------------------------------------------------------------

describe("C2L-Q4 evidence panel", () => {
  // CHECKPOINT C2L (surgical contact photo fix) — the disclosure trigger now
  // shows a plain heading ("Photos (optional)" / "Documents (optional)")
  // plus one separate "Recommended" badge, replacing the old combined
  // "Recommended · optional" string for both branches.
  it("labels the buyer evidence disclosure 'Documents (optional)' with a separate Recommended badge", () => {
    saveQuoteDraft(5, validBuyerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByText("Documents (optional)")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.queryByText("Recommended · optional")).not.toBeInTheDocument();
  });

  it("labels the seller evidence disclosure 'Photos (optional)' with a separate Recommended badge", () => {
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByText("Photos (optional)")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.queryByText("Recommended · optional")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// C2L-Q5. Evidence disclosure: closed default, expansion, file-present
// open state, restored-draft/error open state.
// ---------------------------------------------------------------------------

describe("C2L-Q5 evidence disclosure", () => {
  it("is closed by default on a fresh form, hiding the uploader", () => {
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const trigger = screen.getByRole("button", { name: /photos \(optional\)/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Add photos", { selector: "input" })).not.toBeInTheDocument();
  });

  it("expands on click to reveal the uploader, with correct aria-expanded state", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const trigger = screen.getByRole("button", { name: /photos \(optional\)/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Add photos", { selector: "input" })).toBeInTheDocument();
  });

  // CHECKPOINT C2L (surgical contact photo fix) — verifies the third
  // required Contact state: an uploaded thumbnail rendered beside the
  // compact upload tile, with its own remove control and an updated count.
  it("shows an uploaded thumbnail with a remove control beside the upload tile", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    await openEvidenceDisclosure("seller");
    const file = new File([new Uint8Array(100)], "site-photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);

    expect(screen.getByRole("button", { name: /remove site-photo\.jpg/i })).toBeInTheDocument();
    expect(screen.getByText(/1 of 5 photos added/i)).toBeInTheDocument();
    // The tile itself stays available (relabelled "Add more") since there's still room.
    expect(screen.getByLabelText("Add photos", { selector: "input" })).toBeInTheDocument();
  });

  it("re-opens automatically once a file already exists (e.g. after navigating away and back)", async () => {
    const user = userEvent.setup();
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    await openEvidenceDisclosure("seller");
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);

    // Continue to Review, then Edit back into Contact (the last of the 4
    // seller sections) — ContactEvidenceStep remounts fresh.
    await user.click(screen.getByRole("button", { name: /review request/i }));
    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    await user.click(editButtons[editButtons.length - 1]!);

    expect(screen.getByRole("button", { name: /photos \(optional\)/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Add photos", { selector: "input" })).toBeInTheDocument();
  });

  it("re-opens automatically when a restored draft indicates files existed before (guidance to re-add them)", () => {
    saveQuoteDraft(5, { ...validSellerValues(), sellerPhotos: [{} as never] });
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByRole("button", { name: /photos \(optional\)/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/aren't saved — please add them again/i)).toBeInTheDocument();
  });

  it("re-opens automatically when an unresolved-file submission error exists", async () => {
    const transport = createFakeTransport({
      initiate: async () =>
        initiateOk([
          slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "missing.jpg" }),
        ]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/how should we contact you/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /photos \(optional\)/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("missing.jpg");
  });
});

// ---------------------------------------------------------------------------
// BUYER GET QUOTE — FINAL FRICTION PASS. Required-first hierarchy: Spec/grade
// moved below Supply route and collapsed by default.
// ---------------------------------------------------------------------------

describe("buyer Material required-first hierarchy", () => {
  it("hides Specification / grade behind a closed disclosure on a fresh buyer form", () => {
    saveQuoteDraft(2, validBuyerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.queryByLabelText(/specification \/ grade/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add specification \/ grade/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reopens Specification / grade automatically when a restored draft already has a value", () => {
    saveQuoteDraft(2, validBuyerValues({ materialSpec: "6063-T5, mill finish" }));
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByLabelText(/specification \/ grade/i)).toHaveValue("6063-T5, mill finish");
  });

  it("keeps Required quantity, Unit and Supply route ahead of the collapsed Specification / grade section", () => {
    saveQuoteDraft(2, validBuyerValues());
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={buyerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    const body = document.body.innerHTML;
    const quantityIndex = body.indexOf("Required quantity");
    const supplyRouteIndex = body.indexOf("Supply route");
    const specIndex = body.indexOf("Add specification");
    expect(quantityIndex).toBeGreaterThan(-1);
    expect(supplyRouteIndex).toBeGreaterThan(quantityIndex);
    expect(specIndex).toBeGreaterThan(supplyRouteIndex);
  });
});

// ---------------------------------------------------------------------------
// C2Q-FINAL. Step 1 confidence line.
// ---------------------------------------------------------------------------

describe("C2Q-FINAL Request stage confidence line", () => {
  it("shows the low-commitment reassurance line beneath the supporting sentence", () => {
    render(
      <QuoteExperience
        mode="standalone"
        initialContext={sellerContext}
        onClose={vi.fn()}
        transport={createFakeTransport()}
        turnstileWidget={FakeTurnstileWidget}
      />,
    );
    expect(screen.getByText(/takes about 2 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
  });
});
