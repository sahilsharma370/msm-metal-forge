# Owner email setup — CHECKPOINT C2H-B1

Names and steps only — no real values are committed anywhere in this repo.

## What's built so far

The database outbox (C2H-A/C2H-B1 migrations) and the server-only dispatch
brain (`src/server/notifications/`) are complete and fully tested. **Nothing
calls the dispatcher yet** — no Cloudflare Queue consumer, no scheduled
handler, no route. That wiring is CHECKPOINT C2H-B2.

## Required environment variables

Set these wherever the Worker's runtime environment is configured (never
committed — see `.env.example` for names only):

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | yes | Resend API key, server-only |
| `OWNER_NOTIFICATION_EMAIL` | yes | Where the owner enquiry email is sent |
| `EMAIL_FROM` | yes | The `From` address/display name |
| `EMAIL_REPLY_TO` | no | Optional `Reply-To` |
| `OWNER_DASHBOARD_URL` | no | Optional link included in the email when set |

Missing `RESEND_API_KEY`/`OWNER_NOTIFICATION_EMAIL`/`EMAIL_FROM` does not
break anything else — `getEmailConfig()` (`src/server/env.server.ts`) is
read lazily, only from inside the dispatcher, only after a delivery is
already claimed. A missing value there dead-letters that one delivery with
a sanitized `CONFIGURATION_ERROR` code and stops — it never touches
`leads`, never breaks the build, and never affects Quote completion.

## Manual recovery after fixing configuration

If deliveries dead-lettered because of a configuration mistake (wrong API
key, unverified sending domain, etc.), fix the environment variable(s) and
then call `public.requeue_notification_delivery_v1(delivery_id)` — service
role only — for each affected row. It resets the delivery to `pending` with
a fresh five-attempt budget; `manual_requeue_count` records that this
happened. There is no bulk requeue RPC in this checkpoint.

## Open items for C2H-B2

- Cloudflare Queue producer (enqueue a `{ deliveryId }` message after
  completion) and consumer (calls `dispatchOwnerNotification({ deliveryId })`).
- A scheduled/Cron handler that calls `dispatchOwnerNotification({})`
  (fallback mode) on an interval, so a lost/never-sent Queue message still
  gets picked up.
- The Resend 409 idempotency-conflict body shape is verified against
  Resend's official documented error contract (see
  `resend-email-provider.server.ts`'s own doc comment): the `name` field
  is the discriminator — `name = "concurrent_idempotent_requests"` is
  retryable, `name = "invalid_idempotent_request"` is permanent/non-
  retryable.
- Verifying the sending domain in Resend and confirming `EMAIL_FROM`'s
  domain matches it (unverified domains are typically rejected by Resend
  with a permanent error this adapter already classifies as non-retryable).
