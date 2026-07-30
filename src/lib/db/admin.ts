/**
 * Admin actions on claims, reports, and the trending queue.
 *
 * Every mutating function here writes an audit_log row in the same batch as the
 * change it records. That coupling is deliberate: the editorial policy promises
 * that corrections and decisions are transparent, and an audit trail that can
 * drift from the actions it describes is worse than none.
 *
 * The publish path is the one place in the whole system where a claim reaches
 * TYPE 1 (`source_type = 'original'`, `status = 'published'`). It exists only
 * behind admin auth — see src/middleware.ts.
 */
import type {
  AdminUser,
  AuditAction,
  AuditEntityType,
  ClaimRow,
  ReportRow,
  Verdict,
  EvidenceItem,
} from '../types';
import { newId, nowIso } from './util';

// ── Draft queue ───────────────────────────────────────────────

export type DraftSort = 'submissions' | 'confidence' | 'age';

/**
 * What counts as a draft awaiting review, as a SQL predicate on `claims c`.
 *
 * Report-based rather than keyed on `source_type`, because of the TYPE 3 → 2
 * special case (docs/pipeline.md): when the crawler finds an authenticated
 * external report for a claim that already has an AI draft, the claim becomes
 * TYPE 2 publicly (`external`/`published`) but the AI draft must stay in the
 * admin queue so an editor can still publish a TYPE 1 that supersedes it. So a
 * claim is a pending draft when it has a preliminary report, has not yet been
 * published as an original, and hasn't been rejected — regardless of whether an
 * external report has since been attached.
 */
export const PENDING_DRAFT_PREDICATE = `
  EXISTS (SELECT 1 FROM reports rp WHERE rp.claim_id = c.id AND rp.report_type = 'preliminary')
  AND NOT EXISTS (SELECT 1 FROM reports ro WHERE ro.claim_id = c.id AND ro.report_type = 'original')
  AND c.status != 'rejected'`;

export interface DraftQueueItem {
  claim_id: string;
  report_id: string;
  canonical_text: string;
  verdict: Verdict | null;
  confidence: number | null;
  submission_count: number;
  created_at: string;
  headline: string;
  summary: string;
  subscriber_count: number;
  /** Per-channel submission tallies, e.g. { whatsapp: 31, web: 7 }. */
  channels: Record<string, number>;
}

/**
 * Drafts awaiting review. TYPE 3 claims that a human has not yet published or
 * rejected — i.e. status draft or under_review, sourced as preliminary.
 */
export async function getDraftQueue(db: D1Database, sort: DraftSort = 'submissions'): Promise<DraftQueueItem[]> {
  const orderBy =
    sort === 'confidence'
      ? 'c.confidence DESC, c.submission_count DESC'
      : sort === 'age'
        ? 'c.created_at ASC'
        : 'c.submission_count DESC, c.confidence DESC';

  const { results } = await db
    .prepare(
      `SELECT c.id AS claim_id, r.id AS report_id, c.canonical_text, c.verdict,
              c.confidence, c.submission_count, c.created_at,
              r.headline, r.summary,
              (SELECT COUNT(*) FROM subscribers s WHERE s.claim_id = c.id) AS subscriber_count
       FROM claims c
       JOIN reports r ON r.claim_id = c.id AND r.report_type = 'preliminary'
       WHERE ${PENDING_DRAFT_PREDICATE}
       ORDER BY ${orderBy}`
    )
    .all<Omit<DraftQueueItem, 'channels'>>();

  const drafts = results ?? [];

  // Channel breakdown per claim — one grouped query rather than N.
  const channels = await channelBreakdown(
    db,
    drafts.map((d) => d.claim_id)
  );

  return drafts.map((d) => ({ ...d, channels: channels[d.claim_id] ?? {} }));
}

