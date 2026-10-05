# MSM Metal Forge — Release Handover / Runbook

Generated 2026-10-05 after a full ground-truth audit of the live deployment,
a repo-reproducibility fix, and an end-to-end architecture trace. Supersedes
`LAUNCH_AUDIT.md`'s "UNKNOWN (external config)" items — this repo's Worker
has since been deployed to production and provisioned end-to-end; see
verdict below for what is now confirmed vs what still needs a human check.

---

## 1. Architecture

- **App**: TanStack Start (React 19), Nitro `cloudflare-module` preset,
  deployed as Cloudflare Worker `msm-metal-forge`.
- **Data**: Supabase (Postgres 17, hosted, project `msm-scrap-production`,
  ref `hjvjazmerynneylzkgiz`, region `ap-south-1`). RLS enabled on lead
  tables; server code uses the service-role key and bypasses RLS by design
  (trusted backend) — RLS is defense-in-depth against any future anon-key
  path, not the primary access-control layer.
- **Storage**: one private bucket, `lead-files` (confirmed `public: false`
  via direct query). Owner file access mints short-lived signed URLs after
  an app-code membership check (`owner-lead-file-access.server.ts`) —
  storage paths never come from browser input.
- **Human verification**: Cloudflare Turnstile widget "MSM Quote" (managed
  mode), allowed domains `msm-metal-forge.sharm230.workers.dev` and
  `msmscrap.com`. Server-side Siteverify client in
  `src/server/turnstile.server.ts` fails closed on any config/response
  anomaly; diagnostic logging emits only a fixed failure-label enum
  (`missing_token` / `invalid_or_expired_token` / `action_mismatch` /
  `hostname_mismatch` / `service_unavailable`, plus a secondary
  `invalid_secret` / `invalid_response` / `timeout_or_duplicate` /
  `other_siteverify_failure` breakdown on a `success:false` Siteverify
  response) — never the raw token, response, or secret.
- **Quote flow**: homepage → Quote overlay / `/quote` → Seller/Buyer intent
  → material/logistics/contact steps (live-revalidated after first failed
  Continue, with a validation-summary banner) → Turnstile → Review →
  Submit. Submission is idempotent (`/api/quote/initiate`, payload-hash +
  client idempotency key, backed by `create_website_quote_v1`), file
  uploads are a separate claim/finalize RPC pair
  (`claim_quote_upload_v1` / `finalize_quote_upload_v2`) with real
  byte-level MIME/size verification (never trusts the browser's declared
  type), and completion is a third step (`/api/quote/complete`).
- **Owner side**: `/owner/login` issues an OTP via Supabase Auth
  (`request-code.ts` → `verify-code.ts`, both rate-limited, both
  anti-enumeration — one fixed response regardless of registered/
  unregistered email or right/wrong/expired code). Session is a bearer
  Supabase Auth JWT (no cookies, no CSRF-relevant ambient auth) verified on
  every protected route by the single reusable `verifyOwnerSession()` —
  confirmed wired into every owner API route that mutates or reads lead
  data.
- **Notifications**: new/updated leads enqueue a wake-up message onto the
  `msm-owner-notifications` Cloudflare Queue; the consumer
  (`queue-consumer.server.ts`) treats the message as a hint only — Postgres
  (`notification_deliveries`, its own `attempt_count`/`next_attempt_at`) is
  the sole durable retry authority, never Cloudflare's own queue-retry
  count. Actual send is via Resend's HTTP API
  (`resend-email-provider.server.ts`), with correct 409 idempotency-conflict
  classification and no secret/raw-response logging.
- **Rate limiting**: 5 Cloudflare Rate Limiting bindings (`initiate` 5/60s,
  `upload` 30/60s, `complete` 10/60s, owner `request-code` 5/60s, owner
  `verify-code` 8/60s), keyed on `cf-connecting-ip` only (Cloudflare's own
  edge-set header — `X-Forwarded-For` is never read anywhere in this
  codebase). A request with no Cloudflare-verified IP fails closed (500),
  never silently skips the check.

---

## 2. Deploy procedure

This repo's `src/` now reproduces the live deployment exactly (verified via
a clean `git worktree` build whose client bundle hash matched production
byte-for-byte). The working tree still carries one deliberate, uncommitted,
unshipped difference: `QuoteExperience.tsx`'s background-tab Turnstile
visibility patch (+ its tests) — a hypothesis for the original P0 mobile
bug, never proven, never deployed. Do not deploy it without separately
validating it; if/when you do, commit it like any other change first.

**Standard deploy, from a clean commit of this repo:**

