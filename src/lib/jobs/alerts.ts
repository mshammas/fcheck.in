/**
 * Admin alerts job.
 *
 * Two editorial signals that admins should hear about between logins:
 *   • new drafts arriving in the review queue, and
 *   • the trending queue running low (fewer than TRENDING_LOW_THRESHOLD cards).
 *
 * The dashboard already surfaces both counts (getOverview); this job is the push
 * side — an email to every active admin so the queue does not sit unattended.
 *
 * Both alerts are deduped in `admin_alert_state` so a scheduled run does not
 * re-notify about a backlog it already reported:
 *   • new_drafts is watermark-triggered — only drafts newer than the last
 *     alerted one fire, and the watermark advances only after a send lands.
 *   • low_trending is edge-triggered — one alert when the queue crosses below
 *     the mark, nothing more until it recovers (no recovery email, no spam).
 *
 * Delivery mirrors the subscriber path: with the email transport unset the job
 * is inert (nothing sent, no state advanced), so the first configured run
 * delivers the current state rather than a silently-swallowed backlog.
 */
import type { EmailConfig, EmailMessage, SendOutcome } from '../notify/email';
import { sendEmail as sendEmailHttp } from '../notify/email';
import {
  alertRecipients,
  getAlertState,
  setAlertState,
  newDraftsSince,
  trendingDepth,
  type AlertRecipient,
} from '../db/alerts';

const DEFAULT_SITE_URL = 'https://fcheck.in';

export interface AlertDeps {
  email?: EmailConfig;
  /** Base URL for the admin link in the message. Defaults to the production site. */
  siteUrl?: string;
  /** Overridable transport — tests inject a stub; production sends over HTTP email. */
  sendEmail?: (msg: EmailMessage) => Promise<SendOutcome>;
}

export interface AlertOutcome {
  /** Whether this alert's condition held this run. */
  triggered: boolean;
  /** Whether an email actually went out (false when inert, no recipients, or deduped). */
  sent: boolean;
  detail: string;
}

export interface AlertsResult {
  recipients: number;
  newDrafts: AlertOutcome;
  lowTrending: AlertOutcome;
}

export async function dispatchAdminAlerts(db: D1Database, deps: AlertDeps): Promise<AlertsResult> {
  const recipients = await alertRecipients(db);
  const base = (deps.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '');
  const send = deps.sendEmail ?? ((msg: EmailMessage) => sendEmailHttp(deps.email ?? {}, msg));

  const newDrafts = await checkNewDrafts(db, recipients, base, send);
  const lowTrending = await checkLowTrending(db, recipients, base, send);

  return { recipients: recipients.length, newDrafts, lowTrending };
}

// ── New drafts (watermark-triggered) ──────────────────────────

async function checkNewDrafts(
  db: D1Database,
  recipients: AlertRecipient[],
  base: string,
  send: (msg: EmailMessage) => Promise<SendOutcome>
): Promise<AlertOutcome> {
  const state = await getAlertState(db, 'new_drafts');
  const drafts = await newDraftsSince(db, state?.watermark ?? null);

  if (drafts.fresh === 0) {
    return { triggered: false, sent: false, detail: 'no new drafts' };
  }
  if (recipients.length === 0) {
    return { triggered: true, sent: false, detail: 'no active admins to notify' };
  }

  const message = newDraftsEmail(drafts, base);
  const sent = await sendToAll(recipients, message, send);

  // Advance the watermark only after a real send, so an inert transport leaves
  // the backlog to the next run rather than swallowing it.
  if (sent) await setAlertState(db, 'new_drafts', drafts.newest, true);

  return {
    triggered: true,
    sent,
    detail: sent
      ? `alerted ${recipients.length} admin(s): ${drafts.fresh} new, ${drafts.total} pending`
      : 'transport inert — left pending',
  };
}

function newDraftsEmail(
  drafts: { fresh: number; total: number; newestHeadline: string | null },
  base: string
): EmailMessage {
  const link = `${base}/admin`;
  const countLine =
    drafts.fresh === 1
      ? '1 new draft is awaiting review'
      : `${drafts.fresh} new drafts are awaiting review`;
  const totalLine = `${drafts.total} draft${drafts.total === 1 ? '' : 's'} in the queue in total.`;
  const sample = drafts.newestHeadline ? `\n\nMost recent: ${drafts.newestHeadline}` : '';

  const text = `${countLine}. ${totalLine}${sample}

Review the queue: ${link}`;

  const html = `<p><strong>${escapeHtml(countLine)}.</strong> ${escapeHtml(totalLine)}</p>${
    drafts.newestHeadline ? `<p>Most recent: ${escapeHtml(drafts.newestHeadline)}</p>` : ''
  }<p><a href="${link}">Review the queue</a></p>`;

  return {
    to: '',
    subject: `${drafts.fresh} new draft${drafts.fresh === 1 ? '' : 's'} awaiting review`,
    text,
    html,
  };
}

// ── Low trending queue (edge-triggered) ───────────────────────

async function checkLowTrending(
  db: D1Database,
  recipients: AlertRecipient[],
  base: string,
  send: (msg: EmailMessage) => Promise<SendOutcome>
): Promise<AlertOutcome> {
  const state = await getAlertState(db, 'low_trending');
  const { remaining, low } = await trendingDepth(db);

  if (!low) {
    // Recovered (or never low): clear the edge so the next drop re-alerts.
    // No recovery email — admins only hear about a problem, not its absence.
    if (state?.watermark === 'low') await setAlertState(db, 'low_trending', 'ok', false);
    return { triggered: false, sent: false, detail: `queue healthy (${remaining})` };
  }

  // Still-low but already alerted: hold the edge, stay quiet.
  if (state?.watermark === 'low') {
    return { triggered: true, sent: false, detail: `already alerted (${remaining})` };
  }
  if (recipients.length === 0) {
    return { triggered: true, sent: false, detail: 'no active admins to notify' };
  }

  const sent = await sendToAll(recipients, lowTrendingEmail(remaining, base), send);

  // Only latch the edge once the alert actually went out.
  if (sent) await setAlertState(db, 'low_trending', 'low', true);

  return {
    triggered: true,
    sent,
    detail: sent ? `alerted ${recipients.length} admin(s): ${remaining} remaining` : 'transport inert — left pending',
  };
}

function lowTrendingEmail(remaining: number, base: string): EmailMessage {
  const link = `${base}/admin/trending`;
  const text = `The trending queue is running low: ${remaining} non-pinned card${
    remaining === 1 ? '' : 's'
  } remaining. Approve or nominate candidates so the homepage rail stays fresh.

Manage trending: ${link}`;

  const html = `<p><strong>The trending queue is running low: ${remaining} non-pinned card${
    remaining === 1 ? '' : 's'
  } remaining.</strong></p><p>Approve or nominate candidates so the homepage rail stays fresh.</p><p><a href="${link}">Manage trending</a></p>`;

  return { to: '', subject: `Trending queue low — ${remaining} card${remaining === 1 ? '' : 's'} left`, text, html };
}

// ── Shared send ───────────────────────────────────────────────

/**
 * Sends one message to every recipient. Returns true only if at least one send
 * landed; an inert transport (not-configured) or all-failed returns false, which
 * keeps the caller from advancing dedup state.
 */
async function sendToAll(
  recipients: AlertRecipient[],
  message: EmailMessage,
  send: (msg: EmailMessage) => Promise<SendOutcome>
): Promise<boolean> {
  let any = false;
  for (const r of recipients) {
    const outcome = await send({ ...message, to: r.email });
    if (outcome.ok) any = true;
  }
  return any;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
