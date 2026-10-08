import { describe, expect, it, vi } from "vitest";
import { createFetchQuoteTransport } from "./quote-submission-transport";
import type { SubmissionShape, CanonicalFileDeclaration } from "./quote-submission-identity";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validSubmission: SubmissionShape = {
  intent: "sell",
  source: "hero",
  material: "copper",
  sellerName: "Ahmed Seller",
  sellerPhone: "+971501234567",
} as SubmissionShape;

const oneFile: readonly CanonicalFileDeclaration[] = [
  { original_filename: "a.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 100 },
];

describe("createFetchQuoteTransport — initiate", () => {
  it("POSTs to /api/quote/initiate with the exact expected JSON body and headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: { leadId: "l1", reference: "MSM-000001", idempotentReplay: false, uploadSlots: [] },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: oneFile, turnstileToken: "test-turnstile-token" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/quote/initiate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({ idempotencyKey: "k1", submission: validSubmission, files: oneFile, turnstileToken: "test-turnstile-token" });
  });

  it("returns ok:true with the parsed data on a well-formed success body", async () => {
    const slot = {
      slotId: "s1",
      slotIndex: 0,
      kind: "seller_photo",
      status: "pending",
      storagePath: "leads/x/slot-0-s1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      originalFilename: "a.jpg",
      declaredMimeType: "image/jpeg",
      declaredByteSize: 100,
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: { leadId: "l1", reference: "MSM-000001", idempotentReplay: true, uploadSlots: [slot] },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: oneFile, turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.leadId).toBe("l1");
      expect(result.data.uploadSlots[0]).toEqual(slot);
    }
  });

  it("maps a well-formed error body to a typed API error with derived retryable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        error: { code: "IDEMPOTENCY_CONFLICT", message: "This request was already submitted with different details." },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    if (!result.ok && !result.transportFailure) {
      expect(result.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(result.retryable).toBe(false);
    }
  });

  it("derives retryable:true only for INTERNAL_ERROR", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }));
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    if (!result.ok && !result.transportFailure) {
      expect(result.retryable).toBe(true);
    }
  });

  it("returns a network_error transportFailure when fetch itself throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.transportFailure).toBe("network_error");
  });

  it("returns a malformed_response transportFailure when the body is not valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.transportFailure).toBe("malformed_response");
  });

  it("returns a malformed_response transportFailure when the JSON body matches neither the success nor the error schema", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, data: { unexpected: "shape" } }));
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.transportFailure).toBe("malformed_response");
  });

  it("returns an aborted transportFailure and never calls fetch when the signal is already aborted", async () => {
    const fetchImpl = vi.fn();
    const transport = createFetchQuoteTransport({ fetchImpl });
    const controller = new AbortController();
    controller.abort();

    const result = await transport.initiate(
      { idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.transportFailure).toBe("aborted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a genuine AbortError thrown by fetch to an aborted transportFailure, not a network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.initiate({ idempotencyKey: "k1", submission: validSubmission, files: [], turnstileToken: "test-turnstile-token" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.transportFailure).toBe("aborted");
  });

  it("a stalled JSON call (initiate) times out into a retryable network_error instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      // Mimics a real stalled fetch: never settles on its own, only reacts
      // to its own signal being aborted — exactly what a genuinely hung
      // connection on a weak mobile network looks like from this module's
      // point of view.
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
      const transport = createFetchQuoteTransport({ fetchImpl });

      const resultPromise = transport.initiate({
        idempotencyKey: "k1",
        submission: validSubmission,
        files: [],
        turnstileToken: "test-turnstile-token",
      });

      await vi.advanceTimersByTimeAsync(30_000);
      const result = await resultPromise;

      expect(result.ok).toBe(false);
      expect(!result.ok && result.transportFailure).toBe("network_error");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retrying after an ambiguous (client-timed-out) initiate on the SAME transport instance still reaches a real outcome", async () => {
    vi.useFakeTimers();
    try {
      // One transport instance, reused for both calls below — this is the
      // one thing last reported inaccurately: an earlier version of this
      // test constructed a second, separate transport for the "retry"
      // call, which cannot demonstrate anything about shared state at
      // all. Here, ONE mutable fetchImpl backs ONE transport instance for
      // both calls: first call hangs (connection appeared stalled — the
      // "ambiguous" case where the server may or may not have actually
      // finished), second call (the retry) gets a normal fast response.
      // The transport layer itself is stateless per call, so nothing here
      // proves server-side idempotency (that is create_website_quote_v1's
      // own job, already covered by initiate-quote.test.ts) — this test
      // only guards that THIS layer never leaves anything (a stuck timer,
      // a dangling listener, a module-level flag) on the SAME instance
      // that would corrupt or block the very next call made on it.
      const fetchImpl = vi.fn();
      fetchImpl.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      });
      fetchImpl.mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          data: { leadId: "l1", reference: "MSM-000001", idempotentReplay: true, uploadSlots: [] },
        }),
      );
      const transport = createFetchQuoteTransport({ fetchImpl });

      const firstAttempt = transport.initiate({
        idempotencyKey: "same-key",
        submission: validSubmission,
        files: [],
        turnstileToken: "test-turnstile-token",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      const firstResult = await firstAttempt;
      expect(!firstResult.ok && firstResult.transportFailure).toBe("network_error");

      // Second call, on the SAME transport instance (the user tapping
      // Retry): nothing from the first call's timer/listener/controller
      // leaks into or blocks this one.
      const secondResult = await transport.initiate({
        idempotencyKey: "same-key",
        submission: validSubmission,
        files: [],
        turnstileToken: "test-turnstile-token",
      });

      expect(secondResult.ok).toBe(true);
      if (secondResult.ok) {
        expect(secondResult.data.idempotentReplay).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createFetchQuoteTransport — upload", () => {
  it("POSTs multipart form data with exactly slotId, idempotencyKey and file", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, data: { success: true, slotId: "s1", fileId: "f1", status: "verified", replayed: false } }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });
    const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });

    await transport.upload({ slotId: "s1", idempotencyKey: "k1", file });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/quote/upload");
    expect(init.method).toBe("POST");
    const formData = init.body as FormData;
    expect(formData.get("slotId")).toBe("s1");
    expect(formData.get("idempotencyKey")).toBe("k1");
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(Array.from(formData.keys()).sort()).toEqual(["file", "idempotencyKey", "slotId"]);
  });

  it("upload has no internal deadline, unlike initiate/complete — fetchImpl resolving well past 30s is never killed", async () => {
    vi.useFakeTimers();
    try {
      // This does NOT simulate measured upload progress (no partial bytes,
      // no XHR/progress events — the Fetch API gives this module no such
      // signal, see the upload call site's own comment on why). It only
      // proves the one thing that's actually implemented and testable at
      // this layer: fetchImpl is free to take arbitrarily long — several
      // multiples of JSON_REQUEST_TIMEOUT_MS below — and this module never
      // aborts it on its own, because no internal timer exists for upload.
      let resolveFetch!: (value: Response) => void;
      const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
      const transport = createFetchQuoteTransport({ fetchImpl });
      const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });

      const resultPromise = transport.upload({ slotId: "s1", idempotencyKey: "k1", file });

      // Advance well past the JSON deadline — several multiples of it —
      // with nothing having aborted the upload.
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      resolveFetch(
        jsonResponse(200, { ok: true, data: { success: true, slotId: "s1", fileId: "f1", status: "verified", replayed: false } }),
      );
      const result = await resultPromise;

      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns ok:true with status verified on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, data: { success: true, slotId: "s1", fileId: "f1", status: "verified", replayed: true } }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });
    const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });

    const result = await transport.upload({ slotId: "s1", idempotencyKey: "k1", file });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("verified");
      expect(result.data.replayed).toBe(true);
    }
  });

  it("passes through the server's own retryable flag for an upload error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        error: { code: "UPLOAD_IN_PROGRESS", message: "An upload is already in progress for this slot. Please wait and try again.", retryable: true },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });
    const file = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });

    const result = await transport.upload({ slotId: "s1", idempotencyKey: "k1", file });
    expect(result.ok).toBe(false);
    if (!result.ok && !result.transportFailure) {
      expect(result.code).toBe("UPLOAD_IN_PROGRESS");
      expect(result.retryable).toBe(true);
    }
  });
});

