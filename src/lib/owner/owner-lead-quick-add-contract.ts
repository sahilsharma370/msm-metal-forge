/**
 * CHECKPOINT C2J-F — the ONE canonical, browser-safe contract for owner
 * Quick Add (`POST /api/owner/leads`). Matches owner-leads-contract.ts's
 * own established pattern: no server-only import, secret, Supabase admin
 * client, Node-only dependency, or `process.env` access — safe to import
 * from any browser bundle.
 *
 * Field vocabulary is reused, never re-invented: intent/material from
 * owner-leads-contract.ts (this checkpoint's own canonical source), the
 * quantity-unit and emirate vocabularies from the Quote Experience's own
 * quote-options.ts (the same closed sets leads.seller_quantity_unit /
 * leads.seller_emirate already enforce at the DB layer). QUICK_ADD_CHANNEL_VALUES
 * is deliberately a narrower subset of OWNER_LEAD_CAPTURE_CHANNEL_VALUES —
 * 'website' belongs to the Quote Experience alone, and 'owner_manual' is
 * reserved for a distinct future backfill feature (see the migration's own
 * header comment for why Quick Add never writes that value).
 *
 * Buyer-branch location is deliberately absent from this contract — see the
 * migration's header comment (leads_buyer_route_field_isolation would force
 * a trade-route choice just to record a phone call, an invented requirement
 * this checkpoint's own instructions warn against).
 */
import { z } from "zod";
import { OWNER_LEAD_INTENT_VALUES, OWNER_LEAD_MATERIAL_VALUES, type OwnerLeadIntent, type OwnerLeadMaterial } from "./owner-leads-contract";
import { QUOTE_UNITS, EMIRATES } from "@/components/site/quote/quote-options";
import { isValidPhoneNumber } from "@/components/site/quote/quote-schema";

export const QUICK_ADD_CHANNEL_VALUES = ["phone", "whatsapp", "walk_in"] as const;
export type QuickAddChannel = (typeof QUICK_ADD_CHANNEL_VALUES)[number];

export const QUICK_ADD_QUANTITY_UNIT_VALUES = QUOTE_UNITS;
export type QuickAddQuantityUnit = (typeof QUICK_ADD_QUANTITY_UNIT_VALUES)[number];

export const QUICK_ADD_EMIRATE_VALUES = EMIRATES;
export type QuickAddEmirate = (typeof QUICK_ADD_EMIRATE_VALUES)[number];

export const QUICK_ADD_NOTES_MAX_LENGTH = 2000;
export const QUICK_ADD_CONTACT_NAME_MAX_LENGTH = 120;
export const QUICK_ADD_SELLER_AREA_MAX_LENGTH = 150;
export const QUICK_ADD_MATERIAL_OTHER_TEXT_MAX_LENGTH = 200;
export const QUICK_ADD_QUANTITY_UNIT_OTHER_MAX_LENGTH = 60;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const ownerLeadQuickAddFieldsShape = {
  intent: z.enum(OWNER_LEAD_INTENT_VALUES),
  channel: z.enum(QUICK_ADD_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  materialOtherText: z.string().trim().max(QUICK_ADD_MATERIAL_OTHER_TEXT_MAX_LENGTH).optional(),
  contactName: z.string().trim().min(1, "Enter a contact name.").max(QUICK_ADD_CONTACT_NAME_MAX_LENGTH, "Name is too long."),
  // Raw, as typed by the owner — normalized server-side via the same
  // normalizePhoneNumber the Quote Experience itself uses (never
  // duplicated here), matching this checkpoint's "normalize using the
  // existing canonical helper" requirement.
  contactPhone: z.string().trim().min(1, "Enter a phone number.").refine((val) => isValidPhoneNumber(val), "Enter a valid phone number."),
  notes: z.string().trim().max(QUICK_ADD_NOTES_MAX_LENGTH, "Note is too long.").optional(),
  quantityValue: z.number().positive().optional(),
  quantityUnit: z.enum(QUICK_ADD_QUANTITY_UNIT_VALUES).optional(),
  quantityUnitOther: z.string().trim().max(QUICK_ADD_QUANTITY_UNIT_OTHER_MAX_LENGTH).optional(),
  sellerEmirate: z.enum(QUICK_ADD_EMIRATE_VALUES).optional(),
  sellerArea: z.string().trim().max(QUICK_ADD_SELLER_AREA_MAX_LENGTH).optional(),
};

function refineOwnerLeadQuickAddFields(
  value: z.infer<z.ZodObject<typeof ownerLeadQuickAddFieldsShape>>,
  ctx: z.RefinementCtx,
): void {
  if (value.material === "other" && !value.materialOtherText) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materialOtherText"], message: "Describe the material." });
  }
  if (value.quantityUnit === "other" && !value.quantityUnitOther) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantityUnitOther"], message: "Describe the unit." });
  }
  if (value.quantityUnitOther && value.quantityUnit !== "other") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantityUnit"], message: 'Only valid when unit is "other".' });
  }
  if (value.intent === "buy" && (value.sellerEmirate || value.sellerArea)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sellerEmirate"], message: "Location does not apply to a buyer enquiry." });
  }
}

/** The form's own field set, with no requestId — used client-side (e.g. to gate a submit button) before an attempt identity has ever been generated. */
export const ownerLeadQuickAddFormValuesSchema = z.object(ownerLeadQuickAddFieldsShape).strict().superRefine(refineOwnerLeadQuickAddFields);
export type OwnerLeadQuickAddFormValues = z.infer<typeof ownerLeadQuickAddFormValuesSchema>;

export const ownerLeadQuickAddRequestSchema = z
  .object({
    ...ownerLeadQuickAddFieldsShape,
    // Client-generated once per logical Quick Add attempt, resent unchanged
    // across a retry of that same attempt — the server-side idempotency
    // anchor, reused as leads.idempotency_key itself (see the migration).
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine(refineOwnerLeadQuickAddFields);
export type OwnerLeadQuickAddRequest = z.infer<typeof ownerLeadQuickAddRequestSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const ownerLeadQuickAddSuccessBodySchema = z
  .object({
    ok: z.literal(true),
    data: z
      .object({
        leadId: z.string().uuid(),
        reference: z.string(),
        idempotentReplay: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadQuickAddSuccessBody = z.infer<typeof ownerLeadQuickAddSuccessBodySchema>;

export const OWNER_LEAD_QUICK_ADD_ERROR_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "CONFLICT", "INTERNAL_ERROR"] as const;
export type OwnerLeadQuickAddErrorCode = (typeof OWNER_LEAD_QUICK_ADD_ERROR_CODES)[number];

export const ownerLeadQuickAddErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(OWNER_LEAD_QUICK_ADD_ERROR_CODES),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type OwnerLeadQuickAddErrorBody = z.infer<typeof ownerLeadQuickAddErrorBodySchema>;

export const ownerLeadQuickAddResponseBodySchema = z.union([ownerLeadQuickAddSuccessBodySchema, ownerLeadQuickAddErrorBodySchema]);
export type OwnerLeadQuickAddResponseBody = z.infer<typeof ownerLeadQuickAddResponseBodySchema>;

export type { OwnerLeadIntent, OwnerLeadMaterial };
