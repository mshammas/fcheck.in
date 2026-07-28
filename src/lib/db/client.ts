/**
 * D1 access helpers.
 *
 * Bindings come from the `cloudflare:workers` module rather than
 * `Astro.locals.runtime` — @astrojs/cloudflare v14 runs on
 * @cloudflare/vite-plugin, where `locals` no longer carries `env`.
 *
 * Every query in the app goes through here so the binding lookup and the
 * "binding not configured" failure mode live in one place.
 */
import { env } from 'cloudflare:workers';

export function getDb(): D1Database {
  if (!env.DB) {
    throw new Error(
      'D1 binding "DB" is not available. Check wrangler.jsonc and run `npm run db:migrate`.'
    );
  }
  return env.DB;
}

export function getEnv(): Env {
  return env;
}

/** UUID for new rows. crypto.randomUUID is available in workerd. */
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
