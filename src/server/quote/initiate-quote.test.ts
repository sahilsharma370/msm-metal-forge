import { describe, expect, it, vi } from "vitest";
import {
  handleQuoteInitiateBody,
  readBoundedBody,
  BodyTooLargeError,
  type QuoteRpcClient,
} from "./initiate-quote";
import { computeQuotePayloadHash } from "./canonicalize";
import { normalizeSubmission, initiateQuoteRequestSchema } from "./submission-schema";

const validSeller = {
  intent: "sell",
  source: "hero",
  material: "copper",
  sellerCondition: "clean_separated",
  sellerQuantityValue: "100",
  sellerQuantityUnit: "kg",
  sellerQuantityUnsure: false,
  sellerEmirate: "dubai",
  sellerArea: "Al Quoz Industrial 3",
  sellerPickupRequired: "no",
  sellerName: "Ahmed Seller",
  sellerPhone: "+971501234567",
  sellerPreferredContact: "whatsapp",
};

const validBuyerLocal = {
  intent: "buy",
  source: "materials",
  material: "aluminium",
  buyerQuantityValue: "500",
  buyerQuantityUnit: "kg",
  buyerTradeRequirement: "local",
  buyerDestinationEmirate: "dubai",
  buyerDestinationArea: "Business Bay area",
  buyerFulfilment: "delivery",
  buyerContactPerson: "Fatima Buyer",
  buyerPhone: "+971502345678",
  buyerPreferredContact: "whatsapp",
};

interface RpcCallArgs {
  p_idempotency_key: string;
  p_payload_hash: string;
  p_submission: unknown;
  p_files: unknown;
}

const idempotencyKey = "d0000000-0000-0000-0000-000000000001";

function requestBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ idempotencyKey, submission: validSeller, files: [], ...overrides });
}

const rpcSuccessPayload = {
  lead_id: "11111111-1111-1111-1111-111111111111",
  reference: "MSM-260812-ABCDEF",
  idempotent_replay: false,
  upload_slots: [] as unknown[],
};

/** A fake RPC client — no real Supabase client, no network access, ever, in this file. */
function fakeSupabase(response: {
  data: unknown;
  error: { message: string } | null;
}): QuoteRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn().mockResolvedValue(response) };
}

describe("handleQuoteInitiateBody — happy paths", () => {
  it("maps a valid seller request to a 200 with the expected shape", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      data: {
        leadId: rpcSuccessPayload.lead_id,
        reference: rpcSuccessPayload.reference,
        idempotentReplay: false,
        uploadSlots: [],
      },
    });
  });

  it("maps a valid buyer-local request successfully", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(requestBody({ submission: validBuyerLocal }), {
      supabase,
    });
    expect(result.status).toBe(200);
  });

  it("maps upload slot fields from snake_case to camelCase without loss", async () => {
    const slot = {
      slot_id: "22222222-2222-2222-2222-222222222222",
      slot_index: 0,
      kind: "seller_photo",
      storage_path:
        "leads/11111111-1111-1111-1111-111111111111/slot-0-22222222-2222-2222-2222-222222222222",
      expires_at: "2026-08-12T18:00:00+00:00",
      original_filename: "photo1.jpg",
      declared_mime_type: "image/jpeg",
      declared_byte_size: 1024,
    };
    const supabase = fakeSupabase({
      data: { ...rpcSuccessPayload, upload_slots: [slot] },
      error: null,
    });
    const files = [
      {
        original_filename: "photo1.jpg",
        declared_mime_type: "image/jpeg",
        declared_byte_size: 1024,
      },
    ];
    const result = await handleQuoteInitiateBody(requestBody({ files }), { supabase });

    expect(result.status).toBe(200);
    if (result.body.ok) {
      expect(result.body.data.uploadSlots[0]).toEqual({
        slotId: slot.slot_id,
        slotIndex: 0,
        kind: "seller_photo",
        storagePath: slot.storage_path,
        expiresAt: slot.expires_at,
        originalFilename: "photo1.jpg",
        declaredMimeType: "image/jpeg",
        declaredByteSize: 1024,
      });
    }
  });

  it("maps idempotent_replay: true through to idempotentReplay in the response", async () => {
    const supabase = fakeSupabase({
      data: { ...rpcSuccessPayload, idempotent_replay: true },
      error: null,
    });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });
    expect(result.status).toBe(200);
    if (result.body.ok) {
      expect(result.body.data.idempotentReplay).toBe(true);
    }
  });
});

