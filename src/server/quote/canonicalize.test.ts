import { describe, expect, it } from "vitest";
import { canonicalize, computeQuotePayloadHash, sha256Hex } from "./canonicalize";

describe("canonicalize", () => {
  it("sorts object keys regardless of source order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserves array order — never sorts arrays", () => {
    expect(canonicalize({ items: [1, 2, 3] })).not.toBe(canonicalize({ items: [3, 2, 1] }));
  });

  it("encodes null, booleans and numbers deterministically", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(42)).toBe("42");
  });
});

describe("sha256Hex", () => {
  it("produces the known SHA-256 digest of an empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("always returns 64 lowercase hex characters", async () => {
    const digest = await sha256Hex("some input");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeQuotePayloadHash", () => {
  const submissionA = { intent: "sell", material: "copper", sellerName: "Ahmed" };
  const submissionB = { ...submissionA, sellerName: "Bilal" };
  const files = [
    { original_filename: "a.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 1024 },
    { original_filename: "b.jpg", declared_mime_type: "image/jpeg", declared_byte_size: 2048 },
  ];

  it("is deterministic for an identical normalized submission and identical ordered files", async () => {
    const first = await computeQuotePayloadHash(submissionA, files);
    const second = await computeQuotePayloadHash({ ...submissionA }, [...files]);
    expect(first).toBe(second);
  });

  it("is deterministic regardless of source key order (object keys are canonicalized)", async () => {
    const first = await computeQuotePayloadHash({ intent: "sell", material: "copper" }, []);
    const second = await computeQuotePayloadHash({ material: "copper", intent: "sell" }, []);
    expect(first).toBe(second);
  });

  it("changes when a meaningful submission value changes", async () => {
    const first = await computeQuotePayloadHash(submissionA, files);
    const second = await computeQuotePayloadHash(submissionB, files);
    expect(first).not.toBe(second);
  });

  it("changes when the same files are declared in a different order", async () => {
    const first = await computeQuotePayloadHash(submissionA, files);
    const second = await computeQuotePayloadHash(submissionA, [...files].reverse());
    expect(first).not.toBe(second);
  });

  it("changes when a file is added or removed", async () => {
    const first = await computeQuotePayloadHash(submissionA, files);
    const second = await computeQuotePayloadHash(submissionA, files.slice(0, 1));
    expect(first).not.toBe(second);
  });

  it("returns a 64-character lowercase hex digest", async () => {
    const digest = await computeQuotePayloadHash(submissionA, files);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
