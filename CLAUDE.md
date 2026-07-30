# fcheck.in — Project Bible

Make fact-checking accessible to everyone, from any platform, in seconds.
fcheck.in aggregates fact-checks, checks claims with AI, and gives a verdict
wherever the user already is.

This file is the **map**. It stays deliberately short — detail lives in `docs/`.

## Product principles

1. **Three clicks to a verdict** — no friction, no registration wall on the check
2. **Mobile-first, always** — assume a phone, probably in WhatsApp, probably at night
3. **Honest about uncertainty** — never show a verdict we can't source; label provisional results
4. **Credit where it's due** — external fact-checkers are always attributed visibly
5. **Human review before publication** — AI proposes, humans approve; no AI report goes live unreviewed
6. **No jargon** — verdicts readable by anyone, anywhere
7. **Non-partisan** — no political side; sources and methodology always shown

## The hard rules (never break these)

- **AI never publishes a verdict autonomously.** TYPE 1 (original) requires admin
  approval. The only code path to `published`/`original` is `publishDraft()` in
  `src/lib/db/admin.ts`.
- **Every AI-generated claim cites a source.** Evidence without a working URL is
  dropped before it reaches a user — enforced in `src/lib/providers/anthropic.ts`
  and again in the admin edit path, not just in the prompt.
- **Confidence is never padded** — it reflects real source quality and quantity.
- **External sources are authoritative and attributed** — no AI verdict layered on top.

## Current status — M1 shipped

**Built:** Astro on Cloudflare Workers + D1; the full check pipeline (stages 1–6);
all four response TYPEs; the admin dashboard (draft review → publish/reject,
trending queue); Cloudflare Access admin auth; the web channel; the JSON API;
an offline test suite. Web + API are the only live input channels.

**Not built yet (see [docs/roadmap.md](docs/roadmap.md)):** bot channels
(WhatsApp/Telegram/email/extension), background crawler + re-check jobs and the
automatic promotions they drive, subscriber notifications, embedding-based claim
fingerprinting (currently hash + FTS), media analysis (OCR / transcription /
frames — media is accepted and flagged only), editorial-mode homepage, and the
TL;DR share flow.

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

Promotions notify subscribers. Only the **TYPE 3 → 1** transition (admin publish)
is built today; the crawler/re-check-driven promotions are on the roadmap.
Details: [docs/pipeline.md](docs/pipeline.md).

## Verdict labels

`True` · `False` · `Misleading` · `Unverifiable` · `Outdated` · `Satire`
(defined in [docs/product.md](docs/product.md); enforced in the DB schema and the AI schemas).

## Repo map

| Path | What lives here |
| --- | --- |
| `src/lib/pipeline/` | The check pipeline — one file per stage (`normalize`, `matcher`, `searchInternal`, `searchExternal`, `index`) |
| `src/lib/providers/` | External APIs: `anthropic.ts` (Claude), `googleFactCheck.ts` |
| `src/lib/db/` | D1 data access: `claims`, `admin`, `factCheckers`, `client` |
| `src/lib/auth.ts`, `src/middleware.ts` | Admin identity + `/admin` gating |
| `src/pages/` | Web pages (`index`, `check/[id]`, `article/[slug]`, `admin/*`) and API (`api/v1/*`, `api/admin/*`) |
| `src/components/`, `src/layouts/`, `src/styles/` | Astro UI |
| `migrations/` | D1 schema + seeds (`0001`–`0004`) |
| `test/` | Offline tests: auth JWT, AI editorial invariants |
| `wireframes/` | HTML design references + `data-model.html` (schema source of truth) |
| `docs/` | The detailed docs indexed below |

## Docs index

| Doc | Covers |
| --- | --- |
| [docs/product.md](docs/product.md) | TYPE hierarchy, verdicts, editorial policy, what fcheck.in is NOT |
| [docs/pipeline.md](docs/pipeline.md) | Processing pipeline, input channels & types, persistence & promotion |
| [docs/data-model.md](docs/data-model.md) | Claim record, DB schema, fact-checker network |
| [docs/admin.md](docs/admin.md) | Admin dashboard, draft queue, trending queue |
| [docs/homepage.md](docs/homepage.md) | Search & editorial modes, filters, TL;DR share |
| [docs/roadmap.md](docs/roadmap.md) | Everything not yet built — the resumable work log |
| [docs/setup.md](docs/setup.md) | Run, test, deploy, and the two human-only setup steps |

## Tech stack

Cloudflare Workers (with static assets) + D1 (SQLite at edge) · Astro · Claude
API (Haiku 4.5 extract, Sonnet 5 deep-check with web search) · Google Fact Check
Tools API · WhatsApp/Telegram bots (planned). Domain `fcheck.in` on Cloudflare DNS.
