/**
 * Data access for admin alerts (docs/admin.md).
 *
 * Two things the editorial team needs to hear about between logins: new drafts
 * arriving in the review queue, and the trending queue running low. This module
 * reads the counts (the same predicates the dashboard tiles use) and holds the
 * small dedup state that keeps the alerts job from re-notifying on every run.
 *
 * The alert-state watermark advances only after a send lands — the job owns that
 * ordering — so an inert transport leaves the alert pending, never lost.
 */
import { nowIso } from './util';
import { PENDING_DRAFT_PREDICATE } from './admin';
import { TRENDING_LOW_THRESHOLD } from '../jobs/trending';

export type AlertKind = 'new_drafts' | 'low_trending';

export interface AlertRecipient {
  name: string;
  email: string;
}

/** Active admins who should receive editorial alerts. */
export async function alertRecipients(db: D1Database): Promise<AlertRecipient[]> {
  const { results } = await db
    .prepare('SELECT name, email FROM admin_users WHERE active = 1 ORDER BY email')
    .all<AlertRecipient>();
  return results ?? [];
}

export interface AlertState {
  watermark: string | null;
  last_alerted_at: string | null;
}

export async function getAlertState(db: D1Database, kind: AlertKind): Promise<AlertState | null> {
  return db
    .prepare('SELECT watermark, last_alerted_at FROM admin_alert_state WHERE kind = ?')
    .bind(kind)
    .first<AlertState>();
}

/** Upserts the dedup watermark for a kind, stamping when it was last alerted. */
export async function setAlertState(
  db: D1Database,
  kind: AlertKind,
  watermark: string | null,
  alerted: boolean
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO admin_alert_state (kind, watermark, last_alerted_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET
         watermark = excluded.watermark,
         last_alerted_at = CASE WHEN ? THEN excluded.last_alerted_at ELSE admin_alert_state.last_alerted_at END,
         updated_at = excluded.updated_at`
    )
    .bind(kind, watermark, alerted ? now : null, now, alerted ? 1 : 0)
    .run();
}

export interface NewDrafts {
  /** Drafts created since the watermark — the reason to alert. */
  fresh: number;
  /** Everything currently awaiting review, for context in the message. */
  total: number;
  /** created_at of the newest pending draft; the next watermark. Null if none. */
  newest: string | null;
  /** Headline of the newest pending draft, for a human-readable message. */
  newestHeadline: string | null;
}

/**
 * Counts pending drafts newer than `since` (an ISO timestamp, or null to count
 * the whole backlog). "Pending" is the report-based PENDING_DRAFT_PREDICATE the
 * admin queue uses, so the alert can never disagree with the dashboard tile.
 */
export async function newDraftsSince(db: D1Database, since: string | null): Promise<NewDrafts> {
  const floor = since ?? '';
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM claims c WHERE ${PENDING_DRAFT_PREDICATE} AND c.created_at > ?) AS fresh,
         (SELECT COUNT(*) FROM claims c WHERE ${PENDING_DRAFT_PREDICATE}) AS total,
         (SELECT MAX(c.created_at) FROM claims c WHERE ${PENDING_DRAFT_PREDICATE}) AS newest`
    )
    .bind(floor)
    .first<{ fresh: number; total: number; newest: string | null }>();

  const fresh = row?.fresh ?? 0;
  const total = row?.total ?? 0;
  const newest = row?.newest ?? null;

  let newestHeadline: string | null = null;
  if (newest) {
    const head = await db
      .prepare(
        `SELECT r.headline
         FROM claims c
         JOIN reports r ON r.claim_id = c.id AND r.report_type = 'preliminary'
         WHERE ${PENDING_DRAFT_PREDICATE}
         ORDER BY c.created_at DESC LIMIT 1`
      )
      .first<{ headline: string }>();
    newestHeadline = head?.headline ?? null;
  }

  return { fresh, total, newest, newestHeadline };
}

/** Non-pinned trending cards still live, and whether that is below the mark. */
export async function trendingDepth(db: D1Database): Promise<{ remaining: number; low: boolean }> {
  const now = nowIso();
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM trending_cards WHERE pinned = 0 AND (expires_at IS NULL OR expires_at > ?)'
    )
    .bind(now)
    .first<{ n: number }>();
  const remaining = row?.n ?? 0;
  return { remaining, low: remaining < TRENDING_LOW_THRESHOLD };
}
