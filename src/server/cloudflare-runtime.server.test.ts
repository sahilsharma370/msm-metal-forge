import { describe, expect, it } from "vitest";
import { getCloudflareBinding, getCloudflareRuntimeEnv } from "./cloudflare-runtime.server";

function fakeCloudflareRequest(env?: Record<string, unknown>): Request {
  const request = new Request("https://example.test/");
  if (env !== undefined) {
    Object.assign(request, { runtime: { cloudflare: { env } } });
  }
  return request;
}

function isThingWithFoo(value: unknown): value is { foo: () => void } {
  return typeof value === "object" && value !== null && typeof (value as { foo?: unknown }).foo === "function";
}

describe("getCloudflareRuntimeEnv", () => {
  it("returns undefined when the request has no attached runtime at all (e.g. plain vite dev)", () => {
    const request = new Request("https://example.test/");
    expect(getCloudflareRuntimeEnv(request)).toBeUndefined();
  });

  it("returns the exact attached env object", () => {
    const env = { SOME_BINDING: { foo: () => {} } };
    const request = fakeCloudflareRequest(env);
    expect(getCloudflareRuntimeEnv(request)).toBe(env);
  });
});

describe("getCloudflareBinding", () => {
  it("returns undefined when there is no attached runtime env", () => {
    const request = new Request("https://example.test/");
    expect(getCloudflareBinding(request, "SOME_BINDING", isThingWithFoo)).toBeUndefined();
  });

  it("returns undefined when the named binding is absent from the env", () => {
    const request = fakeCloudflareRequest({});
    expect(getCloudflareBinding(request, "SOME_BINDING", isThingWithFoo)).toBeUndefined();
  });

  it("returns undefined when the value exists but fails the type guard", () => {
    const request = fakeCloudflareRequest({ SOME_BINDING: "not-an-object" });
    expect(getCloudflareBinding(request, "SOME_BINDING", isThingWithFoo)).toBeUndefined();
  });

  it("returns the live value when present and it passes the guard", () => {
    const binding = { foo: () => {} };
    const request = fakeCloudflareRequest({ SOME_BINDING: binding });
    expect(getCloudflareBinding(request, "SOME_BINDING", isThingWithFoo)).toBe(binding);
  });

  it("never throws, regardless of input shape", () => {
    const request = fakeCloudflareRequest({ SOME_BINDING: null });
    expect(() => getCloudflareBinding(request, "SOME_BINDING", isThingWithFoo)).not.toThrow();
  });

  it("reads from the exact Request instance passed in, never a different/global source", () => {
    const boundBinding = { foo: () => {} };
    const boundRequest = fakeCloudflareRequest({ SOME_BINDING: boundBinding });
    const unboundRequest = fakeCloudflareRequest({});
    expect(getCloudflareBinding(boundRequest, "SOME_BINDING", isThingWithFoo)).toBe(boundBinding);
    expect(getCloudflareBinding(unboundRequest, "SOME_BINDING", isThingWithFoo)).toBeUndefined();
  });
});
