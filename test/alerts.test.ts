/**
 * Admin alert tests, against real SQLite (test/d1.ts). No network: the alerts
 * job takes an injectable transport, so delivery is exercised with a stub that
 * records calls. Covers both dedup contracts — new_drafts (watermark-triggered)
 * and low_trending (edge-triggered) — plus the inert-transport backlog rule.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import { dispatchAdminAlerts } from '../src/lib/jobs/alerts';
import type { EmailMessage, SendOutcome } from '../src/lib/notify/email';

let db: D1Database;
let raw: Database.Database;

beforeEach(() => {
  ({ db, raw } = freshDb());
});

let seq = 0;

/** A pending draft: preliminary claim + preliminary report. `at` sets created_at. */
function insertDraft(at: string, headline = 'A draft headline'): string {
  const id = `c${++seq}`;
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?, ?, 'A checkable claim.', 'preliminary', 'draft', 'FALSE', 80, 1, NULL, NULL, NULL, NULL, ?)`
    )
    .run(id, `fp-${id}`, at);
  raw
    .prepare(
      `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
       VALUES (?, ?, 'preliminary', NULL, ?, 's', 'b', '[]', '[]', NULL, NULL, NULL, NULL, NULL, ?)`
    )
    .run(`rep-${id}`, id, headline, at);
  return id;
}

function insertAdmin(email: string, role = 'editor', active = 1) {
  raw
    .prepare(
      `INSERT INTO admin_users (id,name,email,role,active,last_login_at,created_at)
       VALUES (?, ?, ?, ?, ?, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(`admin-${email}`, email.split('@')[0], email, role, active);
}

/** A live non-pinned trending card. Needs a published claim + report. */
function insertTrendingCard(pinned = 0) {
  const id = `t${++seq}`;
  raw
    .prepare(
      `INSERT OR IGNORE INTO admin_users (id,name,email,role,active,last_login_at,created_at)
       VALUES ('admin-approver','Approver','approver@fcheck.in','editor',0,NULL,'2026-07-01T00:00:00Z')`
    )
    .run();
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?, ?, 'Live claim.', 'original', 'published', 'FALSE', 90, 1, '2026-07-01T00:00:00Z', NULL, NULL, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(id, `fp-${id}`);
  raw
    .prepare(
      `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
       VALUES (?, ?, 'original', ?, 'h', 's', 'b', '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(`rep-${id}`, id, `slug-${id}`);
  raw
    .prepare(
      `INSERT INTO trending_cards (id,claim_id,report_id,pinned,queue_position,expires_at,approved_by,approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-07-01T00:00:00Z')`
    )
    .run(`card-${id}`, id, `rep-${id}`, pinned, seq, pinned ? null : '2099-01-01T00:00:00Z', 'admin-approver');
}

/** Fills the trending queue above the low-water mark so only draft alerts fire. */
function seedHealthyTrending() {
  for (let i = 0; i < 5; i++) insertTrendingCard();
}

function recorder() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    deps: { siteUrl: 'https://fcheck.in', sendEmail: async (msg: EmailMessage) => (sent.push(msg), { ok: true } as SendOutcome) },
  };
}

