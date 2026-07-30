/**
 * The editorial rules that live in the AI path — the ones no real key has
 * exercised yet. These run the actual extract/deep-check logic against a fake
 * Anthropic client, so the source-enforcement and downgrade behaviour is
 * proven without an API call.
 */
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extractClaim, deepCheck } from '../src/lib/providers/anthropic';
import { normalizeVerdict } from '../src/lib/providers/googleFactCheck';
import { matchFactChecker } from '../src/lib/db/factCheckers';
import type { FactCheckerRow } from '../src/lib/types';

/** A stand-in Claude client that returns a fixed structured payload. */
function fakeClient(fixture: unknown, stopReason = 'end_turn'): Anthropic {
  return {
    messages: {
      async create() {
        return {
          stop_reason: stopReason,
          content: [{ type: 'text', text: JSON.stringify(fixture) }],
        };
      },
    },
  } as unknown as Anthropic;
}

describe('deepCheck — every assertion must cite a source', () => {
  it('drops evidence with no URL and downgrades to insufficient when none remain', async () => {
    const client = fakeClient({
      sufficient_evidence: true,
      verdict: 'FALSE',
      confidence: 88,
      headline: 'Claim is false',
      summary: 'Summary',
      body: 'Body',
      evidence: [
        { source: 'Unsourced claim', url: '', snippet: 's', date: null },
        { source: 'Also unsourced', url: 'not-a-real-url', snippet: 's', date: null },
      ],
      tags: ['Health'],
    });

    const result = await deepCheck(client, 'some claim');

    // No sourced evidence survived, so the verdict cannot stand.
    expect(result.evidence).toHaveLength(0);
    expect(result.sufficient_evidence).toBe(false);
    expect(result.verdict).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it('keeps sourced evidence and preserves the verdict when at least one URL is valid', async () => {
    const client = fakeClient({
      sufficient_evidence: true,
      verdict: 'FALSE',
      confidence: 90,
      headline: 'Claim is false',
      summary: 'Summary',
      body: 'Body',
      evidence: [
        { source: 'WHO', url: 'https://www.who.int/page', snippet: 's', date: '2026-01-01' },
        { source: 'Unsourced', url: '', snippet: 's', date: null },
      ],
      tags: ['Health'],
    });

    const result = await deepCheck(client, 'some claim');

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.source).toBe('WHO');
    expect(result.sufficient_evidence).toBe(true);
    expect(result.verdict).toBe('FALSE');
    expect(result.confidence).toBe(90);
  });

  it('surfaces a genuine TYPE 4 (insufficient) result unchanged', async () => {
    const client = fakeClient({
      sufficient_evidence: false,
      verdict: null,
      confidence: null,
      headline: 'Not enough evidence',
      summary: 'We could not find enough sources.',
      body: 'Body',
      evidence: [],
      tags: [],
    });

    const result = await deepCheck(client, 'obscure local claim');
    expect(result.sufficient_evidence).toBe(false);
    expect(result.verdict).toBeNull();
  });
});

describe('deepCheck — server-tool interruptions do not fabricate a result', () => {
  it('throws on a paused turn rather than returning a partial answer', async () => {
    const client = fakeClient({ sufficient_evidence: true, verdict: 'FALSE', evidence: [] }, 'pause_turn');
    await expect(deepCheck(client, 'x')).rejects.toThrow(/paused/i);
  });

  it('throws on a safety refusal', async () => {
    const client = fakeClient({}, 'refusal');
    await expect(deepCheck(client, 'x')).rejects.toThrow(/declined/i);
  });
});

describe('extractClaim — structured output', () => {
  it('parses the canonical text and checkability flag', async () => {
    const client = fakeClient({
      canonical_text: 'Drinking warm water cures viral infections.',
      assertions: ['Warm water cures viral infections'],
      country: 'IN',
      language: 'en',
      is_checkable: true,
    });

    const result = await extractClaim(client, 'forwarded: drink warm water, it kills the virus!!!');
    expect(result.canonical_text).toContain('warm water');
    expect(result.is_checkable).toBe(true);
    expect(result.country).toBe('IN');
  });

  it('reads is_checkable=false for opinions', async () => {
    const client = fakeClient({
      canonical_text: 'The user thinks the policy is bad.',
      assertions: [],
      country: null,
      language: 'en',
      is_checkable: false,
    });

    const result = await extractClaim(client, 'this new policy is terrible and everyone hates it');
    expect(result.is_checkable).toBe(false);
  });
});

describe('normalizeVerdict — publisher ratings to our six verdicts', () => {
  const cases: [string, string | null][] = [
    ['False', 'FALSE'],
    ['Pants on Fire', 'FALSE'],
    ['Fake', 'FALSE'],
    ['Mostly false', 'MISLEADING'],
    ['Misleading', 'MISLEADING'],
    ['Missing context', 'MISLEADING'],
    ['True', 'TRUE'],
    ['Correct', 'TRUE'],
    ['Satire', 'SATIRE'],
    ['Unproven', 'UNVERIFIABLE'],
    ['No evidence', 'UNVERIFIABLE'],
    ['Outdated', 'OUTDATED'],
    ['', null],
    ['Some rating we have never seen', null],
  ];

  for (const [rating, expected] of cases) {
    it(`maps "${rating}" → ${expected}`, () => {
      expect(normalizeVerdict(rating)).toBe(expected);
    });
  }
});

describe('matchFactChecker — resolving a publisher to the network', () => {
  const network: FactCheckerRow[] = [
    { id: 'fc-boom', name: 'Boom Live', slug: 'boom-live', tier: 2, countries: '["IN"]', languages: '["en"]', api_endpoint: null, homepage_url: 'https://www.boomlive.in', active: 1 },
    { id: 'fc-snopes', name: 'Snopes', slug: 'snopes', tier: 1, countries: '["US"]', languages: '["en"]', api_endpoint: null, homepage_url: 'https://www.snopes.com', active: 1 },
  ];

  it('matches on the publisher domain', () => {
    expect(matchFactChecker(network, 'BOOM', 'boomlive.in')?.id).toBe('fc-boom');
  });

  it('matches on the publisher name when the domain is unknown', () => {
    expect(matchFactChecker(network, 'Snopes', 'unknown-host.example')?.id).toBe('fc-snopes');
  });

  it('returns null for a publisher outside the network', () => {
    expect(matchFactChecker(network, 'Some Random Blog', 'randomblog.example')).toBeNull();
  });
});
