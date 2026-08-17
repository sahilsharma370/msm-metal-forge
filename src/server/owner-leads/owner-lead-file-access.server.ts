/**
 * CHECKPOINT C2J-C — the owner private-file access service: mints one
 * short-lived signed URL for a single lead_files object, after proving
 * every membership/state check in application code (never trusting a
 * single compound query to have enforced them). Matches
 * owner-lead-detail.server.ts's own established pattern — plain async
 * functions injected as deps, `.server.ts` suffix for import protection,
 * never re-checks authorization (the caller/route already has).
 *
 * Never accepts a storage path from the browser: the only caller input is
 * `leadId`/`fileId`, both validated UUID route parameters — the actual
 * `storage_path` used to mint the signed URL always comes from the
 * database row this service itself fetches, never from request input.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS } from "@/lib/owner/owner-lead-detail-contract";

/** Matches upload-quote.ts's own established local-constant convention (no shared exported bucket-name constant exists yet in this codebase). */
const LEAD_FILES_BUCKET = "lead-files";

const leadFileAccessRowSchema = z.object({
  id: z.string().uuid(),
  lead_id: z.string().uuid(),
  storage_path: z.string().min(1).max(500),
  upload_status: z.enum(["pending", "complete", "failed"]),
});
export type LeadFileAccessRow = z.infer<typeof leadFileAccessRowSchema>;

export class OwnerLeadFileAccessQueryError extends Error {
  constructor() {
    super("Server configuration error.");
    this.name = "OwnerLeadFileAccessQueryError";
  }
}

export interface OwnerLeadFileAccessServiceDeps {
  /** True if the lead exists and has submission_completed_at set; false if it exists but isn't completed; null if no such lead exists at all. */
  queryLeadIsCompleted(leadId: string): Promise<boolean | null>;
  /** Null when no such file row exists. */
  queryLeadFile(fileId: string): Promise<LeadFileAccessRow | null>;
  /** Null signedUrl signals a Storage/provider failure — never thrown across this boundary so the route can map it to one sanitized 500 without echoing provider error text. */
  createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string | null>;
}

export function createProductionOwnerLeadFileAccessServiceDeps(): OwnerLeadFileAccessServiceDeps {
  const admin: SupabaseClient = createSupabaseAdminClient();
  return {
    async queryLeadIsCompleted(leadId) {
      const { data, error } = await admin.from("leads").select("submission_completed_at").eq("id", leadId).maybeSingle();
      if (error) throw new OwnerLeadFileAccessQueryError();
      if (!data) return null;
      return (data as { submission_completed_at: string | null }).submission_completed_at !== null;
    },

    async queryLeadFile(fileId) {
      const { data, error } = await admin
        .from("lead_files")
        .select("id, lead_id, storage_path, upload_status")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw new OwnerLeadFileAccessQueryError();
      if (!data) return null;
      const parsed = leadFileAccessRowSchema.safeParse(data);
      if (!parsed.success) throw new OwnerLeadFileAccessQueryError();
      return parsed.data;
    },

    async createSignedUrl(storagePath, expiresInSeconds) {
      const { data, error } = await admin.storage.from(LEAD_FILES_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
      if (error || !data) return null;
      return data.signedUrl;
    },
  };
}

export type OwnerLeadFileAccessResult =
  | { readonly ok: true; readonly url: string; readonly expiresInSeconds: number }
  | { readonly ok: false; readonly reason: "not_found" | "storage_error" };

/**
 * The one entry point this checkpoint's file-access route calls. Every one
 * of "lead doesn't exist", "lead isn't completed", "file doesn't exist",
 * "file belongs to a different lead", and "file isn't in its final
 * accessible upload state" returns the identical
 * { ok: false, reason: "not_found" } — the route maps all of them to one
 * generic 404, so none can be distinguished by a caller probing for which
 * case applies.
 */
export async function getOwnerLeadFileAccess(
  leadId: string,
  fileId: string,
  deps: OwnerLeadFileAccessServiceDeps,
): Promise<OwnerLeadFileAccessResult> {
  const isCompleted = await deps.queryLeadIsCompleted(leadId);
  if (isCompleted !== true) {
    return { ok: false, reason: "not_found" };
  }

  const file = await deps.queryLeadFile(fileId);
  if (!file) {
    return { ok: false, reason: "not_found" };
  }
  if (file.lead_id !== leadId) {
    return { ok: false, reason: "not_found" };
  }
  if (file.upload_status !== "complete") {
    return { ok: false, reason: "not_found" };
  }

  const url = await deps.createSignedUrl(file.storage_path, OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS);
  if (!url) {
    return { ok: false, reason: "storage_error" };
  }

  return { ok: true, url, expiresInSeconds: OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS };
}
