import { describe, expect, it } from "vitest";
import { outcomeBanner, progressPhaseText, unresolvedFilenames } from "./quote-submission-copy";
import type { QuoteSubmissionOutcome } from "./quote-submission-engine";

describe("progressPhaseText", () => {
  it("returns an empty string when there is no active phase", () => {
    expect(progressPhaseText(null)).toBe("");
  });

  it("renders file-count progress, never a fabricated percentage", () => {
    const text = progressPhaseText({
      phase: "uploading",
      slotIndex: 1,
      slotId: "s1",
      uploadedCount: 1,
      totalCount: 3,
    });
    expect(text).toBe("Uploading file 2 of 3…");
    expect(text).not.toMatch(/%/);
  });

  it.each([
    ["computing_identity", "Validating details…"],
    ["initiating", "Creating or recovering your enquiry…"],
    ["resolving_slots", "Preparing your files…"],
    ["completing", "Finalizing your enquiry…"],
  ] as const)("maps phase=%s to truthful copy", (phase, expected) => {
    expect(progressPhaseText({ phase })).toBe(expected);
  });
});

describe("outcomeBanner — exhaustive per-kind mapping", () => {
  const leadId = "11111111-1111-1111-1111-111111111111";
  const reference = "MSM-260101-ABCDEF";

  it("returns null for success — the confirmation screen owns that outcome, never a Review banner", () => {
    expect(
      outcomeBanner({
        kind: "success",
        leadId,
        reference,
        submissionCompletedAt: "2026-01-01T00:00:00.000Z",
        alreadyCompleted: false,
      }),
    ).toBeNull();
  });

  it("returns null for aborted — never shown as an error", () => {
    expect(outcomeBanner({ kind: "aborted" })).toBeNull();
  });

  it("returns null for needs_reselection — handled via step navigation, not a Review banner", () => {
    expect(outcomeBanner({ kind: "needs_reselection", leadId, reference, slots: [] })).toBeNull();
  });

  it("returns null for content_mismatch — handled via step navigation", () => {
    expect(
      outcomeBanner({ kind: "content_mismatch", leadId, reference, slotIndex: 0, slotId: "s0" }),
    ).toBeNull();
  });

  it("returns a fallback banner for validation_error — usually superseded by step navigation, but never silently blank", () => {
    const banner = outcomeBanner({ kind: "validation_error", issues: [] });
    expect(banner).not.toBeNull();
    expect(banner?.showRetry).toBe(false);
  });

  it("returns a fallback banner for server_rejected — usually superseded by step navigation, but never silently blank", () => {
    const banner = outcomeBanner({ kind: "server_rejected", issues: [] });
    expect(banner).not.toBeNull();
    expect(banner?.showRetry).toBe(false);
  });

  it("marks upload_in_progress retryable, never terminal", () => {
    const banner = outcomeBanner({
      kind: "upload_in_progress",
      leadId,
      reference,
      slotIndex: 0,
      slotId: "s0",
    });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
  });

  it("marks network_error retryable", () => {
    const banner = outcomeBanner({ kind: "network_error", retryable: true });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
  });

  it("marks server_error retryable", () => {
    const banner = outcomeBanner({ kind: "server_error", retryable: true });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
  });

  it("server_error carries the QT-SRV code — a genuine server-returned failure", () => {
    const banner = outcomeBanner({ kind: "server_error", retryable: true });
    expect(banner?.message).toContain("QT-SRV");
    expect(banner?.message).not.toContain("QT-CLI");
  });

  it("client_exception shows the same customer-facing wording and retry affordance as server_error", () => {
    const banner = outcomeBanner({ kind: "client_exception", retryable: true, stage: "initiating" });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
    expect(banner?.message).toContain("Something went wrong on our end");
  });

  it("client_exception carries the QT-CLI code, never QT-SRV — the only visible difference from server_error", () => {
    const serverBanner = outcomeBanner({ kind: "server_error", retryable: true });
    const clientBanner = outcomeBanner({ kind: "client_exception", retryable: true, stage: "initiating" });
    expect(clientBanner?.message).toContain("QT-CLI");
    expect(clientBanner?.message).not.toContain("QT-SRV");
    expect(clientBanner?.message).not.toBe(serverBanner?.message);
  });

  it("client_exception shows the exact same generic message with or without a recovered leadId — REVIEWED, kept generic", () => {
    // An earlier draft branched on `outcome.leadId` to show a more
    // reassuring, non-generic message when the engine had recovered a
    // confirmed lead. That branch was deliberately reverted: this release
    // is scoped to zero NEW customer-facing copy relative to the live
    // site, which shows this exact generic wording for every
    // client_exception today, with or without a recoverable leadId. The
    // engine's leadId recovery itself is untouched — only this banner
    // stopped reading it. See this file's own comment for the full
    // trade-off (retry-safety is unaffected either way; only the
    // customer's awareness of an already-existing lead differs).
    const withoutLead = outcomeBanner({ kind: "client_exception", retryable: true, stage: "computing_identity" });
    const withLead = outcomeBanner({ kind: "client_exception", retryable: true, stage: "uploading", leadId, reference });

    expect(withoutLead?.message).toBe("Something went wrong on our end. Please try again. (Error code: QT-CLI)");
    expect(withLead?.message).toBe(withoutLead?.message);
    expect(withLead?.tone).toBe("retryable");
    expect(withLead?.showRetry).toBe(true);
  });

  it("neither banner ever contains a stack trace, error message, or technical jargon — just the fixed code", () => {
    const serverBanner = outcomeBanner({ kind: "server_error", retryable: true });
    const clientBanner = outcomeBanner({ kind: "client_exception", retryable: true, stage: "initiating" });
    for (const banner of [serverBanner, clientBanner]) {
      expect(banner?.message).not.toMatch(/at \S+:\d+|TypeError|ReferenceError|undefined is not/i);
    }
  });

  it("marks not_ready retryable", () => {
    const banner = outcomeBanner({ kind: "not_ready", leadId, reference });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
  });

  it("marks upload_failed retryable", () => {
    const banner = outcomeBanner({
      kind: "upload_failed",
      leadId,
      reference,
      slotIndex: 0,
      slotId: "s0",
      retryable: true,
    });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
  });

  it("marks idempotency_conflict as a conflict with no retry affordance — never auto-reset/auto-resubmit", () => {
    const banner = outcomeBanner({ kind: "idempotency_conflict" });
    expect(banner?.tone).toBe("conflict");
    expect(banner?.showRetry).toBe(false);
    expect(banner?.message.toLowerCase()).toContain("whatsapp");
  });

  it("marks restart_required terminal, with no retry affordance and no claim of a new lead", () => {
    const banner = outcomeBanner({
      kind: "restart_required",
      leadId,
      reference,
      slotIndex: 0,
      slotId: "s0",
    });
    expect(banner?.tone).toBe("terminal");
    expect(banner?.showRetry).toBe(false);
    expect(banner?.message).not.toMatch(/automatically|new lead/i);
  });

  it("marks human_verification_required retryable, with copy that doesn't leak Siteverify internals", () => {
    const banner = outcomeBanner({ kind: "human_verification_required" });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
    expect(banner?.message.toLowerCase()).not.toMatch(/turnstile|siteverify|token|cloudflare/);
  });

  it("marks rate_limited retryable, with copy that never mentions an IP or internal counter", () => {
    const banner = outcomeBanner({ kind: "rate_limited", retryable: true });
    expect(banner?.tone).toBe("retryable");
    expect(banner?.showRetry).toBe(true);
    expect(banner?.message.toLowerCase()).not.toMatch(/ip|counter|limiter|binding/);
  });

  it("every kind of QuoteSubmissionOutcome is handled (exhaustive switch — compile-time guaranteed, this just documents the set)", () => {
    const kinds: QuoteSubmissionOutcome["kind"][] = [
      "success",
      "validation_error",
      "needs_reselection",
      "restart_required",
      "upload_in_progress",
      "content_mismatch",
      "upload_failed",
      "idempotency_conflict",
      "not_ready",
      "server_rejected",
      "network_error",
      "server_error",
      "human_verification_required",
      "rate_limited",
      "aborted",
    ];
    expect(kinds).toHaveLength(15);
  });
});

