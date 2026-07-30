# Pipeline — channels, input types, processing, promotion

How a submission becomes a response. The response *types* themselves are defined
in [product.md](product.md); not-yet-built stages are tracked in
[roadmap.md](roadmap.md).

**Status:** stages 1–6 are built for the **web**, **api**, and **whatsapp**
channels, with text, URLs, images, and PDFs fully processed. Audio and video are
accepted and flagged but not yet analysed (pending transcription). Background
jobs and the automatic promotions they drive are built. WhatsApp is wired but
inert until Meta credentials are set ([setup.md](setup.md)); Telegram, email, and
the browser extension are on the roadmap.

---

## Input Channels

fcheck.in must accept inputs from wherever users encounter misinformation.

### Mobile (highest priority)
- WhatsApp bot — user forwards message (text, image, PDF; audio/video flagged) to fcheck.in number *(built: `src/pages/api/webhooks/whatsapp.ts`; inert until Meta credentials are set — [setup.md](setup.md))*
- Telegram bot — same pattern *(planned)*
- PWA with Web Share Target — fcheck.in appears as share destination on Android/iOS without app install *(planned)*
- iOS Share Extension / Android Share Intent — for future native app *(planned)*

### Browser
- Browser extension — right-click selected text, image, or full page → "Check with fcheck.in" *(planned)*
- Direct web — paste text, drop file, enter URL *(built)*
- Bookmarklet — lightweight fallback *(planned)*

### Social platform integrations
- Twitter/X — tag @fcheck in a reply to fact-check a tweet *(planned)*
- Email — forward any email to check@fcheck.in; get a reply with verdict *(planned)*

### Programmatic
- API — for developers, newsrooms, and partner integrations *(built: `src/pages/api/v1/check.ts`)*

The `submissions.channel` column already allows `web`, `whatsapp`, `telegram`,
`email`, `extension`, and `api`, so a new channel needs only a webhook that
builds a `CheckRequest` — the pipeline itself does not change.

---

## Input Types

Every channel must handle all of these, unified through one processing pipeline.
Inputs are never restricted to a single type — any combination is accepted as
one claim package.

| Type | Examples |
|---|---|
| Plain text | WhatsApp forward, copied headline, typed claim |
| URL | News article, tweet, YouTube video, social post |
| Image | Screenshot, infographic, photo with claim |
| Video | WhatsApp video, TikTok, Reel, YouTube clip |
| Audio | Voice note, podcast clip |
| Document | PDF, shared file |
| Mixed — any combination | Text + URL, text + image + video, URL + image, WhatsApp message with caption + image + link — all treated as one unified claim package |
| Screenshot | Social media post screenshot (processed via OCR) |

**Mixed input processing rule:** when a submission contains multiple types, all
components are processed together and contribute to a single verdict. A text
caption on an image is not processed separately from the image — both are
analysed as one claim.

**Media processing:** text and URLs are fully processed (`normalize()` fetches
and strips linked pages). Images and PDFs are read inline by Claude (vision +
document input, via `src/lib/pipeline/media.ts`) and folded into the claim
package as text, so stages 2+ treat them like any other input. Audio and video
are still recorded and flagged only — transcription and frame extraction are on
the [roadmap](roadmap.md). File bytes ride in on `CheckFile.data` (base64,
bounded) and are stripped before the submission is stored.

---

## Processing Pipeline

All inputs — regardless of channel or type — flow through one pipeline
(`src/lib/pipeline/index.ts`):

```
Input
  → Normalize (extract text/frames/audio as needed)        [normalize.ts]
  → Extract Claims (identify the factual assertion(s))      [providers/anthropic.ts — Haiku]
  → Fingerprint + cache check (repeat claims served from D1) [matcher.ts]
  → Search fcheck.in database                                [searchInternal.ts]
      → Hit: TYPE 1 response
  → Search authenticated fact-checker network                [searchExternal.ts]
      → Hit: TYPE 2 response
  → AI deep-check (source search, contradiction analysis)    [providers/anthropic.ts — Sonnet]
      → Sufficient facts: TYPE 3 response + draft queued
      → Insufficient: TYPE 4 response
  → Format output for channel (WhatsApp reply / web page / API JSON / SMS / email)
```

First match wins; the pipeline stops there. No path through this pipeline sets a
claim to `published` — that is an admin action ([admin.md](admin.md)).

---

## Claim Persistence and Promotion

### Every response is stored — no reprocessing

Every claim entering the pipeline is persisted regardless of TYPE. Future
submissions of the same or semantically similar claim are served from the
database instantly.

