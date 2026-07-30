/**
 * Claim reads and writes.
 *
 * Editorial invariant enforced here: nothing in this module can set a claim to
 * `published`. Publication is an admin action and the admin surface does not
 * exist yet. See CLAUDE.md — "AI must never publish a verdict autonomously".
 */
import type { ClaimRow, ReportRow, SourceType, Verdict, Channel } from '../types';
import { newId, nowIso } from './util';

export async function getClaimById(db: D1Database, id: string): Promise<ClaimRow | null> {
  return db.prepare('SELECT * FROM claims WHERE id = ?').bind(id).first<ClaimRow>();
}

export async function getClaimByFingerprint(
  db: D1Database,
  fingerprint: string
): Promise<ClaimRow | null> {
  return db
    .prepare('SELECT * FROM claims WHERE fingerprint = ? ORDER BY created_at ASC LIMIT 1')
    .bind(fingerprint)
    .first<ClaimRow>();
}

/**
 * The report a user should see for this claim right now.
 *
 * Ordered by the response hierarchy — an original supersedes an external,
 * which supersedes a preliminary. A claim promoted to TYPE 1 after being TYPE 2
 * therefore renders its own report, with the external one moving to
 * "Also reported by".
 */
export async function getPrimaryReport(
  db: D1Database,
  claimId: string
): Promise<ReportRow | null> {
  return db
    .prepare(
      `SELECT * FROM reports
       WHERE claim_id = ?
       ORDER BY CASE report_type
                  WHEN 'original'    THEN 1
                  WHEN 'external'    THEN 2
                  WHEN 'preliminary' THEN 3
                END,
                published_at DESC
       LIMIT 1`
    )
    .bind(claimId)
    .first<ReportRow>();
}

export async function getReportsForClaim(db: D1Database, claimId: string): Promise<ReportRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM reports WHERE claim_id = ? ORDER BY published_at DESC')
    .bind(claimId)
    .all<ReportRow>();
  return results ?? [];
}

export async function getReportBySlug(db: D1Database, slug: string): Promise<ReportRow | null> {
  return db.prepare('SELECT * FROM reports WHERE slug = ?').bind(slug).first<ReportRow>();
}

export interface NewClaim {
  fingerprint: string;
  canonicalText: string;
  sourceType: SourceType;
  /** 'published' is rejected for anything but `external` — see insertClaim. */
  status: ClaimRow['status'];
  verdict: Verdict | null;
  confidence: number | null;
}

export async function insertClaim(db: D1Database, claim: NewClaim): Promise<ClaimRow> {
  // The editorial rule, enforced here rather than trusted to callers: a verdict
  // fcheck.in generated may never go live on its own. An `external` claim may —
  // its verdict belongs to an attributed human fact-checker, and surfacing
  // their published work is not us publishing ours.
  if (claim.status === 'published' && claim.sourceType !== 'external') {
    throw new Error(
      `Refusing to publish a ${claim.sourceType} claim. Only external reports go live without ` +
        'admin approval; originals are published through the admin surface.'
    );
  }

  const id = newId();
  const createdAt = nowIso();
  const publishedAt = claim.status === 'published' ? createdAt : null;

  await db
    .prepare(
      `INSERT INTO claims
         (id, fingerprint, canonical_text, source_type, status, verdict, confidence,
          submission_count, published_at, promoted_from, promoted_at, last_rechecked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, NULL, ?)`
    )
    .bind(
      id,
      claim.fingerprint,
      claim.canonicalText,
      claim.sourceType,
      claim.status,
      claim.verdict,
      claim.confidence,
      publishedAt,
      createdAt
    )
    .run();

  return {
    id,
    fingerprint: claim.fingerprint,
    canonical_text: claim.canonicalText,
    source_type: claim.sourceType,
    status: claim.status,
    verdict: claim.verdict,
    confidence: claim.confidence,
    submission_count: 1,
    published_at: publishedAt,
    promoted_from: null,
    promoted_at: null,
    last_rechecked_at: null,
    created_at: createdAt,
  };
}

/** Called on every repeat submission — drives admin queue ordering. */
export async function incrementSubmissionCount(db: D1Database, claimId: string): Promise<void> {
  await db
    .prepare('UPDATE claims SET submission_count = submission_count + 1 WHERE id = ?')
    .bind(claimId)
    .run();
}

