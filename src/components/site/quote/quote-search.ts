import { z } from "zod";

/**
 * Shared, reusable search contract for the MSM Quote Experience.
 * Used by both the homepage overlay route ("/") and the standalone
 * fallback route ("/quote") so CTA wiring and future material/service
 * links can target either one with the same typed shape.
 */

export const QUOTE_SOURCES = [
  "header",
  "hero",
  "final_cta",
  "services",
  "materials",
  "direct",
] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

export const QUOTE_INTENTS = ["sell", "buy"] as const;
export type QuoteIntent = (typeof QUOTE_INTENTS)[number];

export const QUOTE_MATERIAL_KEYS = ["copper", "aluminium", "steel_iron", "lead", "other"] as const;
export type QuoteMaterialKey = (typeof QUOTE_MATERIAL_KEYS)[number];

export const QUOTE_TRADE_ROUTES = ["local", "import", "export"] as const;
export type QuoteTradeRoute = (typeof QUOTE_TRADE_ROUTES)[number];

/**
 * Every enum field here is `.optional().catch(undefined)`: a present-but-invalid
 * value fails the enum check, which the outer `.catch` intercepts and silently
 * resolves to `undefined` rather than throwing — malformed/tampered URLs never
 * crash route validation, they just fall back to "no preselection".
 */
export const quoteContextSearchSchema = z.object({
  source: z.enum(QUOTE_SOURCES).optional().catch(undefined),
  intent: z.enum(QUOTE_INTENTS).optional().catch(undefined),
  material: z.enum(QUOTE_MATERIAL_KEYS).optional().catch(undefined),
  tradeRoute: z.enum(QUOTE_TRADE_ROUTES).optional().catch(undefined),
});

export type QuoteContextSearch = z.infer<typeof quoteContextSearchSchema>;

/** "/" adds the overlay-open flag on top of the shared context fields. */
export const indexSearchSchema = quoteContextSearchSchema.extend({
  quote: z.literal(true).optional().catch(undefined),
});

export type IndexSearch = z.infer<typeof indexSearchSchema>;

/** "/quote" reuses the same context shape verbatim (no overlay flag needed). */
export const quoteRouteSearchSchema = quoteContextSearchSchema;

export type QuoteRouteSearch = z.infer<typeof quoteRouteSearchSchema>;

export interface QuoteInitialContext {
  source: QuoteSource;
  intent?: QuoteIntent | undefined;
  material?: QuoteMaterialKey | undefined;
  tradeRoute?: QuoteTradeRoute | undefined;
}

export function toInitialContext(
  search: QuoteContextSearch,
  fallbackSource: QuoteSource,
): QuoteInitialContext {
  return {
    source: search.source ?? fallbackSource,
    intent: search.intent,
    material: search.material,
    tradeRoute: search.tradeRoute,
  };
}
