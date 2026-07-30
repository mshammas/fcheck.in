/**
 * D1 binding access.
 *
 * Bindings come from the `cloudflare:workers` module rather than
 * `Astro.locals.runtime` — @astrojs/cloudflare v14 runs on
 * @cloudflare/vite-plugin, where `locals` no longer carries `env`.
 *
 * Pure helpers (newId / nowIso / toFtsQuery) live in `./util` so that query
 * modules and background jobs can import them without pulling in this module's
 * `cloudflare:workers` dependency. They are re-exported here for existing
 * callers.
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

export { newId, nowIso, toFtsQuery } from './util';