```bash
# 1. From the repo root, on the commit you intend to ship:
rm -rf .output .wrangler

# 2. Supply build-time values (never commit these; VITE_* become public in
#    the client bundle by design, so use the real site key/Supabase values):
export VITE_SUPABASE_URL=https://hjvjazmerynneylzkgiz.supabase.co
export VITE_SUPABASE_PUBLISHABLE_KEY=<supabase publishable key>
export VITE_TURNSTILE_SITE_KEY=<turnstile site key>

# 3. Build
npm run build

# 4. Deploy WITHOUT --secrets-file so existing secrets are never replaced
cd .output/server
npx wrangler deploy --config wrangler.json
```

**If you need an isolated copy** (e.g. to build from a commit while keeping
a dirty working tree untouched): `rsync -a --exclude='.git'
--exclude='node_modules' --exclude='.output' --exclude='.env*'
--exclude='.wrangler' <repo>/ <isolated-dir>/`, symlink `node_modules`,
build there instead.

**Verify after every deploy:**
```bash
npx wrangler deployments list --name msm-metal-forge   # confirm new Version ID
npx wrangler secret list --name msm-metal-forge         # confirm all 8 secret NAMES still present
curl -s -o /dev/null -w '%{http_code}\n' https://msm-metal-forge.sharm230.workers.dev/quote
```

### Required secret names (values managed only via `wrangler secret put <NAME> --name msm-metal-forge`, never printed/committed)
`EMAIL_FROM`, `OWNER_DASHBOARD_URL`, `OWNER_NOTIFICATION_EMAIL`,
`RESEND_API_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_URL`,
`TURNSTILE_ALLOWED_HOSTNAMES`, `TURNSTILE_SECRET_KEY`.

### Required public build-time vars
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`VITE_TURNSTILE_SITE_KEY` — baked into the client bundle, safe to be
public by design.

### Dev-only vars that must never be set in a real deployment
`TURNSTILE_LOCAL_TEST_MODE`, `LOCAL_DEV_CLIENT_IP_FALLBACK` — both are
triple/double-gated to fail closed even if accidentally left set (verified
in code; see `turnstile.server.ts` CHECKPOINT C2G-LT and
`rate-limit.server.ts` CHECKPOINT C2I-A-LT).

---

## 3. Routine owner workflow

1. Go to `/owner/login`, request a code with the registered owner email.
2. Enter the code (Supabase-Auth-managed expiry/replay) → lands in
   `/owner` dashboard.
3. Lead list loads from `/api/owner/leads/overview`; filter/search/refresh
   from the dashboard header.
4. Open a lead → view details, change status, add notes, access uploaded
   files (signed URL, short-lived) — every action re-verifies the bearer
   session server-side on that specific route.
5. Trash/restore and CSV export are available from the same authenticated
   surface.
6. New leads trigger an owner notification email automatically (Queue →
   Resend) — no manual step required.

---

## 4. Monitoring

- **Live logs**: `npx wrangler tail msm-metal-forge --format json`. Filter
  with `--method POST`, `--status error`, or `--search` for a specific
  console.log text match. Never pipe raw `wrangler tail` output anywhere
  that isn't your own terminal — it can carry request metadata.
- **Turnstile diagnostics**: watch for `quote.turnstile_rejected` (reason:
  one of the 5-value enum) and `quote.turnstile_siteverify_failure` (label:
  one of the 4-value enum) console.log lines — both are privacy-safe by
  construction (fixed enum only, never raw response/token/secret).
- **Deployment history**: `npx wrangler deployments list --name
  msm-metal-forge`.
- **Secret presence (names only, never values)**: `npx wrangler secret
  list --name msm-metal-forge`.

---

## 5. Backup / restore

- **Supabase**: `npx supabase backups list --experimental --project-ref
  hjvjazmerynneylzkgiz` currently reports `walg_enabled: true` (daily
  WAL-G backups enabled at the infra level) but **`pitr_enabled: false`**
  (Point-In-Time-Recovery is a separate, not-yet-enabled add-on) **and an
  empty `backups` list** — no restorable snapshot currently shows as
  available through this check. **Action required**: confirm directly in
  the Supabase dashboard (Database → Backups) whether a snapshot actually
  exists and whether PITR should be enabled before this goes fully live;
  this cannot be confirmed with more confidence from the CLI alone.
- **Supabase migrations**: all 17 local migrations in `supabase/migrations/`
  are confirmed applied to the remote project (`supabase migration list
  --linked` shows every local timestamp matched remotely, zero drift).
- **Cloudflare Worker rollback**: every deploy is a new immutable Version.
  To roll back:
  ```bash
  npx wrangler rollback <version-id> --name msm-metal-forge -m "<reason>"
  ```
  Get `<version-id>` from `wrangler deployments list`. This does not touch
  secrets or bindings — only which Version serves traffic.
