/**
 * Integration tests for the background-job promotions and the report-based
 * draft queue, against real SQLite (test/d1.ts). No API keys: these exercise
 * the DB logic directly, injecting the analysis/report a real Claude/Google
 * call would have produced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import type { ClaimRow, Verdict } from '../src/lib/types';
import { promoteToPreliminary, promoteToExternal } from '../src/lib/jobs/promote';
import { expireTrending, TRENDING_LOW_THRESHOLD } from '../src/lib/jobs/trending';
import { getDraftQueue, getDraftDetail, publishDraft, rejectDraft } from '../src/lib/db/admin';
import type { ExternalReportFields } from '../src/lib/pipeline/searchExternal';
import type { AdminUser } from '../src/lib/types';

let db: D1Database;
let raw: Database.Database;

beforeEach(() => {
  ({ db, raw } = freshDb());
  // A super-admin for publish/reject audit rows.
  raw
    .prepare(
      `INSERT INTO admin_users (id, name, email, role, active, last_login_at, created_at)
       VALUES ('admin-1','Editorial','ed@fcheck.in','super_admin',1,NULL,'2026-01-01T00:00:00Z')`
    )
    .run();
});

const admin: AdminUser = {
  id: 'admin-1',
  name: 'Editorial',
  email: 'ed@fcheck.in',
  role: 'super_admin',
  active: 1,
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

function insertClaim(over: Partial<ClaimRow> & { id: string }): ClaimRow {
  const c: ClaimRow = {
    id: over.id,
    fingerprint: over.fingerprint ?? `fp-${over.id}`,
    canonical_text: over.canonical_text ?? 'A claim about something specific and checkable.',
    source_type: over.source_type ?? 'submitted',
    status: over.status ?? 'processing',
    verdict: over.verdict ?? null,
    confidence: over.confidence ?? null,
    submission_count: over.submission_count ?? 1,
    published_at: over.published_at ?? null,
    promoted_from: over.promoted_from ?? null,
    promoted_at: over.promoted_at ?? null,
    last_rechecked_at: over.last_rechecked_at ?? null,
    created_at: over.created_at ?? '2026-07-01T00:00:00Z',
  };
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (@id,@fingerprint,@canonical_text,@source_type,@status,@verdict,@confidence,
        @submission_count,@published_at,@promoted_from,@promoted_at,@last_rechecked_at,@created_at)`
    )
    .run(c);
  return c;
}

function insertPreliminaryReport(claimId: string, headline = 'AI draft headline') {
  raw
    .prepare(
      `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
       VALUES (?, ?, 'preliminary', NULL, ?, 'summary', 'body', '[{"source":"WHO","url":"https://who.int","snippet":"x"}]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-07-02T00:00:00Z')`
    )
    .run(`rep-${claimId}`, claimId, headline);
}

const externalReport: ExternalReportFields = {
  verdict: 'FALSE',
  headline: 'External fact-checker headline',
  summary: 'Boom Live rated this claim "False".',
  body: 'The claim text as reviewed.',
  evidence: [{ source: 'Boom Live', url: 'https://boomlive.in/x', snippet: 'Rated False', date: '2026-07-10' }],
  country: 'IN',
  language: 'en',
  externalUrl: 'https://boomlive.in/x',
  factCheckerId: null,
};

function row(id: string): ClaimRow {
  return raw.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow;
}
function reportTypes(claimId: string): string[] {
  return (raw.prepare('SELECT report_type FROM reports WHERE claim_id = ? ORDER BY report_type').all(claimId) as { report_type: string }[]).map(
    (r) => r.report_type
  );
}

describe('re-check promotion (TYPE 4 → 3)', () => {
  it('promotes a submitted claim to a preliminary draft, never published', async () => {
    const claim = insertClaim({ id: 'c1', source_type: 'submitted', status: 'processing' });

    await promoteToPreliminary(db, claim, {
      verdict: 'MISLEADING' as Verdict,
      confidence: 64,
      headline: 'Now there is enough to say something',
      summary: 'Provisional summary.',
      body: 'Provisional body.',
      evidence: [{ source: 'RBI', url: 'https://rbi.org.in', snippet: 's' }],
      tags: ['Finance'],
    });

    const c = row('c1');
    expect(c.source_type).toBe('preliminary');
    expect(c.status).toBe('draft'); // queued for a human, not published
    expect(c.published_at).toBeNull();
    expect(c.verdict).toBe('MISLEADING');
    expect(c.promoted_from).toBe('submitted');
    expect(reportTypes('c1')).toEqual(['preliminary']);
  });
});

describe('crawler promotion (TYPE 4 → 2)', () => {
  it('promotes a submitted claim to a live external report', async () => {
    const claim = insertClaim({ id: 'c2', source_type: 'submitted', status: 'processing' });

    await promoteToExternal(db, claim, externalReport);

    const c = row('c2');
    expect(c.source_type).toBe('external');
    expect(c.status).toBe('published'); // external carve-out — attributed, not ours
    expect(c.published_at).not.toBeNull();
    expect(c.verdict).toBe('FALSE');
    expect(c.promoted_from).toBe('submitted');
    expect(reportTypes('c2')).toEqual(['external']);
  });
});

describe('crawler promotion (TYPE 3 → 2) keeps the draft reviewable', () => {
  it('goes live as TYPE 2 but leaves the AI draft in the admin queue', async () => {
    const claim = insertClaim({ id: 'c3', source_type: 'preliminary', status: 'draft', verdict: 'UNVERIFIABLE' });
    insertPreliminaryReport('c3');

    await promoteToExternal(db, claim, externalReport);

    const c = row('c3');
    expect(c.source_type).toBe('external'); // public sees TYPE 2
    expect(c.status).toBe('published');
    expect(reportTypes('c3')).toEqual(['external', 'preliminary']); // draft kept

    // Report-based draft queue still includes it, and flags it externally live.
    const queue = await getDraftQueue(db);
    expect(queue.map((d) => d.claim_id)).toContain('c3');

    const detail = await getDraftDetail(db, 'c3');
    expect(detail?.externallyLive).toBe(true);
  });

  it('publishing then supersedes the external report with a TYPE 1 original', async () => {
    const claim = insertClaim({ id: 'c4', source_type: 'preliminary', status: 'draft', verdict: 'MISLEADING' });
    insertPreliminaryReport('c4', 'Draft that will become the original');
    await promoteToExternal(db, claim, externalReport);

    const result = await publishDraft(db, admin, 'c4');
    expect(result.slug).toBeTruthy();

    const c = row('c4');
    expect(c.source_type).toBe('original');
    expect(c.status).toBe('published');
    // Both reports exist; the original wins, the external becomes "Also reported by".
    expect(reportTypes('c4').sort()).toEqual(['external', 'original']);
    // No longer in the pending queue (it now has an original).
    expect((await getDraftQueue(db)).map((d) => d.claim_id)).not.toContain('c4');
  });

  it('rejecting a live TYPE 2 draft drops the AI draft but keeps the external report', async () => {
    const claim = insertClaim({ id: 'c5', source_type: 'preliminary', status: 'draft', verdict: 'FALSE' });
    insertPreliminaryReport('c5');
    await promoteToExternal(db, claim, externalReport);

    await rejectDraft(db, admin, 'c5', 'External report is sufficient.');

    const c = row('c5');
    expect(c.source_type).toBe('external'); // still live as TYPE 2
    expect(c.status).toBe('published');
    expect(reportTypes('c5')).toEqual(['external']); // AI draft dropped
    expect((await getDraftQueue(db)).map((d) => d.claim_id)).not.toContain('c5');
  });
});

describe('reject on a pure TYPE 3 draft', () => {
  it('marks the claim rejected', async () => {
    const claim = insertClaim({ id: 'c6', source_type: 'preliminary', status: 'under_review', verdict: 'FALSE' });
    insertPreliminaryReport('c6');

    await rejectDraft(db, admin, 'c6', 'Not in the public interest.');

    expect(row('c6').status).toBe('rejected');
    expect((await getDraftQueue(db)).map((d) => d.claim_id)).not.toContain('c6');
  });
});

describe('trending expiry job', () => {
  function insertCard(id: string, pinned: number, expiresAt: string | null) {
    // Needs a claim + report to satisfy FKs.
    insertClaim({ id: `claim-${id}`, source_type: 'external', status: 'published', verdict: 'FALSE' });
    raw
      .prepare(
        `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
         VALUES (?, ?, 'external', NULL, 'h','s','b','[]','[]',NULL,NULL,'https://x',NULL,NULL,'2026-07-01T00:00:00Z')`
      )
      .run(`rep-${id}`, `claim-${id}`);
    raw
      .prepare(
        `INSERT INTO trending_cards (id,claim_id,report_id,pinned,queue_position,expires_at,approved_by,approved_at)
         VALUES (?, ?, ?, ?, 0, ?, 'admin-1', '2026-07-01T00:00:00Z')`
      )
      .run(id, `claim-${id}`, `rep-${id}`, pinned, expiresAt);
  }

  it('removes expired non-pinned cards, keeps pinned and unexpired, and flags a low queue', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    insertCard('expired', 0, past);
    insertCard('live', 0, future);
    insertCard('pinned', 1, null);

    const res = await expireTrending(db);

    expect(res.expired).toBe(1);
    expect(res.remaining).toBe(1); // only the unexpired non-pinned card
    expect(res.lowQueue).toBe(res.remaining < TRENDING_LOW_THRESHOLD);

    const ids = (raw.prepare('SELECT id FROM trending_cards ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['live', 'pinned']); // expired removed, pinned untouched
  });
});
