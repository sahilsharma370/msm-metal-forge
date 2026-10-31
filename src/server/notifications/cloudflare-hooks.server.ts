/**
 * CHECKPOINT C2H-B2 — Nitro plugin registering the Cloudflare `queue`/
 * `scheduled` Worker handlers. `.server.ts` suffix — see env.server.ts for
 * why that's sufficient import protection on its own.
 *
 * Registered via `nitro.plugins` in vite.config.ts (see that file's own
 * comment for exactly why an explicit path is required rather than
 * directory-convention auto-discovery). All real logic lives in
 * queue-consumer.server.ts/cron-sweep.server.ts, both fully unit tested
 * with fake deps — this file is intentionally thin, pure wiring that
 * cannot itself be meaningfully unit tested outside a real Nitro runtime.
 *
 * globalThis.__env__ (and therefore every process.env["..."] read inside
 * createDispatchNotificationDeps() — Supabase admin client, email config)
 * is already set by Nitro's cloudflare-module preset before either hook
 * below ever fires (confirmed by reading
 * node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs:
 * both its `queue()` and `scheduled()` methods do `globalThis.__env__ = env`
 * before calling into these hooks) — no manual env threading is needed
 * here.
 */
import { definePlugin } from "nitro";
import { handleOwnerNotificationQueueBatch, createProductionQueueConsumerDeps, type WakeupMessageBatch } from "./queue-consumer.server";
import { runNotificationCronSweep, createProductionCronSweepDeps } from "./cron-sweep.server";

export default definePlugin((nitro) => {
  nitro.hooks.hook("cloudflare:queue", async ({ batch }) => {
    await handleOwnerNotificationQueueBatch(batch as WakeupMessageBatch, createProductionQueueConsumerDeps());
  });

  nitro.hooks.hook("cloudflare:scheduled", async () => {
    await runNotificationCronSweep(createProductionCronSweepDeps());
  });
});
