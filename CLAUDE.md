# fcheck.in — Project Bible

## Mission

Make fact-checking accessible to every person, from any platform, in seconds. fcheck.in is not just a database of fact-check articles — it is an aggregator, an original fact-checker, and a universal entry point that meets users wherever they already are.

---

## Product Principles

1. **Three clicks to a verdict** — no friction, no registration walls on the check itself
2. **Mobile-first, always** — the primary user is on a phone, probably in WhatsApp, probably at night
3. **Honest about uncertainty** — never show a verdict we cannot back with sources; label provisional results clearly
4. **Credit where it's due** — when sourcing from external fact-checkers, always attribute visibly
5. **Human review before publication** — AI proposes, humans approve; no AI-generated report goes live without admin sign-off
6. **No jargon** — verdicts and summaries must be readable by anyone, everywhere
7. **Non-partisan** — fcheck.in takes no political side; sources and methodology are always shown

---

## Response Type Hierarchy

Every user query flows through this hierarchy in order. The first match wins.

### TYPE 1 — fcheck.in Original Article
- Full reviewed report authored by the fcheck.in team
- Highest trust indicator shown to user
- `source_type: original`

### TYPE 2 — Authenticated Fact-Checker Report
- Sourced from the fcheck.in authenticated fact-checker network
- Shown with clear attribution: source name, link, date, their verdict
- fcheck.in displays a source trust tier alongside
- No "preliminary" label — external authoritative sources are treated as authoritative
- `source_type: external`

### TYPE 3 — Preliminary Check
- No existing article found anywhere in the network
- AI has found sufficient facts, data, or contradicting sources to form a partial picture
- Shown with explicit confidence level (e.g. "High confidence — likely misleading")
- Clearly labeled: *"This is an AI-generated preliminary analysis. A reviewed report is in progress."*
- Full draft queued for admin review; user can opt in for notification on publish
- `source_type: preliminary`

### TYPE 4 — Submitted for Review
- No existing article found; AI found insufficient facts to form a view
- No verdict shown — too risky
- User informed: "We found limited information. This has been submitted to our team."
- User notified when a report is eventually published
- `source_type: submitted`

---

## Claim Status Lifecycle

```
submitted → processing → draft → under_review → published
                                              └→ rejected
```

- **processing**: AI is running
- **draft**: AI done, awaiting admin
- **under_review**: admin has opened the draft
- **published**: live article
- **rejected**: admin determined not worth publishing (duplicate, insufficient public interest, etc.)

---

## Input Channels

fcheck.in must accept inputs from wherever users encounter misinformation.

### Mobile (highest priority)
- WhatsApp bot — user forwards message (text, image, video, voice note) to fcheck.in number
- Telegram bot — same pattern
- PWA with Web Share Target — fcheck.in appears as share destination on Android/iOS without app install
- iOS Share Extension / Android Share Intent — for future native app

### Browser
- Browser extension — right-click selected text, image, or full page → "Check with fcheck.in"
- Direct web — paste text, drop file, enter URL
- Bookmarklet — lightweight fallback

### Social platform integrations
- Twitter/X — tag @fcheck in a reply to fact-check a tweet
- Email — forward any email to check@fcheck.in; get a reply with verdict

### Programmatic
- API — for developers, newsrooms, and partner integrations

---

## Input Types

Every channel must handle all of these, unified through one processing pipeline. Inputs are never restricted to a single type — any combination is accepted as one claim package.

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

**Mixed input processing rule:** when a submission contains multiple types, all components are processed together and contribute to a single verdict. A text caption on an image is not processed separately from the image — both are analysed as one claim.

---

## Processing Pipeline

All inputs — regardless of channel or type — flow through one pipeline:

```
Input
  → Normalize (extract text/frames/audio as needed)
  → Extract Claims (identify the specific factual assertion(s))
  → Search fcheck.in database
      → Hit: TYPE 1 response
  → Search authenticated fact-checker network (Google Fact Check API + curated list)
      → Hit: TYPE 2 response
  → AI deep-check (source search, contradiction analysis, confidence scoring)
      → Sufficient facts: TYPE 3 response + draft queued
      → Insufficient: TYPE 4 response
  → Format output for channel (WhatsApp reply / web page / API JSON / SMS / email)
```

---

## Authenticated Fact-Checker Network

A curated, tiered list maintained by fcheck.in admins. Tier affects trust indicator shown to users.

### Primary aggregation
- **Google Fact Check Tools API** — indexes ClaimReview schema markup from 100+ publishers; first call in every external search

### Tier 1 — Global
Snopes, Reuters Fact Check, AP Fact Check, AFP Fact Check, PolitiFact, FactCheck.org, Full Fact, BBC Reality Check

