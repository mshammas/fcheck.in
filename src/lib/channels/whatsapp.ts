/**
 * WhatsApp Business Cloud API channel.
 *
 * One inbound webhook that turns a forwarded WhatsApp message into a
 * `CheckRequest`, runs the shared pipeline, and sends a short verdict back. The
 * pipeline is reused unchanged — this file only translates to and from Meta's
 * payloads.
 *
 * Everything here is pure or has an injectable transport, so the parsing,
 * formatting, and signature logic are unit-tested without hitting Meta. The
 * route (src/pages/api/webhooks/whatsapp.ts) is the only part that needs the
 * live credentials, and it stays inert until they are set — see docs/setup.md.
 */
import type { CheckResponse } from '../types';
import { VERDICT_LABELS } from '../types';

// ── Config ────────────────────────────────────────────────────

export interface WhatsAppConfig {
  /** Permanent or system-user access token for the WhatsApp Business account. */
  accessToken?: string;
  /** The sending phone number's id (not the number itself). */
  phoneNumberId?: string;
  /** Shared token echoed during webhook verification (we choose this value). */
  verifyToken?: string;
  /** App secret, for validating the X-Hub-Signature-256 on inbound POSTs. */
  appSecret?: string;
  /** Graph API version. */
  apiVersion: string;
}

export function whatsappConfigFromEnv(env: {
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_API_VERSION?: string;
}): WhatsAppConfig {
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
  };
}

/** Can we send replies? (Verification/signature need only their own fields.) */
export function whatsappConfigured(cfg: WhatsAppConfig): boolean {
  return Boolean(cfg.accessToken && cfg.phoneNumberId);
}

// ── Webhook verification (GET) ────────────────────────────────

/**
 * Meta's one-time webhook handshake: echo `hub.challenge` only when the mode and
 * our shared `hub.verify_token` match. Returns null to signal a 403.
 */
export function verifyWebhookChallenge(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  return mode === 'subscribe' && token === verifyToken ? challenge : null;
}

// ── Inbound signature (POST) ──────────────────────────────────

/**
 * Validates the `X-Hub-Signature-256: sha256=…` header — an HMAC-SHA256 of the
 * raw body under the app secret. Returns true when there is no app secret
 * configured (nothing to verify against) so local/dev without a secret still
 * works; the route additionally requires the secret in production.
 */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret) return true;
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = header.slice('sha256='.length);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const actual = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Inbound parsing ───────────────────────────────────────────

export type WhatsAppMediaType = 'image' | 'audio' | 'video' | 'document';

export interface InboundMessage {
  /** Sender's WhatsApp id (phone number). */
  from: string;
  messageId: string;
  /** Text body, or an image/document caption; '' when there is none. */
  text: string;
  /** Present when the message carries a media attachment. */
  media?: { id: string; type: WhatsAppMediaType; mime?: string; filename?: string };
  /** True for message kinds we can't turn into a claim (location, contacts, …). */
  unsupported: boolean;
}

/**
 * Pulls the first user message out of a webhook payload. Returns null for
 * payloads with no message (delivery/read status callbacks), which the route
 * simply acknowledges.
 */
export function parseInbound(payload: unknown): InboundMessage | null {
  const value = (payload as any)?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message || typeof message.from !== 'string') return null;

  const base = { from: message.from as string, messageId: String(message.id ?? ''), text: '', unsupported: false };

  switch (message.type) {
    case 'text':
      return { ...base, text: String(message.text?.body ?? '') };
    case 'image':
      return { ...base, text: String(message.image?.caption ?? ''), media: { id: message.image?.id, type: 'image', mime: message.image?.mime_type } };
    case 'document':
      return {
        ...base,
        text: String(message.document?.caption ?? ''),
        media: { id: message.document?.id, type: 'document', mime: message.document?.mime_type, filename: message.document?.filename },
      };
    case 'audio':
    case 'voice':
      return { ...base, media: { id: message.audio?.id, type: 'audio', mime: message.audio?.mime_type } };
    case 'video':
      return { ...base, text: String(message.video?.caption ?? ''), media: { id: message.video?.id, type: 'video', mime: message.video?.mime_type } };
    default:
      return { ...base, unsupported: true };
  }
}

