/**
 * WhatsApp Business Cloud API webhook.
 *
 *   GET  — Meta's subscription handshake: echo hub.challenge when the verify
 *          token matches.
 *   POST — an inbound message: validate the signature, turn it into a
 *          CheckRequest, run the shared pipeline, and send a short verdict back.
 *
 * Meta retries any non-200, so this route answers 200 for every well-formed
 * delivery — including ones it can't act on — and does the reply as a side
 * effect. It is inert until the WHATSAPP_* credentials are set (see
 * docs/setup.md); the channel library holds all the logic and is unit-tested.
 */
import type { APIRoute } from 'astro';
import type { CheckFile, CheckRequest } from '../../../lib/types';
import { getDb, getEnv } from '../../../lib/db/client';
import { runPipeline } from '../../../lib/pipeline';
import {
  whatsappConfigFromEnv,
  whatsappConfigured,
  verifyWebhookChallenge,
  verifySignature,
  parseInbound,
  formatReply,
  unsupportedReply,
  sendWhatsAppText,
  fetchWhatsAppMedia,
  type WhatsAppConfig,
  type InboundMessage,
} from '../../../lib/channels/whatsapp';

export const prerender = false;

// Only the media types the pipeline can actually read are worth downloading.
const ANALYZABLE_MEDIA = /^image\/|^application\/pdf$/;

export const GET: APIRoute = ({ request }) => {
  const cfg = whatsappConfigFromEnv(getEnv());
  const params = new URL(request.url).searchParams;
  const challenge = verifyWebhookChallenge(params, cfg.verifyToken);
  if (challenge === null) return new Response('Forbidden', { status: 403 });
  // Meta expects the raw challenge string echoed back.
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
};

export const POST: APIRoute = async ({ request }) => {
  const env = getEnv();
  const cfg = whatsappConfigFromEnv(env);

  const rawBody = await request.text();

  // Reject forged payloads, but only when a secret is configured to check them.
  const valid = await verifySignature(rawBody, request.headers.get('x-hub-signature-256'), cfg.appSecret);
  if (!valid) return new Response('Invalid signature', { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return ack(); // malformed body — ack so Meta doesn't retry forever
  }

  const message = parseInbound(payload);
  if (!message) return ack(); // status callback or empty change — nothing to do

  const origin = new URL(request.url).origin;

  // Do the work but never let it turn into a non-200 for Meta.
  try {
    await handleMessage(env, cfg, message, origin);
  } catch (err) {
    console.error('whatsapp handling failed', err);
    if (whatsappConfigured(cfg)) {
      await sendWhatsAppText(cfg, message.from, "Something went wrong checking that — please try again in a moment.").catch(() => {});
    }
  }
  return ack();
};

async function handleMessage(env: Env, cfg: WhatsAppConfig, message: InboundMessage, origin: string): Promise<void> {
  // Can't reply without a token — record nothing, just acknowledge upstream.
  if (!whatsappConfigured(cfg)) {
    console.warn('WhatsApp inbound received but WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID are not set — cannot reply.');
    return;
  }

  if (message.unsupported) {
    await sendWhatsAppText(cfg, message.from, unsupportedReply('other'));
    return;
  }

  // Audio/video can't be analysed yet, and a bare unsupported-media message with
  // no caption has nothing to check.
  const mediaAnalyzable = message.media ? ANALYZABLE_MEDIA.test(message.media.mime ?? '') : false;
  if (message.media && !mediaAnalyzable && !message.text.trim()) {
    await sendWhatsAppText(cfg, message.from, unsupportedReply('media'));
    return;
  }

  const files: CheckFile[] = [];
  if (message.media && mediaAnalyzable) {
    const media = await fetchWhatsAppMedia(cfg, message.media.id);
    if (media) {
      files.push({
        name: message.media.filename ?? `whatsapp-${message.media.type}`,
        type: media.mime,
        size: 0,
        data: media.data,
      });
    }
  }

  if (!message.text.trim() && files.length === 0) {
    await sendWhatsAppText(cfg, message.from, unsupportedReply('other'));
    return;
  }

  const check: CheckRequest = { text: message.text, files, channel: 'whatsapp' };
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

  await sendWhatsAppText(cfg, message.from, formatReply(result));
}

/** WhatsApp only needs a 200; the body is ignored. */
function ack(): Response {
  return new Response('OK', { status: 200 });
}