async function channelBreakdown(db: D1Database, claimIds: string[]): Promise<Record<string, Record<string, number>>> {
  if (claimIds.length === 0) return {};
  const placeholders = claimIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT claim_id, channel, COUNT(*) AS n
       FROM submissions WHERE claim_id IN (${placeholders})
       GROUP BY claim_id, channel`
    )
    .bind(...claimIds)
    .all<{ claim_id: string; channel: string; n: number }>();

  const out: Record<string, Record<string, number>> = {};
  for (const row of results ?? []) {
    (out[row.claim_id] ??= {})[row.channel] = row.n;
  }
  return out;
}

// ── Draft review (single claim) ───────────────────────────────

export interface DraftDetail {
  claim: ClaimRow;
  report: ReportRow;
  subscriber_count: number;
  channels: Record<string, number>;
  /** Other published reports on similar claims — shown to avoid duplication. */
  similar: { claim_id: string; headline: string; slug: string | null }[];
  /**
   * True when the crawler already promoted this claim to a live TYPE 2 while the
   * AI draft waits here (the TYPE 3 → 2 case). Publishing then supersedes the
   * external report; the admin UI can note that.
   */
  externallyLive: boolean;
}

export async function getDraftDetail(db: D1Database, claimId: string): Promise<DraftDetail | null> {
  const claim = await db.prepare('SELECT * FROM claims WHERE id = ?').bind(claimId).first<ClaimRow>();
  if (!claim || claim.status === 'rejected') return null;

  // A pending draft is defined by its reports, not its source_type — see
  // PENDING_DRAFT_PREDICATE. It needs a preliminary report and no original yet.
  const [report, original, external, subs, channels, similar] = await Promise.all([
    db
      .prepare("SELECT * FROM reports WHERE claim_id = ? AND report_type = 'preliminary' ORDER BY published_at DESC LIMIT 1")
      .bind(claimId)
      .first<ReportRow>(),
    db.prepare("SELECT id FROM reports WHERE claim_id = ? AND report_type = 'original' LIMIT 1").bind(claimId).first(),
    db.prepare("SELECT id FROM reports WHERE claim_id = ? AND report_type = 'external' LIMIT 1").bind(claimId).first(),
    db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE claim_id = ?').bind(claimId).first<{ n: number }>(),
    channelBreakdown(db, [claimId]),
    findSimilarPublished(db, claim.canonical_text, claimId),
  ]);

  if (!report || original) return null;

  return {
    claim,
    report,
    subscriber_count: subs?.n ?? 0,
    channels: channels[claimId] ?? {},
    similar,
    externallyLive: Boolean(external),
  };
}

async function findSimilarPublished(db: D1Database, canonicalText: string, excludeClaimId: string) {
  const tokens = canonicalText
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3)
    .slice(0, 12);
  if (tokens.length === 0) return [];

  const match = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
  const { results } = await db
    .prepare(
      `SELECT c.id AS claim_id, r.headline, r.slug
       FROM reports_fts f
       JOIN reports r ON r.rowid = f.rowid
       JOIN claims c ON c.id = r.claim_id
       WHERE reports_fts MATCH ?
         AND c.status = 'published'
         AND c.id != ?
       ORDER BY rank
       LIMIT 3`
    )
    .bind(match, excludeClaimId)
    .all<{ claim_id: string; headline: string; slug: string | null }>()
    .catch(() => ({ results: [] as { claim_id: string; headline: string; slug: string | null }[] }));

  return results ?? [];
}

// ── Editing a draft before publication ────────────────────────

export interface DraftEdits {
  verdict?: Verdict;
  confidence?: number | null;
  headline?: string;
  summary?: string;
  body?: string;
  evidence?: EvidenceItem[];
  tags?: string[];
}

export async function updateDraft(
  db: D1Database,
  admin: AdminUser,
  claimId: string,
  edits: DraftEdits
): Promise<void> {
  const detail = await getDraftDetail(db, claimId);
  if (!detail) throw new AdminActionError('No draft found for this claim.', 404);

  const before = detail.report;

  // Editorial rule: an assertion without a source is not shown. An editor
  // cannot save evidence that lacks a URL — the same rule the AI output obeys.
  if (edits.evidence) {
    const bad = edits.evidence.find((e) => !e.url || !/^https?:\/\//i.test(e.url));
    if (bad) throw new AdminActionError('Every evidence item needs a valid source URL.', 400);
  }

  const reportUpdates: string[] = [];
  const reportBind: unknown[] = [];
  const claimUpdates: string[] = [];
  const claimBind: unknown[] = [];

  if (edits.headline !== undefined) { reportUpdates.push('headline = ?'); reportBind.push(edits.headline); }
  if (edits.summary !== undefined) { reportUpdates.push('summary = ?'); reportBind.push(edits.summary); }
  if (edits.body !== undefined) { reportUpdates.push('body = ?'); reportBind.push(edits.body); }
  if (edits.evidence !== undefined) { reportUpdates.push('evidence = ?'); reportBind.push(JSON.stringify(edits.evidence)); }
  if (edits.tags !== undefined) { reportUpdates.push('tags = ?'); reportBind.push(JSON.stringify(edits.tags)); }

  if (edits.verdict !== undefined) { claimUpdates.push('verdict = ?'); claimBind.push(edits.verdict); }
  if (edits.confidence !== undefined) { claimUpdates.push('confidence = ?'); claimBind.push(edits.confidence); }

  if (reportUpdates.length === 0 && claimUpdates.length === 0) return;

  const statements: D1PreparedStatement[] = [];
  if (reportUpdates.length > 0) {
    statements.push(
      db.prepare(`UPDATE reports SET ${reportUpdates.join(', ')} WHERE id = ?`).bind(...reportBind, before.id)
    );
  }
  if (claimUpdates.length > 0) {
    statements.push(
      db.prepare(`UPDATE claims SET ${claimUpdates.join(', ')} WHERE id = ?`).bind(...claimBind, claimId)
    );
  }

  const diff = {
    before: { verdict: detail.claim.verdict, confidence: detail.claim.confidence, headline: before.headline },
    edits,
  };
  statements.push(auditStatement(db, admin, 'edit', 'report', before.id, diff));

  await db.batch(statements);
}

/** Marking a draft under_review the first time an admin opens it. */
export async function markUnderReview(db: D1Database, claimId: string): Promise<void> {
  await db
    .prepare("UPDATE claims SET status = 'under_review' WHERE id = ? AND status = 'draft'")
    .bind(claimId)
    .run();
}

// ── Publish: TYPE 3 → TYPE 1 ──────────────────────────────────

export interface PublishResult {
  slug: string;
  subscriber_count: number;
}

/**
 * Publishes a reviewed draft as an fcheck.in original.
 *
 * This is the AI-proposes-human-approves gate. The claim moves to `original` /
 * `published`, the report becomes an `original` with a stable slug, and the
 * whole change plus its audit row commit as one batch so a partial publish
 * cannot leave a claim marked published with a report still typed preliminary.
 */
export async function publishDraft(db: D1Database, admin: AdminUser, claimId: string): Promise<PublishResult> {
  // getDraftDetail returns null once an original report exists, so a non-null
  // detail here is always a claim that has not yet been published as TYPE 1 —
  // whether it's a pure TYPE 3 draft or one the crawler promoted to TYPE 2.
  const detail = await getDraftDetail(db, claimId);
  if (!detail) throw new AdminActionError('No draft found for this claim, or it is already published.', 404);
  if (!detail.claim.verdict) {
    throw new AdminActionError('A draft cannot be published without a verdict.', 400);
  }

  const slug = await uniqueSlug(db, detail.report.headline);
  const now = nowIso();

  await db.batch([
    db
      .prepare(
        `UPDATE claims
         SET source_type = 'original', status = 'published',
             published_at = ?, promoted_from = source_type, promoted_at = ?
         WHERE id = ?`
      )
      .bind(now, now, claimId),
    db
      .prepare(
        `UPDATE reports
         SET report_type = 'original', slug = ?, published_by = ?, published_at = ?
         WHERE id = ?`
      )
      .bind(slug, admin.id, now, detail.report.id),
    auditStatement(db, admin, 'publish', 'claim', claimId, {
      promoted_from: detail.claim.source_type,
      slug,
      verdict: detail.claim.verdict,
    }),
  ]);

  // Subscriber notification is a separate, best-effort concern handled by the
  // caller (the publish route calls notifyClaimSubscribers after this commits),
  // kept out of this batch so a delivery failure can't roll back the publish.
  return { slug, subscriber_count: detail.subscriber_count };
}

export async function rejectDraft(
  db: D1Database,
  admin: AdminUser,
  claimId: string,
  reason: string
): Promise<void> {
  const detail = await getDraftDetail(db, claimId);
  if (!detail) throw new AdminActionError('No reviewable draft found for this claim.', 404);

  if (detail.externallyLive) {
    // TYPE 3 → 2 case: the claim is publicly live as an attributed external
    // report. Rejecting means "we won't write our own TYPE 1" — it must not
    // pull down the live TYPE 2. Drop just the AI draft so it leaves the queue;
    // the external report and the claim's published state stand untouched.
    await db.batch([
      db.prepare("DELETE FROM reports WHERE id = ? AND report_type = 'preliminary'").bind(detail.report.id),
      auditStatement(db, admin, 'reject', 'report', detail.report.id, {
        reason,
        kept_external: true,
        headline: detail.report.headline,
      }),
    ]);
    return;
  }

  // Pure TYPE 3: no public verdict is showing, so the claim itself is rejected.
  await db.batch([
    db.prepare("UPDATE claims SET status = 'rejected' WHERE id = ?").bind(claimId),
    auditStatement(db, admin, 'reject', 'claim', claimId, { reason }),
  ]);
}

// ── Trending queue management ──────────────────────────────────

export interface TrendingCandidate {
  claim_id: string;
  report_id: string;
  headline: string;
  verdict: Verdict | null;
  source_type: string;
  submission_count: number;
  created_at: string;
  fact_checker_name: string | null;
}

/**
 * Claims eligible to be trending but not yet in the queue.
 *
 * Only TYPE 1 and TYPE 2 are eligible — nothing preliminary or unreviewed can
 * surface. Ranked by submission volume, recency, and verdict weight
 * (FALSE/MISLEADING rank higher, since those are the claims worth surfacing).
 */
export async function getTrendingCandidates(db: D1Database, limit = 12): Promise<TrendingCandidate[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS claim_id, r.id AS report_id, r.headline, c.verdict,
              c.source_type, c.submission_count, c.created_at,
              f.name AS fact_checker_name
       FROM claims c
       JOIN reports r ON r.claim_id = c.id
         AND r.report_type IN ('original', 'external')
       LEFT JOIN fact_checkers f ON f.id = r.fact_checker_id
       WHERE c.source_type IN ('original', 'external')
         AND c.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM trending_cards t WHERE t.claim_id = c.id)
       ORDER BY
         (CASE c.verdict WHEN 'FALSE' THEN 2 WHEN 'MISLEADING' THEN 2 ELSE 0 END
          + c.submission_count) DESC,
         c.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<TrendingCandidate>();
  return results ?? [];
}

/** The live queue as the admin sees it — pinned and time-limited alike. */
export async function getTrendingQueue(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT t.id AS card_id, t.pinned, t.queue_position, t.expires_at, t.approved_at,
              c.id AS claim_id, c.verdict, c.source_type,
              r.headline, r.slug,
              f.name AS fact_checker_name, f.tier AS fact_checker_tier
       FROM trending_cards t
       JOIN claims c ON c.id = t.claim_id
       JOIN reports r ON r.id = t.report_id
       LEFT JOIN fact_checkers f ON f.id = r.fact_checker_id
       ORDER BY t.pinned DESC, t.queue_position ASC`
    )
    .all();
  return results ?? [];
}