describe('new-draft alerts', () => {
  it('alerts every active admin about new drafts and advances the watermark', async () => {
    insertAdmin('a@fcheck.in');
    insertAdmin('b@fcheck.in');
    seedHealthyTrending();
    insertDraft('2026-07-10T00:00:00Z', 'Newest claim');
    insertDraft('2026-07-09T00:00:00Z');

    const { sent, deps } = recorder();
    const res = await dispatchAdminAlerts(db, deps);

    expect(res.newDrafts.triggered).toBe(true);
    expect(res.newDrafts.sent).toBe(true);
    expect(sent).toHaveLength(2); // one per admin
    expect(sent.map((m) => m.to).sort()).toEqual(['a@fcheck.in', 'b@fcheck.in']);
    expect(sent[0].subject).toMatch(/2 new drafts/i);
    expect(sent[0].text).toContain('Newest claim');
    expect(sent[0].text).toContain('https://fcheck.in/admin');

    const state = raw.prepare("SELECT watermark FROM admin_alert_state WHERE kind='new_drafts'").get() as { watermark: string };
    expect(state.watermark).toBe('2026-07-10T00:00:00Z');
  });

  it('does not re-alert about the same drafts on a second run', async () => {
    insertAdmin('a@fcheck.in');
    insertDraft('2026-07-10T00:00:00Z');

    const { deps } = recorder();
    await dispatchAdminAlerts(db, deps);
    const second = await dispatchAdminAlerts(db, deps);

    expect(second.newDrafts.triggered).toBe(false);
    expect(second.newDrafts.sent).toBe(false);
  });

  it('alerts again only for drafts newer than the watermark', async () => {
    insertAdmin('a@fcheck.in');
    insertDraft('2026-07-10T00:00:00Z');

    const first = recorder();
    await dispatchAdminAlerts(db, first.deps);

    insertDraft('2026-07-11T00:00:00Z', 'Even newer');
    const second = recorder();
    const res = await dispatchAdminAlerts(db, second.deps);

    expect(res.newDrafts.sent).toBe(true);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0].subject).toMatch(/1 new draft/i);
    expect(second.sent[0].text).toContain('Even newer');
  });

  it('leaves the backlog pending when the transport is inert', async () => {
    insertAdmin('a@fcheck.in');
    seedHealthyTrending();
    insertDraft('2026-07-10T00:00:00Z');

    // No sendEmail and no email config → not-configured → nothing sent.
    const res = await dispatchAdminAlerts(db, { siteUrl: 'https://fcheck.in' });
    expect(res.newDrafts.triggered).toBe(true);
    expect(res.newDrafts.sent).toBe(false);

    const state = raw.prepare("SELECT watermark FROM admin_alert_state WHERE kind='new_drafts'").get();
    expect(state).toBeUndefined(); // watermark not advanced

    // Once configured, the same draft is delivered rather than lost.
    const { sent, deps } = recorder();
    await dispatchAdminAlerts(db, deps);
    expect(sent).toHaveLength(1);
  });

  it('reports triggered-but-unsent when there are no active admins', async () => {
    insertAdmin('a@fcheck.in', 'editor', 0); // inactive
    insertDraft('2026-07-10T00:00:00Z');

    const { sent, deps } = recorder();
    const res = await dispatchAdminAlerts(db, deps);
    expect(res.newDrafts.triggered).toBe(true);
    expect(res.newDrafts.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('low-trending alerts', () => {
  it('alerts once when the queue drops below the mark, then stays quiet', async () => {
    insertAdmin('a@fcheck.in');
    insertTrendingCard(); // 1 non-pinned card < threshold of 5

    const first = recorder();
    const res1 = await dispatchAdminAlerts(db, first.deps);
    expect(res1.lowTrending.triggered).toBe(true);
    expect(res1.lowTrending.sent).toBe(true);
    expect(first.sent[0].subject).toMatch(/trending queue low/i);
    expect(first.sent[0].text).toContain('https://fcheck.in/admin/trending');

    // Still low, but already alerted → no second email.
    const second = recorder();
    const res2 = await dispatchAdminAlerts(db, second.deps);
    expect(res2.lowTrending.triggered).toBe(true);
    expect(res2.lowTrending.sent).toBe(false);
    expect(second.sent).toHaveLength(0);
  });

  it('does not alert while the queue is healthy', async () => {
    insertAdmin('a@fcheck.in');
    for (let i = 0; i < 5; i++) insertTrendingCard(); // == threshold, not below

    const { sent, deps } = recorder();
    const res = await dispatchAdminAlerts(db, deps);
    expect(res.lowTrending.triggered).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('re-alerts after the queue recovers and drops again', async () => {
    insertAdmin('a@fcheck.in');
    insertTrendingCard(); // low

    await dispatchAdminAlerts(db, recorder().deps); // first alert, edge latched

    // Recover above the mark — clears the edge, no recovery email.
    for (let i = 0; i < 5; i++) insertTrendingCard();
    const recovered = recorder();
    const resR = await dispatchAdminAlerts(db, recovered.deps);
    expect(resR.lowTrending.triggered).toBe(false);
    expect(recovered.sent).toHaveLength(0);

    // Drop again — the edge should fire a fresh alert.
    raw.prepare('DELETE FROM trending_cards').run();
    insertTrendingCard();
    const again = recorder();
    const resA = await dispatchAdminAlerts(db, again.deps);
    expect(resA.lowTrending.sent).toBe(true);
    expect(again.sent).toHaveLength(1);
  });

  it('ignores pinned cards when measuring depth', async () => {
    insertAdmin('a@fcheck.in');
    for (let i = 0; i < 6; i++) insertTrendingCard(1); // all pinned → 0 non-pinned → low

    const { deps } = recorder();
    const res = await dispatchAdminAlerts(db, deps);
    expect(res.lowTrending.triggered).toBe(true);
    expect(res.lowTrending.sent).toBe(true);
  });
});
