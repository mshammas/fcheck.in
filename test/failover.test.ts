/**
 * Static failover tests — the pipeline when Claude is unavailable.
 *
 * Two failure modes are covered: the API key is unset (no client at all), and a
 * runtime failure mid-check (rate limit / overload). In both, the AI-free stages
 * (cache, internal DB, external network) must still serve real results, and a
 * claim that genuinely needs AI must fall through to TYPE 4 with an honest note —
 * never a thrown error.
 *
 * Runs against real SQLite (test/d1.ts): FTS and the cache path are exercised for
 * real. The Anthropic calls are mocked so no key or network is needed; Google is
 * mocked at the fetch boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import type { ClaimRow, CheckRequest } from '../src/lib/types';
import { insertReport } from '../src/lib/db/claims';
import { runPipeline, AI_UNAVAILABLE_NOTE, type PipelineEnv } from '../src/lib/pipeline';
import { staticExtract } from '../src/lib/pipeline/fallback';
import { recheckSubmitted } from '../src/lib/jobs/recheck';

// Mock only the two networked Claude calls; getClientOrNull stays real so the
// "key present but the API fails" path builds a client and then errors on use.
const { extractImpl, deepImpl } = vi.hoisted(() => ({ extractImpl: vi.fn(), deepImpl: vi.fn() }));
vi.mock('../src/lib/providers/anthropic', async (importActual) => {
  const actual = await importActual<typeof import('../src/lib/providers/anthropic')>();
  return {
    ...actual,
    extractClaim: (...args: unknown[]) => extractImpl(...args),
    deepCheck: (...args: unknown[]) => deepImpl(...args),
  };
});

let db: D1Database;
let raw: Database.Database;

beforeEach(() => {
  ({ db, raw } = freshDb());
  extractImpl.mockReset();
  deepImpl.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A pipeline env with no AI key (the "not set" failover) unless overridden. */
function env(over: Partial<PipelineEnv> = {}): PipelineEnv {
  return { db, origin: 'https://fcheck.in', ...over };
}

function check(text: string, over: Partial<CheckRequest> = {}): CheckRequest {
  return { text, urls: [], files: [], channel: 'web', ...over };
}

/** Seed a published fcheck.in original + its report (report insert fires the FTS
 *  trigger). Raw claim insert bypasses insertClaim's "no non-external publish"
 *  guard — publication is normally an admin action, which we short-circuit here. */
