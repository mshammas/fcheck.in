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

## Things only you can do

Everything else in the app is built and verified. These need credentials or a
Cloudflare-dashboard/CLI action, so they can't be done from the codebase. The
first two are required for the live pipeline; the third is optional and the app
runs without it.

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

Optional — subscriber email notifications. Without all three set, the send path
is inert: subscriptions are still recorded and no one is marked notified, so the
backlog delivers once the keys are added. The payload matches Resend and similar
(`POST` of `{from,to,subject,text,html}` with a bearer token); point the URL at
whatever transactional-email service you use.

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

The re-check, crawler, and trending-expiry jobs run via `POST /api/jobs/:job`,
guarded by a `CRON_SECRET` bearer, and are fired on a schedule by the standalone
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
needs `GOOGLE_FACT_CHECK_API_KEY`), `trending` (expiry, no keys). Without
`CRON_SECRET` the endpoints are inert (503) rather than open.

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
