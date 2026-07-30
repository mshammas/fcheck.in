/**
 * Telegram channel tests. Pure logic only — parsing inbound Updates, formatting
 * replies, and the secret-token check. The Telegram network calls
 * (send/fetch-media) take an injected transport and are exercised with a stub;
 * the webhook route is thin glue over these.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CheckResponse } from '../src/lib/types';
import {
  telegramConfigFromEnv,
  telegramConfigured,
  verifySecret,
  parseInbound,
  formatReply,
  sendTelegramText,
} from '../src/lib/channels/telegram';

function textUpdate(text: string, chatId = 4242) {
  return { update_id: 1, message: { message_id: 7, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text } };
}

const baseResponse: CheckResponse = {
  claim_id: 'c1',
  source_type: 'external',
  type: 2,
  status: 'published',
  verdict: 'FALSE',
  confidence: null,
  canonical_text: 'A claim.',
  headline: 'The bridge video is from 2019, not 2026.',
  summary: 'Boom Live rated this claim False.',
  evidence: [],
  attribution: { name: 'Boom Live', url: 'https://boomlive.in/x', tier: 1, published_at: null },
  provisional: false,
  cached: false,
  url: 'https://fcheck.in/check/c1',
  notes: [],
};

describe('config', () => {
  it('reports configured only with a bot token', () => {
    expect(telegramConfigured(telegramConfigFromEnv({}))).toBe(false);
    expect(telegramConfigured(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: '123:abc' }))).toBe(true);
  });
});

describe('verifySecret', () => {
  it('accepts a matching header and rejects a wrong or missing one', () => {
    expect(verifySecret('s3cret', 's3cret')).toBe(true);
    expect(verifySecret('nope', 's3cret')).toBe(false);
    expect(verifySecret(null, 's3cret')).toBe(false);
  });

  it('skips the check when no secret is configured', () => {
    expect(verifySecret(null, undefined)).toBe(true);
    expect(verifySecret('anything', undefined)).toBe(true);
  });
});

describe('parseInbound', () => {
  it('extracts a text message with its chat id', () => {
    const msg = parseInbound(textUpdate('warm water cures covid', 9001));
    expect(msg).toMatchObject({ chatId: 9001, text: 'warm water cures covid', unsupported: false });
    expect(msg?.media).toBeUndefined();
  });

  it('takes the largest photo size and its caption', () => {
    const update = {
      message: {
        message_id: 1,
        chat: { id: 5 },
        caption: 'is this real?',
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'large', file_size: 9000 },
        ],
      },
    };
    const msg = parseInbound(update);
    expect(msg?.text).toBe('is this real?');
    expect(msg?.media).toEqual({ fileId: 'large', type: 'image', mime: 'image/jpeg' });
  });

  it('reads a document with its mime and filename', () => {
    const update = { message: { message_id: 1, chat: { id: 5 }, document: { file_id: 'doc1', mime_type: 'application/pdf', file_name: 'flyer.pdf' } } };
    expect(parseInbound(update)?.media).toEqual({ fileId: 'doc1', type: 'document', mime: 'application/pdf', filename: 'flyer.pdf' });
  });

  it('marks a voice note as audio with no text', () => {
    const update = { message: { message_id: 1, chat: { id: 5 }, voice: { file_id: 'v1', mime_type: 'audio/ogg' } } };
    expect(parseInbound(update)?.media?.type).toBe('audio');
    expect(parseInbound(update)?.text).toBe('');
  });

  it('treats /start and /help as empty text, not a claim', () => {
    expect(parseInbound(textUpdate('/start'))?.text).toBe('');
    expect(parseInbound(textUpdate('/help please'))?.text).toBe('');
  });

  it('flags an unhandled message kind as unsupported', () => {
    const update = { message: { message_id: 1, chat: { id: 5 }, location: { latitude: 1, longitude: 2 } } };
    expect(parseInbound(update)?.unsupported).toBe(true);
  });

  it('returns null for a non-message update', () => {
    expect(parseInbound({ update_id: 1, edited_message: { chat: { id: 5 }, text: 'x' } })).toBeNull();
    expect(parseInbound({ update_id: 1 })).toBeNull();
  });
});

describe('formatReply', () => {
  it('external (TYPE 2) names the fact-checker and links out, no markdown asterisks', () => {
    const reply = formatReply(baseResponse);
    expect(reply).toContain('False');
    expect(reply).toContain('via Boom Live');
    expect(reply).toContain('https://fcheck.in/check/c1');
    expect(reply).not.toContain('*'); // plain text — no parse_mode
  });

  it('preliminary (TYPE 3) is labelled provisional with confidence', () => {
    const reply = formatReply({ ...baseResponse, type: 3, source_type: 'preliminary', verdict: 'MISLEADING', confidence: 64, provisional: true, attribution: null });
    expect(reply).toMatch(/preliminary/i);
    expect(reply).toContain('64% confidence');
    expect(reply).toMatch(/under review/i);
  });

  it('submitted (TYPE 4) shows no verdict, just the review note', () => {
    const reply = formatReply({ ...baseResponse, type: 4, source_type: 'submitted', verdict: null, headline: null, summary: null, attribution: null });
    expect(reply).toMatch(/submitted for review/i);
    expect(reply).not.toMatch(/False|True|Misleading/);
    expect(reply).toContain('https://fcheck.in/check/c1');
  });
});

describe('sendTelegramText', () => {
  it('is inert without a bot token', async () => {
    const out = await sendTelegramText(telegramConfigFromEnv({}), 1, 'hi');
    expect(out).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('POSTs to the Bot API sendMessage endpoint when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const cfg = telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: '123:abc' });
    const out = await sendTelegramText(cfg, 777, 'your verdict', fetchMock as unknown as typeof fetch);

    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ chat_id: 777, text: 'your verdict' });
  });
});
