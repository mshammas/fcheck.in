/**
 * Semantic claim fingerprinting — the embedding half of stage 3.
 *
 * The Bible asks that "warm water cures covid" and "drinking hot water kills the
 * virus" fold into one record. A SHA-256 of normalised text can't do that (the
 * strings differ); FTS5 catches near-identical wording but not paraphrase. This
 * module adds meaning-based matching: each claim is embedded (Workers AI) and
 * stored in a Vectorize index keyed by claim id, and an incoming claim is
 * matched to the nearest stored one above a cosine threshold.
 *
 * ## Provisioning (a human-only step — see docs/setup.md)
 *
 * This needs two bindings that are NOT provisioned by default: `AI` (Workers AI)
 * and `CLAIM_VECTORS` (a Vectorize index). Until they exist, every function here
 * is a graceful no-op — `indexClaimVector` stores nothing and `findSemanticMatch`
 * returns null — so the pipeline falls back to today's hash + FTS matching with
 * no error. Nothing here can break the running system before the index is live.
 */
import type { ClaimRow } from '../types';
import { getClaimById } from '../db/claims';

/** The embedding model. 768-dim; the Vectorize index must be created to match. */
export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBED_DIMENSIONS = 768;

/**
 * Cosine similarity above which two claims are treated as the same claim.
 * Deliberately high: merging two *different* claims hides one from the world,
 * which is worse than keeping a paraphrase as its own record. Tune with real
 * traffic once the index is live.
 */
export const SIMILARITY_THRESHOLD = 0.88;

/** The two bindings semantic matching needs. Absent → every op is a no-op. */
export interface EmbeddingDeps {
  ai?: Ai;
  vectorize?: VectorizeIndex | Vectorize;
}

export function embeddingsAvailable(deps: EmbeddingDeps): boolean {
  return Boolean(deps.ai && deps.vectorize);
}

/** Embeds one string. Returns null on any failure so callers fall back, never throw. */
export async function embed(ai: Ai, text: string): Promise<number[] | null> {
  try {
    const out = (await ai.run(EMBED_MODEL, { text: [text] })) as { data?: number[][] };
    const vector = out.data?.[0];
    return Array.isArray(vector) && vector.length > 0 ? vector : null;
  } catch (err) {
    console.error('embedding call failed', err);
    return null;
  }
}

/**
 * Stores a claim's vector so future submissions can match it. Best-effort: a
 * failed upsert leaves the claim matchable by hash + FTS, just not semantically.
 * Vectorize upserts are async/eventually-consistent, so a brand-new claim may
 * not be queryable for a moment — the exact-hash pass covers immediate repeats.
 */
export async function indexClaimVector(deps: EmbeddingDeps, claimId: string, canonicalText: string): Promise<void> {
  if (!deps.ai || !deps.vectorize) return;
  const vector = await embed(deps.ai, canonicalText);
  if (!vector) return;
  try {
    await deps.vectorize.upsert([{ id: claimId, values: vector }]);
  } catch (err) {
    console.error(`vector upsert failed for ${claimId}`, err);
  }
}

/**
 * Finds the stored claim whose meaning is closest to `canonicalText`, if it is
 * similar enough to be the same claim. Returns null when embeddings aren't
 * provisioned, the match is too weak, or the matched vector's claim has since
 * been deleted.
 */
export async function findSemanticMatch(deps: EmbeddingDeps, db: D1Database, canonicalText: string): Promise<ClaimRow | null> {
  if (!deps.ai || !deps.vectorize) return null;

  const vector = await embed(deps.ai, canonicalText);
  if (!vector) return null;

  let top: { id: string; score: number } | undefined;
  try {
    const res = await deps.vectorize.query(vector, { topK: 1 });
    top = res.matches?.[0];
  } catch (err) {
    console.error('vector query failed', err);
    return null;
  }

  if (!top || top.score < SIMILARITY_THRESHOLD) return null;
  return getClaimById(db, top.id);
}
