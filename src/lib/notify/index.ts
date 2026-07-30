/**
 * Subscriber notification service.
 *
 * Called after a claim changes state — an admin publish (TYPE 3 → 1) or an
 * automatic promotion (4 → 3, 4 → 2, 3 → 2) — to tell everyone who asked to be
 * notified. It reads the claim's *current* state from the DB, so it must run
 * after the promotion/publish has committed; the message it composes describes
 * where the claim landed (provisional, attributed, or reviewed).
 *
 * Delivery is best-effort and per-subscriber: `notified_at` is stamped only for
 * the ones that actually sent, so an inert or failing transport leaves the rest
 * pending for the next run rather than marking them done. Channels without a
 * delivery path yet (WhatsApp/Telegram/web-push — the bot channels are still on
 * the roadmap) are counted as skipped and left pending.
 */
import type { EmailConfig, EmailMessage, SendOutcome } from './email';
import { sendEmail as sendEmailHttp } from './email';
import { pendingSubscribers, markNotified, type SubscriberRow } from '../db/subscribers';

const DEFAULT_SITE_URL = 'https://fcheck.in';

export interface NotifyDeps {
  email?: EmailConfig;
  /** Base URL for the link in the message. Defaults to the production site. */
  siteUrl?: string;
  /** Overridable transport — tests inject a stub; production sends over HTTP email. */
  sendEmail?: (msg: EmailMessage) => Promise<SendOutcome>;
}

export interface NotifyResult {
  claim_id: string;
  pending: number;
  sent: number;
  failed: number;
  /** Left pending: no delivery path for the channel yet, or the transport is inert. */
  skipped: number;
}

/**
 * Notifies every waiting subscriber on a claim about its current verdict state.
 * Safe to call when there are no subscribers (returns zeros) and when email is
 * unconfigured (everything is skipped, nothing is marked notified).
 */
export async function notifyClaimSubscribers(
  db: D1Database,
  deps: NotifyDeps,
  claimId: string
): Promise<NotifyResult> {
  const result: NotifyResult = { claim_id: claimId, pending: 0, sent: 0, failed: 0, skipped: 0 };

  const subs = await pendingSubscribers(db, claimId);
  result.pending = subs.length;
  if (subs.length === 0) return result;

  const state = await currentState(db, claimId);
  if (!state) return result; // claim vanished; nothing to say

  const base = (deps.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '');
  const link = `${base}/check/${claimId}`;
  const send = deps.sendEmail ?? ((msg: EmailMessage) => sendEmailHttp(deps.email ?? {}, msg));

  const notified: string[] = [];
  for (const sub of subs) {
    if (sub.notify_via !== 'email') {
      // WhatsApp/Telegram/web-push delivery is not built yet — leave pending.
      result.skipped++;
      continue;
    }

    const outcome = await send(buildEmail(sub, state, link));
    if (outcome.ok) {
      result.sent++;
      notified.push(sub.id);
    } else if (outcome.reason === 'not-configured') {
      result.skipped++;
    } else {
      result.failed++;
    }
  }

  await markNotified(db, notified);
  return result;
}

interface ClaimState {
  source_type: string;
  headline: string | null;
}

async function currentState(db: D1Database, claimId: string): Promise<ClaimState | null> {
  const claim = await db
    .prepare('SELECT source_type FROM claims WHERE id = ?')
    .bind(claimId)
    .first<{ source_type: string }>();
  if (!claim) return null;

  const report = await db
    .prepare('SELECT headline FROM reports WHERE claim_id = ? ORDER BY published_at DESC LIMIT 1')
    .bind(claimId)
    .first<{ headline: string }>();

  return { source_type: claim.source_type, headline: report?.headline ?? null };
}

/** Per-state subject + body — honest about how settled the verdict is. */
function buildEmail(sub: SubscriberRow, state: ClaimState, link: string): EmailMessage {
  const headline = state.headline ?? 'the claim you asked us to check';

  const copy =
    state.source_type === 'original'
      ? {
          subject: 'Reviewed fact-check published',
          lead: 'Our team has reviewed and published a fact-check for a claim you were following.',
        }
      : state.source_type === 'external'
        ? {
            subject: 'A fact-check has been published',
            lead: 'An authenticated fact-checker has published a verdict for a claim you were following.',
          }
        : {
            subject: 'A preliminary result is available',
            lead: 'A preliminary, AI-generated assessment is now available for a claim you were following. It is labelled provisional and is being reviewed by our team before a final report is published.',
          };

  const text = `${copy.lead}

${headline}

See the result: ${link}

You are receiving this because you asked fcheck.in to notify you about this claim.`;

  const html = `<p>${escapeHtml(copy.lead)}</p>
<p><strong>${escapeHtml(headline)}</strong></p>
<p><a href="${link}">See the result</a></p>
<p style="color:#6b7280;font-size:12px">You are receiving this because you asked fcheck.in to notify you about this claim.</p>`;

  return { to: sub.contact, subject: copy.subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
