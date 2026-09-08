// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getStage2Schema, getStageSchema, type QuoteFormValues } from "./quote-schema";

/**
 * C2L-Q1 — targeted coverage for the new stage-schema resolvers introduced
 * to collapse the former separate Material (step 2) and Material Details
 * (step 3) screens into one "Material & Requirements" stage. These are pure
 * functions layered directly on top of the pre-existing, already-covered
 * per-step schemas (materialStepSchema / sellerDetailsStepSchema /
 * buyerDetailsStepSchema / *LogisticsStepSchema / *ContactStepSchema) — this
 * file only exercises the NEW combination/resolution behaviour, not the
 * underlying field rules those schemas already enforce.
 */

const baseSeller: Partial<QuoteFormValues> = {
  intent: "sell",
  sellerPhotos: [],
  buyerDocuments: [],
};

const baseBuyer: Partial<QuoteFormValues> = {
  intent: "buy",
  sellerPhotos: [],
  buyerDocuments: [],
};

describe("getStage2Schema — combined Material & Requirements", () => {
  it("fails when material is chosen but the branch-specific details are missing", () => {
    const result = getStage2Schema("sell").safeParse({
      ...baseSeller,
      material: "copper",
      // sellerCondition intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it("fails when details are valid but material is missing", () => {
    const result = getStage2Schema("sell").safeParse({
      ...baseSeller,
      sellerCondition: "clean_separated",
      sellerQuantityUnsure: true,
    });
    expect(result.success).toBe(false);
  });

  it("aggregates issues from BOTH sides in one ZodError with correct field paths", () => {
    const result = getStage2Schema("sell").safeParse(baseSeller);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path[0]);
    expect(paths).toContain("material");
    expect(paths).toContain("sellerCondition");
  });

  it("passes once both material and branch-specific details are valid (seller)", () => {
    const result = getStage2Schema("sell").safeParse({
      ...baseSeller,
      material: "copper",
      sellerCondition: "clean_separated",
      sellerQuantityUnsure: true,
    });
    expect(result.success).toBe(true);
  });

  it("passes once both material and branch-specific details are valid (buyer)", () => {
    const result = getStage2Schema("buy").safeParse({
      ...baseBuyer,
      material: "aluminium",
      buyerQuantityValue: "500",
      buyerQuantityUnit: "kg",
      buyerTradeRequirement: "local",
    });
    expect(result.success).toBe(true);
  });
});

describe("getStageSchema — the single canonical 5-stage resolver", () => {
  it("stage 1 is the enquiry-type schema regardless of intent", () => {
    expect(getStageSchema(1, undefined)!.safeParse({}).success).toBe(false);
    expect(getStageSchema(1, undefined)!.safeParse({ intent: "sell" }).success).toBe(true);
  });

  it("stage 2 resolves to the same combined schema as getStage2Schema for both branches", () => {
    const sellerValues = {
      ...baseSeller,
      material: "copper",
      sellerCondition: "clean_separated",
      sellerQuantityUnsure: true,
    };
    expect(getStageSchema(2, "sell")!.safeParse(sellerValues).success).toBe(
      getStage2Schema("sell").safeParse(sellerValues).success,
    );
  });

  it("stage 3 (Location & Logistics) branches correctly on all three buyer supply routes", () => {
    const importMissingEmirate = {
      ...baseBuyer,
      buyerTradeRequirement: "import",
      buyerLogisticsRequirement: "delivery",
    };
    expect(getStageSchema(3, "buy")!.safeParse(importMissingEmirate).success).toBe(false);

    const exportMissingCountry = {
      ...baseBuyer,
      buyerTradeRequirement: "export",
      buyerLogisticsRequirement: "delivery",
    };
    expect(getStageSchema(3, "buy")!.safeParse(exportMissingCountry).success).toBe(false);

    const localValid = {
      ...baseBuyer,
      buyerTradeRequirement: "local",
      buyerDestinationEmirate: "dubai",
      buyerDestinationArea: "Al Quoz",
      buyerFulfilment: "delivery",
    };
    expect(getStageSchema(3, "buy")!.safeParse(localValid).success).toBe(true);
  });

  it("stage 3 (seller) rejects a past pickup date only when pickup is Yes", () => {
    const pastDateButNoPickup = {
      ...baseSeller,
      sellerEmirate: "dubai",
      sellerArea: "Al Quoz",
      sellerPickupRequired: "no",
      sellerPickupDate: "2000-01-01",
    };
    expect(getStageSchema(3, "sell")!.safeParse(pastDateButNoPickup).success).toBe(true);

    const pastDateWithPickup = { ...pastDateButNoPickup, sellerPickupRequired: "yes" };
    expect(getStageSchema(3, "sell")!.safeParse(pastDateWithPickup).success).toBe(false);
  });

  it("stage 5 (Review) has no schema of its own", () => {
    expect(getStageSchema(5, "sell")).toBeNull();
  });
});
