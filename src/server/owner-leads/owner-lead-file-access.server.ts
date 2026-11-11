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

/**
 * PERF — the owner photo viewer's modal preview. A number from 20 to 100
 * (Storage's own documented range); 75 keeps visible artefacting low while
 * still meaningfully smaller than the default 80 + the original's own
 * encoding. Width only (no height): Storage preserves aspect ratio on a
 * single-dimension constraint regardless of `resize` mode, so there is
 * nothing to get wrong by omitting it. 1600px remains sharp inside this
 * modal's own `max-h-[70vh] max-w-3xl` bounds on any display this product
 * targets, while capping the owner-upload ceiling (8 MiB, see
 * upload-quote.ts's MAX_BYTES — no client-side resize happens before
 * upload, so a real phone photo can legitimately be that large) down to a
 * small fraction of that for the common "glance at it, triage the lead"
 * case. Omitting `format` lets Storage pick a modern, smaller format
 * (WebP) for whatever the requesting browser accepts, rather than forcing
 * the original's own encoding.
 */
export const OWNER_LEAD_FILE_PREVIEW_TRANSFORM = { width: 1600, quality: 75 } as const;
export type OwnerLeadFilePreviewTransform = typeof OWNER_LEAD_FILE_PREVIEW_TRANSFORM;

export interface OwnerLeadFileAccessServiceDeps {
  /** True if the lead exists and has submission_completed_at set; false if it exists but isn't completed; null if no such lead exists at all. */
  queryLeadIsCompleted(leadId: string): Promise<boolean | null>;
  /** Null when no such file row exists. */
  queryLeadFile(fileId: string): Promise<LeadFileAccessRow | null>;
  /**
   * Null signedUrl signals a Storage/provider failure — never thrown
   * across this boundary so the route can map it to one sanitized 500
   * without echoing provider error text. `transform`, when given, asks for
   * a smaller rendered variant (the viewer's modal preview, never the
   * "view full resolution" path) — the production implementation is
   * responsible for falling back to an untransformed signed URL if the
   * transformed request itself fails (e.g. Image Transformations not
   * enabled on this Supabase project), never surfacing that as a total
   * failure; see mintSignedUrlWithTransformFallback below.
   */
  createSignedUrl(storagePath: string, expiresInSeconds: number, transform?: OwnerLeadFilePreviewTransform): Promise<string | null>;
}

/** The one Storage call shape both the transformed and fallback attempts below share — narrowed to exactly what createSignedUrl needs so this stays testable without a real SupabaseClient. */
type SignedUrlMinter = (
  transform?: OwnerLeadFilePreviewTransform,
) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;

/**
 * PERF — never guesses whether this Supabase project actually has Image
 * Transformations enabled (a paid, per-project add-on; this session has no
 * way to confirm it from here without either the secret key or a live
 * owner session against production). Attempts the transformed mint first
 * when a transform is given; if THAT specific attempt errors for any
 * reason, retries once with no transform at all — exercising the viewer's
 * already-working untransformed path rather than ever turning an unproven
 * infra assumption into a broken photo. No transform requested at all
 * skips straight to the single untransformed attempt.
 */
export async function mintSignedUrlWithTransformFallback(
  mint: SignedUrlMinter,
  transform: OwnerLeadFilePreviewTransform | undefined,
): Promise<string | null> {
  if (transform) {
    const transformed = await mint(transform);
    if (!transformed.error && transformed.data) return transformed.data.signedUrl;
  }
  const plain = await mint(undefined);
  if (plain.error || !plain.data) return null;
  return plain.data.signedUrl;
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

    async createSignedUrl(storagePath, expiresInSeconds, transform) {
      return mintSignedUrlWithTransformFallback(
        (t) =>
          t
            ? admin.storage.from(LEAD_FILES_BUCKET).createSignedUrl(storagePath, expiresInSeconds, { transform: t })
            : admin.storage.from(LEAD_FILES_BUCKET).createSignedUrl(storagePath, expiresInSeconds),
        transform,
      );
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
  /** `preview: true` — the viewer modal's own fast-loading variant, never the "view full resolution" path. Purely a presentational hint to Storage; never affects any authorization check above. */
  options?: { readonly preview?: boolean },
): Promise<OwnerLeadFileAccessResult> {
  // PERF — queryLeadIsCompleted(leadId) and queryLeadFile(fileId) are
  // genuinely independent reads (neither's result depends on the other),
  // so they run in parallel rather than sequentially. This runs AFTER the
  // caller's own verifyOwnerSession (the route calls that first, before
  // this function at all) — never before it: a caller's authorization is
  // still fully established before either of these protected-data queries
  // ever fires, unchanged. createSignedUrl still runs strictly after both,
  // since it needs file.storage_path from the second query's result.
  const [isCompleted, file] = await Promise.all([deps.queryLeadIsCompleted(leadId), deps.queryLeadFile(fileId)]);

  if (isCompleted !== true) {
    return { ok: false, reason: "not_found" };
  }
  if (!file) {
    return { ok: false, reason: "not_found" };
  }
  if (file.lead_id !== leadId) {
    return { ok: false, reason: "not_found" };
  }
  if (file.upload_status !== "complete") {
    return { ok: false, reason: "not_found" };
  }

  const url = await deps.createSignedUrl(
    file.storage_path,
    OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS,
    options?.preview ? OWNER_LEAD_FILE_PREVIEW_TRANSFORM : undefined,
  );
  if (!url) {
    return { ok: false, reason: "storage_error" };
  }

  return { ok: true, url, expiresInSeconds: OWNER_LEAD_FILE_ACCESS_SIGNED_URL_TTL_SECONDS };
}