describe("unresolvedFilenames", () => {
  it("extracts declaration filenames from needs_reselection, in order", () => {
    const outcome: QuoteSubmissionOutcome = {
      kind: "needs_reselection",
      leadId: "l1",
      reference: "r1",
      slots: [
        {
          slotIndex: 0,
          slotId: "s0",
          declaration: { originalFilename: "a.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 100 },
        },
        {
          slotIndex: 1,
          slotId: "s1",
          declaration: { originalFilename: "b.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 200 },
        },
      ],
    };
    expect(unresolvedFilenames(outcome)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("uses the supplied mismatch filename for content_mismatch", () => {
    const outcome: QuoteSubmissionOutcome = {
      kind: "content_mismatch",
      leadId: "l1",
      reference: "r1",
      slotIndex: 0,
      slotId: "s0",
    };
    expect(unresolvedFilenames(outcome, "original.jpg")).toEqual(["original.jpg"]);
  });

  it("returns an empty list for content_mismatch with no known filename", () => {
    const outcome: QuoteSubmissionOutcome = {
      kind: "content_mismatch",
      leadId: "l1",
      reference: "r1",
      slotIndex: 0,
      slotId: "s0",
    };
    expect(unresolvedFilenames(outcome)).toEqual([]);
  });

  it("returns an empty list for every other outcome kind", () => {
    expect(unresolvedFilenames({ kind: "aborted" })).toEqual([]);
    expect(unresolvedFilenames({ kind: "idempotency_conflict" })).toEqual([]);
  });
});