export async function approveTrending(db: D1Database, admin: AdminUser, claimId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT c.id AS claim_id, r.id AS report_id, c.source_type, c.status
       FROM claims c
       JOIN reports r ON r.claim_id = c.id AND r.report_type IN ('original', 'external')
       WHERE c.id = ? LIMIT 1`
    )
    .bind(claimId)
    .first<{ claim_id: string; report_id: string; source_type: string; status: string }>();

  if (!row) throw new AdminActionError('No eligible report found for this claim.', 404);
  if (!['original', 'external'].includes(row.source_type) || row.status !== 'published') {
    throw new AdminActionError('Only published TYPE 1 and TYPE 2 claims can trend.', 400);
  }

  const existing = await db.prepare('SELECT id FROM trending_cards WHERE claim_id = ?').bind(claimId).first();
  if (existing) throw new AdminActionError('This claim is already in the trending queue.', 409);

  const now = nowIso();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // 48h from approval
  const nextPos = await nextQueuePosition(db);
  const cardId = newId();

  await db.batch([
    db
      .prepare(
        `INSERT INTO trending_cards (id, claim_id, report_id, pinned, queue_position, expires_at, approved_by, approved_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .bind(cardId, claimId, row.report_id, nextPos, expiresAt, admin.id, now),
    auditStatement(db, admin, 'approve_trending', 'trending_card', cardId, { claim_id: claimId }),
  ]);
}

