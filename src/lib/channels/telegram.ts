/**
 * Telegram Bot API channel.
 *
 * The Telegram sibling of the WhatsApp channel: one inbound webhook that turns a
 * forwarded message into a `CheckRequest`, runs the shared pipeline, and sends a
 * short verdict back. The pipeline is reused unchanged — this file only
 * translates to and from Telegram's `Update` payloads.
 *
 * Everything here is pure or has an injectable transport, so the parsing,
 * formatting, and secret-token check are unit-tested without hitting Telegram.
 * The route (src/pages/api/webhooks/telegram.ts) is the only part that needs the
 * live token, and it stays inert until it is set — see docs/setup.md.
 *
 * Two things differ from WhatsApp by design:
 *   • Telegram has no GET verification handshake — the webhook is registered
 *     out-of-band with setWebhook. Instead every inbound update carries the
 *     `X-Telegram-Bot-Api-Secret-Token` header, which we compare against the
 *     secret we chose at registration.
 *   • Photos arrive as a size ladder with no mime type (always JPEG); we take
 *     the largest and label it image/jpeg.
 */
import type { CheckResponse } from '../types';
import { VERDICT_LABELS } from '../types';

// ── Config ────────────────────────────────────────────────────

export interface TelegramConfig {
  /** Bot token from BotFather, e.g. "123456:ABC-DEF…". */
  botToken?: string;
  /** Secret we set on setWebhook and echo-check on every inbound update. */
  webhookSecret?: string;
}

export function telegramConfigFromEnv(env: {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}): TelegramConfig {
  return { botToken: env.TELEGRAM_BOT_TOKEN, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET };
}

/** Can we send replies? (The token is all the outbound API needs.) */
export function telegramConfigured(cfg: TelegramConfig): boolean {
  return Boolean(cfg.botToken);
}

// ── Inbound secret (POST) ─────────────────────────────────────

/**
 * Validates the `X-Telegram-Bot-Api-Secret-Token` header against the secret we
 * registered with setWebhook. Returns true when no secret is configured
 * (nothing to check against) so local/dev without one still works; the route
 * additionally requires the secret in production.
 */
export function verifySecret(header: string | null, webhookSecret: string | undefined): boolean {
  if (!webhookSecret) return true;
  return typeof header === 'string' && timingSafeEqual(header, webhookSecret);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Inbound parsing ───────────────────────────────────────────

export type TelegramMediaType = 'image' | 'audio' | 'video' | 'document';

export interface InboundMessage {
  /** Chat id to reply into. */
  chatId: number;
  messageId: number;
  /** Text body, or a media caption; '' when there is none. */
  text: string;
  /** Present when the message carries a media attachment. */
  media?: { fileId: string; type: TelegramMediaType; mime?: string; filename?: string };
  /** True for message kinds we can't turn into a claim (location, sticker, …). */
  unsupported: boolean;
}

/**
 * Pulls the user message out of an Update. Returns null for updates that carry
 * no actionable message (edited_message, callbacks, etc.), which the route
 * simply acknowledges. `/start` and `/help` commands are treated as empty text
 * so the route can answer with guidance rather than run the pipeline on them.
 */
export function parseInbound(payload: unknown): InboundMessage | null {
  const message = (payload as any)?.message;
  const chatId = message?.chat?.id;
  if (!message || typeof chatId !== 'number') return null;

  const base = { chatId, messageId: Number(message.message_id ?? 0), text: '', unsupported: false };
  const caption = typeof message.caption === 'string' ? message.caption : '';

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Photos come as a size ladder, smallest → largest; take the largest.
    const largest = message.photo[message.photo.length - 1];
    return { ...base, text: caption, media: { fileId: String(largest.file_id), type: 'image', mime: 'image/jpeg' } };
  }
  if (message.document) {
    return {
      ...base,
      text: caption,
      media: { fileId: String(message.document.file_id), type: 'document', mime: message.document.mime_type, filename: message.document.file_name },
    };
  }
  if (message.voice || message.audio) {
    const a = message.voice ?? message.audio;
    return { ...base, media: { fileId: String(a.file_id), type: 'audio', mime: a.mime_type } };
  }
  if (message.video) {
    return { ...base, text: caption, media: { fileId: String(message.video.file_id), type: 'video', mime: message.video.mime_type } };
  }
  if (typeof message.text === 'string') {
    // Bot commands (/start, /help) carry no claim — surface as empty text.
    const text = /^\/(start|help)\b/.test(message.text.trim()) ? '' : message.text;
    return { ...base, text };
  }

  return { ...base, unsupported: true };
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
 * The short reply sent back on Telegram: a verdict line honest about how settled
 * it is, an optional headline, and the link to the full result. Sent as plain
 * text (no parse_mode) so the content is never mangled by Markdown escaping.
 */
export function formatReply(res: CheckResponse): string {
  const link = res.url;

  if (res.type === 4) {
    return [
      '🕐 Submitted for review',
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
      `${emoji} ${label} — preliminary${conf}`,
      `AI analysis, under review by our team.${headline}`,
      link,
    ].join('\n');
  }

  if (res.type === 2) {
    const by = res.attribution?.name ? ` — via ${res.attribution.name}` : '';
    return [`${emoji} ${label}${by}`, `${res.summary ?? headline.trim()}`.trim(), link].filter(Boolean).join('\n');
  }

  // TYPE 1 — reviewed and published by fcheck.in.
  return [`${emoji} ${label} — reviewed by fcheck.in`, `${res.summary ?? headline.trim()}`.trim(), link].filter(Boolean).join('\n');
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

/** Sends a plain-text Telegram reply. Inert when there is no bot token. */
export async function sendTelegramText(
  cfg: TelegramConfig,
  chatId: number,
  body: string,
  fetchImpl: FetchLike = fetch
): Promise<SendOutcome> {
  if (!telegramConfigured(cfg)) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, disable_web_page_preview: false }),
    });
    if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : 'send failed' };
  }
}

/**
 * Downloads an inbound attachment's bytes so the pipeline can analyse it. Two
 * calls: getFile resolves the file_id to a path, then the file is fetched from
 * the file endpoint. Returns null on any failure — the caller falls back to
 * metadata-only.
 */
export async function fetchTelegramMedia(
  cfg: TelegramConfig,
  fileId: string,
  mime: string,
  fetchImpl: FetchLike = fetch
): Promise<{ mime: string; data: string } | null> {
  if (!cfg.botToken) return null;
  try {
    const metaRes = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { ok?: boolean; result?: { file_path?: string } };
    const path = meta.result?.file_path;
    if (!path) return null;

    const bin = await fetchImpl(`https://api.telegram.org/file/bot${cfg.botToken}/${path}`);
    if (!bin.ok) return null;
    const buf = await bin.arrayBuffer();
    return { mime: mime || 'application/octet-stream', data: Buffer.from(buf).toString('base64') };
  } catch (err) {
    console.error(`telegram media fetch failed for ${fileId}`, err);
    return null;
  }
}
