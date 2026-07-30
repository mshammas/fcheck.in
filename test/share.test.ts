/**
 * Share TL;DR tests — the pure fallback/clamp logic shared by the AI path and
 * the no-key fallback. No Claude and no network.
 */
import { describe, it, expect } from 'vitest';
import {
  fallbackTldr,
  clampVariants,
  clip,
  TWITTER_MAX,
  GENERIC_MAX,
  WHATSAPP_MAX,
  type TldrInput,
} from '../src/lib/share';

const base: TldrInput = {
  headline: 'The bridge collapse video is from 2022, not a new structure',
  summary: 'The footage is genuine but predates the claim by four years. It shows a bridge that collapsed during construction in 2022.',
  verdict: 'MISLEADING',
  attributedTo: null,
};

describe('clip', () => {
  it('leaves short text untouched and collapses whitespace', () => {
    expect(clip('  a   b ', 20)).toBe('a b');
  });

  it('truncates on a word boundary with an ellipsis, keeping whole words', () => {
    const out = clip('California banned diesel trucks', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
    // The last kept word is whole ("banned"), not a fragment of "diesel".
    expect(out).toBe('California banned…');
  });

  it('hard-cuts when no space is near the limit', () => {
    const out = clip('supercalifragilistic', 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('fallbackTldr', () => {
  it('leads with the verdict on every platform', () => {
    const t = fallbackTldr(base);
    expect(t.generic).toMatch(/Misleading/);
    expect(t.twitter).toMatch(/Misleading/);
    expect(t.whatsapp).toMatch(/Misleading/);
  });

  it('respects each platform char budget', () => {
    const t = fallbackTldr({ ...base, headline: 'x'.repeat(400), summary: 'y'.repeat(1000) });
    expect(t.generic.length).toBeLessThanOrEqual(GENERIC_MAX);
    expect(t.twitter.length).toBeLessThanOrEqual(TWITTER_MAX);
    expect(t.whatsapp.length).toBeLessThanOrEqual(WHATSAPP_MAX);
  });

  it('credits an external fact-checker when attributed', () => {
    const t = fallbackTldr({ ...base, attributedTo: 'Boom Live' });
    expect(t.twitter).toContain('via Boom Live');
    expect(t.whatsapp).toContain('via Boom Live');
  });

  it('never emits a URL — the link is added by the client', () => {
    const t = fallbackTldr(base);
    expect(`${t.generic} ${t.twitter} ${t.whatsapp}`).not.toMatch(/https?:\/\//);
  });

  it('handles a null verdict without crashing', () => {
    const t = fallbackTldr({ ...base, verdict: null });
    expect(t.generic).toMatch(/Checked/);
  });
});

describe('clampVariants', () => {
  it('trims oversized AI output to the budgets', () => {
    const clamped = clampVariants({ generic: 'g'.repeat(500), twitter: 't'.repeat(500), whatsapp: 'w'.repeat(2000) });
    expect(clamped.generic.length).toBeLessThanOrEqual(GENERIC_MAX);
    expect(clamped.twitter.length).toBeLessThanOrEqual(TWITTER_MAX);
    expect(clamped.whatsapp.length).toBeLessThanOrEqual(WHATSAPP_MAX);
  });
});
