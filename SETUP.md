# fcheck.in — setup & operations

Everything needed to run, verify, and deploy. For product/editorial rules see
[CLAUDE.md](CLAUDE.md); for architecture see the design docs in `wireframes/`.

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

## The two things only you can do

Everything else in the app is built and verified. These two need
credentials or a Cloudflare-dashboard action, so they can't be done from
the codebase.

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
```

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
   [`wrangler.jsonc`](wrangler.jsonc) (replacing the `PLACEHOLDER` values):
   - **Team domain** → `CF_ACCESS_TEAM_DOMAIN`
     (e.g. `your-team.cloudflareaccess.com`; Zero Trust → Settings → Custom
     Pages shows it, as does any Access URL)
   - **Application Audience (AUD) tag** → `CF_ACCESS_AUD`
     (the application's Overview page)

The middleware fails closed: if these are unset in a non-development
environment, every `/admin` request is denied rather than allowed. So a
half-configured deployment locks admins out — it never exposes the panel.

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

Deploys as a **Cloudflare Worker with static assets** (not Pages), so the
background cron jobs from `wireframes/pipeline.html` can later live in the
same deployment.

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
