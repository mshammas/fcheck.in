/**
 * Trending expiry job.
 *
 * Non-pinned trending cards carry a 48-hour countdown from approval. This job
 * removes the expired ones and reports the remaining queue depth so a low-queue
 * alert can fire (fewer than 5 non-pinned cards). Pinned cards never expire.
 *
 * Pure D1 — no external calls. Runs every 30m.
 */
import { nowIso } from '../db/util';

export const TRENDING_LOW_THRESHOLD = 5;

export interface TrendingExpiryResult {
  expired: number;
  /** Non-pinned cards still live after expiry. */
  remaining: number;
  /** True when the queue has dropped below the low-water mark. */
  lowQueue: boolean;
}

export async function expireTrending(db: D1Database): Promise<TrendingExpiryResult> {
  const now = nowIso();

  const expired = await db
    .prepare('DELETE FROM trending_cards WHERE pinned = 0 AND expires_at IS NOT NULL AND expires_at <= ?')
    .bind(now)
    .run();

  const remainingRow = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM trending_cards WHERE pinned = 0 AND (expires_at IS NULL OR expires_at > ?)'
    )
    .bind(now)
    .first<{ n: number }>();

  const remaining = remainingRow?.n ?? 0;

  return {
    expired: expired.meta.changes ?? 0,
    remaining,
    lowQueue: remaining < TRENDING_LOW_THRESHOLD,
  };
}
