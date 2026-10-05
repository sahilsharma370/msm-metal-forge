// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReviewStep } from "./ReviewStep";
import type { QuoteFormValues } from "../quote-schema";

/**
 * Batch B (buyer Import/Export follow-up) — targeted coverage for
 * buyerDestinationRows (the Review "Logistics" card's per-route field
 * mapping), which previously had no dedicated test file. Covers the two
 * behaviours this task was asked to verify by code: each route's own
 * fields surface correctly (including Preferred port's "other" and
 * "no_preference" cases), and a route never displays a field that belongs
 * exclusively to a different route even if a stale value from a prior
 * selection is still sitting in form state.
 */

afterEach(() => {
  cleanup();
});

function baseBuyer(overrides: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    intent: "buy",
    material: "aluminium",
    buyerQuantityValue: "500",
    buyerQuantityUnit: "kg",
    buyerContactPerson: "Fatima Buyer",
    buyerPhone: "0502345678",
    buyerPreferredContact: "whatsapp",
    sellerPhotos: [],
    buyerDocuments: [],
    ...overrides,
  };
}

function renderReview(values: QuoteFormValues) {
  render(
    <ReviewStep
      values={values}
      onEditStep={vi.fn()}
      isSubmitting={false}
      submissionPhase={null}
      submissionOutcome={null}
      turnstileWidget={null}
      turnstileReady={false}
      turnstileExpired={false}
    />,
  );
}

describe("ReviewStep — buyer Import route Logistics card", () => {
  it("shows final delivery emirate, a named preferred port, origin preference and logistics requirement", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "import",
        buyerDestinationEmirate: "dubai",
        buyerPreferredPort: "jebel_ali",
        buyerOriginCountryPreference: "China",
        buyerLogisticsRequirement: "delivery",
      }),
    );
    expect(screen.getByText("Final delivery emirate")).toBeInTheDocument();
    expect(screen.getByText("Dubai")).toBeInTheDocument();
    expect(screen.getByText("Preferred port")).toBeInTheDocument();
    expect(screen.getByText("Jebel Ali")).toBeInTheDocument();
    expect(screen.getByText("Origin preference")).toBeInTheDocument();
    expect(screen.getByText("China")).toBeInTheDocument();
    expect(screen.getByText("Logistics requirement")).toBeInTheDocument();
    expect(screen.getByText("MSM-arranged delivery")).toBeInTheDocument();
  });

  it("shows the typed port name, not the enum label, when preferred port is 'Other'", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "import",
        buyerDestinationEmirate: "sharjah",
        buyerPreferredPort: "other",
        buyerPreferredPortOther: "Hamriyah Port",
        buyerLogisticsRequirement: "collection",
      }),
    );
    expect(screen.getByText("Hamriyah Port")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
  });

  it("shows the 'No preference / Not sure' label when that port option is selected", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "import",
        buyerDestinationEmirate: "abu_dhabi",
        buyerPreferredPort: "no_preference",
        buyerLogisticsRequirement: "discuss",
      }),
    );
    expect(screen.getByText("No preference / Not sure")).toBeInTheDocument();
  });

  it("omits Preferred port and Origin preference rows entirely when left blank, rather than showing an empty value", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "import",
        buyerDestinationEmirate: "dubai",
        buyerLogisticsRequirement: "delivery",
      }),
    );
    expect(screen.queryByText("Preferred port")).not.toBeInTheDocument();
    expect(screen.queryByText("Origin preference")).not.toBeInTheDocument();
  });

  it("never shows Export's Destination row or Local's Fulfilment row", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "import",
        buyerDestinationEmirate: "dubai",
        buyerLogisticsRequirement: "delivery",
      }),
    );
    expect(screen.queryByText("Destination")).not.toBeInTheDocument();
    expect(screen.queryByText("Fulfilment")).not.toBeInTheDocument();
  });
});

describe("ReviewStep — buyer Export route Logistics card", () => {
  it("shows the destination city/country and logistics requirement", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "export",
        buyerDestinationCountry: "Vietnam",
        buyerDestinationCityPort: "Nhava Sheva",
        buyerLogisticsRequirement: "collection",
      }),
    );
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByText("Nhava Sheva, Vietnam")).toBeInTheDocument();
    expect(screen.getByText("Logistics requirement")).toBeInTheDocument();
    // Export's own shipping-specific wording (FULFILMENT_DISPLAY_EXPORT),
    // matching the Logistics card — not the generic "Buyer-arranged
    // collection" Import/Local use.
    expect(screen.getByText("I'll arrange collection/shipping")).toBeInTheDocument();
  });

  it("never shows a UAE final delivery emirate, even if one is still set in form state from a prior Import or Local selection", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "export",
        buyerDestinationCountry: "Vietnam",
        buyerDestinationCityPort: "Nhava Sheva",
        buyerLogisticsRequirement: "collection",
        // Stale value: the route-change handler clears this when switching
        // TO export, but this test asserts the Review layer itself would
        // never surface it even if a future regression stopped clearing it.
        buyerDestinationEmirate: "dubai",
      }),
    );
    expect(screen.queryByText("Final delivery emirate")).not.toBeInTheDocument();
    expect(screen.queryByText("Dubai")).not.toBeInTheDocument();
    expect(screen.queryByText("Preferred port")).not.toBeInTheDocument();
    expect(screen.queryByText("Fulfilment")).not.toBeInTheDocument();
  });

  it("carries an optional logistics note into Review", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "export",
        buyerDestinationCountry: "Vietnam",
        buyerDestinationCityPort: "Nhava Sheva",
        buyerLogisticsRequirement: "collection",
        buyerLogisticsNote: "Needs a 20ft container, sailing after the 10th.",
      }),
    );
    expect(
      screen.getByText("Needs a 20ft container, sailing after the 10th."),
    ).toBeInTheDocument();
  });
});

describe("ReviewStep — buyer Local (Within UAE) route unaffected by Import/Export changes", () => {
  it("still shows Destination and Fulfilment, never Import/Export-only fields", () => {
    renderReview(
      baseBuyer({
        buyerTradeRequirement: "local",
        buyerDestinationEmirate: "dubai",
        buyerDestinationArea: "Al Quoz Industrial 3",
        buyerFulfilment: "delivery",
      }),
    );
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByText("Al Quoz Industrial 3, Dubai")).toBeInTheDocument();
    expect(screen.getByText("Fulfilment")).toBeInTheDocument();
    expect(screen.queryByText("Final delivery emirate")).not.toBeInTheDocument();
    expect(screen.queryByText("Logistics requirement")).not.toBeInTheDocument();
  });
});
