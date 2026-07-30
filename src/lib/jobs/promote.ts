/**
 * Automatic promotions driven by the background jobs.
 *
 * These are the non-admin transitions from docs/pipeline.md:
 *   TYPE 4 → 3  (re-check finds sufficient facts)   — sets a `draft`
 *   TYPE 4 → 2  (crawler finds an external report)   — sets `external`/`published`
 *   TYPE 3 → 2  (crawler finds one before admin acts) — adds external, keeps the draft
 *
 * The hard rule holds: none of these ever set `original`, and none put an
 * AI-authored verdict live. TYPE → 3 only ever writes a `draft` for a human;
 * TYPE → 2 writes an attributed external verdict, which is the established
 * carve-out (see insertClaim in ../db/claims.ts). The one path to `original` is
 * still publishDraft() alone.
 *
 * No audit_log row is written — audit_log records *admin* actions and its
 * admin_user_id is a required FK. An automatic promotion is recorded on the
 * claim itself via promoted_from / promoted_at.
 */
import type { ClaimRow, Verdict } from '../types';
import type { ExternalReportFields } from '../pipeline/searchExternal';
import { insertReport } from '../db/claims';
import { newId, nowIso } from '../db/util';

export interface PromotionResult {
  claim_id: string;
  from: string;
  to: 'preliminary' | 'external';
  /** Subscribers who should be notified once a delivery channel exists. */
  subscribers: number;
}

async function countSubscribers(db: D1Database, claimId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM subscribers WHERE claim_id = ? AND notified_at IS NULL')
    .bind(claimId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * TYPE 4 → TYPE 3. The re-check found enough sources to form a provisional
 * view. Queue a draft for admin review — never published.
 */
export async function promoteToPreliminary(
  db: D1Database,
  claim: ClaimRow,
  draft: { verdict: Verdict; confidence: number | null; headline: string; summary: string; body: string; evidence: unknown[]; tags: string[]; country?: string | null; language?: string | null }
): Promise<PromotionResult> {
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE claims
         SET source_type = 'preliminary', status = 'draft', verdict = ?, confidence = ?,
             promoted_from = source_type, promoted_at = ?, last_rechecked_at = ?
         WHERE id = ?`
      )
      .bind(draft.verdict, draft.confidence, now, now, claim.id),
    db
      .prepare(
        `INSERT INTO reports
           (id, claim_id, report_type, slug, headline, summary, body, evidence, tags,
            country, language, external_url, fact_checker_id, published_by, published_at)
         VALUES (?, ?, 'preliminary', NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`
      )
      .bind(
        newId(),
        claim.id,
        draft.headline,
        draft.summary,
        draft.body,
        JSON.stringify(draft.evidence ?? []),
        JSON.stringify(draft.tags ?? []),
        draft.country ?? null,
        draft.language ?? null,
        now
      ),
  ]);

  return { claim_id: claim.id, from: claim.source_type, to: 'preliminary', subscribers: await countSubscribers(db, claim.id) };
}

/**
 * TYPE 4 → TYPE 2, or TYPE 3 → TYPE 2. The crawler matched an authenticated
 * external report. The claim goes live as an attributed TYPE 2. For a claim
 * that already had an AI draft (the 3 → 2 case), the preliminary report is left
 * in place so an editor can still publish a TYPE 1 that supersedes it — the
 * report-based draft queue keeps it visible.
 */
export async function promoteToExternal(
  db: D1Database,
  claim: ClaimRow,
  report: ExternalReportFields
): Promise<PromotionResult> {
  const now = nowIso();
  // Only overwrite published_at when the claim wasn't already live.
  const wasLive = claim.status === 'published';

  await db.batch([
    db
      .prepare(
        `UPDATE claims
         SET source_type = 'external', status = 'published', verdict = ?, confidence = NULL,
             promoted_from = source_type, promoted_at = ?,
             published_at = COALESCE(published_at, ?), last_rechecked_at = ?
         WHERE id = ?`
      )
      .bind(report.verdict, now, now, now, claim.id),
    insertReportStatement(db, claim.id, report),
  ]);

  void wasLive;
  return { claim_id: claim.id, from: claim.source_type, to: 'external', subscribers: await countSubscribers(db, claim.id) };
}

/** Builds the external-report INSERT as a statement for batching with the claim update. */
function insertReportStatement(db: D1Database, claimId: string, report: ExternalReportFields): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO reports
         (id, claim_id, report_type, slug, headline, summary, body, evidence, tags,
          country, language, external_url, fact_checker_id, published_by, published_at)
       VALUES (?, ?, 'external', NULL, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL, ?)`
    )
    .bind(
      newId(),
      claimId,
      report.headline,
      report.summary,
      report.body,
      JSON.stringify(report.evidence ?? []),
      report.country,
      report.language,
      report.externalUrl,
      report.factCheckerId,
      nowIso()
    );
}

// Re-exported so the crawler/re-check jobs can build reports without importing
// claims.ts directly for the one-off preliminary path used elsewhere.
export { insertReport };
