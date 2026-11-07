import { afterEach, describe, expect, it, vi } from "vitest";

// Captured once, before error-capture.ts is ever imported by this file, so
// each test can fully undo whatever monkey-patching that module applies to
// the real global console.error and start the next test from a clean slate.
const trueOriginalConsoleError = console.error;

const SENSITIVE = "seller-phone:+971501234567 seller-email:driver@example.com";

async function freshModule() {
  vi.resetModules();
  return import("./error-capture");
}

afterEach(() => {
  console.error = trueOriginalConsoleError;
  vi.restoreAllMocks();
});

describe("logUnhandledError — production safety", () => {
  it("never emits error.message, stack, or cause — only the fixed category", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    const cause = new Error(SENSITIVE);
    const err = new Error("outer failure", { cause });
    mod.logUnhandledError(err, "quote_initiate_unhandled");

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(SENSITIVE);
    expect(output).not.toContain("outer failure");
    expect(output).not.toContain(err.stack ?? "__unreachable__");
    expect(JSON.parse(output)).toEqual({
      event: "app.unhandled_error",
      category: "quote_initiate_unhandled",
    });
  });

  it("stays safe across a deep cause chain regardless of category", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    let err: Error = new Error(SENSITIVE);
    for (let i = 0; i < 6; i++) {
      err = new Error(`layer ${i}`, { cause: err });
    }
    mod.logUnhandledError(err, "root_render_unhandled");

    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(SENSITIVE);
    expect(output).not.toContain("layer");
  });

  it("stays safe even for non-Error values (string, plain object)", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    mod.logUnhandledError(SENSITIVE, "server_unhandled");
    mod.logUnhandledError({ message: SENSITIVE }, "server_unhandled");

    for (const call of spy.mock.calls) {
      expect(call[0] as string).not.toContain(SENSITIVE);
    }
  });
});

describe("logUnhandledError — extra closed-enum context (e.g. a pipeline stage)", () => {
  it("merges `extra` into the production log line, still never the error's own message", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    const err = new Error(SENSITIVE);
    mod.logUnhandledError(err, "quote_submit_client_exception", { stage: "uploading" });

    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(SENSITIVE);
    expect(JSON.parse(output)).toEqual({
      event: "app.unhandled_error",
      category: "quote_submit_client_exception",
      stage: "uploading",
    });
  });

  it("omitting `extra` behaves exactly as before — category only, no extra keys", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    mod.logUnhandledError(new Error(SENSITIVE), "server_unhandled");

    const output = spy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({ event: "app.unhandled_error", category: "server_unhandled" });
  });

  it("accepts plain boolean values alongside strings — closed-value either way (added for the future-QT-CLI-diagnostics audit: initiateAttempted/Web-Crypto-availability flags)", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    mod.logUnhandledError(new Error(SENSITIVE), "quote_submit_client_exception", {
      stage: "initiating",
      initiateAttempted: true,
      initiateResponseReceived: false,
    });

    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(SENSITIVE);
    expect(JSON.parse(output)).toEqual({
      event: "app.unhandled_error",
      category: "quote_submit_client_exception",
      stage: "initiating",
      initiateAttempted: true,
      initiateResponseReceived: false,
    });
  });
});

