// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QuoteConfirmation } from "./QuoteConfirmation";
import type { QuoteFormValues } from "../quote-schema";

afterEach(() => {
  cleanup();
});

function baseValues(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    intent: "sell",
    sellerPhotos: [],
    buyerDocuments: [],
    ...overrides,
  };
}

describe("QuoteConfirmation — WhatsApp CTA", () => {
  it("links to the canonical company number with the exact confirmation template, including the dynamic reference", () => {
    render(
      <QuoteConfirmation
        values={baseValues()}
        reference="MSM-260826-ABCDEF"
        onReturnToWebsite={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /continue on whatsapp/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("https://wa.me/971508491233?text=")).toBe(true);
    const message = decodeURIComponent(href.split("?text=")[1] ?? "");
    expect(message).toBe("Hello MSM Scrap, I’ve submitted an enquiry. My reference is MSM-260826-ABCDEF.");
  });

  it("carries a different reference through unchanged for a different submission", () => {
    render(
      <QuoteConfirmation
        values={baseValues({ intent: "buy" })}
        reference="MSM-260826-112233"
        onReturnToWebsite={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /continue on whatsapp/i });
    const message = decodeURIComponent((link.getAttribute("href") ?? "").split("?text=")[1] ?? "");
    expect(message).toContain("My reference is MSM-260826-112233.");
  });
});