describe("handleQuoteInitiateBody — RPC call contract", () => {
  it("calls create_website_quote_v1 exactly once with the exact expected arguments", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    await handleQuoteInitiateBody(requestBody(), { supabase });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = supabase.rpc.mock.calls[0] as [string, RpcCallArgs];
    expect(fn).toBe("create_website_quote_v1");
    expect(args.p_idempotency_key).toBe(idempotencyKey);
    expect(args.p_files).toEqual([]);
    expect(typeof args.p_payload_hash).toBe("string");
    expect(args.p_payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computes p_payload_hash server-side — a caller-supplied hash is never accepted, so the RPC never receives one from the request", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    // The request body cannot even carry a hash — initiateQuoteRequestSchema
    // has no payloadHash key, so this parses the raw JSON.parse output
    // directly to prove any such key would be silently absent from what
    // reaches validation, never smuggled through to the RPC call.
    const bodyWithForgedHash = JSON.stringify({
      idempotencyKey,
      submission: validSeller,
      files: [],
      payloadHash: "0".repeat(64),
    });
    const result = await handleQuoteInitiateBody(bodyWithForgedHash, { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("computes the exact same hash a direct computeQuotePayloadHash call would, for the same normalized submission and files", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const parsed = initiateQuoteRequestSchema.parse({
      idempotencyKey,
      submission: validSeller,
      files: [],
    });
    const expectedHash = await computeQuotePayloadHash(
      normalizeSubmission(parsed.submission),
      parsed.files,
    );

    await handleQuoteInitiateBody(requestBody(), { supabase });

    const [, args] = supabase.rpc.mock.calls[0] as [string, RpcCallArgs];
    expect(args.p_payload_hash).toBe(expectedHash);
  });

  it("produces a different hash for the same key when a meaningful field changes", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    await handleQuoteInitiateBody(requestBody(), { supabase });
    await handleQuoteInitiateBody(
      requestBody({ submission: { ...validSeller, sellerName: "Different Name" } }),
      { supabase },
    );

    const [, firstArgs] = supabase.rpc.mock.calls[0] as [string, RpcCallArgs];
    const [, secondArgs] = supabase.rpc.mock.calls[1] as [string, RpcCallArgs];
    expect(firstArgs.p_payload_hash).not.toBe(secondArgs.p_payload_hash);
  });

  it("produces a different hash when file order changes", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const fileA = {
      original_filename: "a.jpg",
      declared_mime_type: "image/jpeg",
      declared_byte_size: 1024,
    };
    const fileB = {
      original_filename: "b.jpg",
      declared_mime_type: "image/jpeg",
      declared_byte_size: 2048,
    };

    await handleQuoteInitiateBody(requestBody({ files: [fileA, fileB] }), { supabase });
    await handleQuoteInitiateBody(requestBody({ files: [fileB, fileA] }), { supabase });

    const [, firstArgs] = supabase.rpc.mock.calls[0] as [string, RpcCallArgs];
    const [, secondArgs] = supabase.rpc.mock.calls[1] as [string, RpcCallArgs];
    expect(firstArgs.p_payload_hash).not.toBe(secondArgs.p_payload_hash);
  });
});

describe("handleQuoteInitiateBody — rejections", () => {
  it("rejects malformed JSON with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody("{not valid json", { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid idempotencyKey (not a UUID) with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(requestBody({ idempotencyKey: "not-a-uuid" }), {
      supabase,
    });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(requestBody({ extra: "field" }), { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-empty honeypot with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(requestBody({ honeypot: "i-am-a-bot" }), {
      supabase,
    });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid branch (sell-intent submission carrying a buyer field) with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const result = await handleQuoteInitiateBody(
      requestBody({ submission: { ...validSeller, buyerQuantityValue: "50" } }),
      { supabase },
    );
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an incomplete submission (missing a required field) with 400 and fieldErrors", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const { sellerName: _sellerName, ...incomplete } = validSeller;
    const result = await handleQuoteInitiateBody(requestBody({ submission: incomplete }), {
      supabase,
    });
    expect(result.status).toBe(400);
    if (!result.body.ok) {
      expect(result.body.error.fieldErrors?.length).toBeGreaterThan(0);
    }
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects more than 5 files with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const files = Array.from({ length: 6 }, (_, i) => ({
      original_filename: `photo${i}.jpg`,
      declared_mime_type: "image/jpeg",
      declared_byte_size: 1024,
    }));
    const result = await handleQuoteInitiateBody(requestBody({ files }), { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid MIME type with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const files = [
      { original_filename: "a.gif", declared_mime_type: "image/gif", declared_byte_size: 1024 },
    ];
    const result = await handleQuoteInitiateBody(requestBody({ files }), { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared_byte_size with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const files = [
      {
        original_filename: "a.jpg",
        declared_mime_type: "image/jpeg",
        declared_byte_size: 9_000_000,
      },
    ];
    const result = await handleQuoteInitiateBody(requestBody({ files }), { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects a path-traversal-shaped filename with 400", async () => {
    const supabase = fakeSupabase({ data: rpcSuccessPayload, error: null });
    const files = [
      {
        original_filename: "../../etc/passwd",
        declared_mime_type: "image/jpeg",
        declared_byte_size: 1024,
      },
    ];
    const result = await handleQuoteInitiateBody(requestBody({ files }), { supabase });
    expect(result.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("handleQuoteInitiateBody — RPC failure mapping", () => {
  it("maps the idempotency-conflict RPC error to 409, with no internals leaked", async () => {
    const supabase = fakeSupabase({
      data: null,
      error: {
        message:
          "create_website_quote_v1: idempotency_key d0000000-... was already used with a different payload_hash",
      },
    });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });

    expect(result.status).toBe(409);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(JSON.stringify(result.body)).not.toContain("d0000000");
    }
  });

  it("maps an unrelated Supabase error to a generic 500 with no SQL/internals leaked", async () => {
    const supabase = fakeSupabase({
      data: null,
      error: {
        message:
          'new row for relation "leads" violates check constraint "leads_website_requiredness"',
      },
    });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });

    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain("leads_website_requiredness");
      expect(serialized).not.toContain("relation");
    }
  });

  it("maps a malformed/unexpected RPC success payload to a generic 500", async () => {
    const supabase = fakeSupabase({ data: { unexpected: "shape" }, error: null });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });
    expect(result.status).toBe(500);
    if (!result.body.ok) {
      expect(result.body.error.code).toBe("INTERNAL_ERROR");
    }
  });

  it("never includes the computed payload hash anywhere in an error response", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "some db failure" } });
    const result = await handleQuoteInitiateBody(requestBody(), { supabase });
    const [, args] = supabase.rpc.mock.calls[0] as [string, { p_payload_hash: string }];
    expect(JSON.stringify(result.body)).not.toContain(args.p_payload_hash);
  });
});

describe("readBoundedBody", () => {
  function requestWithBody(body: string, contentLength?: number): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (contentLength !== undefined) headers.set("content-length", String(contentLength));
    return new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body,
      headers,
    });
  }

  it("reads a body under the limit", async () => {
    const body = JSON.stringify({ ok: true });
    const text = await readBoundedBody(requestWithBody(body), 1024);
    expect(text).toBe(body);
  });

  it("rejects via Content-Length fast path when it exceeds the limit", async () => {
    const body = "x".repeat(100);
    await expect(readBoundedBody(requestWithBody(body, 10_000), 50)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("rejects based on actual bytes read when Content-Length is absent or wrong", async () => {
    const oversized = "x".repeat(200);
    const request = new Request("https://example.test/api/quote/initiate", {
      method: "POST",
      body: oversized,
      headers: { "content-type": "application/json" },
    });
    request.headers.delete("content-length");
    await expect(readBoundedBody(request, 50)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
