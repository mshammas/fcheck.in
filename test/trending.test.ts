/**
 * Trending candidate queue — the "Ignore" action, against real SQLite (test/d1.ts).
 *
 * Ignore is not permanent: it hides a candidate at its current submission_count
 * and the candidate must resurface once a fresh submission of the same story
 * bumps the count past that watermark. These tests pin down exactly that
 * contract, plus the eligibility guards.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import {
  getTrendingCandidates,
  ignoreTrendingCandidate,
  approveTrending,
  AdminActionError,
} from '../src/lib/db/admin';
import { incrementSubmissionCount } from '../src/lib/db/claims';
import type { AdminUser } from '../src/lib/types';

let db: D1Database;
let raw: Database.Database;

const admin: AdminUser = {
  id: 'admin-1',
  name: 'Editorial',
  email: 'ed@fcheck.in',
  role: 'super_admin',
  active: 1,
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  ({ db, raw } = freshDb());
  raw
    .prepare(
      `INSERT INTO admin_users (id,name,email,role,active,last_login_at,created_at)
       VALUES ('admin-1','Editorial','ed@fcheck.in','super_admin',1,NULL,'2026-01-01T00:00:00Z')`
    )
    .run();
});

let seq = 0;

/** A published TYPE 2 claim + report — i.e. a trending candidate. */
function insertCandidate(submissionCount = 1): string {
  const id = `c${++seq}`;
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?, ?, 'A checkable claim.', 'external', 'published', 'FALSE', 90, ?, '2026-07-01T00:00:00Z', NULL, NULL, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(id, `fp-${id}`, submissionCount);
  raw
    .prepare(
      `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
       VALUES (?, ?, 'external', NULL, 'A headline', 's', 'b', '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(`rep-${id}`, id);
  return id;
}

async function candidateIds(): Promise<string[]> {
  return (await getTrendingCandidates(db)).map((c) => c.claim_id);
}

describe('ignoreTrendingCandidate', () => {
  it('hides the candidate from the queue immediately', async () => {
    const id = insertCandidate();
    expect(await candidateIds()).toContain(id);

    await ignoreTrendingCandidate(db, admin, id);
    expect(await candidateIds()).not.toContain(id);
  });

  it('brings the candidate back once a new submission arrives', async () => {
    const id = insertCandidate(3);
    await ignoreTrendingCandidate(db, admin, id);
    expect(await candidateIds()).not.toContain(id);

    // Same story submitted again → count climbs past the watermark → resurfaces.
    await incrementSubmissionCount(db, id);
    expect(await candidateIds()).toContain(id);
  });

  it('re-ignoring moves the watermark up to the new count', async () => {
    const id = insertCandidate(1);
    await ignoreTrendingCandidate(db, admin, id); // watermark = 1
    await incrementSubmissionCount(db, id); // count = 2 → back
    expect(await candidateIds()).toContain(id);

    await ignoreTrendingCandidate(db, admin, id); // watermark now = 2 (upsert)
    expect(await candidateIds()).not.toContain(id);

    // Exactly one ignore row per claim.
    const rows = raw.prepare('SELECT ignored_at_count FROM trending_ignores WHERE claim_id = ?').all(id) as {
      ignored_at_count: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].ignored_at_count).toBe(2);
  });

  it('writes an ignore_trending audit row', async () => {
    const id = insertCandidate();
    await ignoreTrendingCandidate(db, admin, id);
    const audit = raw
      .prepare(`SELECT action, entity_type, entity_id FROM audit_log WHERE action = 'ignore_trending'`)
      .get() as { action: string; entity_type: string; entity_id: string } | undefined;
    expect(audit).toMatchObject({ action: 'ignore_trending', entity_type: 'claim', entity_id: id });
  });

  it('approving a previously-ignored claim clears its ignore watermark', async () => {
    const id = insertCandidate();
    await ignoreTrendingCandidate(db, admin, id);
    await approveTrending(db, admin, id);
    const row = raw.prepare('SELECT 1 FROM trending_ignores WHERE claim_id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('rejects ignoring a claim already in the trending queue', async () => {
    const id = insertCandidate();
    await approveTrending(db, admin, id);
    await expect(ignoreTrendingCandidate(db, admin, id)).rejects.toBeInstanceOf(AdminActionError);
  });

  it('rejects ignoring an unknown claim', async () => {
    await expect(ignoreTrendingCandidate(db, admin, 'nope')).rejects.toBeInstanceOf(AdminActionError);
  });
});
