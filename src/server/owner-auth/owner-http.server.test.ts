import { describe, expect, it } from "vitest";
import { readOwnerLoginBody, OwnerLoginBodyTooLargeError, MAX_OWNER_LOGIN_BODY_BYTES } from "./owner-http.server";

describe("readOwnerLoginBody", () => {
  it("returns the body text for a small request", async () => {
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.test" }),
    });
    const text = await readOwnerLoginBody(request);
    expect(text).toBe(JSON.stringify({ email: "owner@example.test" }));
  });

  it("rejects via content-length before reading the body", async () => {
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: "x".repeat(100),
      headers: { "content-length": String(MAX_OWNER_LOGIN_BODY_BYTES + 1) },
    });
    await expect(readOwnerLoginBody(request)).rejects.toBeInstanceOf(OwnerLoginBodyTooLargeError);
  });

  it("rejects via actual body length when content-length is absent or wrong", async () => {
    const oversized = "a".repeat(MAX_OWNER_LOGIN_BODY_BYTES + 100);
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: oversized,
    });
    await expect(readOwnerLoginBody(request)).rejects.toBeInstanceOf(OwnerLoginBodyTooLargeError);
  });

  it("accepts a body exactly at the limit", async () => {
    const exact = "a".repeat(MAX_OWNER_LOGIN_BODY_BYTES);
    const request = new Request("https://example.test/api/owner/login/request-code", {
      method: "POST",
      body: exact,
    });
    const text = await readOwnerLoginBody(request);
    expect(text.length).toBe(MAX_OWNER_LOGIN_BODY_BYTES);
  });
});
