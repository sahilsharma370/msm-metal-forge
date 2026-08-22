# Owner email setup — CHECKPOINT C2H-B1 / C2H-B2

Names and steps only — no real values, and no example value shaped like a
real key/secret, are committed anywhere in this repo.

## What's built so far

Everything in this pipeline is implemented and covered by real local
Supabase Postgres integration tests (`tests/integration/notification-dispatch.local.test.ts`)
plus exhaustive unit tests (`src/server/notifications/*.test.ts`):

- The durable outbox (`public.notification_deliveries`) and its lifecycle
  RPCs (`claim_notification_delivery_v1`, `mark_notification_delivery_sent_v1`,
  `reschedule_notification_delivery_v1`, `dead_letter_notification_delivery_v1`,
  `requeue_notification_delivery_v1`) — CHECKPOINT C2H-A/C2H-B1.
- The dispatcher (`src/server/notifications/dispatch-notification.server.ts`)
  and the Resend HTTP adapter (`resend-email-provider.server.ts`).
- **The Cloudflare Queue producer/consumer and the scheduled Cron sweep are
  implemented and wired in** (`queue-producer.server.ts`,
  `queue-consumer.server.ts`, `cron-sweep.server.ts`,
  `cloudflare-hooks.server.ts` — registered via `nitro.plugins` in
  `vite.config.ts`). `/api/quote/complete` publishes a wake-up message after
  every successful completion; the Queue consumer and the Cron sweep both
  drain the same durable outbox via the same dispatcher. This corrects an
  earlier version of this document, which incorrectly listed this wiring as
  an open item — it is not.

The system is honest **at-least-once** delivery with durable idempotency —
never claimed as exactly-once. A Queue message can be lost, delayed, or
delivered twice; the outbox row (never the message) is the only source of
truth, and the message/idempotency-key/claim-fencing design (see each RPC's
own migration comment) is what makes every one of those outcomes a safe
no-op rather than a duplicate email or a lost one.

## Required Cloudflare provisioning (deployment gate — not done by this repo)

None of the following is created by this repository or by `wrangler.jsonc`
declaring the binding/consumer/cron config — they are real dashboard/CLI-
provisioned resources that must exist before a real deployment:

1. **Create the Queue**: `wrangler queues create msm-owner-notifications`
   (binding name `OWNER_NOTIFICATION_QUEUE`, matching `wrangler.jsonc`'s
   `queues` block). See `docs/cloudflare-setup.md` for the full checklist
   shared with the Turnstile/rate-limit checkpoint.
2. **Cron**: `wrangler.jsonc`'s `triggers.crons` (`* * * * *`, every minute)
   is applied automatically on `wrangler deploy` — no separate manual step,
   but confirm it after deploy (see the smoke-test procedure below).
3. Both the Queue and Cron require the same server-only environment
   variables below to be set on the deployed Worker before either does
   anything useful — an unconfigured Worker still runs the consumer/sweep
   safely (every delivery dead-letters with `CONFIGURATION_ERROR`, nothing
   crashes, nothing touches `leads`), it just never actually sends email.

## Required environment variables

