# Admin dashboard

The editorial control surface. AI proposes, humans approve — this is where the
approval happens. Auth for `/admin` and `/api/admin` is covered in
[setup.md](setup.md#admin-authentication).

**Status:** built. Pages under `src/pages/admin/*`, API under
`src/pages/api/admin/*`, data access in `src/lib/db/admin.ts`. Every mutating
action writes an `audit_log` row in the same batch as the change it records.
Admins are alerted about new drafts and a low trending queue by the `alerts`
background job (email; see *Alerts* below). Non-email admin push is on the
[roadmap](roadmap.md).

---

## Draft review

- Queue of draft articles sorted by: submission count (same claim submitted by
  multiple users), AI confidence score, or age (`getDraftQueue`, `DraftSort`).
  Membership is **report-based** (`PENDING_DRAFT_PREDICATE`): a claim is pending
  while it has a preliminary report, has no original yet, and isn't rejected —
  not keyed on `source_type`. This is what keeps a TYPE 3 → 2 promoted claim (now
  publicly TYPE 2) in the queue so it can still be published as TYPE 1.
- Draft detail shows per-channel submission tallies, subscriber count, and
  similar already-published reports to avoid duplication (`getDraftDetail`)
- One-click **approve / edit / reject** per draft
  - Publish (`publishDraft`) is the only path to TYPE 1 (`original`/`published`);
    it moves claim + report + audit row in one batch and requires a verdict
  - Edit (`updateDraft`) cannot save evidence lacking a valid source URL — the
    same rule the AI output obeys
  - Reject (`rejectDraft`) records a reason. For a claim the crawler already
    promoted to a live TYPE 2, rejecting drops only the AI draft and leaves the
    external report live; for a pure TYPE 3 it marks the claim `rejected`
- Opening a draft marks it `under_review` (`markUnderReview`)
- Mobile-friendly — admins must be able to clear the queue from a phone
- Deduplication: if multiple users submit the same claim while in draft, one
  draft is created; users who opt in via the results-page "notify me" form
  (`POST /api/v1/subscribe`) are notified when it publishes
- **Alert system** — new drafts trigger an email to every active admin (see
  *Alerts* below)

---

## Trending queue

Cards on the homepage trending rail are pulled from this admin-managed queue.

**Queue structure**
- Pinned cards — occupy fixed slots, never expire, stay until admin manually
  unpins (`setPinned`)
- Non-pinned cards — 48-hour countdown from admin approval; head of queue pops
  first when expired
- Admin receives a low-queue email alert when fewer than 5 non-pinned cards
  remain (`TRENDING_LOW_THRESHOLD`), fired by the `alerts` job (see *Alerts*
  below); the count is also surfaced live via `getOverview`

**Candidate pipeline**
- Algorithm surfaces candidates by submission volume + recency + verdict weight
  (FALSE/MISLEADING rank higher) — `getTrendingCandidates`
- Only TYPE 1 and TYPE 2 are eligible — no preliminary or unreviewed content
  (enforced in `approveTrending`)
- Admin sees a "Trending Candidates" queue: approve / reject / manually nominate
- Admin can pin any approved card to keep it in rotation indefinitely
- Admin sets card order within the approved queue (`queue_position`)

---

## Roles

From `admin_users.role`, enforced in `src/lib/auth.ts` / `src/middleware.ts`:

- `super_admin`, `editor` — can publish and reject
- `reviewer` — can open and edit drafts but not ship them

---

## Overview counters

`getOverview` powers the dashboard landing tiles: drafts pending, high-confidence
drafts, active/expiring trending cards, claims today, published this week,
TYPE 4 awaiting re-check, TYPE 3 preliminary, and subscribers waiting to be
notified.

---

## Alerts

Between logins, the editorial team is pushed two signals by the `alerts`
background job (`src/lib/jobs/alerts.ts`, `POST /api/jobs/alerts`, scheduled
every 20 min by the cron worker). Both go by email to **every active admin**
(`admin_users.active = 1`), reusing the subscriber email transport
(`src/lib/notify/email.ts`); with the `EMAIL_*` keys unset the job is inert.

- **New drafts** — watermark-triggered. Each run alerts only on drafts created
  since the last alerted one (the report-based `PENDING_DRAFT_PREDICATE`, so it
  agrees with the drafts-pending tile), then advances the watermark — but only
  after a send actually lands, so an inert transport delivers the backlog once
  keys are set. Links to `/admin`.
- **Low trending queue** — edge-triggered. One alert when non-pinned live cards
  drop below `TRENDING_LOW_THRESHOLD` (5), then silence until the queue recovers
  above the mark (no recovery email, no repeat spam). Links to `/admin/trending`.

Dedup state lives in `admin_alert_state` (one row per kind; migration `0005`),
read/written via `src/lib/db/alerts.ts`. Non-email admin push (web-push/Slack)
is on the [roadmap](roadmap.md).
