import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const MODULE_PATH = fileURLToPath(new URL("./supabase-browser.ts", import.meta.url));

describe("supabase-browser.ts — a server secret cannot enter this browser module", () => {
  it("the source never references SUPABASE_SECRET_KEY, service_role, or process.env", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    expect(source).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(source).not.toMatch(/service_role/i);
    expect(source).not.toMatch(/process\.env/);
  });

  it("only reads the two public VITE_-prefixed variables", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    const viteVarMatches = [...source.matchAll(/import\.meta\.env\["([^"]+)"\]/g)].map((m) => m[1]);
    expect(new Set(viteVarMatches)).toEqual(new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]));
  });

  it("does not import anything from src/server/", () => {
    const source = readFileSync(MODULE_PATH, "utf8");
    expect(source).not.toMatch(/from ["']@\/server\//);
    expect(source).not.toMatch(/from ["'].*\/server\//);
  });
});

describe("getSupabaseBrowserClient", () => {
  const originalUrl = import.meta.env["VITE_SUPABASE_URL"];
  const originalKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  afterEach(() => {
    import.meta.env["VITE_SUPABASE_URL"] = originalUrl;
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = originalKey;
    vi.resetModules();
  });

  it("throws BrowserConfigurationError when both env vars are missing", async () => {
    import.meta.env["VITE_SUPABASE_URL"] = "";
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = "";
    vi.resetModules();
    const { getSupabaseBrowserClient, BrowserConfigurationError } = await import("./supabase-browser");
    expect(() => getSupabaseBrowserClient()).toThrow(BrowserConfigurationError);
  });

  it("throws BrowserConfigurationError when only the URL is set", async () => {
    import.meta.env["VITE_SUPABASE_URL"] = "https://example-project.supabase.co";
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = "";
    vi.resetModules();
    const { getSupabaseBrowserClient, BrowserConfigurationError } = await import("./supabase-browser");
    expect(() => getSupabaseBrowserClient()).toThrow(BrowserConfigurationError);
  });

  it("the configuration error message carries no configuration detail", async () => {
    import.meta.env["VITE_SUPABASE_URL"] = "";
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = "";
    vi.resetModules();
    const { getSupabaseBrowserClient } = await import("./supabase-browser");
    try {
      getSupabaseBrowserClient();
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toMatch(/VITE_|SUPABASE_URL|PUBLISHABLE/i);
    }
  });

  it("constructs and memoizes a singleton client when both env vars are present", async () => {
    import.meta.env["VITE_SUPABASE_URL"] = "https://example-project.supabase.co";
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test_only";
    vi.resetModules();
    const { getSupabaseBrowserClient, resetSupabaseBrowserClientForTests } = await import("./supabase-browser");
    resetSupabaseBrowserClientForTests();
    const client1 = getSupabaseBrowserClient();
    const client2 = getSupabaseBrowserClient();
    expect(client1).toBe(client2);
  });
});
