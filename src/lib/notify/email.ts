/**
 * Email delivery for subscriber notifications.
 *
 * Provider-agnostic: it POSTs to a configured transactional-email HTTP API
 * (`EMAIL_API_URL`) with a bearer token (`EMAIL_API_TOKEN`) and a From address
 * (`EMAIL_FROM`). The payload shape — `{ from, to, subject, text, html }` with
 * `Authorization: Bearer …` — matches Resend and similar services; point
 * `EMAIL_API_URL` at whichever you use.
 *
 * When any of the three is unset the sender is inert: it reports
 * `not-configured` and sends nothing, mirroring how the AI providers stay dark
 * without their keys. The notification service never stamps `notified_at` on an
 * inert or failed send, so a real backlog is delivered intact once the keys are
 * set — no subscriber is silently dropped.
 */

export interface EmailConfig {
  apiUrl?: string;
  apiToken?: string;
  from?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type SendOutcome = { ok: true } | { ok: false; reason: 'not-configured' | 'error'; detail?: string };

/** Reads the email transport config off the worker env (all three optional). */
export function emailConfigFromEnv(env: {
  EMAIL_API_URL?: string;
  EMAIL_API_TOKEN?: string;
  EMAIL_FROM?: string;
}): EmailConfig {
  return { apiUrl: env.EMAIL_API_URL, apiToken: env.EMAIL_API_TOKEN, from: env.EMAIL_FROM };
}

export function emailConfigured(cfg: EmailConfig): boolean {
  return Boolean(cfg.apiUrl && cfg.apiToken && cfg.from);
}

export async function sendEmail(cfg: EmailConfig, msg: EmailMessage): Promise<SendOutcome> {
  if (!emailConfigured(cfg)) return { ok: false, reason: 'not-configured' };

  try {
    const res = await fetch(cfg.apiUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiToken}`,
      },
      body: JSON.stringify({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : 'send failed' };
  }
}
