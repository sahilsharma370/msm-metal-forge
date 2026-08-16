# Cloudflare setup — Quote abuse protection (CHECKPOINT C2G)

Names and manual steps only. **No secret values, tokens or keys appear in
this file, in `wrangler.jsonc`, or anywhere else in this repository.**

This document is a checklist for whoever has access to the real Cloudflare
account and Supabase project when it's time to actually deploy. Nothing in
this repository performs any of these steps automatically, and none of them
were performed while producing this checkpoint — all work was local-only.

## 1. What's already checked in

- `wrangler.jsonc` (project root) — pinned `compatibility_date`,
  `compatibility_flags: ["nodejs_compat"]`, the three Rate Limiting
  bindings (`RATE_LIMITER_INITIATE`, `RATE_LIMITER_UPLOAD`,
  `RATE_LIMITER_COMPLETE`), the `OWNER_NOTIFICATION_QUEUE` producer/
  consumer (CHECKPOINT C2H-B2), and an every-minute Cron trigger. Picked
  up automatically by Nitro's `cloudflare-module` preset at build time —
  see the comment block at the top of that file for exactly how it's
  merged.
- `.env.example` — documents every required variable name (server secrets
  and the one public build-time key). No real values.
- `src/server/notifications/` — the owner-notification email brain
  (CHECKPOINT C2H-B1) and its Cloudflare Queue/Cron wiring (CHECKPOINT
  C2H-B2): rendering, the Resend adapter, the dispatcher, the Queue
  producer/consumer, and the Cron sweep. Fully unit + local-integration
  tested; never wired to a real Resend call or a real Cloudflare Queue
  from this repository.

## 2. Bindings that need NO manual dashboard step

Cloudflare Workers Rate Limiting bindings are configured entirely through
`wrangler.jsonc`'s `ratelimits` array — `namespace_id` is an arbitrary,
developer-chosen unique string, not a dashboard-provisioned resource ID
(unlike KV/D1/R2). As long as `wrangler.jsonc` deploys with the Worker, all
three limiter bindings exist automatically. Available on the Workers Free
plan.

## 3. Manual steps still required before a real deployment

1. **Create a Turnstile widget** in the Cloudflare dashboard (Turnstile →
   Add widget). Use "Managed" mode. Register the real production
   hostname(s) — these must exactly match what's configured in
   `TURNSTILE_ALLOWED_HOSTNAMES` (step 3 below), since
   `src/server/turnstile.server.ts` rejects any Siteverify response whose
   `hostname` isn't in that list.
2. **Set the Worker's server-only secrets** (never committed, never in this
   repo):
   - `TURNSTILE_SECRET_KEY` — the secret key from the widget created above.
     Set via `wrangler secret put TURNSTILE_SECRET_KEY` or the dashboard's
     Worker → Settings → Variables (as an encrypted secret, not plaintext).
   - `TURNSTILE_ALLOWED_HOSTNAMES` — comma-separated exact production
     hostname(s), e.g. `www.example.com`. Can be a plaintext environment
     variable (not sensitive) or a secret; either works since
     `process.env` reads both the same way in this runtime.
   - `SUPABASE_URL` / `SUPABASE_SECRET_KEY` — already required by the
     existing Quote pipeline; unchanged by this checkpoint.
3. **Set the one public build-time variable**: `VITE_TURNSTILE_SITE_KEY`,
   the site key from the same widget, in whatever CI/build environment runs
   `npm run build` (it's baked into the client bundle at build time by
   Vite, not read at request time — see `.env.example`'s own comment for
   why this one is safe to be public and why no other `VITE_`-prefixed
   variable should be added without the same confirmation).
4. **Create the Queue** (CHECKPOINT C2H-B2, not done by this repository):
   `wrangler queues create msm-owner-notifications`. Unlike the Rate
   Limiting bindings, a Cloudflare Queue genuinely is a dashboard/CLI-
   provisioned resource — `wrangler.jsonc`'s `queues` block only declares
   the binding/consumer config, it does not create the Queue itself.
5. **Set the owner-email variables**: `RESEND_API_KEY`,
   `OWNER_NOTIFICATION_EMAIL`, `EMAIL_FROM`, optionally `EMAIL_REPLY_TO`
   and `OWNER_DASHBOARD_URL` — see `docs/owner-email-setup.md` for the
   full checklist (verified sending domain, manual
   `requeue_notification_delivery_v1` recovery, etc.).
6. **Deploy** with `wrangler deploy` (or the project's normal CI/CD path).
   Not run from this repository as part of this checkpoint.

## 4. Verifying it worked (post-deploy, not part of this checkpoint)

- Submitting the real Quote form should require completing the visible
  Turnstile challenge before `/api/quote/initiate` succeeds.
- Hitting `/api/quote/initiate`, `/upload`, or `/complete` faster than the
  configured limits (see `wrangler.jsonc`'s own rationale comments) should
  return HTTP 429 with `retryable: true` and a `Retry-After` header.
- `wrangler tail` (or the dashboard's Logs) should never show
  `TURNSTILE_SECRET_KEY`, a raw Siteverify token, or a client IP in any log
  line — the server code never logs these by design.
