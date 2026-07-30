/**
 * Telegram Bot API webhook.
 *
 *   POST — an inbound Update: check the secret-token header, turn the message
 *          into a CheckRequest, run the shared pipeline, and send a short
 *          verdict back.
 *
 * Telegram retries any non-2xx, so this route answers 200 for every well-formed
 * update — including ones it can't act on — and does the reply as a side effect.
 * It is inert until TELEGRAM_BOT_TOKEN is set (see docs/setup.md); the channel
 * library holds all the logic and is unit-tested. Unlike WhatsApp there is no
 * GET handshake: the webhook is registered out-of-band with setWebhook.
 */
import type { APIRoute } from 'astro';
import type { CheckFile, CheckRequest } from '../../../lib/types';
import { getDb, getEnv } from '../../../lib/db/client';
import { runPipeline } from '../../../lib/pipeline';
import {
  telegramConfigFromEnv,
  telegramConfigured,
  verifySecret,
  parseInbound,
  formatReply,
  unsupportedReply,
  sendTelegramText,
  fetchTelegramMedia,
  type TelegramConfig,
  type InboundMessage,
} from '../../../lib/channels/telegram';

export const prerender = false;

// Only the media types the pipeline can actually read are worth downloading.
const ANALYZABLE_MEDIA = /^image\/|^application\/pdf$/;

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv();
  const cfg = telegramConfigFromEnv(env);

  // Reject forged updates, but only when a secret is configured to check them.
  if (!verifySecret(request.headers.get('x-telegram-bot-api-secret-token'), cfg.webhookSecret)) {
    return new Response('Invalid secret token', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return ack(); // malformed body — ack so Telegram doesn't retry forever
  }

  const message = parseInbound(payload);
  if (!message) return ack(); // non-message update — nothing to do

  const origin = new URL(request.url).origin;

  // Do the work but never let it turn into a non-200 for Telegram.
  try {
    await handleMessage(env, cfg, message, origin);
  } catch (err) {
    console.error('telegram handling failed', err);
    if (telegramConfigured(cfg)) {
      await sendTelegramText(cfg, message.chatId, 'Something went wrong checking that — please try again in a moment.').catch(() => {});
    }
  }
  return ack();
};

async function handleMessage(env: Env, cfg: TelegramConfig, message: InboundMessage, origin: string): Promise<void> {
  // Can't reply without a token — record nothing, just acknowledge upstream.
  if (!telegramConfigured(cfg)) {
    console.warn('Telegram inbound received but TELEGRAM_BOT_TOKEN is not set — cannot reply.');
    return;
  }

  if (message.unsupported) {
    await sendTelegramText(cfg, message.chatId, unsupportedReply('other'));
    return;
  }

  // Audio/video can't be analysed yet, and a bare unsupported-media message with
  // no caption has nothing to check.
  const mediaAnalyzable = message.media ? ANALYZABLE_MEDIA.test(message.media.mime ?? '') : false;
  if (message.media && !mediaAnalyzable && !message.text.trim()) {
    await sendTelegramText(cfg, message.chatId, unsupportedReply('media'));
    return;
  }

  const files: CheckFile[] = [];
  if (message.media && mediaAnalyzable) {
    const media = await fetchTelegramMedia(cfg, message.media.fileId, message.media.mime ?? '');
    if (media) {
      files.push({
        name: message.media.filename ?? `telegram-${message.media.type}`,
        type: media.mime,
        size: 0,
        data: media.data,
      });
    }
  }

  if (!message.text.trim() && files.length === 0) {
    await sendTelegramText(cfg, message.chatId, unsupportedReply('other'));
    return;
  }

  const check: CheckRequest = { text: message.text, files, channel: 'telegram' };
  const result = await runPipeline(
    {
      db: getDb(),
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      googleFactCheckApiKey: env.GOOGLE_FACT_CHECK_API_KEY,
      ai: env.AI,
      vectorize: env.CLAIM_VECTORS,
      origin,
    },
    check
  );

  await sendTelegramText(cfg, message.chatId, formatReply(result));
}

/** Telegram only needs a 200; the body is ignored. */
function ack(): Response {
  return new Response('OK', { status: 200 });
}
