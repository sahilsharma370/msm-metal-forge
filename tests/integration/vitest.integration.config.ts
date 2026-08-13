// Deliberately separate from the root vitest.config.ts, and deliberately
// outside src/ — the root config's `include: ["src/**/*.test.ts"]` can
// never match anything under tests/, so `npm test` (plain `vitest run`,
// which defaults to the root config) stays Docker-independent. This config
// is only ever invoked explicitly via `npm run test:integration:local`.
//
// Real local Supabase Postgres + Storage calls (db reset, RPC round trips,
// Storage uploads/downloads) are slower than pure unit tests — generous
// timeouts avoid flaking on a cold local stack without masking a genuine
// hang.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
