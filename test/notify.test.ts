/**
 * Subscriber notification tests, against real SQLite (test/d1.ts). No network:
 * the notification service takes an injectable transport, so delivery is
 * exercised with a stub that records calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import { subscribe, classifyContact, pendingSubscribers, SubscribeError } from '../src/lib/db/subscribers';
import { notifyClaimSubscribers } from '../src/lib/notify';
import type { EmailMessage, SendOutcome } from '../src/lib/notify/email';

let db: D1Database;
let raw: Database.Database;

beforeEach(() => {
  ({ db, raw } = freshDb());
});

function insertClaim(id: string, source_type: string, opts: { headline?: string } = {}) {
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?, ?, 'A checkable claim.', ?, 'processing', NULL, NULL, 1, NULL, NULL, NULL, NULL, '2026-07-01T00:00:00Z')`
    )
    .run(id, `fp-${id}`, source_type);
  if (opts.headline) {
    raw
      .prepare(
        `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
         VALUES (?, ?, 'preliminary', NULL, ?, 's', 'b', '[]', '[]', NULL, NULL, NULL, NULL, NULL, '2026-07-02T00:00:00Z')`
      )
      .run(`rep-${id}`, id, opts.headline);
  }
}

function subCount(claimId: string): { total: number; notified: number } {
  const total = (raw.prepare('SELECT COUNT(*) n FROM subscribers WHERE claim_id = ?').get(claimId) as { n: number }).n;
  const notified = (raw.prepare('SELECT COUNT(*) n FROM subscribers WHERE claim_id = ? AND notified_at IS NOT NULL').get(claimId) as { n: number }).n;
  return { total, notified };
}

describe('classifyContact', () => {
  it('routes an email address to the email channel, lower-cased', () => {
    expect(classifyContact('  Person@Example.COM ')).toEqual({ notify_via: 'email', contact: 'person@example.com' });
  });

  it('routes a phone number to whatsapp, stripped to digits', () => {
    expect(classifyContact('+1 (415) 555-2671')).toEqual({ notify_via: 'whatsapp', contact: '+14155552671' });
  });

  it('rejects anything that is neither', () => {
    expect(() => classifyContact('not a contact')).toThrow(SubscribeError);
  });
});

describe('subscribe', () => {
  it('records a subscriber on an unresolved claim', async () => {
    insertClaim('c1', 'submitted');
    const res = await subscribe(db, { claimId: 'c1', contact: 'a@b.com' });
    expect(res).toEqual({ notify_via: 'email', already: false });
    expect(subCount('c1').total).toBe(1);
  });

  it('is idempotent for a still-waiting contact', async () => {
    insertClaim('c1', 'preliminary');
    await subscribe(db, { claimId: 'c1', contact: 'a@b.com' });
    const second = await subscribe(db, { claimId: 'c1', contact: 'A@B.com' });
    expect(second.already).toBe(true);
    expect(subCount('c1').total).toBe(1); // no duplicate row
  });

  it('refuses an already-published claim', async () => {
    insertClaim('c1', 'original');
    await expect(subscribe(db, { claimId: 'c1', contact: 'a@b.com' })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an unknown claim', async () => {
    await expect(subscribe(db, { claimId: 'ghost', contact: 'a@b.com' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('notifyClaimSubscribers', () => {
  it('sends to waiting email subscribers and marks only them notified', async () => {
    insertClaim('c1', 'preliminary', { headline: 'A preliminary headline' });
    await subscribe(db, { claimId: 'c1', contact: 'a@b.com' });
    await subscribe(db, { claimId: 'c1', contact: '+14155552671' }); // whatsapp — no path yet

    const sent: EmailMessage[] = [];
    const res = await notifyClaimSubscribers(db, {
      siteUrl: 'https://fcheck.in',
      sendEmail: async (msg) => {
        sent.push(msg);
        return { ok: true } as SendOutcome;
      },
    }, 'c1');

    expect(res.pending).toBe(2);
    expect(res.sent).toBe(1);
    expect(res.skipped).toBe(1); // the whatsapp one
    expect(sent[0].to).toBe('a@b.com');
    expect(sent[0].text).toContain('https://fcheck.in/check/c1');
    expect(sent[0].subject).toMatch(/preliminary/i);

    // Only the emailed subscriber is marked; the whatsapp one stays pending.
    expect(subCount('c1').notified).toBe(1);
    expect((await pendingSubscribers(db, 'c1')).map((s) => s.notify_via)).toEqual(['whatsapp']);
  });

  it('does not mark anyone notified when the transport is inert', async () => {
    insertClaim('c1', 'submitted', { headline: 'External headline' });
    await subscribe(db, { claimId: 'c1', contact: 'a@b.com' });
    raw.prepare("UPDATE claims SET source_type = 'external' WHERE id = 'c1'").run(); // promotion committed

    // No sendEmail override and no email config → not-configured → skipped.
    const res = await notifyClaimSubscribers(db, {}, 'c1');
    expect(res.sent).toBe(0);
    expect(res.skipped).toBe(1);
    expect(subCount('c1').notified).toBe(0); // backlog preserved
  });

  it('does not re-notify an already-notified subscriber on a later promotion', async () => {
    insertClaim('c1', 'preliminary', { headline: 'h' });
    await subscribe(db, { claimId: 'c1', contact: 'a@b.com' });

    const ok = { sendEmail: async () => ({ ok: true }) as SendOutcome };
    const first = await notifyClaimSubscribers(db, ok, 'c1');
    const second = await notifyClaimSubscribers(db, ok, 'c1');
    expect(first.sent).toBe(1);
    expect(second.pending).toBe(0); // nothing left waiting
    expect(second.sent).toBe(0);
  });
});
