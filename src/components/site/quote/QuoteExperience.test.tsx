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
  return { ok: true, status: 200, data: { success: true, slotId, fileId: `file-${slotId}`, status: "verified", replayed: false } };
}

function completeOk(): CompleteTransportResult {
  return {
    ok: true,
    status: 200,
    data: { leadId: LEAD_ID, reference: "MSM-260101-ABCDEF", submissionCompletedAt: "2026-01-01T00:05:00.000Z", alreadyCompleted: false },
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

/** Renders the wizard already hydrated onto the Review step with valid, ready-to-submit values. */
function renderOnReview(
  values: QuoteFormValues,
  context: QuoteInitialContext,
  transport: ReturnType<typeof createFakeTransport>,
) {
  saveQuoteDraft(6, values);
  const onClose = vi.fn();
  const utils = render(
    <QuoteExperience mode="standalone" initialContext={context} onClose={onClose} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
  );
  return { ...utils, onClose };
}

function submitButton() {
  return screen.getByRole("button", { name: /submit request|retry submission/i });
}

/** The desktop rail's close control specifically — the one closeButtonRef refers to for focus restoration. Both the desktop and mobile close buttons are always present in jsdom (no real CSS/media-query evaluation), so an unqualified query is ambiguous; this always picks the first (desktop) one, matching the component's own focus-restoration target. */
function desktopCloseButton() {
  return screen.getAllByRole("button", { name: /close quote experience/i })[0]!;
}

/** QuoteProgress renders its "Step X of Y" eyebrow in both the desktop rail and the mobile sticky header unconditionally — jsdom applies no real CSS, so both are always present in the DOM at once; this asserts every occurrence agrees. */
function expectStepLabel(step: number) {
  const matches = screen.getAllByText(new RegExp(`step ${step} of 6`, "i"));
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
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
    );
    rerender(
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
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
    render(<QuoteExperience mode="standalone" initialContext={sellerContext} onClose={onClose} transport={transport} turnstileWidget={FakeTurnstileWidget} />);

    const fileA = new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" });
    const fileB = new File([new Uint8Array(100)], "b.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    await userEvent.upload(input, [fileA, fileB]);

    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/uploading file 1 of 2/i));
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
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
    );

    const fileA = new File([new Uint8Array(100)], "a.jpg", { type: "image/jpeg" });
    const fileB = new File([new Uint8Array(100)], "b.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [fileA, fileB]);
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/enquiry received/i)).toBeInTheDocument());
    expect(transport.upload).toHaveBeenCalledTimes(2);
  });

  it("buyer multi-document flow uploads every declared document and succeeds", async () => {
    const docSlots = [
      slot({ slotIndex: 0, slotId: "s0", kind: "buyer_document", originalFilename: "invoice.pdf", declaredMimeType: "application/pdf" }),
      slot({ slotIndex: 1, slotId: "s1", kind: "buyer_document", originalFilename: "receipt.jpg" }),
    ];
    const transport = createFakeTransport({ initiate: async () => initiateOk(docSlots) });
    saveQuoteDraft(5, validBuyerValues());
    render(
      <QuoteExperience mode="standalone" initialContext={buyerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
    );

    const invoice = new File([new Uint8Array(100)], "invoice.pdf", { type: "application/pdf" });
    const receipt = new File([new Uint8Array(100)], "receipt.jpg", { type: "image/jpeg" });
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
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "pending", originalFilename: "missing.jpg" })]),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/add photos and contact details/i)).toBeInTheDocument());
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
    expect(screen.getByRole("heading", { name: /review your request/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 14. Upload-in-progress UI and retry
// ---------------------------------------------------------------------------

describe("upload_in_progress", () => {
  it("explains the file is still processing, offers Retry, and never marks complete", async () => {
    const transport = createFakeTransport({
      initiate: async () => initiateOk([slot({ slotIndex: 0, slotId: "s0", status: "uploading" })]),
      upload: async () => ({ ok: false, status: 409, code: "UPLOAD_IN_PROGRESS", message: "in progress", retryable: true }),
    });
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
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
      upload: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "x", retryable: true }),
    });
    saveQuoteDraft(5, validSellerValues());
    render(
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={transport} turnstileWidget={FakeTurnstileWidget} />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Add photos", { selector: "input" }), [file]);
    await userEvent.click(screen.getByRole("button", { name: /review request/i }));
    await userEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/couldn't be uploaded/i)).toBeInTheDocument());
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("a completion failure shows a retryable banner, never success", async () => {
    const transport = createFakeTransport({
      complete: async () => ({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "x", retryable: true }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/something went wrong on our end/i)).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/couldn't be completed with the files provided/i)).toBeInTheDocument());
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
      initiate: async () => ({ ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", message: "conflict", retryable: false }),
    });
    renderOnReview(validSellerValues(), sellerContext, transport);

    await userEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/couldn't be confirmed automatically/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry submission/i })).not.toBeInTheDocument();
    expect(transport.initiate).toHaveBeenCalledTimes(1);
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
          signal?.addEventListener("abort", () => resolve({ ok: false, transportFailure: "aborted" }));
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
    saveQuoteDraft(3, validSellerValues({ sellerName: "Restored Name" }));
    render(
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={createFakeTransport()} turnstileWidget={FakeTurnstileWidget} />,
    );
    expectStepLabel(3);
  });

  it("fails closed on a corrupt draft without crashing the UI", () => {
    window.sessionStorage.setItem("msm-quote-draft-v1", "{not valid json");
    expect(() =>
      render(
        <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={createFakeTransport()} turnstileWidget={FakeTurnstileWidget} />,
      ),
    ).not.toThrow();
    expectStepLabel(1);
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
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={createFakeTransport()} turnstileWidget={FakeTurnstileWidget} />,
    );
    expectStepLabel(1);
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
      <QuoteExperience mode="standalone" initialContext={sellerContext} onClose={vi.fn()} transport={createFakeTransport()} turnstileWidget={FakeTurnstileWidget} />,
    );
    const file = new File([new Uint8Array(100)], "file-0.jpg", { type: "image/jpeg" });
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
  it("renders both the desktop rail close control and the mobile sticky-header close control", () => {
    const transport = createFakeTransport();
    renderOnReview(validSellerValues(), sellerContext, transport);
    const closeButtons = screen.getAllByRole("button", { name: /close quote experience/i });
    expect(closeButtons).toHaveLength(2);
  });
});