- **Current known-good version**: `b2fc857f-dcf9-4486-826b-d0252f210d30`
  (code version `d11e959a-30f1-49f1-89e2-3266b34ef987` + the
  `TURNSTILE_SECRET_KEY` rotation layered on top as a secret-only change).

---

## 6. Known risks / non-blocking items

| Item | Severity | Status |
|---|---|---|
| Custom domain `msmscrap.com` not yet attached to the Worker | Blocker for that specific goal, not for the live `workers.dev` site | The Cloudflare credential available in this environment (`zone: read` only) cannot read/write DNS records for the zone (`Authentication error`, code 10000) needed to verify no MX/TXT conflict and to let a Custom Domain attachment provision its own record. **Action**: attach manually via Cloudflare dashboard → Workers & Pages → `msm-metal-forge` → Settings → Domains & Routes → Add Custom Domain → `msmscrap.com` (this UI path has full permissions and will not touch MX/TXT), or grant the API token DNS Read+Edit for this zone and ask for this to be re-run. `workers.dev` is unaffected either way. |
| Resend API key — old/previously-exposed key revocation status | Needs manual confirmation | No Resend-key-shaped string was ever found in this repo's git history (checked earlier this session). This session has no readable Resend API key (Worker secrets are write-only from the CLI/API side) and therefore no way to query Resend's own API-keys endpoint to confirm an old key is actually revoked. **Action**: log into the Resend dashboard → API Keys, and confirm only the current key is active and any earlier one is deleted. |
| Resend sending-domain verification | Needs manual confirmation | Same access limitation as above — cannot be checked without a Resend API key. **Action**: confirm in the Resend dashboard that the sending domain used by `EMAIL_FROM` shows "Verified". |
| `TrustBar.test.tsx` (3 tests) | P2, test-only | `gsap.registerPlugin` isn't in the test's own `vi.mock("gsap")` object; real `gsap` always has it. Production TrustBar is unaffected. Pre-existing, unchanged since the last audit. |
| `owner/index.test.tsx` + `index.fetch-binding.test.tsx` (6 tests) | P2, test-only | Harness renders `OwnerInboxBody` without a `RouterProvider`, but `useSearch()` requires one; production always renders this component inside the real route tree. Pre-existing, unchanged since the last audit. Worth closing eventually — it's the only gap in automated coverage for dashboard search/filter/refresh. |
| Background-tab Turnstile visibility patch | Unshipped, unproven | Lives only in the working tree (`QuoteExperience.tsx` + its tests), uncommitted. Addresses an unconfirmed hypothesis for the original P0 mobile bug. The actual confirmed cause of that bug (per live `wrangler tail` evidence) was an `invalid_secret` Siteverify rejection — already fixed by rotating `TURNSTILE_SECRET_KEY` to match the live "MSM Quote" widget. This patch is not currently needed to explain or fix that incident; do not ship it without separate validation. |
| PITR / backup snapshot visibility | See Backup section above | Confirm before treating Supabase data as durably recoverable. |

---

## 7. GO / NO-GO

**GO for the current `workers.dev` production URL.**
`https://msm-metal-forge.sharm230.workers.dev` — Quote flow, Turnstile
(secret freshly rotated and confirmed matching the "MSM Quote" widget),
owner OTP/session/dashboard, uploads, and notifications are all
code-verified end-to-end, repo-reproducible, tested (1541/1550, the 9
failures are pre-existing test-infra-only), typechecked clean, and the
production build matches the live bundle byte-for-byte.

**NO-GO specifically for the `msmscrap.com` custom domain** until the DNS
access blocker above is resolved by a manual dashboard step.

**Deployed version**: `b2fc857f-dcf9-4486-826b-d0252f210d30`
(unchanged this session — no P0/P1 defect was found, so no new deploy was
necessary; this audit's only repo changes were two commits that made the
already-live state reproducible from git).

### Required physical checks (cannot be done from this environment)
1. Full 20-minute phone smoke test: homepage → Quote (Buy and Sell) →
   upload a real small photo/doc → Turnstile → Submit → confirmation
   screen with a reference number, on a real phone, on the live URL.
2. Owner dashboard on a real phone: request OTP → verify → view leads →
   change a status → filter/search → log out → confirm a direct
   dashboard URL redirects to login when logged out.
3. Resend dashboard: confirm sending-domain verification and that no
   stale/old API key remains active (see Known risks above).
4. Supabase dashboard: confirm an actual backup snapshot exists, and
   decide whether to enable PITR.
5. If `msmscrap.com` is wanted now: attach the Custom Domain manually per
   the Known risks row above, then re-run the smoke test against that
   hostname too.