// ── Reply formatting ──────────────────────────────────────────

const VERDICT_EMOJI: Record<string, string> = {
  TRUE: '✅',
  FALSE: '❌',
  MISLEADING: '⚠️',
  UNVERIFIABLE: '🤔',
  OUTDATED: '🕰️',
  SATIRE: '🎭',
};

/**
 * The short reply sent back on WhatsApp: a verdict line honest about how settled
 * it is, an optional headline, and the link to the full result. Kept to a few
 * lines — this is read on a phone, mid-conversation.
 */
export function formatReply(res: CheckResponse): string {
  const link = res.url;

  if (res.type === 4) {
    return [
      '🕐 *Submitted for review*',
      "We couldn't find enough yet to give a verdict. Our team will keep looking.",
      link,
    ].join('\n');
  }

  const label = res.verdict ? VERDICT_LABELS[res.verdict] : 'Checked';
  const emoji = (res.verdict && VERDICT_EMOJI[res.verdict]) || 'ℹ️';
  const headline = res.headline ? `\n${res.headline}` : '';

  if (res.type === 3) {
    const conf = res.confidence !== null ? ` (${res.confidence}% confidence)` : '';
    return [
      `${emoji} *${label}* — preliminary${conf}`,
      `AI analysis, under review by our team.${headline}`,
      link,
    ].join('\n');
  }

  if (res.type === 2) {
    const by = res.attribution?.name ? ` — via ${res.attribution.name}` : '';
    return [`${emoji} *${label}*${by}`, `${res.summary ?? headline.trim()}`.trim(), link].filter(Boolean).join('\n');
  }

  // TYPE 1 — reviewed and published by fcheck.in.
  return [`${emoji} *${label}* — reviewed by fcheck.in`, `${res.summary ?? headline.trim()}`.trim(), link].filter(Boolean).join('\n');
}

/** Reply for a message we can't turn into a checkable claim. */
export function unsupportedReply(kind: 'media' | 'other'): string {
  return kind === 'media'
    ? "I can't check audio or video yet — send the claim as text, a link, an image, or a PDF and I'll take a look."
    : "Send me a claim as text, a link, an image, or a PDF and I'll fact-check it for you.";
}

// ── Outbound transport (injectable) ───────────────────────────

export type SendOutcome = { ok: true } | { ok: false; reason: 'not-configured' | 'error'; detail?: string };

type FetchLike = typeof fetch;

/** Sends a plain-text WhatsApp reply. Inert when there is no token/number. */
export async function sendWhatsAppText(
  cfg: WhatsAppConfig,
  to: string,
  body: string,
  fetchImpl: FetchLike = fetch
): Promise<SendOutcome> {
  if (!whatsappConfigured(cfg)) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body } }),
    });
    if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : 'send failed' };
  }
}

/**
 * Downloads an inbound media attachment's bytes so the pipeline can analyse it.
 * Two authenticated calls: resolve the media id to a URL, then fetch the URL.
 * Returns null on any failure — the caller falls back to metadata-only.
 */
export async function fetchWhatsAppMedia(
  cfg: WhatsAppConfig,
  mediaId: string,
  fetchImpl: FetchLike = fetch
): Promise<{ mime: string; data: string } | null> {
  if (!cfg.accessToken) return null;
  try {
    const metaRes = await fetchImpl(`https://graph.facebook.com/${cfg.apiVersion}/${mediaId}`, {
      headers: { authorization: `Bearer ${cfg.accessToken}` },
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const bin = await fetchImpl(meta.url, { headers: { authorization: `Bearer ${cfg.accessToken}` } });
    if (!bin.ok) return null;
    const buf = await bin.arrayBuffer();
    return { mime: meta.mime_type ?? 'application/octet-stream', data: Buffer.from(buf).toString('base64') };
  } catch (err) {
    console.error(`whatsapp media fetch failed for ${mediaId}`, err);
    return null;
  }
}
