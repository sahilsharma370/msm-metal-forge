/**
 * Framework-independent byte inspector for one Quote upload. No I/O, no
 * Storage access, no imports beyond the Web Crypto global — this module
 * exists to be trivially unit-testable and reusable from both the future
 * C2B HTTP proxy route and this checkpoint's tests, without pulling in any
 * server/request machinery.
 *
 * IMPORTANT — type verification only, NOT malware/antivirus scanning. This
 * proves the byte stream's magic-number signature matches a supported
 * image/PDF format and matches what the caller declared. It says nothing
 * about whether the file's content is otherwise safe — a well-formed PDF
 * or image that embeds malicious content is indistinguishable from a
 * benign one at this layer. Never present this check to a user or to
 * downstream code as a security/safety scan.
 */

export type SupportedMimeType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

const SUPPORTED_MIME_TYPES: readonly SupportedMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

/** Matches quote_upload_slots.declared_byte_size / lead_files.byte_size's own CHECK constraints (1..8388608). */
export const MIN_BYTES = 1;
export const MAX_BYTES = 8 * 1024 * 1024;

export type UploadInspectionErrorCode =
  "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_DECLARED_TYPE" | "UNRECOGNIZED_SIGNATURE" | "TYPE_MISMATCH";

/** Message is always a safe, generic, user-facing string — never includes byte content, offsets, or any detail an attacker could use to fingerprint the detector. */
export class UploadInspectionError extends Error {
  readonly code: UploadInspectionErrorCode;

  constructor(code: UploadInspectionErrorCode, message: string) {
    super(message);
    this.name = "UploadInspectionError";
    this.code = code;
  }
}

export interface InspectedUpload {
  readonly detectedMimeType: SupportedMimeType;
  /** Always bytes.byteLength — measured directly from the actual input, never a caller-supplied number, so it can never be NaN or otherwise desynced from reality. */
  readonly byteSize: number;
  readonly checksumSha256: string;
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xff, 0xd8, 0xff]);
}

function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/**
 * RIFF container + size framing + "WEBP" marker — deliberately more than
 * just checking the "WEBP" bytes are present. The 4-byte size field
 * (offset 4, little-endian) must equal the actual payload length (total
 * bytes minus the 8-byte "RIFF"+size header itself); a real encoder always
 * writes this correctly, so a truncated or hand-fabricated file with the
 * right marker bytes but wrong/missing framing is still rejected.
 */
function isWebp(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return false; // "RIFF"
  if (bytes.length < 12) return false;
  const b4 = bytes[4] ?? 0;
  const b5 = bytes[5] ?? 0;
  const b6 = bytes[6] ?? 0;
  const b7 = bytes[7] ?? 0;
  const riffSize = (b4 | (b5 << 8) | (b6 << 16) | (b7 << 24)) >>> 0;
  if (riffSize !== bytes.length - 8) return false;
  return startsWith(bytes.subarray(8, 12), [0x57, 0x45, 0x42, 0x50]); // "WEBP"
}

function isPdf(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
}

/**
 * The four signatures are checked independently and are mutually
 * exclusive by construction — each starts with a different first byte
 * (0xFF / 0x89 / 0x52 / 0x25), so real bytes can match at most one. The
 * `matches.length !== 1` branch (both "none matched" and the practically
 * unreachable "more than one matched") is treated identically — unknown/
 * ambiguous bytes are never guessed at, only a single unambiguous match
 * is accepted.
 */
function detectSignature(bytes: Uint8Array): SupportedMimeType | null {
  const matches: SupportedMimeType[] = [];
  if (isJpeg(bytes)) matches.push("image/jpeg");
  if (isPng(bytes)) matches.push("image/png");
  if (isWebp(bytes)) matches.push("image/webp");
  if (isPdf(bytes)) matches.push("application/pdf");

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Web Crypto SHA-256, identical on Cloudflare Workers and Node ≥19 — no platform-specific import. */
async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  // TS's typed-array generics distinguish ArrayBuffer-backed views from the
  // wider ArrayBufferLike (which also covers SharedArrayBuffer); at runtime
  // this function's only two callers pass a definitely-ArrayBuffer-backed
  // Uint8Array (see toUint8Array above), so this cast is safe.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Inspects one file's actual bytes against its declared MIME type. Never
 * mutates the input, never returns the input bytes, never trusts a
 * filename or extension (none is even accepted as a parameter — detection
 * is bytes-only).
 */
export async function inspectUpload(
  input: Uint8Array | ArrayBuffer,
  declaredMimeType: string,
): Promise<InspectedUpload> {
  const bytes = toUint8Array(input);

  if (bytes.byteLength < MIN_BYTES) {
    throw new UploadInspectionError("EMPTY", "The file is empty.");
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new UploadInspectionError("TOO_LARGE", "The file exceeds the 8 MiB limit.");
  }
  if (!SUPPORTED_MIME_TYPES.includes(declaredMimeType as SupportedMimeType)) {
    throw new UploadInspectionError(
      "UNSUPPORTED_DECLARED_TYPE",
      "The declared file type is not supported.",
    );
  }

  const detected = detectSignature(bytes);
  if (detected === null) {
    throw new UploadInspectionError(
      "UNRECOGNIZED_SIGNATURE",
      "The file's actual content does not match a supported image or PDF format.",
    );
  }
  if (detected !== declaredMimeType) {
    throw new UploadInspectionError(
      "TYPE_MISMATCH",
      "The file's actual content does not match the declared file type.",
    );
  }

  const checksumSha256 = await sha256HexOfBytes(bytes);

  return { detectedMimeType: detected, byteSize: bytes.byteLength, checksumSha256 };
}
