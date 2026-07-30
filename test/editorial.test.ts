/**
 * Editorial-homepage tests: the pure region/category mapping, and the two DB
 * queries that feed the featured card, latest grid, and sidebar stats (against
 * real SQLite via test/d1.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import { regionForCountry, categoriesForTags, REGIONS, CATEGORY_LABELS } from '../src/lib/editorial';
import { getPublishedReports, getEditorialStats } from '../src/lib/db/claims';

describe('regionForCountry', () => {
  it('maps known country codes to their region, case-insensitively', () => {
    expect(regionForCountry('IN')).toBe('South Asia');
    expect(regionForCountry('gb')).toBe('Europe');
    expect(regionForCountry('US')).toBe('Americas');
  });

  it('falls back to Global for unknown or missing codes', () => {
    expect(regionForCountry('ZZ')).toBe('Global');
    expect(regionForCountry(null)).toBe('Global');
    expect(regionForCountry(undefined)).toBe('Global');
  });

  it('every mapped region is a declared REGION', () => {
    expect(REGIONS).toContain(regionForCountry('PK'));
  });
});

describe('categoriesForTags', () => {
  it('maps tags to category labels by keyword', () => {
    expect(categoriesForTags(['Finance', 'Banking'])).toContain('Finance');
    expect(categoriesForTags(['COVID vaccine'])).toContain('Health & Medicine');
  });

  it('can match several categories and returns declared labels only', () => {
    const cats = categoriesForTags(['climate policy']);
    expect(cats.every((c) => CATEGORY_LABELS.includes(c))).toBe(true);
    expect(cats).toContain('Environment');
  });

  it('returns nothing for tags that match no category', () => {
    expect(categoriesForTags(['sports', 'cricket'])).toEqual([]);
    expect(categoriesForTags([])).toEqual([]);
  });
});

describe('getPublishedReports / getEditorialStats', () => {
  let db: D1Database;
  let raw: Database.Database;

  beforeEach(() => {
    ({ db, raw } = freshDb());
  });

  function claim(id: string, source_type: string, status: string, published_at: string | null, created_at = '2026-07-25T00:00:00Z', verdict = 'FALSE') {
    raw
      .prepare(
        `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
          submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
         VALUES (?, ?, 'A claim.', ?, ?, ?, NULL, 1, ?, NULL, NULL, NULL, ?)`
      )
      .run(id, `fp-${id}`, source_type, status, verdict, published_at, created_at);
  }
  function report(id: string, claimId: string, type: string, headline: string, published_at: string, slug: string | null = null, country: string | null = null, tags = '[]') {
    raw
      .prepare(
        `INSERT INTO reports (id,claim_id,report_type,slug,headline,summary,body,evidence,tags,country,language,external_url,fact_checker_id,published_by,published_at)
         VALUES (?, ?, ?, ?, ?, 'summary', 'body', '[]', ?, ?, NULL, NULL, NULL, NULL, ?)`
      )
      .run(id, claimId, type, slug, headline, tags, country, published_at);
  }

  it('returns published TYPE 1/2 reports newest first', async () => {
    claim('c1', 'original', 'published', '2026-07-20T00:00:00Z');
    report('r1', 'c1', 'original', 'Older original', '2026-07-20T00:00:00Z', 'older');
    claim('c2', 'external', 'published', '2026-07-28T00:00:00Z');
    report('r2', 'c2', 'external', 'Newer external', '2026-07-28T00:00:00Z');

    const rows = await getPublishedReports(db);
    expect(rows.map((r) => r.headline)).toEqual(['Newer external', 'Older original']);
  });

  it('excludes preliminary drafts and unpublished claims', async () => {
    claim('c3', 'preliminary', 'draft', null);
    report('r3', 'c3', 'preliminary', 'A draft', '2026-07-27T00:00:00Z');

    expect(await getPublishedReports(db)).toHaveLength(0);
  });

  it('returns one row per claim, preferring the original over the external', async () => {
    // The TYPE 3 -> 2 -> 1 path leaves both reports on one claim.
    claim('c4', 'original', 'published', '2026-07-26T00:00:00Z');
    report('r4a', 'c4', 'external', 'External headline', '2026-07-25T00:00:00Z');
    report('r4b', 'c4', 'original', 'Original headline', '2026-07-26T00:00:00Z', 'orig');

    const rows = await getPublishedReports(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe('Original headline');
  });

  it('counts this-week claims, published reports, and active fact-checkers', async () => {
    claim('c5', 'external', 'published', new Date().toISOString(), new Date().toISOString());
    report('r5', 'c5', 'external', 'Recent', new Date().toISOString());
    claim('c6', 'submitted', 'processing', null, '2020-01-01T00:00:00Z'); // old, not this week
    raw
      .prepare(`INSERT INTO fact_checkers (id,name,slug,tier,countries,languages,api_endpoint,homepage_url,active) VALUES ('f1','Boom','boom',1,'[]','[]',NULL,'https://x',1)`)
      .run();

    // Active fact-checkers include the migration seed plus the one added above.
    const activeCount = (raw.prepare('SELECT COUNT(*) n FROM fact_checkers WHERE active = 1').get() as { n: number }).n;
    const stats = await getEditorialStats(db);
    expect(stats.reports_this_week).toBe(1);
    expect(stats.claims_this_week).toBe(1); // only c5 is within the week
    expect(stats.fact_checkers).toBe(activeCount);
  });
});
