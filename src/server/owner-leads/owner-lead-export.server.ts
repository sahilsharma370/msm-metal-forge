/**
 * CHECKPOINT C2M-A — owner-only CSV export. Reuses the exact same query
 * parameter parsing/validation and safe search classification the list
 * endpoint already established (parseOwnerLeadListQuery, classifySearchTerm
 * via buildSearchFilter) — no new filter-injection surface is introduced
 * here; this module only adds a wider column select, a hard 5,000-row cap,
 * and CSV serialization on top of the same safe query-building primitives.
 *
 * Deliberately queries `leads` directly with an explicit, narrow column
 * list — never lead_files, notification_deliveries, or any owner-internal
 * column (idempotency_key, payload_hash, submission_snapshot, actor ids).
 * "Trash" is never an exportable view — see exportOwnerLeadsCsv's own
 * guard below, independent of whatever the caller passes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_INTENT_VALUES,
} from "@/lib/owner/owner-leads-contract";
import type { ParsedOwnerLeadListQuery } from "./owner-leads.server";
import { buildSearchFilter } from "./owner-leads.server";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  formatQuantity,
  formatSimpleVocab,
  formatUaeDateTime,
} from "@/components/owner/owner-lead-format";
import { uaeDateKey } from "./owner-lead-overview.server";

export const OWNER_LEAD_EXPORT_MAX_ROWS = 5000;

const CSV_HEADER_ROW = [
  "Reference",
  "Enquiry type",
  "Status",
  "Submitted (UAE)",
  "Contact name",
  "Company",
  "Phone",
  "Email",
  "Preferred contact",
  "Material",
  "Other material",
  "Quantity",
  "Emirate",
  "Area",
  "Trade / supply route",
  "Capture channel",
  "Notes / specification",
] as const;

const exportRowSchema = z.object({
  reference: z.string(),
  intent: z.enum(OWNER_LEAD_INTENT_VALUES),
  status: z.enum(OWNER_LEAD_STATUS_VALUES),
  capture_channel: z.enum(OWNER_LEAD_CAPTURE_CHANNEL_VALUES),
  material: z.enum(OWNER_LEAD_MATERIAL_VALUES),
  material_other_text: z.string().nullable(),
  material_spec: z.string().nullable(),
  submission_completed_at: z.string(),
  seller_name: z.string().nullable(),
  seller_company: z.string().nullable(),
  seller_phone: z.string().nullable(),
  seller_email: z.string().nullable(),
  seller_preferred_contact: z.string().nullable(),
  seller_quantity_value: z.number().nullable(),
  seller_quantity_unit: z.string().nullable(),
  seller_emirate: z.string().nullable(),
  seller_area: z.string().nullable(),
  seller_description: z.string().nullable(),
  seller_notes: z.string().nullable(),
  buyer_contact_person: z.string().nullable(),
  buyer_company: z.string().nullable(),
  buyer_phone: z.string().nullable(),
  buyer_email: z.string().nullable(),
  buyer_preferred_contact: z.string().nullable(),
  buyer_quantity_value: z.number().nullable(),
  buyer_quantity_unit: z.string().nullable(),
  buyer_destination_emirate: z.string().nullable(),
  buyer_destination_area: z.string().nullable(),
  buyer_trade_requirement: z.string().nullable(),
  buyer_additional_spec: z.string().nullable(),
  buyer_notes: z.string().nullable(),
});
export type OwnerLeadExportRow = z.infer<typeof exportRowSchema>;

const EXPORT_SELECT_COLUMNS = [
  "reference", "intent", "status", "capture_channel", "material", "material_other_text", "material_spec",
  "submission_completed_at",
  "seller_name", "seller_company", "seller_phone", "seller_email", "seller_preferred_contact",
  "seller_quantity_value", "seller_quantity_unit", "seller_emirate", "seller_area", "seller_description", "seller_notes",
  "buyer_contact_person", "buyer_company", "buyer_phone", "buyer_email", "buyer_preferred_contact",
  "buyer_quantity_value", "buyer_quantity_unit", "buyer_destination_emirate", "buyer_destination_area",
  "buyer_trade_requirement", "buyer_additional_spec", "buyer_notes",
].join(", ");

export class OwnerLeadExportQueryError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "OwnerLeadExportQueryError";
  }
}

export interface OwnerLeadExportServiceDeps {
  queryExportRows(query: ParsedOwnerLeadListQuery): Promise<readonly OwnerLeadExportRow[]>;
}

export function createProductionOwnerLeadExportServiceDeps(): OwnerLeadExportServiceDeps {
  const admin: SupabaseClient = createSupabaseAdminClient();
  return {
    async queryExportRows(query) {
      let builder = admin.from("leads").select(EXPORT_SELECT_COLUMNS).not("submission_completed_at", "is", null).is("deleted_at", null);

      // Trash is never exportable — enforced here independent of whatever
      // view the caller passed (exportOwnerLeadsCsv also rejects it before
      // this is ever reached, so this is a second, structural backstop).
      builder = query.view === "archived" ? builder.eq("status", "archived") : builder.neq("status", "archived");

      if (query.status) builder = builder.eq("status", query.status);
      if (query.intent) builder = builder.eq("intent", query.intent);
      if (query.material) builder = builder.eq("material", query.material);
      if (query.captureChannel) builder = builder.eq("capture_channel", query.captureChannel);
      if (query.submittedFrom) builder = builder.gte("submission_completed_at", query.submittedFrom);
      if (query.submittedTo) builder = builder.lte("submission_completed_at", query.submittedTo);
      if (query.search) builder = builder.or(buildSearchFilter(query.search));

      const { data, error } = await builder
        .order("submission_completed_at", { ascending: false })
        .limit(OWNER_LEAD_EXPORT_MAX_ROWS);

      if (error) throw new OwnerLeadExportQueryError();
      const parsed = z.array(exportRowSchema).safeParse(data);
      if (!parsed.success) throw new OwnerLeadExportQueryError();
      return parsed.data;
    },
  };
}

// ---------------------------------------------------------------------------
// CSV serialization — RFC 4180 quoting plus a formula-injection guard.
// ---------------------------------------------------------------------------

/** Excel/Sheets treat a leading =, +, - or @ as the start of a formula even inside an imported CSV cell — prefixing with a plain apostrophe neutralizes that in every major spreadsheet application without altering the visible text. */
function neutralizeFormulaPrefix(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(raw: string | null | undefined): string {
  const safe = neutralizeFormulaPrefix(raw ?? "");
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(cells: readonly (string | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

function joinNonEmpty(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part && part.trim().length > 0)).join(" | ");
}

function mapExportRow(row: OwnerLeadExportRow): string {
  const isSell = row.intent === "sell";
  const contactName = isSell ? row.seller_name : row.buyer_contact_person;
  const company = isSell ? row.seller_company : row.buyer_company;
  const phone = isSell ? row.seller_phone : row.buyer_phone;
  const email = isSell ? row.seller_email : row.buyer_email;
  const preferredContact = formatSimpleVocab(isSell ? row.seller_preferred_contact : row.buyer_preferred_contact);
  const quantity = formatQuantity(isSell ? row.seller_quantity_value : row.buyer_quantity_value, isSell ? row.seller_quantity_unit : row.buyer_quantity_unit);
  const emirate = formatSimpleVocab(isSell ? row.seller_emirate : row.buyer_destination_emirate);
  const area = isSell ? row.seller_area : row.buyer_destination_area;
  const tradeRoute = isSell ? null : formatSimpleVocab(row.buyer_trade_requirement);
  const notes = isSell ? joinNonEmpty([row.seller_description, row.seller_notes]) : joinNonEmpty([row.material_spec, row.buyer_additional_spec, row.buyer_notes]);

  return csvRow([
    row.reference,
    OWNER_LEAD_INTENT_LABELS[row.intent],
    OWNER_LEAD_STATUS_LABELS[row.status],
    formatUaeDateTime(row.submission_completed_at),
    contactName,
    company,
    phone,
    email,
    preferredContact,
    OWNER_LEAD_MATERIAL_LABELS[row.material],
    row.material === "other" ? row.material_other_text : null,
    quantity,
    emirate,
    area,
    tradeRoute,
    OWNER_LEAD_CAPTURE_CHANNEL_LABELS[row.capture_channel],
    notes,
  ]);
}

export function buildOwnerLeadExportCsv(rows: readonly OwnerLeadExportRow[]): string {
  const lines = [csvRow(CSV_HEADER_ROW), ...rows.map(mapExportRow)];
  return lines.join("\r\n") + "\r\n";
}

/** `msm-enquiries-{view}-{UAE calendar date}.csv` — a stable, useful filename an owner can sort by date in their downloads folder. */
export function buildOwnerLeadExportFilename(view: "inbox" | "archived", now: Date = new Date()): string {
  return `msm-enquiries-${view}-${uaeDateKey(now)}.csv`;
}

export type OwnerLeadExportResult =
  | { readonly ok: true; readonly csv: string; readonly filename: string; readonly rowCount: number }
  | { readonly ok: false; readonly reason: "invalid_view" | "internal_error" };

/** The one entry point the export route calls. Trash is rejected outright — CSV export only ever covers Inbox or Archived, matching this batch's own "never export Trash" requirement. */
export async function exportOwnerLeadsCsv(
  query: ParsedOwnerLeadListQuery,
  deps: OwnerLeadExportServiceDeps,
  now: Date = new Date(),
): Promise<OwnerLeadExportResult> {
  if (query.view === "trash") {
    return { ok: false, reason: "invalid_view" };
  }

  try {
    const rows = await deps.queryExportRows(query);
    return {
      ok: true,
      csv: buildOwnerLeadExportCsv(rows),
      filename: buildOwnerLeadExportFilename(query.view, now),
      rowCount: rows.length,
    };
  } catch {
    return { ok: false, reason: "internal_error" };
  }
}
