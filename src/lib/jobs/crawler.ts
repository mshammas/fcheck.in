/**
 * Crawler job — TYPE 4 → TYPE 2 and TYPE 3 → TYPE 2.
 *
 * Polls the authenticated fact-checker network (Google Fact Check Tools API)
 * for claims that don't yet have an fcheck.in original, and promotes any that
 * now have an authenticated external report. A submitted claim (TYPE 4) becomes
 * TYPE 2; a claim with an AI draft (TYPE 3) also becomes TYPE 2 while keeping
 * its draft for an editor to supersede later.
 *
 * Runs frequently (15m). Bounded per run.
 */
import type { ClaimRow } from '../types';
import { searchExternal, externalHitToReport } from '../pipeline/searchExternal';
import { promoteToExternal, type PromotionResult } from './promote';
import { nowIso } from '../db/util';
import type { JobDeps } from './recheck';

export interface CrawlerResult {
  crawled: number;
  promoted: number;
  promotions: PromotionResult[];
}

export async function crawlForExternal(
  db: D1Database,
  deps: JobDeps,
  { limit = 10 }: { limit?: number } = {}
): Promise<CrawlerResult> {
  // Claims still eligible for an external match: submitted (TYPE 4) or an AI
  // draft (TYPE 3), never rejected, with no original report yet. A claim already
  // promoted to external is source_type='external' and drops out here.
  const { results } = await db
    .prepare(
      `SELECT * FROM claims c
       WHERE c.source_type IN ('submitted', 'preliminary')
         AND c.status != 'rejected'
         AND NOT EXISTS (SELECT 1 FROM reports ro WHERE ro.claim_id = c.id AND ro.report_type = 'original')
       ORDER BY c.last_rechecked_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<ClaimRow>();

  const claims = results ?? [];
  const promotions: PromotionResult[] = [];

  for (const claim of claims) {
    let hit: Awaited<ReturnType<typeof searchExternal>> = null;
    try {
      hit = await searchExternal(db, deps.googleFactCheckApiKey, claim.canonical_text);
    } catch (err) {
      console.error(`crawler external search failed for ${claim.id}`, err);
      continue;
    }

    if (hit) {
      const report = externalHitToReport(hit.best, hit.others);
      promotions.push(await promoteToExternal(db, claim, report));
    } else {
      await db.prepare('UPDATE claims SET last_rechecked_at = ? WHERE id = ?').bind(nowIso(), claim.id).run();
    }
  }

  return { crawled: claims.length, promoted: promotions.length, promotions };
}
