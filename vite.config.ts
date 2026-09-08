// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// CHECKPOINT C2H-B2 — @lovable.dev/vite-tanstack-config's own `nitro` option
// type only declares {preset, output, cloudflare} (its own doc comment:
// "narrow on purpose... file an issue if you need more"). Verified directly
// against its dist/index.js, not assumed: the option is passed through with
// no property whitelisting — `{defaultPreset: "cloudflare-module",
// ...options.nitro}` — so a `plugins` key genuinely reaches the real
// `nitro()` Vite plugin call at runtime even though the wrapper's own
// TypeScript surface doesn't declare it. This cast documents that gap
// rather than silently relying on an `any`.
type NitroOptionWithPlugins = NonNullable<NonNullable<Parameters<typeof defineConfig>[0]>["nitro"]>;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Registers the Cloudflare `queue`/`scheduled` Worker handlers (see
  // src/server/notifications/cloudflare-hooks.server.ts) — Nitro's
  // `cloudflare-module` preset always exports `queue`/`scheduled` on the
  // built Worker module (confirmed by reading
  // node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs),
  // wired to the `cloudflare:queue`/`cloudflare:scheduled` runtime hooks a
  // plugin registers. `serverDir` defaults to `false` in this Nitro version
  // (no Nuxt-style auto-scanning of a `server/plugins/` directory), so the
  // plugin must be listed explicitly here rather than discovered by
  // convention.
  nitro: {
    plugins: ["./src/server/notifications/cloudflare-hooks.server.ts"],
  } as unknown as NitroOptionWithPlugins,
});
