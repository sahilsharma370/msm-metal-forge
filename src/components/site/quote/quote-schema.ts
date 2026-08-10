import { z } from "zod";
import type {
  QuoteIntent,
  QuoteInitialContext,
  QuoteMaterialKey,
  QuoteTradeRoute,
} from "./quote-search";
import {
  CONDITIONS,
  EMIRATES,
  FULFILMENT_CHOICES,
  PICKUP_CHOICES,
  PREFERRED_CONTACTS,
  PREFERRED_PORTS,
  QUOTE_UNITS,
} from "./quote-options";

/** A locally-selected photo/document. Never leaves the browser in this pass. */
export interface QuoteLocalFile {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
}

/**
 * Full wizard shape. Every field is optional at the react-hook-form level —
 * branching (seller vs buyer, local vs import/export) means no single step
 * owns a fixed set of required fields, so "required-ness" is enforced by the
 * per-step zod schemas below (run manually on Continue), not by a single
 * whole-form resolver.
 */
export interface QuoteFormValues {
  intent?: QuoteIntent | undefined;

  material?: QuoteMaterialKey | undefined;
  subtype?: string | undefined;
  otherMaterialText?: string | undefined;
  materialSpec?: string | undefined;

  sellerQuantityValue?: string | undefined;
  sellerQuantityUnit?: (typeof QUOTE_UNITS)[number] | undefined;
  sellerQuantityUnsure?: boolean | undefined;
  sellerCondition?: (typeof CONDITIONS)[number] | undefined;
  sellerDescription?: string | undefined;

  buyerQuantityValue?: string | undefined;
  buyerQuantityUnit?: (typeof QUOTE_UNITS)[number] | undefined;
  buyerTradeRequirement?: QuoteTradeRoute | undefined;
  buyerRequiredByDate?: string | undefined;
  buyerAdditionalSpec?: string | undefined;

  sellerEmirate?: (typeof EMIRATES)[number] | undefined;
  sellerArea?: string | undefined;
  sellerMapLink?: string | undefined;
  sellerPickupRequired?: (typeof PICKUP_CHOICES)[number] | undefined;
  sellerPickupDate?: string | undefined;
  sellerAccessNote?: string | undefined;

  buyerDestinationEmirate?: (typeof EMIRATES)[number] | undefined;
  buyerDestinationArea?: string | undefined;
  buyerFulfilment?: (typeof FULFILMENT_CHOICES)[number] | undefined;
  buyerDestinationCountry?: string | undefined;
  buyerDestinationCityPort?: string | undefined;
  buyerPreferredPort?: (typeof PREFERRED_PORTS)[number] | undefined;
  buyerOriginCountryPreference?: string | undefined;
  buyerLogisticsRequirement?: (typeof FULFILMENT_CHOICES)[number] | undefined;
  buyerLogisticsNote?: string | undefined;

  sellerPhotos: QuoteLocalFile[];
  sellerName?: string | undefined;
  sellerPhone?: string | undefined;
  sellerCompany?: string | undefined;
  sellerEmail?: string | undefined;
  sellerPreferredContact?: (typeof PREFERRED_CONTACTS)[number] | undefined;
  sellerNotes?: string | undefined;

  buyerCompany?: string | undefined;
  buyerContactPerson?: string | undefined;
  buyerPhone?: string | undefined;
  buyerEmail?: string | undefined;
  buyerDocuments: QuoteLocalFile[];
  buyerPreferredContact?: (typeof PREFERRED_CONTACTS)[number] | undefined;
  buyerNotes?: string | undefined;
}

export function buildDefaultQuoteValues(context: QuoteInitialContext): QuoteFormValues {
  return {
    intent: context.intent,
    material: context.material,
    buyerTradeRequirement: context.tradeRoute,
    sellerQuantityUnsure: false,
    sellerPhotos: [],
    buyerDocuments: [],
  };
}

/** UAE-friendly but not overly strict: 7-15 digits, optional +, spaces/dashes allowed. */
const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number.")
  .regex(/^\+?[0-9\s-]{7,16}$/, "Enter a valid phone number.");

const requiredText = (message: string) => z.string().trim().min(1, message);

export const enquiryTypeStepSchema = z.object({
  intent: z.enum(["sell", "buy"], { message: "Choose whether you want to sell or buy." }),
});

export const materialStepSchema = z
  .object({
    material: z.enum(["copper", "aluminium", "steel_iron", "lead", "other"], {
      message: "Select a material.",
    }),
    otherMaterialText: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.material === "other" && !val.otherMaterialText?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["otherMaterialText"],
        message: "Describe the material.",
      });
    }
  });

export const sellerDetailsStepSchema = z
  .object({
    sellerQuantityValue: z.string().trim().optional(),
    sellerQuantityUnit: z.enum(QUOTE_UNITS).optional(),
    sellerQuantityUnsure: z.boolean().optional(),
    sellerCondition: z.enum(CONDITIONS, { message: "Select the material condition." }),
  })
  .superRefine((val, ctx) => {
    if (val.sellerQuantityUnsure) return;
    if (!val.sellerQuantityValue?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sellerQuantityValue"],
        message: "Enter an approximate quantity or mark it as unsure.",
      });
    }
    if (!val.sellerQuantityUnit) {
      ctx.addIssue({ code: "custom", path: ["sellerQuantityUnit"], message: "Select a unit." });
    }
  });

