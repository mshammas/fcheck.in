/**
 * Pure DB helpers with no runtime coupling.
 *
 * These are deliberately split out from `client.ts` (which imports
 * `cloudflare:workers` for the binding lookup). Query modules and the
 * background jobs import from here instead, so they carry no Workers-runtime
 * dependency and run unchanged under vitest's plain-Node environment.
 */

/** UUID for new rows. crypto.randomUUID is available in workerd and Node 20+. */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Escapes a user string for an FTS5 MATCH query.
 *
 * FTS5 treats characters like `"`, `*`, `-`, `(` and `:` as operators, so raw
 * user text can throw a syntax error or silently mean something else. Wrapping
 * each token in double quotes makes every token a literal phrase.
 */
export function toFtsQuery(text: string, { or = false } = {}): string {
  const tokens = text
    .toLowerCase()
    .replace(/["]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2)
    .slice(0, 24);

  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(or ? ' OR ' : ' ');
}

/** Common English stopwords — dropped when reducing a claim to its key terms.
 *  Deliberately short: enough to strip filler, not a full linguistic list. */
const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'was', 'were', 'are', 'has', 'have', 'had', 'for',
  'with', 'from', 'not', 'but', 'you', 'your', 'their', 'they', 'them', 'she', 'him',
  'her', 'his', 'its', 'our', 'who', 'what', 'when', 'where', 'why', 'how', 'did',
  'does', 'been', 'being', 'about', 'into', 'over', 'than', 'then', 'there', 'here',
  'will', 'would', 'could', 'should', 'can', 'said', 'says', 'say', 'get', 'got',
]);

/** Framing/question lead-ins people wrap around a claim. Stripped so the stored
 *  claim and the search query are the assertion itself, not the packaging. */
const FRAMING_RE =
  /^(is it true that|is it true|did you know that|did you know|fact check:?|fact-check:?|true or false:?|i heard that|i heard|apparently|breaking:?|rumou?r:?|claim:?)\s+/i;

/**
 * Reduces a raw submission to a concise, human-readable claim for the no-AI path.
 *
 * Strips the question/framing packaging and trailing punctuation and collapses
 * whitespace, but keeps real words — this text is both stored and displayed for
 * a TYPE 4 claim, so it must stay readable (contrast with `keywordsOf`, which is
 * for machine matching only).
 */
export function cleanClaim(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  // Peel off stacked lead-ins ("Is it true that did you know…").
  let prev: string;
  do {
    prev = out;
    out = out.replace(FRAMING_RE, '').trim();
  } while (out !== prev && out.length > 0);
  return out.replace(/[?!.]+$/g, '').trim() || text.trim();
}

/**
 * The set of salient lowercased terms in a piece of text, stopwords removed.
 *
 * Used to score how well a feed item or search-result title matches the claim —
 * a pure token-overlap signal, no AI. Tokens of two characters or fewer are
 * dropped along with stopwords.
 */
export function keywordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}