export async function removeTrending(db: D1Database, admin: AdminUser, cardId: string): Promise<void> {
  const card = await db.prepare('SELECT claim_id FROM trending_cards WHERE id = ?').bind(cardId).first<{ claim_id: string }>();
  if (!card) throw new AdminActionError('Trending card not found.', 404);

  await db.batch([
    db.prepare('DELETE FROM trending_cards WHERE id = ?').bind(cardId),
    auditStatement(db, admin, 'remove_trending', 'trending_card', cardId, { claim_id: card.claim_id }),
  ]);
}

export async function setPinned(db: D1Database, admin: AdminUser, cardId: string, pinned: boolean): Promise<void> {
  const card = await db.prepare('SELECT claim_id FROM trending_cards WHERE id = ?').bind(cardId).first<{ claim_id: string }>();
  if (!card) throw new AdminActionError('Trending card not found.', 404);

  // Pinned cards never expire; unpinning restarts the 48h countdown from now.
  const expiresAt = pinned ? null : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await db.batch([
    db.prepare('UPDATE trending_cards SET pinned = ?, expires_at = ? WHERE id = ?').bind(pinned ? 1 : 0, expiresAt, cardId),
    auditStatement(db, admin, pinned ? 'pin' : 'unpin', 'trending_card', cardId, { claim_id: card.claim_id }),
  ]);
}

