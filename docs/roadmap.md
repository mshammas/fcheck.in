# Roadmap & resumable work log

Everything specified but not yet built. Each item is written so any session can
pick it up cold: what it is, current status, the concrete next action, and where
the code lives or would live.

> **▶ Next step — Embedding-based claim fingerprinting.** When resuming
> ("continue with next step"), work the item marked **▶ Next** in the M2 list
> below (*Embedding fingerprinting*). Note its **blocker**: a Vectorize index
> must be provisioned (a human-only step) before the query path can run — do the
> code behind the existing `ClaimMatcher` interface and flag the provisioning.
> (Absent an explicit ▶ marker, the default is the first item not `[x]`.)
>
> *Subscriber notifications* is built for **email**; *Media analysis* now reads
> **images and PDFs** inline (Claude vision + document input) and folds them into
> the claim package. Audio/video are still recorded and flagged — they need
> transcription (a Workers AI / external-API blocker). WhatsApp/Telegram/web-push
> subscribers are recorded but not yet delivered — both ride on later items.

Milestones: **M1 = shipped** (pipeline, admin, web + API). **M2 = in progress.**

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `▶` next up

---

## M1 — shipped (for reference)

- [x] Astro on Cloudflare Workers + D1; schema + seeds (`migrations/0001`–`0004`)
- [x] Check pipeline stages 1–6 (`src/lib/pipeline/`), text + URL fully processed
- [x] All four response TYPEs
- [x] Admin dashboard: draft review → publish/reject, trending queue (`src/pages/admin/*`, `src/lib/db/admin.ts`)
- [x] Cloudflare Access admin auth + dev bypass, roles (`src/lib/auth.ts`, `src/middleware.ts`)
- [x] Web channel + JSON API (`src/pages/api/v1/*`, `src/pages/api/admin/*`)
- [x] Offline test suite: auth JWT + AI editorial invariants (`test/`)

---

## M2 — core intelligence & reach

### ▶ Next: Embedding-based claim fingerprinting
- **Why:** the Bible specifies semantic matching so "warm water cures covid" and
  "hot water kills the virus" resolve to one record. Today it's SHA-256 of
  normalised text + an FTS5 second pass (≥ 0.75 token overlap).
- **Where:** `src/lib/pipeline/matcher.ts` — add a second `ClaimMatcher` behind
  the existing interface; swap `hashMatcher` in `src/lib/pipeline/index.ts`.
- **Next action:** add a Workers AI embeddings call + a Vectorize binding in
  `wrangler.jsonc`; store the vector on claim insert; query by cosine similarity
  in `findMatch`, keeping the FTS pass as fallback.
- **Blocker:** a Vectorize index must be provisioned.

### [~] Media analysis — images + PDFs built, audio/video pending
- **Built:** images and PDFs are read inline by Claude (vision + document input)
  and folded into `combinedText`, so a photo or PDF of a claim is fact-checked
  exactly like pasted text. The API now carries file bytes (`CheckFile.data`,
  base64, bounded and stripped before D1); the upload UI base64-encodes
  image/PDF attachments. Code: `src/lib/pipeline/media.ts` (MIME branching),
  `extractFromMedia` in `src/lib/providers/anthropic.ts`, folding in
  `normalize.ts`, client build order in `pipeline/index.ts`. Tests:
  `test/media.test.ts`.
- **Still open:** audio and video (and unsupported document types) are still
  recorded and flagged — a media-only submission of those routes to TYPE 4.
  They need transcription/frame extraction, a **blocker**: a Workers AI Whisper
  binding or an external transcription API (neither provisioned). Wire it as a
  new branch in `partitionMedia`/`analyzeMedia` once available.

### [ ] Bot channels — WhatsApp, Telegram, email, browser extension
- **Why:** highest-priority reach per the Bible; only `web` and `api` are wired.
  The `submissions.channel` enum already allows the others.
- **Where:** new webhook routes under `src/pages/api/`; each normalises its
  payload into a `CheckRequest`, calls `runPipeline`, then formats the response
  for that channel (see Output Formats in [pipeline.md](pipeline.md)).
- **Next action:** start with WhatsApp Business API — one inbound webhook + one
  channel formatter; the pipeline is reused unchanged.
- **Blocker:** Meta / Telegram credentials and a verified number.

