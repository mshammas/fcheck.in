/**
 * Semantic-matching tests. No Workers AI and no Vectorize: the two bindings are
 * faked, so these cover the threshold decision, the graceful fallback when the
 * bindings are absent, and the matcher's exact → semantic → FTS ordering —
 * against real SQLite (test/d1.ts) for the claim lookups.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { freshDb } from './d1';
import type { ClaimRow } from '../src/lib/types';
import {
  embeddingsAvailable,
  indexClaimVector,
  findSemanticMatch,
  SIMILARITY_THRESHOLD,
  type EmbeddingDeps,
} from '../src/lib/pipeline/embeddings';
import { createSemanticMatcher, hashMatcher } from '../src/lib/pipeline/matcher';

let db: D1Database;
let raw: Database.Database;

beforeEach(() => {
  ({ db, raw } = freshDb());
});

function insertClaim(id: string, canonical_text: string, fingerprint = `fp-${id}`) {
  raw
    .prepare(
      `INSERT INTO claims (id,fingerprint,canonical_text,source_type,status,verdict,confidence,
        submission_count,published_at,promoted_from,promoted_at,last_rechecked_at,created_at)
       VALUES (?, ?, ?, 'submitted','processing',NULL,NULL,1,NULL,NULL,NULL,NULL,'2026-07-01T00:00:00Z')`
    )
    .run(id, fingerprint, canonical_text);
}

/** A fake Workers AI that returns a fixed vector for any text. */
function fakeAi(vector = [0.1, 0.2, 0.3]) {
  return { run: vi.fn(async () => ({ data: [vector] })) } as unknown as Ai;
}

/** A fake Vectorize that returns a preset top match and records upserts. */
function fakeVectorize(top?: { id: string; score: number }) {
  const upserts: { id: string; values: number[] }[] = [];
  const index = {
    query: vi.fn(async () => ({ matches: top ? [top] : [], count: top ? 1 : 0 })),
    upsert: vi.fn(async (vectors: { id: string; values: number[] }[]) => {
      upserts.push(...vectors);
      return { mutationId: 'm1' };
    }),
  };
  return { index: index as unknown as VectorizeIndex, upserts };
}

describe('embeddingsAvailable', () => {
  it('is true only when both bindings are present', () => {
    expect(embeddingsAvailable({})).toBe(false);
    expect(embeddingsAvailable({ ai: fakeAi() })).toBe(false);
    const { index } = fakeVectorize();
    expect(embeddingsAvailable({ ai: fakeAi(), vectorize: index })).toBe(true);
  });
});

describe('indexClaimVector', () => {
  it('is a no-op when bindings are absent', async () => {
    await expect(indexClaimVector({}, 'c1', 'a claim')).resolves.toBeUndefined();
  });

  it('embeds and upserts the claim vector when provisioned', async () => {
    const ai = fakeAi([1, 0, 0]);
    const { index, upserts } = fakeVectorize();
    await indexClaimVector({ ai, vectorize: index }, 'c1', 'a claim');
    expect(upserts).toEqual([{ id: 'c1', values: [1, 0, 0] }]);
  });
});

describe('findSemanticMatch', () => {
  it('returns null when embeddings are not provisioned', async () => {
    insertClaim('c1', 'warm water cures covid');
    expect(await findSemanticMatch({}, db, 'hot water kills the virus')).toBeNull();
  });

  it('returns the matched claim when the score clears the threshold', async () => {
    insertClaim('c1', 'warm water cures covid');
    const deps: EmbeddingDeps = { ai: fakeAi(), vectorize: fakeVectorize({ id: 'c1', score: SIMILARITY_THRESHOLD + 0.05 }).index };
    const match = await findSemanticMatch(deps, db, 'hot water kills the virus');
    expect(match?.id).toBe('c1');
  });

  it('returns null when the top score is below the threshold', async () => {
    insertClaim('c1', 'warm water cures covid');
    const deps: EmbeddingDeps = { ai: fakeAi(), vectorize: fakeVectorize({ id: 'c1', score: SIMILARITY_THRESHOLD - 0.2 }).index };
    expect(await findSemanticMatch(deps, db, 'a totally different claim')).toBeNull();
  });

  it('returns null when the matched vector points at a deleted claim', async () => {
    const deps: EmbeddingDeps = { ai: fakeAi(), vectorize: fakeVectorize({ id: 'ghost', score: 0.99 }).index };
    expect(await findSemanticMatch(deps, db, 'anything')).toBeNull();
  });
});

describe('createSemanticMatcher', () => {
  it('without bindings, matches identically to hashMatcher (exact hash only here)', async () => {
    insertClaim('c1', 'The RBI has banned all cash deposits.', 'fp-shared');
    const matcher = createSemanticMatcher({});
    const fp = await matcher.fingerprint('anything'); // same normalised-hash impl as hashMatcher
    expect(fp).toEqual(await hashMatcher.fingerprint('anything'));

    // Exact fingerprint hit is found the same way with or without embeddings.
    const viaHash = await hashMatcher.findMatch(db, 'x', 'fp-shared');
    const viaSemantic = await matcher.findMatch(db, 'x', 'fp-shared');
    expect(viaSemantic?.id).toBe('c1');
    expect(viaSemantic?.id).toBe(viaHash?.id);
  });

  it('uses the semantic pass for a paraphrase the hash and FTS would miss', async () => {
    insertClaim('c1', 'warm water cures covid');
    const matcher = createSemanticMatcher({
      ai: fakeAi(),
      vectorize: fakeVectorize({ id: 'c1', score: 0.95 }).index,
    });
    // Different wording, different fingerprint → only the embedding pass can match.
    const match = await matcher.findMatch(db, 'drinking hot water kills the virus', 'fp-nonexistent');
    expect(match?.id).toBe('c1');
  });

  it('prefers an exact fingerprint hit over the semantic pass', async () => {
    insertClaim('c1', 'exact claim', 'fp-exact');
    insertClaim('c2', 'semantic claim');
    const matcher = createSemanticMatcher({
      ai: fakeAi(),
      vectorize: fakeVectorize({ id: 'c2', score: 0.99 }).index,
    });
    const match = await matcher.findMatch(db, 'exact claim', 'fp-exact');
    expect(match?.id).toBe('c1'); // exact wins, semantic never consulted
  });
});