async function nextQueuePosition(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(MAX(queue_position), 0) + 1 AS pos FROM trending_cards WHERE pinned = 0').first<{ pos: number }>();
  return row?.pos ?? 1;
}

// ── Overview / dashboard counters ─────────────────────────────

export interface AdminOverview {
  drafts_pending: number;
  high_confidence_drafts: number;
  trending_active: number;
  trending_expiring_soon: number;
  claims_today: number;
  published_this_week: number;
  type4_awaiting_recheck: number;
  type3_preliminary: number;
  subscribers_waiting: number;
}

export async function getOverview(db: D1Database): Promise<AdminOverview> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sixHours = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const now = nowIso();

  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM claims c WHERE ${PENDING_DRAFT_PREDICATE}) AS drafts_pending,
        (SELECT COUNT(*) FROM claims c WHERE ${PENDING_DRAFT_PREDICATE} AND c.confidence >= 75) AS high_confidence_drafts,
        (SELECT COUNT(*) FROM trending_cards WHERE pinned=1 OR expires_at IS NULL OR expires_at > ?) AS trending_active,
        (SELECT COUNT(*) FROM trending_cards WHERE pinned=0 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?) AS trending_expiring_soon,
        (SELECT COUNT(*) FROM claims WHERE created_at >= ?) AS claims_today,
        (SELECT COUNT(*) FROM claims WHERE status='published' AND published_at >= ?) AS published_this_week,
        (SELECT COUNT(*) FROM claims WHERE source_type='submitted') AS type4_awaiting_recheck,
        (SELECT COUNT(*) FROM claims WHERE source_type='preliminary') AS type3_preliminary,
        (SELECT COUNT(*) FROM subscribers WHERE notified_at IS NULL) AS subscribers_waiting`
    )
    .bind(now, now, sixHours, dayAgo, weekAgo)
    .first<AdminOverview>();

  return (
    row ?? {
      drafts_pending: 0,
      high_confidence_drafts: 0,
      trending_active: 0,
      trending_expiring_soon: 0,
      claims_today: 0,
      published_this_week: 0,
      type4_awaiting_recheck: 0,
      type3_preliminary: 0,
      subscribers_waiting: 0,
    }
  );
}

export async function getRecentActivity(db: D1Database, limit = 12) {
  const { results } = await db
    .prepare(
      `SELECT a.action, a.entity_type, a.entity_id, a.diff, a.created_at, u.name AS admin_name
       FROM audit_log a
       LEFT JOIN admin_users u ON u.id = a.admin_user_id
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all();
  return results ?? [];
}

// ── Audit + helpers ───────────────────────────────────────────

function auditStatement(
  db: D1Database,
  admin: AdminUser,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string,
  diff: unknown
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, admin_user_id, action, entity_type, entity_id, diff, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId(), admin.id, action, entityType, entityId, diff ? JSON.stringify(diff) : null, nowIso());
}

/** Kebab-cases a headline and guarantees uniqueness against existing slugs. */
async function uniqueSlug(db: D1Database, headline: string): Promise<string> {
  const base =
    headline
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'report';

  let slug = base;
  for (let n = 2; ; n++) {
    const clash = await db.prepare('SELECT 1 FROM reports WHERE slug = ?').bind(slug).first();
    if (!clash) return slug;
    slug = `${base}-${n}`;
  }
}

export class AdminActionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'AdminActionError';
  }
}
