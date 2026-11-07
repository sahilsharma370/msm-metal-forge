import { z } from "zod";
import {
  submissionShapeSchema,
  normalizeSubmission,
  MAX_FILES,
  type SubmissionShape,
} from "@/lib/quote/submission-schema";
import { computeQuotePayloadHash, type CanonicalFileDeclaration } from "@/lib/quote/canonicalize";
import type { QuoteFormValues, QuoteLocalFile } from "./quote-schema";
import type { QuoteInitialContext, QuoteIntent } from "./quote-search";

/**
 * CHECKPOINT C2F-C: this module computes, in the browser, exactly what
 * /api/quote/initiate would compute server-side from the equivalent request
 * body — never a second, potentially-drifting implementation of
 * normalization or hashing.
 *
 * That reuse is safe because submission-schema.ts and canonicalize.ts were
 * verified (not assumed) to be browser-safe before this module was written:
 * both import only zod and each other; the one platform API either uses
 * (crypto.subtle.digest / TextEncoder) is a standard Web API available
 * identically in browsers and in this project's server runtime (Cloudflare
 * Workers / Node >=19).
 *
 * They were NOT, however, importable from `@/server/quote/*` directly: this
 * project's TanStack Start build hard-denies any client-side import whose
 * resolved file path matches `**\/server/**` (see
 * @lovable.dev/vite-tanstack-config's importProtection.client config) —
 * discovered only at build time (`npm run build`), not by static inspection
 * of either file's own imports. Both were therefore relocated to
 * src/lib/quote/*, with src/server/quote/* re-exporting from there so every
 * existing server import keeps working unchanged. Imported directly from
 * `@/lib/quote/*` here, and re-exported so callers of this module never
 * need to reach into that path themselves.
 */
export { normalizeSubmission, computeQuotePayloadHash };
export type { SubmissionShape, CanonicalFileDeclaration };

/**
 * Selects the one file array relevant to `intent` — sellerPhotos for a sell
 * enquiry, buyerDocuments for a buy one, never both. Every other function in
 * this module and in quote-file-recovery.ts that needs "the current files"
 * goes through this, so seller/buyer file-kind isolation is structural (one
 * call site decides), not a rule every caller has to remember to apply.
 */
export function selectRelevantLocalFiles(
  values: QuoteFormValues,
  intent: QuoteIntent,
): readonly QuoteLocalFile[] {
  return intent === "sell" ? values.sellerPhotos : values.buyerDocuments;
}

/**
 * Builds the exact object submissionShapeSchema (the server's own shape
 * layer) accepts, from QuoteFormValues plus the `source` that lives on
 * QuoteInitialContext, not on the form. Excludes sellerPhotos/buyerDocuments
 * by destructuring — not by field-by-field allow-listing — so a File
 * object, previewUrl or client-only id can never leak into the result: the
 * only way any field reaches the output is by being a key of `values`
 * itself, and submissionShapeSchema's `.strict()` turns any drift between
 * QuoteFormValues and the server's known key set into a validation failure
 * here rather than silent data loss or a silently-accepted extra field.
 */
export function buildQuoteSubmissionShape(
  values: QuoteFormValues,
  source: QuoteInitialContext["source"],
): z.SafeParseReturnType<unknown, SubmissionShape> {
  const { sellerPhotos, buyerDocuments, ...rest } = values;
  return submissionShapeSchema.safeParse({ ...rest, source });
}

/**
 * Ordered file declarations for computeQuotePayloadHash. Array order is
 * preserved exactly — never sorted — because order IS the declared slot
 * order downstream (see canonicalize.ts's own doc comment), so reordering
 * files is a meaningful change and must change the hash. Only the three
 * declared-metadata fields survive per file: never the File object itself,
 * never previewUrl, never the client-only id QuotePhotoPicker generates.
 */
export function buildOrderedFileDeclarations(
  files: readonly QuoteLocalFile[],
): CanonicalFileDeclaration[] {
  return files.slice(0, MAX_FILES).map((local) => ({
    original_filename: local.name,
    declared_mime_type: local.file.type,
    declared_byte_size: local.size,
  }));
}

export interface QuoteSubmissionIdentity {
  readonly submission: SubmissionShape;
  readonly files: readonly CanonicalFileDeclaration[];
  readonly payloadHash: string;
}

export type ComputeIdentityResult =
  | { readonly ok: true; readonly identity: QuoteSubmissionIdentity }
  | { readonly ok: false; readonly issues: readonly z.ZodIssue[] };

