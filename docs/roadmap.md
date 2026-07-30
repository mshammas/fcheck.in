# Roadmap & resumable work log

Everything specified but not yet built. Each item is written so any session can
pick it up cold: what it is, current status, the concrete next action, and where
the code lives or would live. **When resuming, start at the first item not `[x]`.**

Milestones: **M1 = shipped** (pipeline, admin, web + API). **M2 = next.**

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

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

### [ ] Embedding-based claim fingerprinting
- **Why:** the Bible specifies semantic matching so "warm water cures covid" and
  "hot water kills the virus" resolve to one record. Today it's SHA-256 of
  normalised text + an FTS5 second pass (≥ 0.75 token overlap).
- **Where:** `src/lib/pipeline/matcher.ts` — add a second `ClaimMatcher` behind
  the existing interface; swap `hashMatcher` in `src/lib/pipeline/index.ts`.
- **Next action:** add a Workers AI embeddings call + a Vectorize binding in
  `wrangler.jsonc`; store the vector on claim insert; query by cosine similarity
  in `findMatch`, keeping the FTS pass as fallback.
- **Blocker:** a Vectorize index must be provisioned.

### [ ] Media analysis (OCR / transcription / frame extraction)
- **Why:** images, video, audio, PDFs are accepted and recorded but not analysed;
  a media-only submission is routed straight to TYPE 4 today.
- **Where:** `src/lib/pipeline/normalize.ts` (see `hasUnprocessedMedia` and the
  `[Attached, not yet analysed: …]` placeholder).
- **Next action:** branch by MIME type — OCR for images, transcription for
  audio/video, text extraction for PDF — and fold the output into `combinedText`
  so stages 2+ treat it as one claim package.

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

### [ ] Subscriber notifications
- **Why:** every promotion is supposed to notify subscribers. The `subscribers`
  table and counts exist, and the jobs + `publishDraft` already compute who to
  notify — nothing sends. See the `TODO(M2+)` in `publishDraft()` and the
  `subscribers` field returned by the promotion helpers (`src/lib/jobs/promote.ts`).
- **Where:** a notification service called from `publishDraft` and the jobs; a
  subscribe endpoint for the web/results pages (the results page has the
  "notify me" form, but it currently only says notifications aren't on yet).
- **Next action:** build the subscribe endpoint + an email send path first, then
  wire it into publish and the promotions.

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

- [ ] Set `ANTHROPIC_API_KEY` and `GOOGLE_FACT_CHECK_API_KEY` — stages 5–6 error
      without them.
- [ ] Wire Cloudflare Access for `/admin` + `/api/admin` in staging/production;
      fill the `CF_ACCESS_*` and staging D1 `database_id` placeholders in
      `wrangler.jsonc`.