### Tier 2 — Regional
Boom Live, Alt News, Factly (India), Africa Check, Chequeado (Latin America), Maldita (Spain), Correctiv (Germany)

The list is a managed data entity — admins can add, remove, or re-tier sources. Regional coverage expands as the service grows.

Each fact-checker entry carries:
- `country[]` — one or more countries the source covers
- `language[]` — languages the source publishes in
- `tier` — 1 or 2
- `api_endpoint` — if available (e.g. Google Fact Check Tools API covers many at once)

These fields power the Country and Language search filters.

---

## Claim Persistence and Promotion

### Every response is stored — no reprocessing

Every claim entering the pipeline is persisted regardless of TYPE. Future submissions of the same or semantically similar claim are served from the database instantly.

```
User submits claim
  → Normalise → generate claim fingerprint (semantic embedding)
  → Check database for matching fingerprint
      Match found → serve cached response
      No match → run full pipeline → store → serve
```

Claim fingerprint uses embedding-based similarity search (not exact string match) so semantically identical claims with different wording resolve to the same record.

### Claim record

```
claim {
  id
  fingerprint          // semantic embedding for similarity matching
  canonical_text       // normalised version of the claim
  original_inputs[]    // all raw submissions (text, URL, image, video)
  source_type          // current TYPE: original | external | preliminary | submitted
  status               // processing | draft | under_review | published | rejected
  verdict              // TRUE | FALSE | MISLEADING | UNVERIFIABLE | OUTDATED | SATIRE | null
  confidence           // 0-100 | null
  published_at         // null until published
  external_reports[]   // authenticated fact-checker reports found
  draft_report         // AI-generated draft awaiting admin review
  subscribers[]        // users to notify on promotion
  submission_count     // how many users submitted this claim
  last_rechecked_at    // timestamp of last crawler/re-check run
  promoted_from        // previous source_type before promotion
  promoted_at          // timestamp of last promotion
}
```

### Status promotion logic

Claims promote upward automatically or via admin action. Every promotion notifies all subscribed users.

| Transition | Trigger | Human needed? | Notification |
|---|---|---|---|
| TYPE 4 → TYPE 3 | Re-check job finds sufficient facts | No (queues draft for admin) | "An early analysis is ready" |
| TYPE 4 → TYPE 2 | Crawler finds authenticated report | No | "A verified report is ready" |
| TYPE 3 → TYPE 1 | Admin approves draft | Yes | "Full reviewed report is ready" |
| TYPE 3 → TYPE 2 | Crawler finds authenticated report before admin approves | No | "A verified report is ready" |
| TYPE 2 → TYPE 1 | fcheck.in team publishes original report | Yes | "fcheck.in full report now available" |

**TYPE 3 → TYPE 2 special case:** Draft remains in admin queue — admin can still publish TYPE 1 later, which then supersedes TYPE 2. External sources move to "Also reported by".

**User experience on promotion:** When a subscribed user returns via notification link, the page always reflects current `source_type` — they never see a stale TYPE.

### Background jobs

**Crawler job** — continuously monitors authenticated fact-checker sources for new reports; matches against stored claim fingerprints; triggers TYPE 4→2 and TYPE 3→2 promotions automatically.

**Re-check job** — periodically re-runs AI analysis on TYPE 4 claims to check if sufficient sources have emerged; promotes to TYPE 3 and queues a draft if yes. Runs every 6 hours by default.

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

---

## TL;DR Share Feature

Every published report (TYPE 1 or TYPE 2) includes a one-tap share flow:

- User selects target platform (WhatsApp, Twitter/X, Facebook, SMS, copy link)
- fcheck.in generates a platform-appropriate TL;DR — short enough for a reply, with a link to the full report
- The TL;DR is AI-generated but scoped strictly to the report content — no extrapolation

---

## Admin Dashboard Requirements

- Queue of draft articles sorted by: submission count (same claim submitted by multiple users), AI confidence score, age
- One-click approve / edit / reject per draft
- Mobile-friendly — admins must be able to clear the queue from a phone
- Alert system: push notification or email when new drafts arrive
- Deduplication: if multiple users submit the same claim while in draft, one draft is created; all submitters are notified on publish

---

## Verdict Labels

Standardized verdicts used across all article types:

| Verdict | Meaning |
|---|---|
| True | Claim is accurate and supported by evidence |
| False | Claim is factually incorrect |
| Misleading | Claim contains partial truth presented deceptively |
| Unverifiable | Insufficient evidence to confirm or deny |
| Outdated | Was true at time but no longer accurate |
| Satire | Claim originates from a satirical source |

---

## AI Usage Rules

