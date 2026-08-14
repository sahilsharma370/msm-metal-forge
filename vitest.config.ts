// Standalone from vite.config.ts on purpose: the app's config pulls in the
// TanStack Start / Nitro / Cloudflare build plugins via
// @lovable.dev/vite-tanstack-config, which have no business running under a
// unit-test process. This file only resolves the same `@/*` alias from
// tsconfig.json (via Vite's native tsconfigPaths resolver) so server-only
// modules under src/ can be imported by tests the same way the app imports
// them.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Global default stays "node" for speed — component tests that need a
    // DOM opt in per-file via a `// @vitest-environment jsdom` docblock
    // (see QuoteExperience.test.tsx), never by changing this default.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
