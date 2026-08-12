/**
 * Deterministic canonical-JSON encoding + SHA-256 hashing for the Quote
 * initiate route's server-computed payload_hash.
 *
 * Canonicalization method (documented here because create_website_quote_v1
 * treats payload_hash as an opaque idempotency fingerprint — this is the
 * ONLY place that defines what "the same meaningful request" means):
 *
 * - Object keys are sorted lexicographically before encoding, so key order
 *   in the source object never affects the hash.
 * - Array order is preserved exactly as given — never sorted. This matters
 *   because file declaration order determines slot_index downstream, so a
 *   reordering IS a meaningful change and must change the hash.
 * - Strings/numbers/booleans/null use their standard JSON encoding via
 *   JSON.stringify on the individual primitive (stable for these types —
 *   there is no object-key-order ambiguity at the primitive level).
 * - undefined has no JSON representation and must never appear in the
 *   input — callers normalize every known field to `null` first
 *   (see normalizeSubmission in submission-schema.ts) precisely so the
 *   hash is stable regardless of whether a field was omitted or sent null.
 */

export type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export function canonicalize(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const record = value as { readonly [key: string]: CanonicalJsonValue };
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key] as CanonicalJsonValue)}`).join(",")}}`;
}

/** Lowercase hex SHA-256, computed via the Web Crypto API (available identically on Cloudflare Workers and Node ≥19, so this needs no platform-specific import). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface CanonicalFileDeclaration {
  readonly original_filename: string;
  readonly declared_mime_type: string;
  readonly declared_byte_size: number;
}

/**
 * The single function that defines "the same meaningful request": the
 * normalized submission object (all known keys present, undefined -> null)
 * plus the ordered file declarations, canonicalized and hashed together.
 * Two calls with equal normalized submissions and equal (including order)
 * file arrays always produce the same hash; any meaningful difference —
 * a changed field value, or the same files in a different order — changes it.
 */
export async function computeQuotePayloadHash(
  normalizedSubmission: { readonly [key: string]: CanonicalJsonValue },
  files: readonly CanonicalFileDeclaration[],
): Promise<string> {
  const canonicalInput = canonicalize({
    submission: normalizedSubmission,
    files: files.map((file) => ({
      original_filename: file.original_filename,
      declared_mime_type: file.declared_mime_type,
      declared_byte_size: file.declared_byte_size,
    })),
  });
  return sha256Hex(canonicalInput);
}