### [x] Background jobs — crawler & re-check
- **Built:** the automatic promotions TYPE 4→3 (re-check), 4→2 and 3→2 (crawler),
  plus the trending-expiry job. Logic in `src/lib/jobs/` (`recheck`, `crawler`,
  `trending`, `promote`), exposed at `POST /api/jobs/:job` behind a `CRON_SECRET`
  bearer. The 3→2 case required the admin draft queue to become report-based
  (`PENDING_DRAFT_PREDICATE` in `src/lib/db/admin.ts`) so a claim promoted to
  live TYPE 2 stays reviewable and can still be published as TYPE 1.
- **Scheduling:** a dedicated scheduler worker (`workers/cron/`) with
  `triggers.crons` + a `scheduled()` handler fires those endpoints — the Astro
  adapter's generated worker exports only `fetch`, so the schedule lives in a
  thin second worker. Deploy + `CRON_SECRET` steps in [setup.md](setup.md).
- **Verified:** the promotions and report-based queue have real-SQL integration
  tests (`test/jobs.test.ts`); the trending job + endpoint auth were run against
  local D1. Re-check/crawler full runs need the API keys below to hit live
  Claude/Google.
- **Still open:** subscriber *delivery* (next item) — the jobs count subscribers
  to notify but nothing sends yet.

### [~] Subscriber notifications — email built, other channels pending
- **Built:** the subscribe endpoint (`POST /api/v1/subscribe`, wired to the
  results-page "notify me" form), subscriber persistence with channel inference
  (`src/lib/db/subscribers.ts`), a provider-agnostic email send path
  (`src/lib/notify/email.ts`, `EMAIL_API_URL/TOKEN/FROM` — see [setup.md](setup.md)),
  and a notification service (`src/lib/notify/index.ts`) called after the admin
  publish (TYPE 3 → 1) and after every automatic promotion in the jobs.
- **Delivery contract:** `notified_at` is stamped only after a send actually
  lands; an inert (unconfigured) or failing transport leaves subscribers pending,
  so the backlog delivers once keys are set. Each subscriber is notified once, on
  the first promotion that gives the claim a visible verdict. Tests:
  `test/notify.test.ts`.
- **Still open:** WhatsApp/Telegram/web-push subscribers are accepted and stored
  but skipped at delivery — those rides on the bot-channels item below. A live
  email run needs `EMAIL_*` set (human-only, [setup.md](setup.md)).

---

## M3 — surface & polish

### [ ] Editorial-mode homepage
- **Where:** `src/pages/index.astro` renders a placeholder for the `editorial`
  panel today.
- **Next action:** build featured report, latest-reports grid, and the sticky
  sidebar filters (Region / Category / Country / Language). See [homepage.md](homepage.md).

### [ ] TL;DR share flow
- **Where:** report pages (`src/pages/article/[slug].astro`,
  `src/pages/check/[id].astro`) + a small Claude call scoped strictly to the
  report content.
- **Next action:** add a share control + per-platform TL;DR generation.

### [ ] Country / Language filter UI
- **Note:** the backend already honours these filters (`searchInternal.ts`,
  `searchExternal.ts`). The remaining work is the homepage input controls and
  passing the selections through to `runPipeline`.

### [ ] New-draft & low-trending-queue alerts
- **Where:** admin dashboard ([admin.md](admin.md)); counts already exist in
  `getOverview`. Needs a delivery channel (email/push), shared with subscriber
  notifications above.

---

## Human-only setup (not code — see [setup.md](setup.md))

Credentials, dashboard actions, and provisioning that can't be done from the
codebase. Required unless marked optional.

- [ ] Set `ANTHROPIC_API_KEY` and `GOOGLE_FACT_CHECK_API_KEY` — stages 5–6 (and
      the `recheck`/`crawler` jobs) error without them.
- [ ] Wire Cloudflare Access for `/admin` + `/api/admin` in staging/production;
      fill the `CF_ACCESS_*` and staging D1 `database_id` placeholders in
      `wrangler.jsonc`.
- [ ] Set `CRON_SECRET` on **both** the app worker and the cron worker, set
      `APP_BASE_URL`, and deploy `workers/cron/` to register `triggers.crons` —
      without it the job endpoints are inert (503) and no automatic promotions fire.
- [ ] *(optional)* Set `EMAIL_API_URL`, `EMAIL_API_TOKEN`, `EMAIL_FROM` for
      subscriber email delivery — until then the send path is inert and the
      backlog delivers once configured.

### Blockers for roadmap items not yet started

- [ ] Provision a Vectorize index — blocker for embedding-based fingerprinting.
- [ ] Obtain Meta / Telegram credentials + a verified number — blocker for the
      WhatsApp/Telegram bot channels.
