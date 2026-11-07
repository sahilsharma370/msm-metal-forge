import { describe, expect, it, vi } from "vitest";
import { sendQuoteClientDiagnosticsBeacon, type QuoteClientDiagnosticsSnapshot } from "./quote-client-diagnostics-beacon";

const SNAPSHOT: QuoteClientDiagnosticsSnapshot = {
  stage: "uploading",
  initiateInvoked: true,
  initiateSettled: true,
  subtleAvailable: true,
  getRandomValuesAvailable: true,
  randomUUIDAvailable: false,
};

describe("sendQuoteClientDiagnosticsBeacon", () => {
  it("POSTs the exact snapshot as JSON to /api/quote/client-diagnostics", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/quote/client-diagnostics");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(SNAPSHOT);
  });

  it("sets keepalive:true — mitigates (never guarantees) loss on a near-immediate page close/navigation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });

  it("honors a baseUrl override, matching quote-submission-transport.ts's own convention", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl, baseUrl: "https://example.test" });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://example.test/api/quote/client-diagnostics");
  });

  it("never throws/rejects when fetch itself rejects (network failure) — resolves silently", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl })).resolves.toBeUndefined();
  });

  it("never throws/rejects on a non-2xx response either — the response is never even inspected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl })).resolves.toBeUndefined();
  });

  it("aborts via its own internal timeout rather than hanging forever on a stalled fetch, and still resolves (never rejects) once that happens", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          // Realistic stand-in for a real fetch() stalled on the network:
          // it settles only when ITS OWN signal aborts, exactly like a
          // genuine fetch would reject with an AbortError at that point.
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      });

      const pending = sendQuoteClientDiagnosticsBeacon(SNAPSHOT, { fetchImpl: fetchImpl as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(3000);

      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