/**
 * Turns "current form state" into "what /api/quote/initiate would be asked
 * to create" — the submission shape, the ordered file declarations, and the
 * payload hash computed from both via the exact same normalizeSubmission +
 * computeQuotePayloadHash path the server runs. A hash computed here is
 * therefore provably the same hash the server would compute from the
 * equivalent request body, not merely assumed to match.
 *
 * Only meaningful once intent/material (and the active branch's required
 * fields) are set, mirroring checkSubmissionCompleteness's own scope — an
 * incomplete form returns `ok: false` with the zod issues that explain why,
 * rather than throwing or returning a hash for a request that could never
 * actually be sent.
 */
export async function computeQuoteSubmissionIdentity(
  values: QuoteFormValues,
  context: QuoteInitialContext,
): Promise<ComputeIdentityResult> {
  const parsed = buildQuoteSubmissionShape(values, context.source);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }
  const relevantFiles = selectRelevantLocalFiles(values, parsed.data.intent);
  const files = buildOrderedFileDeclarations(relevantFiles);
  const normalized = normalizeSubmission(parsed.data);
  const payloadHash = await computeQuotePayloadHash(normalized, files);
  return { ok: true, identity: { submission: parsed.data, files, payloadHash } };
}

/**
 * MEASURED-PLAUSIBLE GAP (auditing the Google in-app browser QT-CLI path,
 * not reproduced on any specific device) — crypto.randomUUID() is a late
 * addition to the Web Crypto API (2021); crypto.getRandomValues() has been
 * part of the base Crypto interface for far longer, and — per spec — is
 * NOT gated to secure contexts the way crypto.subtle is. An embedded
 * WebView whose bundled Chromium hasn't been updated past that point
 * could plausibly expose the latter without the former.
 *
 * CORRECTION to an earlier draft of this audit: that draft treated
 * crypto.subtle being unavailable as evidence crypto.getRandomValues was
 * probably ALSO unavailable, on the (wrong) assumption that the two are
 * gated together. They are not — crypto.subtle (SubtleCrypto, used by
 * computeQuotePayloadHash in canonicalize.ts) is secure-context-only;
 * crypto.getRandomValues (part of the base Crypto interface, used here)
 * is available in every context. Each of this file's and canonicalize.ts's
 * own fallbacks is independent of the other's availability in EITHER
 * direction — see canonicalize.ts's own sha256Hex for its own, separate
 * fallback (added once this correction was made), never assumed to share
 * fate with this one.
 *
 * Deliberately NOT a Math.random()-based fallback, or any other
 * non-cryptographic source: idempotency's whole guarantee (the server
 * trusts this key as an unguessable, collision-resistant identifier for
 * THIS one submission) depends on genuine CSPRNG entropy, not merely on
 * the string looking UUID-shaped. getRandomValues() is the exact same
 * CSPRNG randomUUID() itself draws from — this only assembles the same 122
 * bits of randomness into an RFC 4122 v4 UUID by hand, it does not weaken
 * what's actually being asked of the key.
 */
function randomUUIDViaGetRandomValues(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Fixed-size Uint8Array(16): indices 6/8 are always in bounds — the
  // non-null assertions are only here to satisfy noUncheckedIndexedAccess,
  // not a sign either access could genuinely be undefined.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One fresh, cryptographically random key per materially distinct
 * normalized payload: the existing idempotency key is reused for as long
 * as the payload hash stays the same (so re-renders and genuine retries
 * never mint a second key for the same request), and a fresh key is
 * generated the moment the hash changes for any reason — including a
 * changed file declaration or a changed file order, since both already
 * feed computeQuotePayloadHash. Equivalent phone formatting never changes
 * the hash in the first place (normalizeSubmission canonicalizes phone
 * numbers before hashing — see CHECKPOINT C2F-B), so it never triggers a
 * new key here either.
 *
 * crypto.randomUUID() missing or throwing (see randomUUIDViaGetRandomValues's
 * own doc comment) falls back to the exact same CSPRNG via
 * crypto.getRandomValues() — never a weaker source. If THAT also throws
 * (crypto.getRandomValues genuinely unavailable too — a much more severe,
 * much less plausible case, since it would mean the Web Crypto API is
 * absent entirely), this function intentionally does not catch it: that
 * failure must propagate exactly as an unguarded crypto.randomUUID() call
 * always did, failing closed (no request sent) via this engine's own
 * outer safety net — never silently minting a key from a non-cryptographic
 * source just to avoid that failure.
 *
 * Pure aside from the crypto calls themselves: never reads or writes
 * storage — callers (quote-storage.ts) own persisting the result.
 */
export function resolveIdempotencyKey(
  newPayloadHash: string,
  existing: { readonly payloadHash: string; readonly idempotencyKey: string } | null,
): string {
  if (existing && existing.payloadHash === newPayloadHash) {
    return existing.idempotencyKey;
  }
  try {
    return crypto.randomUUID();
  } catch {
    return randomUUIDViaGetRandomValues();
  }
}
