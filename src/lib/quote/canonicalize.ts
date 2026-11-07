/**
 * Deterministic canonical-JSON encoding + SHA-256 hashing for the Quote
 * initiate route's server-computed payload_hash.
 *
 * CHECKPOINT C2F-C: lives under src/lib (not src/server) because it must be
 * importable from browser code too — this project's TanStack Start build
 * hard-denies any client-side import whose resolved file path matches
 * `**\/server/**` (see @lovable.dev/vite-tanstack-config's
 * importProtection.client config), regardless of whether the file's own
 * code is actually browser-safe. src/server/quote/canonicalize.ts re-exports
 * everything from here so every existing server import keeps working
 * unchanged; there is exactly one implementation, never two.
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

import { sha256 as noblesha256 } from "@noble/hashes/sha2.js";

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

/**
 * Lowercase hex SHA-256. Primarily computed via the Web Crypto API
 * (available identically on Cloudflare Workers, Node >=19 and every
 * browser, so this needs no platform-specific import on that path).
 *
 * MEASURED-PLAUSIBLE GAP, fixed — auditing the Google in-app browser
 * QT-CLI path. CORRECTION to an earlier draft of this audit, which wrongly
 * assumed crypto.subtle being unavailable implies crypto.getRandomValues
 * is unavailable too: per the Web Crypto spec these are gated
 * independently. crypto.subtle (the SubtleCrypto interface, which
 * crypto.subtle.digest belongs to) is restricted to secure contexts;
 * crypto.getRandomValues is part of the base Crypto interface and has
 * been available in every context, secure or not, since long before
 * SubtleCrypto existed. A restricted in-app WebView could very plausibly
 * expose one without the other — in EITHER direction, not just the one
 * this file previously assumed. This function's own fallback therefore
 * does not depend on getRandomValues at all; it is independent from, and
 * complementary to, resolveIdempotencyKey's own getRandomValues-based
 * fallback in quote-submission-identity.ts.
 *
 * Falls back to @noble/hashes — an independently audited, zero-dependency,
 * pure-JS FIPS 180-4 SHA-256 implementation — never a hand-written one,
 * and never a weaker/non-cryptographic hash. SHA-256 is a fully specified,
 * deterministic algorithm: any correct implementation (native or this
 * one) MUST produce byte-identical output for the same input. Proven,
 * not merely asserted — see canonicalize.test.ts, which checks this
 * fallback against NIST's own published SHA-256 test vectors AND against
 * a direct runtime comparison with crypto.subtle.digest on the same
 * input.
 *
 * CORRECTED FRAMING: this hash is never transmitted to or compared
 * against the server directly — initiate's request body carries only
 * idempotencyKey/submission/files (see quote-submission-transport.ts);
 * the server (src/server/quote/initiate-quote.ts) independently
 * recomputes its own payload_hash from those via this SAME shared
 * module, and that server-side value alone is what create_website_quote_v1
 * actually keys its idempotency check on. The reason this fallback must
 * still match crypto.subtle.digest exactly is CLIENT-side self-
 * consistency: reconcileSubmissionAttempt (quote-storage.ts) compares a
 * previously-stored payloadHash against a freshly-computed one, within
 * the SAME browser session, to decide whether to reuse or discard an
 * idempotency key. If crypto.subtle's availability ever flickered within
 * one session (native, then fallback, or vice versa) and the two paths
 * produced different hashes for IDENTICAL form data, that mismatch alone
 * would look like "the form changed" and wrongly discard a still-valid
 * key — never a client-vs-server hash disagreement, which this code has
 * no mechanism to even observe.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  let digestBytes: Uint8Array;
  try {
    digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  } catch {
    digestBytes = noblesha256(bytes);
  }
  return Array.from(digestBytes)
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