describe("createFetchQuoteTransport — complete", () => {
  it("POSTs to /api/quote/complete with exactly leadId and idempotencyKey", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: { leadId: "l1", reference: "MSM-000001", submissionCompletedAt: "2026-01-01T00:00:00.000Z", alreadyCompleted: false },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    await transport.complete({ leadId: "l1", idempotencyKey: "k1" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/quote/complete");
    expect(JSON.parse(init.body as string)).toEqual({ leadId: "l1", idempotencyKey: "k1" });
  });

  it("returns not-ready as a typed, retryable API error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        error: { code: "NOT_READY", message: "This quote is not ready to be completed yet — some uploads are still in progress.", retryable: true },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl });

    const result = await transport.complete({ leadId: "l1", idempotencyKey: "k1" });
    expect(result.ok).toBe(false);
    if (!result.ok && !result.transportFailure) {
      expect(result.code).toBe("NOT_READY");
      expect(result.retryable).toBe(true);
    }
  });

  it("prepends the configured baseUrl to the request path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: { leadId: "l1", reference: "MSM-000001", submissionCompletedAt: "2026-01-01T00:00:00.000Z", alreadyCompleted: true },
      }),
    );
    const transport = createFetchQuoteTransport({ fetchImpl, baseUrl: "https://example.test" });

    await transport.complete({ leadId: "l1", idempotencyKey: "k1" });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/api/quote/complete");
  });
});