```
User submits claim
  → Normalise → generate claim fingerprint
  → Check database for matching fingerprint
      Match found → serve cached response
      No match → run full pipeline → store → serve
```

**Matching** runs three passes behind the `ClaimMatcher` interface
(`matcher.ts`): exact SHA-256 hash of normalised text → embedding similarity →
FTS5 keyword second pass (≥ 0.75 token overlap required to fold two claims
together). The embedding pass (`embeddings.ts`, Workers AI + Vectorize) resolves
paraphrases — "warm water cures covid" and "hot water kills the virus" — to one
record. It is **inactive until a Vectorize index is provisioned**
([setup.md](setup.md)); until then `createSemanticMatcher` degrades to exactly
the hash + FTS behaviour, so semantically identical claims with different wording
produce separate records.

The claim record and DB schema are documented in [data-model.md](data-model.md).

### Status promotion logic

Claims promote upward automatically or via admin action. Every promotion is meant
to notify all subscribed users.

| Transition | Trigger | Human needed? | Notification | Status |
|---|---|---|---|---|
| TYPE 4 → TYPE 3 | Re-check job finds sufficient facts | No (queues draft for admin) | "An early analysis is ready" | **built** |
| TYPE 4 → TYPE 2 | Crawler finds authenticated report | No | "A verified report is ready" | **built** |
| TYPE 3 → TYPE 1 | Admin approves draft | Yes | "Full reviewed report is ready" | **built** |
| TYPE 3 → TYPE 2 | Crawler finds authenticated report before admin approves | No | "A verified report is ready" | **built** |
| TYPE 2 → TYPE 1 | fcheck.in team publishes original report | Yes | "fcheck.in full report now available" | **built** |

The transitions are implemented (`publishDraft` for the admin path;
`src/lib/jobs/promote.ts` for the automatic ones), and each now fires subscriber
notifications on commit via `notifyClaimSubscribers` (`src/lib/notify/`). Email
is delivered when `EMAIL_*` is configured (inert otherwise, backlog preserved);
WhatsApp/Telegram/web-push subscribers are recorded but skipped until the bot
channels ship. Delivery is best-effort and never rolls back a promotion. Each
subscriber is notified once, at the first promotion that gives the claim a
visible verdict. See [roadmap.md](roadmap.md).

Editorial invariant preserved throughout: the automatic promotions never set
`original` and never put an AI verdict live. TYPE → 3 only ever writes a `draft`
for a human; TYPE → 2 writes an attributed external verdict (the carve-out
enforced in `insertClaim`). The one path to `original` remains `publishDraft`.

**TYPE 3 → TYPE 2 special case:** Draft remains in admin queue — admin can still
publish TYPE 1 later, which then supersedes TYPE 2. External sources move to
"Also reported by".

**User experience on promotion:** When a subscribed user returns via
notification link, the page always reflects current `source_type` — they never
see a stale TYPE. This is why `buildResponse()` re-reads the claim from the DB
rather than returning what it just computed.

### Background jobs *(built — `src/lib/jobs/`)*

Each is a pure `(db, deps)` function, dispatched by `runJob` (`jobs/index.ts`),
run via `POST /api/jobs/:job` (bearer `CRON_SECRET`), and scheduled by the cron
worker in `workers/cron/`. All are bounded per run.

**Crawler job** *(every 15m)* — polls the fact-checker network for claims with no
fcheck.in original yet; promotes any that now have an authenticated external
report (TYPE 4→2 and TYPE 3→2). `jobs/crawler.ts`.

**Re-check job** *(every 6h)* — re-runs the AI deep-check on TYPE 4 claims; when
enough sources have emerged, promotes to TYPE 3 and queues a draft. `jobs/recheck.ts`.

**Trending-expiry job** *(every 30m)* — removes expired non-pinned trending cards
and reports remaining queue depth for the low-queue alert. `jobs/trending.ts`.

---

## Output Formats by Channel

| Channel | Format |
|---|---|
| WhatsApp / Telegram / SMS | 3-line verdict + confidence + fcheck.in link |
| Web (full) | Complete article: verdict, evidence, source quality, timeline, share button |
| Browser extension | Inline overlay on current page |
| Email | Plain-text reply with structured report |
| API | Structured JSON with verdict, confidence, sources, status |
| Social (Twitter/X) | Concise reply with verdict + link |

Web, API, and WhatsApp formats are built (WhatsApp: `formatReply` in
`src/lib/channels/whatsapp.ts`); the rest arrive with their channels.