describe("describeWebCryptoAvailability", () => {
  it("returns only booleans, never throws even if crypto itself is broken", async () => {
    const mod = await freshModule();
    const result = mod.describeWebCryptoAvailability();
    expect(Object.values(result).every((v: unknown) => typeof v === "boolean")).toBe(true);
  });

  it("reports true for every flag in this real test environment, where Web Crypto is fully present", async () => {
    const mod = await freshModule();
    const result = mod.describeWebCryptoAvailability();
    expect(result).toEqual({
      subtleAvailable: true,
      getRandomValuesAvailable: true,
      randomUUIDAvailable: true,
    });
  });

  it("fails closed to all-false, never throws, when crypto itself throws on property access", async () => {
    const mod = await freshModule();
    vi.stubGlobal("crypto", {
      get subtle(): never {
        throw new Error("blocked");
      },
      get getRandomValues(): never {
        throw new Error("blocked");
      },
      get randomUUID(): never {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => mod.describeWebCryptoAvailability()).not.toThrow();
      expect(mod.describeWebCryptoAvailability()).toEqual({
        subtleAvailable: false,
        getRandomValuesAvailable: false,
        randomUUIDAvailable: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("logUnhandledError — development preserves detail", () => {
  it("still emits the full message/stack in dev (unchanged behavior)", async () => {
    import.meta.env.DEV = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mod = await freshModule();

    const err = new Error(SENSITIVE);
    mod.logUnhandledError(err, "server_unhandled");

    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).toContain(SENSITIVE);
  });
});

describe("global console.error wrapper — covers calls this audit doesn't control directly (e.g. h3 internals)", () => {
  function expectSuppressed(spy: ReturnType<typeof vi.spyOn>) {
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(SENSITIVE);
    expect(JSON.parse(output)).toEqual({
      event: "app.unhandled_error",
      category: "console_internal_unhandled",
    });
    return output;
  }

  it("suppresses a bare sensitive string argument in production", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    console.error(SENSITIVE);

    expectSuppressed(spy);
  });

  it("suppresses a bare sensitive object argument in production", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    console.error({ detail: SENSITIVE });

    expectSuppressed(spy);
  });

  it("suppresses a bare Error argument in production", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    console.error(new Error(SENSITIVE));

    expectSuppressed(spy);
  });

  it("suppresses a mixed argument list — string + object with a cause — matching h3's own call shape", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    // node_modules/h3/dist/h3.mjs:1063 — console.error("[h3] Stream error...", { cause: error })
    console.error("[h3] Stream error in Node.js handler", { cause: new Error(SENSITIVE) });

    expectSuppressed(spy);
  });

  it("suppresses a mixed argument list — string + Error — matching h3's own call shape", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    // node_modules/h3/dist/h3.mjs:243 — console.error("[h3] onDispose:", error)
    console.error("[h3] onDispose:", new Error(SENSITIVE));

    expectSuppressed(spy);
  });

  it("even a call with no Error-like argument at all still collapses to the generic category, never passing the real arguments through", async () => {
    import.meta.env.DEV = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    const safe = JSON.stringify({ event: "quote.submit_client_exception" });
    console.error(safe);

    expectSuppressed(spy);
  });

  it("still expands a bare Error in development (unchanged)", async () => {
    import.meta.env.DEV = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    console.error(new Error(SENSITIVE));

    const output = spy.mock.calls[0]?.[0] as string;
    expect(output).toContain(SENSITIVE);
  });

  it("still passes non-Error arguments through untouched in development (unchanged)", async () => {
    import.meta.env.DEV = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await freshModule();

    console.error("[h3] onDispose:", SENSITIVE);

    expect(spy).toHaveBeenCalledWith("[h3] onDispose:", SENSITIVE);
  });
});

describe("classifyRoutePath / classifyRenderPath", () => {
  it("classifies the quote-initiate route distinctly from every other route", async () => {
    const mod = await freshModule();
    expect(mod.classifyRoutePath("/api/quote/initiate")).toBe("quote_initiate_unhandled");
    expect(mod.classifyRoutePath("/api/quote/upload")).toBe("server_unhandled");
    expect(mod.classifyRoutePath("/api/quote/complete")).toBe("server_unhandled");
    expect(mod.classifyRoutePath("/owner/login")).toBe("server_unhandled");
  });

  it("classifies the quote render route distinctly from every other route", async () => {
    const mod = await freshModule();
    expect(mod.classifyRenderPath("/quote")).toBe("quote_render_unhandled");
    expect(mod.classifyRenderPath("/")).toBe("root_render_unhandled");
    expect(mod.classifyRenderPath("/owner")).toBe("root_render_unhandled");
  });
});
