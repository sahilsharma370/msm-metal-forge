import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalize, sha256Hex } from "./canonicalize";

// ---------------------------------------------------------------------------
// NIST FIPS 180-2 published SHA-256 test vectors — ground truth, not
// self-asserted. Verified independently against Node's own crypto module
// before being written here (never trust-on-faith for a cryptographic
// fallback's correctness).
// ---------------------------------------------------------------------------
const EMPTY_STRING_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const NIST_VECTORS: readonly [input: string, hex: string][] = [
  ["", EMPTY_STRING_SHA256],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
];

describe("canonicalize", () => {
  it("sorts object keys lexicographically, so key order never affects the output", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserves array order exactly — never sorts", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("encodes null, booleans, numbers and strings via standard JSON rules", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("x")).toBe('"x"');
  });
});

describe("sha256Hex — native Web Crypto path", () => {
  it.each(NIST_VECTORS)("matches the published NIST SHA-256 test vector for %j", async (input, expectedHex) => {
    expect(await sha256Hex(input)).toBe(expectedHex);
  });

  it("is deterministic: the same input always produces the same hash", async () => {
    const first = await sha256Hex("determinism check");
    const second = await sha256Hex("determinism check");
    expect(first).toBe(second);
  });
});

describe("sha256Hex — @noble/hashes fallback when crypto.subtle.digest is unavailable", () => {
  // MEASURED-PLAUSIBLE GAP, fixed — auditing the Google in-app browser
  // QT-CLI path. crypto.subtle (SubtleCrypto) is gated to secure contexts
  // independently of crypto.getRandomValues (base Crypto interface,
  // available everywhere per spec) — a restricted WebView could plausibly
  // expose one without the other. sha256Hex falls back to @noble/hashes —
  // an independently audited, zero-dependency, pure-JS SHA-256
  // implementation — never a hand-written one, never a weaker hash.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(NIST_VECTORS)(
    "the fallback ALSO matches the published NIST SHA-256 test vector for %j — proof it is not a different/weaker hash",
    async (input, expectedHex) => {
      vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
        throw new Error("crypto.subtle.digest is not available in this context");
      });
      expect(await sha256Hex(input)).toBe(expectedHex);
    },
  );

  it("produces BYTE-IDENTICAL output to the native crypto.subtle.digest path for the same arbitrary input — the actual correctness bar for payload_hash, not just fixed vectors", async () => {
    const input = JSON.stringify({
      submission: { intent: "sell", material: "copper", sellerName: "Ahmed Seller", sellerPhone: "0501234567" },
      files: [{ original_filename: "a.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 12345 }],
    });

    const native = await sha256Hex(input);

    vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
      throw new Error("crypto.subtle.digest is not available in this context");
    });
    const fallback = await sha256Hex(input);

    expect(fallback).toBe(native);
    // Sanity: a real 64-hex-char SHA-256 digest, not an empty/short string
    // that happened to equal `native` by some degenerate accident.
    expect(fallback).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back correctly when crypto.subtle itself is entirely undefined, not just its digest method throwing", async () => {
    vi.stubGlobal("crypto", {
      ...crypto,
      subtle: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID: crypto.randomUUID.bind(crypto),
    });
    try {
      expect(await sha256Hex("")).toBe(EMPTY_STRING_SHA256);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