- AI may extract claims, search sources, summarize findings, and generate confidence scores
- AI may generate preliminary responses (TYPE 3) shown to users, clearly labeled as provisional
- AI may generate draft reports for admin review
- AI may generate TL;DR share text scoped to an existing reviewed report
- AI must never publish a verdict autonomously — admin approval required for all TYPE 1 articles
- Every AI-generated claim must cite a source; unsourced assertions are not permitted in any output
- Confidence scores must reflect actual source quality and quantity — not padded

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Hosting | Cloudflare Pages | Edge deployment, free tier, supports Workers |
| Serverless functions | Cloudflare Workers | AI calls, bot webhooks, form handling |
| Database | Cloudflare D1 | SQLite at edge, free tier, simple schema |
| Framework | Astro or SvelteKit | Fast, content-optimized, minimal JS |
| AI | Claude API (Anthropic) | Claim extraction, fact analysis, TL;DR generation |
| Fact-check search | Google Fact Check Tools API + curated crawlers | Broad coverage, structured ClaimReview data |
| WhatsApp integration | WhatsApp Business API (via Meta) | Bot channel |
| Telegram integration | Telegram Bot API | Bot channel |
| Domain | fcheck.in (Cloudflare DNS) | Already registered |
| Source code | Private GitHub repo | Version control, CI/CD to Cloudflare Pages |

---

## Editorial Policy (short form)

- fcheck.in publishes only what can be sourced
- Preliminary AI results are never presented as final
- External sources are always attributed — we do not claim their work as ours
- Reports are reviewed by at least one admin before publication
- Corrections are published with full transparency when errors are found
- The authenticated fact-checker list is reviewed periodically for reliability

---

## Homepage Design

### Two modes — toggled by user, preference saved to localStorage

**Search mode (default)**
- Hero search bar — single input area that accepts any combination of content simultaneously; no "pick one type" restriction
- Input is treated as a single claim package regardless of how many content types it contains

**Input handling rules:**
- Text typed or pasted into the bar is always accepted
- URLs embedded anywhere within pasted text are auto-extracted and processed alongside the surrounding text
- Attachment button (📎) opens a multi-file picker — user can attach images, videos, audio, and documents simultaneously
- Drag-and-drop onto the search bar is supported
- Any combination is valid: text only, URL only, image only, text + URL + image + video + document — all processed together as one claim package
- Detected content is shown as chips below the bar in real time (e.g. "📝 Text detected", "🔗 URL detected", "🎬 Video URL detected", "📎 2 files attached") so the user can confirm what was picked up before submitting
- Input type is never restricted by a mode selector — the system detects automatically

**Filters below the input area:**
  - **Country** — multi-select searchable dropdown; filters both fcheck.in DB and external fact-checker queries by country coverage; default: All
  - **Language** — multi-select; filters language of report returned (not language of input); default: All; selecting a country auto-suggests common languages for that country but remains overridable
  - The two filters are independent but offer smart suggestions when one is set
- Trust anchor below filters: "Checked by X trusted fact-checkers worldwide"
- Trending section below — cards from fcheck.in articles and authenticated external fact-checkers, visually distinguished by source badge
- Toggle in top-right header: [Search] [Editorial] — active mode underlined

**Editorial mode**
- Featured article (large card with image) at top
- Right sidebar (sticky on scroll): Region filter, Category filter, Country filter, Language filter, stats block
- Latest reports grid (3 columns desktop)
- Country and Language filters in sidebar narrow the reports grid, consistent with Search mode filter behaviour

### Trending section — card queue model

Cards in the trending section are pulled from an admin-managed queue:

**Queue structure:**
- Pinned cards — occupy fixed slots, never expire, stay until admin manually unpins
- Non-pinned cards — 48-hour countdown from admin approval; head of queue pops first when expired
- Admin receives a low-queue alert when fewer than 5 non-pinned cards remain

**Candidate pipeline:**
- Algorithm surfaces candidates by: submission volume + recency + verdict weight (FALSE/MISLEADING rank higher)
- Only TYPE 1 (fcheck.in original) and TYPE 2 (authenticated external) cards are eligible — no preliminary or unreviewed content
- Admin sees a "Trending Candidates" queue: approve / reject each card, or manually nominate a card
- Admin can also pin any approved card to keep it in rotation indefinitely
- Admin sets card order within the approved queue

**Card display:**
- Each card shows: claim headline, verdict badge (color-coded), source badge (fcheck.in vs. external fact-checker name), date
- fcheck.in articles use a distinct color treatment from external source cards — attribution is always visible
- Clicking any card: fcheck.in original → full article on fcheck.in; external → TYPE 2 page on fcheck.in attributing and summarising the external report with link

---

## What fcheck.in is NOT

- Not a social media platform
- Not a place to report opinions or commentary — only factual claims
- Not a tool for targeting individuals — claims about public figures are in scope; private individuals are out of scope unless they are making public claims
- Not a replacement for journalism — we aggregate and analyze, we do not investigate from scratch (except when no source exists)
