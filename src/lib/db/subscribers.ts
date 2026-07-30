/**
 * Subscriber persistence — who to notify when a claim's verdict changes.
 *
 * A subscriber asks to hear when an unresolved claim (TYPE 3 provisional or
 * TYPE 4 submitted) gains or changes its verdict. The single `notified_at`
 * column is the whole state machine: NULL means "still waiting", a timestamp
 * means "told". A subscriber is notified at most once — on the first promotion
 * that puts a user-visible verdict on the results page — and the delivery path
 * (../notify) only stamps `notified_at` after a send actually succeeds, so a
 * backlog survives intact until a channel is configured.
 */
import { newId, nowIso } from './util';

export type NotifyVia = 'email' | 'whatsapp' | 'telegram' | 'web_push';

export interface SubscriberRow {
  id: string;
  claim_id: string;
  notify_via: NotifyVia;
  contact: string;
  notified_at: string | null;
  created_at: string;
}

export class SubscribeError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'SubscribeError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Infers the delivery channel from the single free-text field the results page
 * offers ("Email or WhatsApp number"). An address with an `@` is email;
 * otherwise a plausible phone number is treated as WhatsApp. Anything else is
 * rejected rather than stored as an un-deliverable contact.
 */
export function classifyContact(raw: string): { notify_via: NotifyVia; contact: string } {
  const contact = raw.trim();
  if (EMAIL_RE.test(contact)) return { notify_via: 'email', contact: contact.toLowerCase() };

  const digits = contact.replace(/[\s()\-.]/g, '');
  if (/^\+?\d{7,15}$/.test(digits)) return { notify_via: 'whatsapp', contact: digits };

  throw new SubscribeError('Enter a valid email address or phone number.');
}

export interface SubscribeInput {
  claimId: string;
  contact: string;
}

export interface SubscribeResult {
  notify_via: NotifyVia;
  /** True when this exact contact was already waiting on this claim — no new row. */
  already: boolean;
}

/**
 * Records a subscription. Idempotent per (claim, contact, channel): a repeat
 * subscribe that is still waiting is a no-op rather than a duplicate row.
 *
 * Only unresolved claims accept subscribers — a published verdict (TYPE 1/2)
 * has nothing left to announce, so subscribing to one is a 409 rather than a
 * row that will never fire.
 */
export async function subscribe(db: D1Database, input: SubscribeInput): Promise<SubscribeResult> {
  const { notify_via, contact } = classifyContact(input.contact);

  const claim = await db
    .prepare('SELECT source_type FROM claims WHERE id = ?')
    .bind(input.claimId)
    .first<{ source_type: string }>();
  if (!claim) throw new SubscribeError('That claim no longer exists.', 404);
  if (claim.source_type !== 'preliminary' && claim.source_type !== 'submitted') {
    throw new SubscribeError('This claim already has a published verdict — there is nothing left to notify about.', 409);
  }

  const existing = await db
    .prepare('SELECT id, notified_at FROM subscribers WHERE claim_id = ? AND contact = ? AND notify_via = ?')
    .bind(input.claimId, contact, notify_via)
    .first<{ id: string; notified_at: string | null }>();
  if (existing && !existing.notified_at) return { notify_via, already: true };

  await db
    .prepare('INSERT INTO subscribers (id, claim_id, notify_via, contact, notified_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
    .bind(newId(), input.claimId, notify_via, contact, nowIso())
    .run();

  return { notify_via, already: false };
}

/** Subscribers on a claim who have not yet been told about a verdict. */
export async function pendingSubscribers(db: D1Database, claimId: string): Promise<SubscriberRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM subscribers WHERE claim_id = ? AND notified_at IS NULL')
    .bind(claimId)
    .all<SubscriberRow>();
  return results ?? [];
}

/** Stamps `notified_at` on the given subscribers — called only after a send lands. */
export async function markNotified(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = nowIso();
  await db.batch(ids.map((id) => db.prepare('UPDATE subscribers SET notified_at = ? WHERE id = ?').bind(now, id)));
}
