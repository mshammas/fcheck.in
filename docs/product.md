# Product — response types, verdicts, editorial policy

The product rules that govern what fcheck.in shows a user and why. For the
lightweight overview see [CLAUDE.md](../CLAUDE.md); for how these types are
produced see [pipeline.md](pipeline.md).

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

All four types are live. The pipeline that selects between them is in
`src/lib/pipeline/index.ts`.

---

## Verdict Labels

Standardized verdicts used across all article types. Enforced in the DB schema
(`migrations/0001_init.sql`) and both Claude output schemas
(`src/lib/providers/anthropic.ts`).

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

The last three rules are enforced in code, not just prompts: evidence without a
working URL is dropped in `deepCheck` and rejected in the admin edit path, and
the only path to `published`/`original` is `publishDraft()` in
`src/lib/db/admin.ts`.

---

## Editorial Policy (short form)

- fcheck.in publishes only what can be sourced
- Preliminary AI results are never presented as final
- External sources are always attributed — we do not claim their work as ours
- Reports are reviewed by at least one admin before publication
- Corrections are published with full transparency when errors are found
- The authenticated fact-checker list is reviewed periodically for reliability

---

## What fcheck.in is NOT

- Not a social media platform
- Not a place to report opinions or commentary — only factual claims
- Not a tool for targeting individuals — claims about public figures are in scope; private individuals are out of scope unless they are making public claims
- Not a replacement for journalism — we aggregate and analyze, we do not investigate from scratch (except when no source exists)
