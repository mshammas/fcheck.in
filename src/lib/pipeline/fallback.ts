/**
 * Static failover for stage 2 (claim extraction).
 *
 * When Claude is unavailable — the API key is unset, or a call fails at runtime
 * (rate limit, overload, timeout) — we still want stages 3–5 (cache, internal
 * DB, external fact-checker network) to run, because none of them need AI. That
 * only requires a canonical text to search on, so this builds one deterministically
 * from the normalised input, with zero network and zero AI.
 *
 * This mirrors `fallbackTldr` (src/lib/share.ts): a deterministic backup that
 * produces exactly the shape the AI path returns, so the caller is agnostic to
 * which one ran.
 */
import type { ExtractedClaim } from '../providers/anthropic';

/** Marker labels normalize inserts around fetched/attached content. We strip the
 *  labels (they are scaffolding, not claim text) but keep the content lines. */
const MARKER_LINE = /^\[(Content of|Attached|Linked URL)[^\]]*\]\s*$/gim;
/** Longer than this and it stops being a claim and starts being a document; the
 *  search stages only need a representative query. */
const MAX_CANONICAL_CHARS = 500;

/**
 * Deterministic stand-in for `extractClaim` when Claude can't be reached.
 *
 * No AI means we can't split assertions, detect country/language, or judge
 * checkability — so those default conservatively (`is_checkable: true` keeps the
 * search stages running; the missing verdict is handled downstream as TYPE 4).
 */
export function staticExtract(combinedText: string): ExtractedClaim {
  const canonical = combinedText
    .replace(MARKER_LINE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CANONICAL_CHARS)
    .trim();

  return {
    canonical_text: canonical,
    assertions: [],
    country: null,
    language: null,
    is_checkable: true,
  };
}
