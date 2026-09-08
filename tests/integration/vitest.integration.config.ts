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
//
// fileParallelism: false — every file in this directory performs its own
// `npx supabase db reset` and/or Storage cleanup against the SAME local
// database (see each file's own safety-gate/cleanup comments). Vitest runs
// test files in parallel by default; two of these files resetting the same
// local Postgres/Storage concurrently would corrupt each other's state.
// This is a supported top-level `test` option in the installed Vitest
// version (4.1.10) — confirmed against its own config type declarations —
// and is scoped to this integration-only config, so ordinary `npm test`
// (the root vitest.config.ts, which has no such need since unit tests never
// touch a shared local database) is completely unaffected.
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
