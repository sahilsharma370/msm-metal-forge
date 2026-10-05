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
    // Batch A — buyer's WhatsApp link is now labelled "Chat on WhatsApp"
    // (an explicitly optional action), not seller's "Continue on
    // WhatsApp" — the link/action itself is still unchanged, only its
    // accessible name differs by intent, so this query is updated to
    // match.
    const link = screen.getByRole("link", { name: /chat on whatsapp/i });
    const message = decodeURIComponent((link.getAttribute("href") ?? "").split("?text=")[1] ?? "");
    expect(message).toContain("My reference is MSM-260826-112233.");
  });

  it("still links to the canonical company number and template for a buyer submission — only the label changed", () => {
    render(
      <QuoteConfirmation
        values={baseValues({ intent: "buy" })}
        reference="MSM-260826-112233"
        onReturnToWebsite={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /chat on whatsapp/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("https://wa.me/971508491233?text=")).toBe(true);
  });

  it("seller keeps the exact existing 'Continue on WhatsApp' label, unchanged", () => {
    render(
      <QuoteConfirmation values={baseValues()} reference="MSM-260826-ABCDEF" onReturnToWebsite={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: /continue on whatsapp/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /chat on whatsapp/i })).not.toBeInTheDocument();
  });

  it.each([
    ["call", "Call"],
    ["whatsapp", "WhatsApp"],
    ["email", "Email"],
  ] as const)(
    "buyer confirmation states the submitted preference as a fact ('Preferred contact: %s'), not a contact promise",
    (value, label) => {
      render(
        <QuoteConfirmation
          values={baseValues({ intent: "buy", buyerPreferredContact: value })}
          reference="MSM-260826-112233"
          onReturnToWebsite={vi.fn()}
        />,
      );
      expect(screen.getByText(`Preferred contact: ${label}`)).toBeInTheDocument();
      expect(screen.queryByText(/MSM will contact you via/i)).not.toBeInTheDocument();
    },
  );

  it("seller confirmation never shows the buyer-only preferred-contact line", () => {
    render(
      <QuoteConfirmation
        values={baseValues({ sellerPreferredContact: "whatsapp" })}
        reference="MSM-260826-ABCDEF"
        onReturnToWebsite={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Preferred contact:/i)).not.toBeInTheDocument();
  });
});