async function seedPublishedOriginal(id: string, canonical: string, headline: string) {
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?,?,?,'original','published','FALSE',90,1,'2026-07-01T00:00:00Z',NULL,NULL,NULL,'2026-07-01T00:00:00Z')`
    )
    .run(id, `fp-${id}`, canonical);
  await insertReport(db, {
    claimId: id,
    reportType: 'original',
    headline,
    summary: 'A published fcheck.in original report.',
    body: canonical,
    evidence: [{ source: 'fcheck.in', url: 'https://fcheck.in/x', quote: 'checked' }],
    tags: [],
  });
}

describe('no AI key — AI-free stages still serve results', () => {
  it('serves a repeat submission from cache without any AI', async () => {
    const req = check('The moon landing footage was filmed in a Nevada studio in 1969.');

    const first = await runPipeline(env(), req);
    expect(first.cached).toBe(false);
    expect(first.type).toBe(4); // no verdict, queued

    const second = await runPipeline(env(), req);
    expect(second.cached).toBe(true);
    expect(second.claim_id).toBe(first.claim_id);

    // The static path never touched Claude.
    expect(extractImpl).not.toHaveBeenCalled();
    expect(deepImpl).not.toHaveBeenCalled();
  });

  it('serves a TYPE 1 hit from the fcheck.in database (FTS)', async () => {
    await seedPublishedOriginal('c1', 'Aspartame causes cancer in humans.', 'Aspartame does not cause cancer');

    const res = await runPipeline(env(), check('aspartame causes cancer'));

    expect(res.type).toBe(1);
    expect(res.claim_id).toBe('c1');
    expect(res.verdict).toBe('FALSE');
    expect(extractImpl).not.toHaveBeenCalled();
  });

  it('serves a TYPE 2 hit from the external network (Google)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('factchecktools.googleapis.com')) {
        return new Response(
          JSON.stringify({
            claims: [
              {
                text: '5G towers spread the virus.',
                claimReview: [
                  {
                    publisher: { name: 'Snopes', site: 'snopes.com' },
                    url: 'https://snopes.com/5g',
                    title: '5G does not spread viruses',
                    reviewDate: '2026-01-15T00:00:00Z',
                    textualRating: 'False',
                    languageCode: 'en',
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    try {
      const res = await runPipeline(
        env({ googleFactCheckApiKey: 'fake-google-key' }),
        check('Do 5G towers spread the virus?')
      );
      expect(res.type).toBe(2);
      expect(res.attribution?.name).toBe('Snopes');
      expect(res.verdict).toBe('FALSE');
      expect(extractImpl).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('queues a novel claim as TYPE 4 with the AI-unavailable note (no throw)', async () => {
    const res = await runPipeline(env(), check('A brand new unverifiable claim nobody has checked before.'));

    expect(res.type).toBe(4);
    expect(res.verdict).toBeNull();
    expect(res.notes).toContain(AI_UNAVAILABLE_NOTE);
  });
});

describe('runtime AI failure — degrades to the static path', () => {
  it('falls back when extractClaim throws (key present)', async () => {
    extractImpl.mockRejectedValue(new Error('429 rate_limit'));

    const res = await runPipeline(
      env({ anthropicApiKey: 'sk-fake' }),
      check('Another fresh claim that will need AI but cannot get it.')
    );

    expect(res.type).toBe(4);
    expect(res.notes).toContain(AI_UNAVAILABLE_NOTE);
    // Extraction failed, so the deep-check is skipped entirely.
    expect(deepImpl).not.toHaveBeenCalled();
  });

  it('falls back when deepCheck throws after a successful extract', async () => {
    extractImpl.mockResolvedValue({
      canonical_text: 'A fresh claim that extracts fine but the deep-check fails on.',
      assertions: [],
      country: null,
      language: null,
      is_checkable: true,
    });
    deepImpl.mockRejectedValue(new Error('529 overloaded'));

    const res = await runPipeline(env({ anthropicApiKey: 'sk-fake' }), check('deep check will overload'));

    expect(res.type).toBe(4);
    expect(res.notes).toContain(AI_UNAVAILABLE_NOTE);
    expect(deepImpl).toHaveBeenCalledOnce();
  });
});

describe('re-check job', () => {
  it('no-ops cleanly with no AI key', async () => {
    // A TYPE 4 claim sits in the queue; with no key the job must not throw.
    raw
      .prepare(
        `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
          submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
         VALUES ('s1','fp-s1','A queued claim.','submitted','processing',NULL,NULL,1,NULL,NULL,NULL,NULL,'2026-07-01T00:00:00Z')`
      )
      .run();

    const result = await recheckSubmitted(db, {}, { limit: 5 });
    expect(result).toEqual({ checked: 0, promoted: 0, promotions: [], notifications: [] });
    expect(deepImpl).not.toHaveBeenCalled();
  });
});

describe('staticExtract', () => {
  it('strips normalize markers, collapses whitespace, and clips', () => {
    const input = '[Content of https://x.com]\nThe   actual\n\nclaim text.\n[Attached, not yet analysed: a.mp3]';
    const out = staticExtract(input);
    expect(out.canonical_text).toBe('The actual claim text.');
    expect(out.is_checkable).toBe(true);
    expect(out.assertions).toEqual([]);
    expect(out.country).toBeNull();
  });

  it('clips overly long input to a bounded query', () => {
    const out = staticExtract('word '.repeat(400));
    expect(out.canonical_text.length).toBeLessThanOrEqual(500);
  });
});
