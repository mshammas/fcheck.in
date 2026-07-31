# fcheck.in — setup & operations

Everything needed to run, verify, and deploy. For product/editorial rules see
[CLAUDE.md](../CLAUDE.md); for architecture see the design docs in
[`../wireframes/`](../wireframes/) and the [docs index](../CLAUDE.md#docs-index).

---

## Local development

```bash
npm install
npm run db:migrate        # apply migrations to the local D1 database
npm run dev               # http://localhost:4321
```

Admin panel: <http://localhost:4321/admin>. Locally you are signed in
automatically as the seeded super-admin (`editorial@fcheck.in`) via the
development bypass — see [Admin authentication](#admin-authentication).

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server on the Workers runtime, with local D1 |
| `npm run build` | Production build (`dist/`) |
| `npm run preview` | Build, then serve the built worker with `wrangler dev` |
| `npm run check` | `wrangler types` + `astro check` (full type-check) |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:migrate` | Apply migrations to **local** D1 |
| `npm run db:migrate:remote` | Apply migrations to the **remote** D1 |
| `npm run db:query "<SQL>"` | One-off query against local D1 |

### Tests

`npm test` runs entirely offline — no API keys, no Cloudflare account. It
covers the two things that otherwise need live credentials to exercise:

- **The Cloudflare Access JWT verifier** (`test/auth.test.ts`) — mints
  genuinely RS256-signed tokens and asserts every accept/reject path
  (expired, wrong audience, wrong issuer, tampered signature, unknown key,
  non-admin, revoked admin), plus that the dev bypass only fires in
  development.
- **The AI editorial invariants** (`test/ai-invariants.test.ts`) — runs the
  real extract/deep-check logic against a fake Claude client to prove that
  evidence without a source URL is dropped and a verdict with no surviving
  source is downgraded to "insufficient", that a paused or refused turn
  never fabricates a result, and the publisher-rating → verdict mapping.

---

## Go-live checklist

**The single runbook for taking fcheck.in from "built" to serving public
traffic.** Start here in a fresh session to see what's pending. Work the tiers
top to bottom. The **Required** steps each link to a detailed how-to below; the
**Fast-follow** and **Not-built** tiers can wait. This checklist covers only
what stands between the current build and launch — for remaining *coded* work
(new channels, transcription, etc.) the source of truth is
[roadmap.md](roadmap.md).

### Tier 1 — Required (the site can't do its job until these are done)

Do them in order; the pipeline, admin review, and background jobs each depend on
the ones above.

- [ ] **Provision remote D1 + migrate.** `wrangler d1 create fcheck` (and
      `fcheck-staging`), paste each `database_id` into the matching block in
      `wrangler.jsonc`, then `npm run db:migrate:remote`. → [Deployment](#deployment)
- [ ] **Set the AI keys** — `ANTHROPIC_API_KEY` and `GOOGLE_FACT_CHECK_API_KEY`
      as worker secrets. Without them stages 5–6 error and no check completes.
      → [§1 API keys](#things-only-you-can-do)
- [ ] **Wire Cloudflare Access** for `/admin` + `/api/admin`; fill the
      `CF_ACCESS_*` placeholders in `wrangler.jsonc`. Without it no human can
      review or publish, so the *human-review-before-publication* rule can't be
      honoured and no TYPE 3 ever becomes a TYPE 1.
      → [§2 Cloudflare Access](#2-cloudflare-access--protects-admin-in-production)
- [ ] **Seed a real admin** — insert at least one `super_admin` (or `editor`)
      row into `admin_users` on remote D1, keyed to the email that will sign in
      via Access; otherwise the dashboard rejects everyone.
      → [Admin authentication](#admin-authentication)
- [ ] **Enable background jobs** — set `CRON_SECRET` (identical on the app worker
      and the cron worker), set `APP_BASE_URL`, and deploy `workers/cron/`.
      Without it: no automatic promotions (4→3, 4→2, 3→2), no trending expiry, no
      admin alerts. → [Background jobs](#background-jobs)
- [ ] **Deploy the app** — `npm run deploy`. → [Deployment](#deployment)
- [ ] **Smoke-test on staging with live keys** (next section) — the live
      pipeline has never run end-to-end (all tests are offline), so this is the
      first proof it works against real Claude/Google.

### Tier 1b — Staging smoke test (before any public traffic)

Offline tests all pass, but stages 5–6 hitting real Claude/Google have never
executed. Against the staging deploy, confirm each by hand:

1. Submit a well-known debunked claim → expect **TYPE 2** with an attributed
   fact-checker.
2. Submit a novel factual claim → expect **TYPE 3/4**; open `/admin`, review the
   draft, and **publish** it → confirm it becomes **TYPE 1** with a slug.
3. Fire each job once with the `CRON_SECRET` bearer (`recheck`, `crawler`,
   `trending`, `alerts`) → 200 + a sane summary. → [Background jobs](#background-jobs)
4. Confirm the cron worker's scheduled triggers actually fire (check its logs).

### Tier 2 — Fast-follow (launch-safe to skip; flip on by adding credentials)

Each is inert until configured and loses no data meanwhile — the backlog
delivers once the keys are set.

- [ ] **Email delivery** (`EMAIL_*`) — subscriber notifications + admin alerts.
      → [§1, Email note](#things-only-you-can-do)
- [ ] **WhatsApp channel** — `WHATSAPP_*` + registered webhook.
      → [§4 WhatsApp](#4-whatsapp-bot-channel--optional-meta-credentials)
- [ ] **Telegram channel** — `TELEGRAM_BOT_TOKEN` + `setWebhook`.
      → [§5 Telegram](#5-telegram-bot-channel--optional-botfather-token)
- [ ] **Semantic matching** (Workers AI + Vectorize) — falls back to hash + FTS
      until provisioned. → [§3 Semantic claim matching](#things-only-you-can-do)

### Tier 3 — Not built yet (genuine roadmap work, not a config flip)

No credential turns these on; tracked in [roadmap.md](roadmap.md):

- **Audio/video analysis** (transcription) — such media is accepted but flagged
  and routed to TYPE 4.
- **Email-inbound** and **browser-extension** channels.
- **Non-email notification/alert delivery** — WhatsApp/Telegram/web-push
  subscribers and non-email admin push are recorded but never sent.

---

## Things only you can do

The detailed how-to for each credentialed step in the [Go-live
checklist](#go-live-checklist) above. These need credentials or a
Cloudflare-dashboard/CLI action, so they can't be done from the codebase.
§§1–2 are required for the live pipeline; §§3–5 are the fast-follow tier and the
app runs without them.

### 1. API keys — makes the live check pipeline run

Stages 5–6 of the pipeline (external fact-checker search and the AI
deep-check) call Google and Anthropic. Without keys, a check runs stages
1–4 and then errors on stage 5.

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` and fill in:

- `ANTHROPIC_API_KEY` — <https://console.anthropic.com> → API keys
- `GOOGLE_FACT_CHECK_API_KEY` — <https://console.cloud.google.com> → enable
  **Fact Check Tools API** → create an API key

Optional — email notifications. These power both subscriber notifications and
the new-draft / low-trending admin alerts (the `alerts` job). Without all three
set, the send path is inert: subscriptions and alert conditions are still
tracked and nothing is marked sent, so the backlog delivers once the keys are
added. The payload matches Resend and similar (`POST` of
`{from,to,subject,text,html}` with a bearer token); point the URL at whatever
transactional-email service you use.

- `EMAIL_API_URL` — the provider's send endpoint (e.g. `https://api.resend.com/emails`)
- `EMAIL_API_TOKEN` — the provider API key (bearer)
- `EMAIL_FROM` — the From address, e.g. `fcheck.in <noreply@fcheck.in>`

Restart `npm run dev`, then verify end to end:

```bash
# A well-known debunked claim → expect TYPE 2 with attribution
curl -s localhost:4321/api/v1/check \
  -H 'content-type: application/json' \
  -d '{"text":"Drinking bleach cures COVID-19"}' | python3 -m json.tool
```

```bash
# The same claim twice → second response has "cached": true, submission_count 2,
# and makes no Claude call
curl -s localhost:4321/api/v1/check -H 'content-type: application/json' \
  -d '{"text":"An obscure local claim about a factory layoff"}' >/dev/null
curl -s localhost:4321/api/v1/check -H 'content-type: application/json' \
  -d '{"text":"An obscure local claim about a factory layoff"}' | python3 -m json.tool
```

For production, set them as secrets instead of vars:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_FACT_CHECK_API_KEY
wrangler secret put EMAIL_API_TOKEN     # optional — subscriber email delivery
```

`EMAIL_API_URL` and `EMAIL_FROM` are not secrets; set them under `vars` in
`wrangler.jsonc` (only `EMAIL_API_TOKEN` needs `wrangler secret put`).

### 2. Cloudflare Access — protects /admin in production

Locally the admin panel uses a development bypass. In staging/production it
must sit behind Cloudflare Access. The verification code is built and
tested; this is the dashboard wiring it needs.

1. **Zero Trust → Access → Applications → Add an application** →
   *Self-hosted*.
2. Application domain: your admin path, e.g. `staging.fcheck.in` with path
   `/admin` (add a second for `/api/admin`, or cover both with a wildcard
   as your setup allows).
3. Add a policy: **Allow**, matching the editorial team's emails (the same
   addresses that exist in the `admin_users` table).
4. After creating it, copy two values into the matching env block in
   [`../wrangler.jsonc`](../wrangler.jsonc) (replacing the `PLACEHOLDER` values):
   - **Team domain** → `CF_ACCESS_TEAM_DOMAIN`
     (e.g. `your-team.cloudflareaccess.com`; Zero Trust → Settings → Custom
     Pages shows it, as does any Access URL)
   - **Application Audience (AUD) tag** → `CF_ACCESS_AUD`
     (the application's Overview page)

The middleware fails closed: if these are unset in a non-development
environment, every `/admin` request is denied rather than allowed. So a
half-configured deployment locks admins out — it never exposes the panel.

### 3. Semantic claim matching — optional (Workers AI + Vectorize)

By default, repeat claims are matched by normalised hash + FTS5 keyword search.
Provisioning a Vectorize index turns on embedding-based matching so paraphrases
("warm water cures covid" / "hot water kills the virus") fold into one record.
The code degrades to hash + FTS when this is absent, so it is safe to skip.

To enable:

```bash
wrangler vectorize create fcheck-claims --dimensions=768 --metric=cosine
```

Then uncomment the `ai` and `vectorize` bindings in `wrangler.jsonc` (they are
left commented because an unbound Vectorize index breaks `wrangler dev`). The
768 dimensions and cosine metric must match the embedding model
(`@cf/baai/bge-base-en-v1.5`, set in `src/lib/pipeline/embeddings.ts`). New
claims are indexed automatically on submission; there is no backfill for claims
created before the index existed — they remain matchable by hash + FTS.

### 4. WhatsApp bot channel — optional (Meta credentials)

The webhook at `POST/GET /api/webhooks/whatsapp` turns forwarded WhatsApp
messages into checks and replies with a short verdict. It reuses the pipeline
unchanged and is inert until the credentials below are set, so it is safe to
leave off.

Setup, in the [Meta App Dashboard](https://developers.facebook.com/) → WhatsApp:

1. Create a Meta app with the WhatsApp product; note the **Phone number ID** and
   generate an **access token** (a permanent system-user token for production).
2. Choose any string as your **verify token**. Set the four secrets:

   ```bash
   wrangler secret put WHATSAPP_ACCESS_TOKEN
   wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   wrangler secret put WHATSAPP_VERIFY_TOKEN
   wrangler secret put WHATSAPP_APP_SECRET     # App Dashboard → Settings → Basic
   ```

3. In **WhatsApp → Configuration → Webhook**, set the callback URL to
   `https://<your-domain>/api/webhooks/whatsapp`, paste the same **verify token**,
   and subscribe to the **messages** field. Meta calls `GET` to verify, then
   `POST`s each inbound message.

The route validates the `X-Hub-Signature-256` on every POST against
`WHATSAPP_APP_SECRET`, so leave that secret set in production. Text, image, and
PDF messages are checked; audio/video get a "send it as text/image" reply until
transcription lands. A verified business phone number is required to send
replies outside the 24-hour customer-service window.

---

### 5. Telegram bot channel — optional (BotFather token)

The webhook at `POST /api/webhooks/telegram` turns forwarded Telegram messages
into checks and replies with a short verdict. Same shape as WhatsApp — reuses the
pipeline unchanged and is inert until `TELEGRAM_BOT_TOKEN` is set, so it is safe
to leave off. Unlike WhatsApp there is no GET handshake; the webhook is
registered out-of-band with the Bot API's `setWebhook`.

1. Talk to [@BotFather](https://t.me/BotFather), `/newbot`, and note the **bot
   token**. Choose any string as your **webhook secret**. Set the two secrets:

   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```

2. Register the webhook, passing the same secret so Telegram echoes it on every
   update (the route rejects any POST whose `X-Telegram-Bot-Api-Secret-Token`
   header doesn't match):

   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<your-domain>/api/webhooks/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

Text, photo, and PDF messages are checked; audio/video get a "send it as
text/image" reply until transcription lands. `/start` and `/help` return a short
usage hint rather than running the pipeline.

---

## Admin authentication

`src/middleware.ts` gates `/admin` and `/api/admin`. `src/lib/auth.ts`
resolves the caller's identity:

- **Development** (`ENVIRONMENT=development`): if there's no Access token,
  it uses `ADMIN_DEV_EMAIL` from `wrangler.jsonc`. This branch is gated on
  the environment value — a `wrangler.jsonc` var, not request input — so it
  cannot fire in staging or production.
- **Staging / production**: it verifies the `Cf-Access-Jwt-Assertion` token
  against the team's JWKS (signature, audience, issuer, expiry), then
  matches the email to an active `admin_users` row. Access being in front
  is defence in depth; this verification is the real gate.

Admin roles: `super_admin` and `editor` can publish and reject; `reviewer`
can open and edit drafts but not ship them.

---

## Deployment

Deploys as a **Cloudflare Worker with static assets** (not Pages). The
background jobs run in a **separate** scheduler worker (`../workers/cron/`) that
shares nothing but an authenticated HTTP call — see [Background jobs](#background-jobs).

```bash
# one-time, per environment: create the D1 database and paste its id into
# the matching block in wrangler.jsonc
wrangler d1 create fcheck-staging

npm run db:migrate:remote     # apply migrations to remote D1
npm run deploy                # astro build && wrangler deploy
```

Before the first staging deploy, replace the `PLACEHOLDER` values in
`wrangler.jsonc`: the staging D1 `database_id`, and the two `CF_ACCESS_*`
values from [step 2 above](#2-cloudflare-access--protects-admin-in-production).

---

## Background jobs

The re-check, crawler, trending-expiry, and admin-alert jobs run via
`POST /api/jobs/:job`, guarded by a `CRON_SECRET` bearer, and are fired on a
schedule by the standalone
cron worker in [`../workers/cron/`](../workers/cron/). The app worker owns all
the logic and D1 access; the cron worker is just a timer (the Astro adapter's
generated worker exports only `fetch`, not `scheduled`).

**Local:** `.dev.vars.example` sets a `CRON_SECRET`; with it, you can run a job
by hand (note the JSON content-type — Astro's CSRF guard needs it):

```bash
curl -s -X POST localhost:4321/api/jobs/trending \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CRON_SECRET" -d '{}'
# → {"job":"trending","summary":{"expired":N,"remaining":M,"lowQueue":bool}}
```

Jobs: `recheck` (TYPE 4→3, needs `ANTHROPIC_API_KEY`), `crawler` (TYPE 4/3→2,
needs `GOOGLE_FACT_CHECK_API_KEY`), `trending` (expiry, no keys), `alerts`
(new-draft & low-trending admin emails, needs `EMAIL_*` to actually send;
`APP_BASE_URL` sets the link origin). Without `CRON_SECRET` the endpoints are
inert (503) rather than open.

**Production — deploy the cron worker (once):**

```bash
# a strong shared secret, identical on both workers
wrangler secret put CRON_SECRET                                   # app worker
cd workers/cron
wrangler secret put CRON_SECRET --env staging                    # cron worker
# set APP_BASE_URL in workers/cron/wrangler.jsonc to the deployed app origin
wrangler deploy --env staging                                    # registers triggers.crons
```

The cron worker's `triggers.crons` (every 6h / 15m / 30m, UTC) then fire the job
endpoints automatically. Keep the `SCHEDULE` map in `workers/cron/index.ts` in
sync with `triggers.crons`.
