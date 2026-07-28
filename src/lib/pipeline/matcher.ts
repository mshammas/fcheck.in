/**
 * Stage 3 — claim fingerprinting and cache check.
 *
 * Every claim entering the pipeline is persisted, and a repeat submission of
 * the same claim is served from the database instead of being reprocessed.
 *
 * ## Known limitation (M1)
 *
 * CLAUDE.md specifies embedding-based similarity, so that "warm water cures
 * covid" and "drinking hot water kills the virus" resolve to one record. This
 * implementation does exact matching on a normalised SHA-256 hash, plus FTS5
 * keyword search as a second pass. Semantically identical claims with different
 * wording will produce separate records until Workers AI embeddings + Vectorize
 * land behind this same interface.
 *
 * Keep new code talking to `ClaimMatcher`, not to the hash directly.
 */
import type { ClaimRow } from '../types';
import { getClaimByFingerprint } from '../db/claims';
import { toFtsQuery } from '../db/client';

export interface ClaimMatcher {
  /** Stable identifier for a claim's meaning. */
  fingerprint(canonicalText: string): Promise<string>;
  /** Finds an existing claim this submission should be folded into. */
  findMatch(db: D1Database, canonicalText: string, fingerprint: string): Promise<ClaimRow | null>;
}

/**
 * Normalises before hashing so trivial differences — casing, punctuation,
 * whitespace, a trailing "!!!" — don't fork a claim into two records.
 */
function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashMatcher: ClaimMatcher = {
  async fingerprint(canonicalText) {
    return sha256(normalizeForHash(canonicalText));
  },

  async findMatch(db, canonicalText, fingerprint) {
    const exact = await getClaimByFingerprint(db, fingerprint);
    if (exact) return exact;

    // Second pass: FTS5 over stored claim text. Catches near-identical wording
    // that the hash missed, without pretending to be semantic search.
    const query = toFtsQuery(canonicalText);
    if (!query) return null;

    const row = await db
      .prepare(
        `SELECT c.* FROM claims_fts f
         JOIN claims c ON c.rowid = f.rowid
         WHERE claims_fts MATCH ?
         ORDER BY rank
         LIMIT 1`
      )
      .bind(query)
      .first<ClaimRow & { score?: number }>()
      .catch(() => null); // malformed FTS query → treat as no match, never a 500

    if (!row) return null;

    // Require substantial token overlap before folding two claims together —
    // FTS rank alone will happily return a loosely related article.
    return tokenOverlap(canonicalText, row.canonical_text) >= 0.75 ? row : null;
  },
};

function tokenOverlap(a: string, b: string): number {
  const setA = new Set(normalizeForHash(a).split(' ').filter((t) => t.length > 2));
  const setB = new Set(normalizeForHash(b).split(' ').filter((t) => t.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / Math.min(setA.size, setB.size);
}
