/**
 * WhatsApp channel tests. Pure logic only — parsing inbound payloads, formatting
 * replies, the verification handshake, and HMAC signature checking. The Meta
 * network calls (send/fetch-media) take an injected transport and are exercised
 * with a stub; the webhook route is thin glue over these.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CheckResponse } from '../src/lib/types';
import {
  whatsappConfigFromEnv,
  whatsappConfigured,
  verifyWebhookChallenge,
  verifySignature,
  parseInbound,
  formatReply,
  sendWhatsAppText,
} from '../src/lib/channels/whatsapp';

function textPayload(body: string, from = '15551234567') {
  return { entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.1', type: 'text', text: { body } }] } }] }] };
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
  it('defaults the API version and reports configured only with token + number', () => {
    expect(whatsappConfigFromEnv({}).apiVersion).toBe('v21.0');
    expect(whatsappConfigured(whatsappConfigFromEnv({}))).toBe(false);
    const cfg = whatsappConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' });
    expect(whatsappConfigured(cfg)).toBe(true);
  });
});

describe('verifyWebhookChallenge', () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it('echoes the challenge when mode and token match', () => {
    const p = params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'secret', 'hub.challenge': '42' });
    expect(verifyWebhookChallenge(p, 'secret')).toBe('42');
  });

  it('rejects a wrong token or missing verify token', () => {
    const p = params({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' });
    expect(verifyWebhookChallenge(p, 'secret')).toBeNull();
    expect(verifyWebhookChallenge(p, undefined)).toBeNull();
  });
});

describe('verifySignature', () => {
  it('accepts a correct HMAC and rejects a tampered body', async () => {
    const secret = 'app-secret';
    const body = JSON.stringify(textPayload('hello'));
    // Compute the expected signature the same way Meta would.
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

    expect(await verifySignature(body, `sha256=${hex}`, secret)).toBe(true);
    expect(await verifySignature(body + 'x', `sha256=${hex}`, secret)).toBe(false);
    expect(await verifySignature(body, 'sha256=deadbeef', secret)).toBe(false);
    expect(await verifySignature(body, null, secret)).toBe(false);
  });

  it('skips verification when no app secret is configured', async () => {
    expect(await verifySignature('anything', null, undefined)).toBe(true);
  });
});

describe('parseInbound', () => {
  it('extracts a text message', () => {
    const msg = parseInbound(textPayload('warm water cures covid', '15550001111'));
    expect(msg).toMatchObject({ from: '15550001111', text: 'warm water cures covid', unsupported: false });
    expect(msg?.media).toBeUndefined();
  });

  it('extracts an image with its caption as media', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: '1', id: 'w', type: 'image', image: { id: 'media-9', mime_type: 'image/jpeg', caption: 'is this real?' } }] } }] }] };
    const msg = parseInbound(payload);
    expect(msg?.text).toBe('is this real?');
    expect(msg?.media).toEqual({ id: 'media-9', type: 'image', mime: 'image/jpeg' });
  });

  it('marks audio as media with no text', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: '1', id: 'w', type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg' } }] } }] }] };
    expect(parseInbound(payload)?.media?.type).toBe('audio');
  });

  it('flags an unknown message type as unsupported', () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: '1', id: 'w', type: 'location', location: {} }] } }] }] };
    expect(parseInbound(payload)?.unsupported).toBe(true);
  });

  it('returns null for a status callback (no messages)', () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] };
    expect(parseInbound(payload)).toBeNull();
  });
});

describe('formatReply', () => {
  it('external (TYPE 2) names the fact-checker and links out', () => {
    const reply = formatReply(baseResponse);
    expect(reply).toContain('False');
    expect(reply).toContain('via Boom Live');
    expect(reply).toContain('https://fcheck.in/check/c1');
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

describe('sendWhatsAppText', () => {
  it('is inert without a token/number', async () => {
    const out = await sendWhatsAppText(whatsappConfigFromEnv({}), '1', 'hi');
    expect(out).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('POSTs to the graph API with a bearer token when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const cfg = whatsappConfigFromEnv({ WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '999' });
    const out = await sendWhatsAppText(cfg, '15551112222', 'your verdict', fetchMock as unknown as typeof fetch);

    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/999/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '15551112222', type: 'text', text: { body: 'your verdict' } });
  });
});
