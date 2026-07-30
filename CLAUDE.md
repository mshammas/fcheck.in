# fcheck.in — Project Bible

Make fact-checking accessible to everyone, from any platform, in seconds.
fcheck.in aggregates fact-checks, checks claims with AI, and gives a verdict
wherever the user already is.

This file is the **map**. It stays deliberately short — detail lives in `docs/`.

**Working in this repo:** this file is loaded automatically — read it first for
context. Then open **only** the `docs/` file(s) relevant to your task (use the
[Docs index](#docs-index) to choose the right one), and consult the code as
needed. Don't load docs you don't need; keeping this file thin and reading on
demand is the whole point of the structure.

## Product principles

1. **Three clicks to a verdict** — no friction, no registration wall on the check
2. **Mobile-first, always** — assume a phone, probably in WhatsApp, probably at night
3. **Honest about uncertainty** — never show a verdict we can't source; label provisional results
4. **Credit where it's due** — external fact-checkers are always attributed visibly
5. **Human review before publication** — AI proposes, humans approve; no AI report goes live unreviewed
6. **No jargon** — verdicts readable by anyone, anywhere
7. **Non-partisan** — no political side; sources and methodology always shown

## The hard rules (never break these)

- **AI never publishes a verdict autonomously.** `publishDraft()` in
  `src/lib/db/admin.ts` is the **only** code path to `original` (TYPE 1), and it
  requires admin approval. `published` is *also* reachable for `external` claims
  (TYPE 2) — but that is an attributed human fact-checker's verdict, never an AI
  one; the carve-out is enforced in `insertClaim` (`external` is the only
  non-admin `source_type` allowed to be `published`).
- **Every AI-generated claim cites a source.** Evidence without a working URL is
  dropped before it reaches a user — enforced in `src/lib/providers/anthropic.ts`
  and again in the admin edit path, not just in the prompt.
- **Confidence is never padded** — it reflects real source quality and quantity.
- **External sources are authoritative and attributed** — no AI verdict layered on top.

## Current status — M1 shipped

**Built:** Astro on Cloudflare Workers + D1; the full check pipeline (stages 1–6);
all four response TYPEs; the admin dashboard (draft review → publish/reject,
trending queue); Cloudflare Access admin auth; the web channel; the JSON API;
background jobs (re-check, crawler, trending-expiry) driving the automatic
promotions (TYPE 4→3, 4→2, 3→2), scheduled by a dedicated cron worker;
subscriber notifications over email (subscribe endpoint + send path, wired into
publish and the promotions); image + PDF analysis (read inline by Claude and
folded into the claim package); an offline test suite. Web + API are the only
live input channels.

**Not built yet (see [docs/roadmap.md](docs/roadmap.md)):** bot channels
(WhatsApp/Telegram/email/extension), subscriber notification delivery on the
non-email channels (WhatsApp/Telegram/web-push subscribers are recorded but not
sent — rides on bot channels), embedding-based claim fingerprinting
(currently hash + FTS), audio/video media analysis (images + PDFs are analysed;
audio/video are accepted and flagged, pending transcription), editorial-mode
homepage, and the TL;DR share flow.

Two things only a human with credentials can do (both in [docs/setup.md](docs/setup.md)):
set the API keys, and wire Cloudflare Access for `/admin` in production.

## Response TYPE hierarchy (first match wins)

| TYPE | Meaning | source_type | Built? |
| --- | --- | --- | --- |
| 1 | fcheck.in original, human-reviewed | `original` | yes |
| 2 | Authenticated external fact-checker, attributed | `external` | yes |
| 3 | AI preliminary, labelled provisional, draft queued | `preliminary` | yes |
| 4 | Insufficient facts — submitted for review, no verdict | `submitted` | yes |

Full definitions and editorial policy: [docs/product.md](docs/product.md).

## Claim lifecycle

```
submitted → processing → draft → under_review → published
                                             └→ rejected
```

Promotions notify subscribers — the admin publish (TYPE 3 → 1) and the automatic
crawler/re-check promotions all send on commit (email today; other channels
recorded, pending bot channels). Details: [docs/pipeline.md](docs/pipeline.md).

## Verdict labels

`True` · `False` · `Misleading` · `Unverifiable` · `Outdated` · `Satire`
(defined in [docs/product.md](docs/product.md); enforced in the DB schema and the AI schemas).

## Repo map

| Path | What lives here |
| --- | --- |
| `src/lib/pipeline/` | The check pipeline — one file per stage (`normalize`, `media` (image/PDF analysis), `matcher`, `searchInternal`, `searchExternal`, `index`) |
| `src/lib/jobs/` | Background jobs: `recheck`, `crawler`, `trending`, `promote` (automatic promotions), `index` (dispatch) |
| `src/lib/providers/` | External APIs: `anthropic.ts` (Claude), `googleFactCheck.ts` |
| `src/lib/notify/` | Subscriber notifications: `index` (service, called on publish/promotion), `email` (provider-agnostic HTTP send path) |
| `src/lib/db/` | D1 data access: `claims`, `admin`, `subscribers`, `factCheckers`, `client` (bindings), `util` (pure helpers — no runtime coupling) |
| `src/lib/auth.ts`, `src/middleware.ts` | Admin identity + `/admin` gating |
| `src/pages/` | Web pages (`index`, `check/[id]`, `article/[slug]`, `admin/*`) and API (`api/v1/*`, `api/admin/*`, `api/jobs/[job]`) |
| `src/components/`, `src/layouts/`, `src/styles/` | Astro UI |
| `workers/cron/` | Standalone cron scheduler worker — fires the job endpoints on a schedule |
| `migrations/` | D1 schema + seeds (`0001`–`0004`) |
| `test/` | Offline tests: auth JWT, AI editorial invariants, job promotions, subscriber notifications, media analysis (real-SQL via `d1.ts`) |
| `wireframes/` | HTML design references + `data-model.html` (schema source of truth) |
| `docs/` | The detailed docs indexed below |

## Docs index

Open the single file whose topic matches your task. Each topic is single-homed —
it lives in exactly one doc, with cross-links instead of duplication — so you
rarely need to open more than one.

| Doc | Single source of truth for… |
| --- | --- |
| [docs/product.md](docs/product.md) | Response TYPE definitions, verdict meanings, AI usage rules, editorial policy, scope ("what fcheck.in is NOT") |
| [docs/pipeline.md](docs/pipeline.md) | The 6 processing stages, input channels & types, claim persistence, and the promotion/lifecycle rules |
| [docs/data-model.md](docs/data-model.md) | Claim record, DB tables & schema, the fact-checker network entity |
| [docs/admin.md](docs/admin.md) | Admin dashboard behaviour: draft review/publish/reject, trending queue, roles |
| [docs/homepage.md](docs/homepage.md) | Public UI: search & editorial modes, filters, trending cards, TL;DR share |
| [docs/roadmap.md](docs/roadmap.md) | What is not built yet — the resumable work log; start here to continue unfinished work |
| [docs/setup.md](docs/setup.md) | Run, test, deploy, and the two human-only setup steps (API keys, Cloudflare Access) |

Maintenance: when adding or editing docs, keep each row's description
discriminative and single-home every topic. If two docs would cover the same
thing, pick one owner and cross-link from the other.

## Tech stack

Cloudflare Workers (with static assets) + D1 (SQLite at edge) · Astro · Claude
API (Haiku 4.5 extract, Sonnet 5 deep-check with web search) · Google Fact Check
Tools API · WhatsApp/Telegram bots (planned). Domain `fcheck.in` on Cloudflare DNS.