Set these wherever the Worker's runtime environment is configured (never
committed — see `.env.example` for names only, never a value):

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | yes | Resend API key, server-only |
| `OWNER_NOTIFICATION_EMAIL` | yes | Where the owner enquiry email is sent |
| `EMAIL_FROM` | yes | The `From` address/display name |
| `EMAIL_REPLY_TO` | no | Optional `Reply-To` |
| `OWNER_DASHBOARD_URL` | no | Optional link included in the email when set — never guessed/constructed, only ever this exact configured value (see `owner-notification-email.ts`'s own doc comment: this is the only source, so it can never be influenced by quote input) |

Missing `RESEND_API_KEY`/`OWNER_NOTIFICATION_EMAIL`/`EMAIL_FROM` does not
break anything else — `getEmailConfig()` (`src/server/env.server.ts`) is
read lazily, only from inside the dispatcher, only after a delivery is
already claimed. A missing value there dead-letters that one delivery with
a sanitized `CONFIGURATION_ERROR` code and stops — it never touches
`leads`, never breaks the build, and never affects Quote completion.

## Resend domain verification (deployment gate)

`EMAIL_FROM`'s domain must be a verified sending domain in the Resend
dashboard before deployment. An unverified domain is typically rejected by
Resend with a permanent error, which `resend-email-provider.server.ts`
already classifies as non-retryable (dead-letters immediately rather than
spending the five-attempt retry budget on an error retrying can never fix)
— but the delivery still fails until the domain is verified. Not something
this repository or its tests can do for you; a one-time manual dashboard
step in Resend.

## Staging smoke-test procedure (after the above is provisioned)

1. Submit one real Quote (Seller or Buyer) against the deployed staging
   Worker.
2. Confirm the owner inbox (`OWNER_NOTIFICATION_EMAIL`) receives the email
   within roughly a minute — the Queue wake-up should make it near-
   immediate; the Cron sweep is the outer bound (at most one minute later)
   if the Queue message was ever lost.
3. Inspect the row directly (service-role only, e.g. via the Supabase SQL
   editor or CLI against the staging project):
   ```sql
   select id, lead_id, status, attempt_count, provider, provider_message_id,
          sent_at, last_error_code, last_error_at
   from public.notification_deliveries
   order by created_at desc
   limit 5;
   ```
   Confirm `status = 'sent'`, `provider = 'resend'`, and a genuine
   `provider_message_id`.
4. `wrangler tail` (or the dashboard's Logs) during the test should never
   show `RESEND_API_KEY`, a raw Resend response body, or a customer email
   address/name in any log line — the logger (`notification-logger.ts`)
   only ever emits a fixed, pre-approved event code (e.g.
   `notifications.queue_dispatch_sent`), never free-form data.

## Failure / retry / dead-letter inspection procedure

Query `public.notification_deliveries` (service-role only) to see what's
happening:

- **Currently retrying**: `status = 'retry_wait'` — `next_attempt_at` shows
  when it will next be attempted; `last_error_code`/`last_error_at` show the
  most recent transient failure (a short machine code only, e.g.
  `SERVER_ERROR`, `RATE_LIMITED` — never raw provider text).
- **Stuck/crashed worker**: `status = 'processing'` with `lease_expires_at`
  in the past — this is stranded, not stuck forever: the next Queue message
  or Cron tick will reclaim it automatically (`claim_notification_delivery_v1`
  treats an expired lease as eligible again).
- **Needs manual attention**: `status = 'dead_letter'` — `attempt_count`
  will show `5` (exhausted the normal retry budget) or less (a permanent
  failure classified as unrecoverable-by-retry, e.g. `CONFIGURATION_ERROR`,
  `AUTH_ERROR`, `INVALID_RECIPIENT`). Check `last_error_code` to diagnose,
  fix the underlying cause (usually a config/domain-verification issue),
  then recover it:
  ```sql
  select public.requeue_notification_delivery_v1('<delivery_id>');
  ```
  This resets `status` to `pending` with a fresh five-attempt budget;
  `manual_requeue_count` is a permanent audit trail of how many times this
  delivery needed manual intervention — never reset, unlike `attempt_count`.
  There is no bulk requeue RPC — each dead-lettered row is requeued
  individually, a deliberate operator action every time.

## Deployment gates that remain external to this repository

Everything above this line is implemented and tested; these are the only
remaining items that require a real Cloudflare/Resend account and cannot be
completed or verified from this codebase alone:

- Creating the `msm-owner-notifications` Queue (`wrangler queues create`).
- Setting the four environment variables above on the deployed Worker
  (`wrangler secret put` / dashboard Variables).
- Verifying `EMAIL_FROM`'s sending domain in the Resend dashboard.
- Running the staging smoke-test procedure above at least once before
  relying on this pipeline in production.