export const buyerDetailsStepSchema = z.object({
  buyerQuantityValue: requiredText("Enter the required quantity."),
  buyerQuantityUnit: z.enum(QUOTE_UNITS, { message: "Select a unit." }),
  buyerTradeRequirement: z.enum(["local", "import", "export"], {
    message: "Select a trade requirement.",
  }),
  buyerRequiredByDate: z.string().trim().optional(),
  buyerAdditionalSpec: z.string().trim().optional(),
});

export const sellerLogisticsStepSchema = z.object({
  sellerEmirate: z.enum(EMIRATES, { message: "Select an emirate." }),
  sellerArea: requiredText("Enter the area."),
  sellerMapLink: z.string().trim().optional(),
  sellerPickupRequired: z.enum(PICKUP_CHOICES, { message: "Let us know if pickup is required." }),
  sellerPickupDate: z.string().trim().optional(),
  sellerAccessNote: z.string().trim().optional(),
});

export const buyerLogisticsStepSchema = z
  .object({
    buyerTradeRequirement: z.enum(["local", "import", "export"]).optional(),
    buyerDestinationEmirate: z.enum(EMIRATES).optional(),
    buyerDestinationArea: z.string().trim().optional(),
    buyerFulfilment: z.enum(FULFILMENT_CHOICES).optional(),
    buyerDestinationCountry: z.string().trim().optional(),
    buyerDestinationCityPort: z.string().trim().optional(),
    buyerPreferredPort: z.enum(PREFERRED_PORTS).optional(),
    buyerOriginCountryPreference: z.string().trim().optional(),
    buyerLogisticsRequirement: z.enum(FULFILMENT_CHOICES).optional(),
    buyerLogisticsNote: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.buyerTradeRequirement === "local") {
      if (!val.buyerDestinationEmirate) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationEmirate"],
          message: "Select a destination emirate.",
        });
      }
      if (!val.buyerDestinationArea?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationArea"],
          message: "Enter the destination area.",
        });
      }
      if (!val.buyerFulfilment) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerFulfilment"],
          message: "Select a fulfilment option.",
        });
      }
    } else if (val.buyerTradeRequirement === "import") {
      if (!val.buyerDestinationEmirate) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationEmirate"],
          message: "Select the emirate the material should arrive in.",
        });
      }
    } else {
      if (!val.buyerDestinationCountry?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationCountry"],
          message: "Enter the destination country.",
        });
      }
      if (!val.buyerDestinationCityPort?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["buyerDestinationCityPort"],
          message: "Enter the destination city or port.",
        });
      }
    }
  });

export const sellerContactStepSchema = z.object({
  sellerName: requiredText("Enter your name."),
  sellerPhone: phoneSchema,
  sellerCompany: z.string().trim().optional(),
  sellerEmail: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
  sellerPreferredContact: z.enum(PREFERRED_CONTACTS, {
    message: "Select a preferred contact method.",
  }),
  sellerNotes: z.string().trim().optional(),
});

export const buyerContactStepSchema = z
  .object({
    buyerCompany: z.string().trim().optional(),
    buyerContactPerson: requiredText("Enter the contact person's name."),
    buyerPhone: phoneSchema,
    buyerEmail: z.string().trim().email("Enter a valid email.").optional().or(z.literal("")),
    buyerPreferredContact: z.enum(PREFERRED_CONTACTS, {
      message: "Select a preferred contact method.",
    }),
    buyerNotes: z.string().trim().optional(),
    buyerTradeRequirement: z.enum(["local", "import", "export"]).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.buyerTradeRequirement !== "local" && !val.buyerCompany?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["buyerCompany"],
        message: "Company is required for import/export enquiries.",
      });
    }
  });

export type QuoteStepSchema =
  | typeof enquiryTypeStepSchema
  | typeof materialStepSchema
  | typeof sellerDetailsStepSchema
  | typeof buyerDetailsStepSchema
  | typeof sellerLogisticsStepSchema
  | typeof buyerLogisticsStepSchema
  | typeof sellerContactStepSchema
  | typeof buyerContactStepSchema;

/** Returns the zod schema (and the field slice it validates) for a given step + branch. */
export function getStepSchema(
  step: number,
  intent: QuoteIntent | undefined,
): QuoteStepSchema | null {
  const isSeller = intent === "sell";
  switch (step) {
    case 1:
      return enquiryTypeStepSchema;
    case 2:
      return materialStepSchema;
    case 3:
      return isSeller ? sellerDetailsStepSchema : buyerDetailsStepSchema;
    case 4:
      return isSeller ? sellerLogisticsStepSchema : buyerLogisticsStepSchema;
    case 5:
      return isSeller ? sellerContactStepSchema : buyerContactStepSchema;
    default:
      return null;
  }
}
