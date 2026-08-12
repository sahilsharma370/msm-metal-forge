import { describe, expect, it } from "vitest";
import { inspectUpload, UploadInspectionError, MAX_BYTES } from "./inspect-upload";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function padded(signature: number[], totalLength: number): Uint8Array {
  const buffer = new Uint8Array(totalLength);
  buffer.set(signature, 0);
  return buffer;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Builds a minimal, correctly-framed WebP: "RIFF" + size(LE, = length-8) + "WEBP" + optional trailing payload. */
function webp(payloadLength = 0): Uint8Array {
  const total = 12 + payloadLength;
  const buffer = new Uint8Array(total);
  buffer.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  const size = total - 8;
  buffer[4] = size & 0xff;
  buffer[5] = (size >>> 8) & 0xff;
  buffer[6] = (size >>> 16) & 0xff;
  buffer[7] = (size >>> 24) & 0xff;
  buffer.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return buffer;
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    return error instanceof UploadInspectionError && error.code === code;
  });
}

describe("inspectUpload — valid files", () => {
  it("accepts a valid JPEG", async () => {
    const result = await inspectUpload(padded(JPEG_SIGNATURE, 20), "image/jpeg");
    expect(result.detectedMimeType).toBe("image/jpeg");
    expect(result.byteSize).toBe(20);
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a valid PNG", async () => {
    const result = await inspectUpload(padded(PNG_SIGNATURE, 30), "image/png");
    expect(result.detectedMimeType).toBe("image/png");
    expect(result.byteSize).toBe(30);
  });

  it("accepts a valid WebP", async () => {
    const file = webp(10);
    const result = await inspectUpload(file, "image/webp");
    expect(result.detectedMimeType).toBe("image/webp");
    expect(result.byteSize).toBe(file.byteLength);
  });

  it("accepts a valid PDF", async () => {
    const result = await inspectUpload(padded(PDF_SIGNATURE, 40), "application/pdf");
    expect(result.detectedMimeType).toBe("application/pdf");
    expect(result.byteSize).toBe(40);
  });

  it("accepts an ArrayBuffer input identically to a Uint8Array", async () => {
    const uint8 = padded(JPEG_SIGNATURE, 10);
    const arrayBuffer = uint8.buffer.slice(
      uint8.byteOffset,
      uint8.byteOffset + uint8.byteLength,
    ) as ArrayBuffer;
    const result = await inspectUpload(arrayBuffer, "image/jpeg");
    expect(result.detectedMimeType).toBe("image/jpeg");
  });
});

describe("inspectUpload — truncated signature boundaries", () => {
  it("rejects a JPEG signature missing its final byte", async () => {
    await expectError(inspectUpload(bytes(0xff, 0xd8), "image/jpeg"), "UNRECOGNIZED_SIGNATURE");
  });

  it("rejects a PNG signature missing its final byte", async () => {
    await expectError(
      inspectUpload(bytes(...PNG_SIGNATURE.slice(0, 7)), "image/png"),
      "UNRECOGNIZED_SIGNATURE",
    );
  });

  it("rejects a WebP missing its final marker byte", async () => {
    const truncated = webp(0).slice(0, 11);
    await expectError(inspectUpload(truncated, "image/webp"), "UNRECOGNIZED_SIGNATURE");
  });

  it("rejects a WebP with a correct marker but wrong size framing", async () => {
    const file = webp(10);
    file[4] = 0xff; // corrupt the declared RIFF size without changing actual length
    await expectError(inspectUpload(file, "image/webp"), "UNRECOGNIZED_SIGNATURE");
  });

  it("rejects a PDF signature missing its final byte", async () => {
    await expectError(
      inspectUpload(bytes(...PDF_SIGNATURE.slice(0, 4)), "application/pdf"),
      "UNRECOGNIZED_SIGNATURE",
    );
  });
});

describe("inspectUpload — declared type mismatches actual bytes", () => {
  it("rejects a file declared image/jpeg whose actual bytes are a PDF", async () => {
    await expectError(inspectUpload(padded(PDF_SIGNATURE, 20), "image/jpeg"), "TYPE_MISMATCH");
  });

  it("rejects a file declared application/pdf whose actual bytes are a PNG", async () => {
    await expectError(inspectUpload(padded(PNG_SIGNATURE, 20), "application/pdf"), "TYPE_MISMATCH");
  });

  it("rejects the same bytes declared under a different supported type", async () => {
    await expectError(inspectUpload(webp(4), "image/png"), "TYPE_MISMATCH");
  });
});

describe("inspectUpload — unsupported / malformed input", () => {
  it("rejects bytes matching no supported signature", async () => {
    const notAnImage = new TextEncoder().encode("hello world, this is plain text");
    await expectError(inspectUpload(notAnImage, "image/jpeg"), "UNRECOGNIZED_SIGNATURE");
  });

  it("rejects an unsupported declared MIME type outright", async () => {
    await expectError(
      inspectUpload(padded(JPEG_SIGNATURE, 10), "image/gif"),
      "UNSUPPORTED_DECLARED_TYPE",
    );
  });

  it("rejects an empty file", async () => {
    await expectError(inspectUpload(bytes(), "image/jpeg"), "EMPTY");
  });
});

describe("inspectUpload — size boundaries", () => {
  it("accepts a file that is exactly 8 MiB (constructed in memory, no fixture file)", async () => {
    const file = padded(JPEG_SIGNATURE, MAX_BYTES);
    const result = await inspectUpload(file, "image/jpeg");
    expect(result.byteSize).toBe(MAX_BYTES);
  });

  it("rejects a file that is 8 MiB + 1 byte", async () => {
    const file = padded(JPEG_SIGNATURE, MAX_BYTES + 1);
    await expectError(inspectUpload(file, "image/jpeg"), "TOO_LARGE");
  });
});

describe("inspectUpload — checksum and input safety", () => {
  it("computes a deterministic SHA-256 for the same bytes", async () => {
    const file = padded(JPEG_SIGNATURE, 50);
    const first = await inspectUpload(file, "image/jpeg");
    const second = await inspectUpload(file.slice(), "image/jpeg");
    expect(first.checksumSha256).toBe(second.checksumSha256);
  });

  it("computes different checksums for different byte content", async () => {
    const fileA = padded(JPEG_SIGNATURE, 50);
    const fileB = padded(JPEG_SIGNATURE, 51);
    const resultA = await inspectUpload(fileA, "image/jpeg");
    const resultB = await inspectUpload(fileB, "image/jpeg");
    expect(resultA.checksumSha256).not.toBe(resultB.checksumSha256);
  });

  it("never mutates the input bytes", async () => {
    const file = padded(JPEG_SIGNATURE, 30);
    const before = Array.from(file);
    await inspectUpload(file, "image/jpeg");
    expect(Array.from(file)).toEqual(before);
  });
});
