# Data model — claim record, schema, fact-checker network

**Source of truth for the schema is `wireframes/data-model.html`**, mirrored by
the SQL in `migrations/`. Do not drift from either without updating both. This
doc is the narrative overview; the migrations are the authoritative definition.

---

## Claim record

The central entity. Everything else references it.

```
claim {
  id
  fingerprint          // stable identifier for the claim's meaning
  canonical_text       // normalised version of the claim
  original_inputs[]    // all raw submissions (text, URL, image, video) — stored in `submissions`
  source_type          // current TYPE: original | external | preliminary | submitted
  status               // processing | draft | under_review | published | rejected
  verdict              // TRUE | FALSE | MISLEADING | UNVERIFIABLE | OUTDATED | SATIRE | null
  confidence           // 0-100 | null
  published_at         // null until published
  external_reports[]   // authenticated fact-checker reports found — stored in `reports`
  draft_report         // AI-generated draft awaiting admin review — stored in `reports`
  subscribers[]        // users to notify on promotion — stored in `subscribers`
  submission_count     // how many users submitted this claim
  last_rechecked_at    // timestamp of last crawler/re-check run
  promoted_from        // previous source_type before promotion
  promoted_at          // timestamp of last promotion
}
```

> **Note:** `fingerprint` is specified as a semantic embedding. The M1
> implementation stores a SHA-256 hash of normalised text; embeddings are on the
> [roadmap](roadmap.md). The column and interface do not change when it lands.

---

## Tables (as built)

Defined in `migrations/0001_init.sql`, with FTS in `0002_fts.sql` and seeds in
`0003`/`0004`.

| Table | Purpose |
|---|---|
| `claims` | Central entity: fingerprint, canonical_text, source_type, status, verdict, confidence, submission_count, promotion timestamps |
| `reports` | Published/draft articles (`original` \| `external` \| `preliminary`); slug, headline, summary, body, evidence (JSON), tags, country, language, external_url, fact_checker_id |
| `submissions` | One row per user input; channel, raw_input (JSON), anonymised user_identifier |
| `subscribers` | Notify-on-promotion contacts; notify_via, contact, notified_at |
| `fact_checkers` | The authenticated network (see below) |
| `trending_cards` | Admin-managed homepage queue; pinned, queue_position, expires_at |
| `audit_log` | Every admin action, for editorial transparency |
| `admin_users` | Dashboard access; role in super_admin \| editor \| reviewer |

`claims_fts` and `reports_fts` are FTS5 virtual tables powering keyword search
and the current fingerprint second pass.

---

## Authenticated Fact-Checker Network

A curated, tiered list maintained by fcheck.in admins. Tier affects the trust
indicator shown to users. Managed via the `fact_checkers` table; seeded in
`migrations/0003_seed_fact_checkers.sql`.

### Primary aggregation
- **Google Fact Check Tools API** — indexes ClaimReview schema markup from 100+
  publishers; first call in every external search (`src/lib/providers/googleFactCheck.ts`)

### Tier 1 — Global
Snopes, Reuters Fact Check, AP Fact Check, AFP Fact Check, PolitiFact,
FactCheck.org, Full Fact, BBC Reality Check

### Tier 2 — Regional
Boom Live, Alt News, Factly (India), Africa Check, Chequeado (Latin America),
Maldita (Spain), Correctiv (Germany)

The list is a managed data entity — admins can add, remove, or re-tier sources.
Regional coverage expands as the service grows.

Each fact-checker entry carries:
- `countries[]` — one or more countries the source covers
- `languages[]` — languages the source publishes in
- `tier` — 1 or 2
- `api_endpoint` — if available (e.g. Google Fact Check Tools API covers many at once)

These fields power the Country and Language search filters (honoured today in
`searchInternal.ts` and `searchExternal.ts`; the homepage UI controls are on the
[roadmap](roadmap.md)).