export async function recordSubmission(
  db: D1Database,
  claimId: string,
  channel: Channel,
  rawInput: unknown,
  userIdentifier: string | null = null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO submissions (id, claim_id, channel, raw_input, user_identifier, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), claimId, channel, JSON.stringify(rawInput), userIdentifier, nowIso())
    .run();
}

export interface NewReport {
  claimId: string;
  reportType: ReportRow['report_type'];
  slug?: string | null;
  headline: string;
  summary: string;
  body: string;
  evidence: unknown[];
  tags: string[];
  country?: string | null;
  language?: string | null;
  externalUrl?: string | null;
  factCheckerId?: string | null;
}

export async function insertReport(db: D1Database, report: NewReport): Promise<string> {
  const id = newId();
  await db
    .prepare(
      `INSERT INTO reports
         (id, claim_id, report_type, slug, headline, summary, body, evidence, tags,
          country, language, external_url, fact_checker_id, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .bind(
      id,
      report.claimId,
      report.reportType,
      report.slug ?? null,
      report.headline,
      report.summary,
      report.body,
      JSON.stringify(report.evidence ?? []),
      JSON.stringify(report.tags ?? []),
      report.country ?? null,
      report.language ?? null,
      report.externalUrl ?? null,
      report.factCheckerId ?? null,
      nowIso()
    )
    .run();
  return id;
}

export interface PublishedReportRow {
  claim_id: string;
  headline: string;
  summary: string;
  slug: string | null;
  verdict: Verdict | null;
  source_type: SourceType;
  published_at: string | null;
  country: string | null;
  tags: string;
  fact_checker_name: string | null;
  fact_checker_tier: 1 | 2 | null;
  external_url: string | null;
}

/**
 * Published reports for the editorial homepage — live TYPE 1 and TYPE 2, newest
 * first. Exactly one report per claim: when a claim has both an original and an
 * external report (the TYPE 3 → 2 → 1 path), the fcheck.in original wins, so the
 * grid never shows the same claim twice.
 */
export async function getPublishedReports(db: D1Database, limit = 13): Promise<PublishedReportRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS claim_id, r.headline, r.summary, r.slug, c.verdict, c.source_type,
              r.published_at, r.country, r.tags,
              f.name AS fact_checker_name, f.tier AS fact_checker_tier, r.external_url
       FROM claims c
       JOIN reports r ON r.id = (
         SELECT rp.id FROM reports rp
         WHERE rp.claim_id = c.id AND rp.report_type IN ('original', 'external')
         ORDER BY CASE rp.report_type WHEN 'original' THEN 0 ELSE 1 END
         LIMIT 1
       )
       LEFT JOIN fact_checkers f ON f.id = r.fact_checker_id
       WHERE c.status = 'published' AND c.source_type IN ('original', 'external')
       ORDER BY r.published_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<PublishedReportRow>();
  return results ?? [];
}

export interface EditorialStats {
  claims_this_week: number;
  reports_this_week: number;
  fact_checkers: number;
}

/** The sidebar "This Week" counters — public, so no admin coupling. */
export async function getEditorialStats(db: D1Database): Promise<EditorialStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM claims WHERE created_at >= ?) AS claims_this_week,
         (SELECT COUNT(*) FROM claims WHERE status = 'published' AND published_at >= ?) AS reports_this_week,
         (SELECT COUNT(*) FROM fact_checkers WHERE active = 1) AS fact_checkers`
    )
    .bind(weekAgo, weekAgo)
    .first<EditorialStats>();
  return row ?? { claims_this_week: 0, reports_this_week: 0, fact_checkers: 0 };
}

/** Trending queue: pinned cards first, then unexpired queue cards in order. */
export async function getTrending(db: D1Database, limit = 12) {
  const { results } = await db
    .prepare(
      `SELECT t.id           AS card_id,
              t.pinned,
              c.id           AS claim_id,
              c.verdict,
              c.source_type,
              r.headline,
              r.slug,
              r.published_at,
              r.country,
              f.name         AS fact_checker_name,
              f.tier         AS fact_checker_tier,
              r.external_url
       FROM trending_cards t
       JOIN claims  c ON c.id = t.claim_id
       JOIN reports r ON r.id = t.report_id
       LEFT JOIN fact_checkers f ON f.id = r.fact_checker_id
       WHERE t.pinned = 1 OR t.expires_at IS NULL OR t.expires_at > ?
       ORDER BY t.pinned DESC, t.queue_position ASC
       LIMIT ?`
    )
    .bind(nowIso(), limit)
    .all();
  return results ?? [];
}
