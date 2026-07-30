/**
 * Re-check job — TYPE 4 → TYPE 3.
 *
 * Periodically re-runs the AI deep-check on submitted claims to see whether
 * enough sources have emerged since they were first seen. When they have, the
 * claim is promoted to a provisional TYPE 3 and a draft is queued for admin
 * review — never published. Runs every 6h by default.
 *
 * Bounded per run (`limit`) so one invocation can't fan out into an unbounded
 * number of Claude calls. Oldest-checked claims go first.
 */
import type { ClaimRow, Verdict } from '../types';
import { getClient, deepCheck } from '../providers/anthropic';
import { promoteToPreliminary, type PromotionResult } from './promote';
import { notifyClaimSubscribers, type NotifyResult } from '../notify';
import type { EmailConfig } from '../notify/email';
import { nowIso } from '../db/util';

export interface JobDeps {
  anthropicApiKey?: string;
  googleFactCheckApiKey?: string;
  /** Email transport for subscriber notifications; delivery is inert if unset. */
  email?: EmailConfig;
}

export interface RecheckResult {
  checked: number;
  promoted: number;
  promotions: PromotionResult[];
  notifications: NotifyResult[];
}

export async function recheckSubmitted(
  db: D1Database,
  deps: JobDeps,
  { limit = 5 }: { limit?: number } = {}
): Promise<RecheckResult> {
  const client = getClient(deps.anthropicApiKey);

  // Oldest-touched first. NULL last_rechecked_at (never re-checked) sorts first
  // in SQLite, so brand-new TYPE 4 claims are picked up on the next run.
  const { results } = await db
    .prepare(
      `SELECT * FROM claims
       WHERE source_type = 'submitted'
       ORDER BY last_rechecked_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<ClaimRow>();

  const claims = results ?? [];
  const promotions: PromotionResult[] = [];
  const notifications: NotifyResult[] = [];

  for (const claim of claims) {
    let analysis: Awaited<ReturnType<typeof deepCheck>> | null = null;
    try {
      analysis = await deepCheck(client, claim.canonical_text);
    } catch (err) {
      // A single claim's failure must not sink the batch — leave it for next run.
      console.error(`recheck deepCheck failed for ${claim.id}`, err);
      continue;
    }

    if (analysis.sufficient_evidence && analysis.verdict) {
      promotions.push(
        await promoteToPreliminary(db, claim, {
          verdict: analysis.verdict as Verdict,
          confidence: analysis.confidence,
          headline: analysis.headline,
          summary: analysis.summary,
          body: analysis.body,
          evidence: analysis.evidence,
          tags: analysis.tags ?? [],
        })
      );
      // Promotion committed — notify subscribers about the new provisional result.
      notifications.push(await notifyClaimSubscribers(db, { email: deps.email }, claim.id));
    } else {
      // Still insufficient — record the attempt so it moves to the back of the queue.
      await db.prepare('UPDATE claims SET last_rechecked_at = ? WHERE id = ?').bind(nowIso(), claim.id).run();
    }
  }

  return { checked: claims.length, promoted: promotions.length, promotions, notifications };
}
