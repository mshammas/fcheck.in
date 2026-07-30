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
