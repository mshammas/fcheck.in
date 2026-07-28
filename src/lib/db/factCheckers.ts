/**
 * The authenticated fact-checker network — a managed data entity, not a
 * hardcoded list. Admins add, remove and re-tier sources at runtime; these
 * queries always read the current state.
 */
import type { FactCheckerRow, FactCheckerTier } from '../types';

export async function getActiveFactCheckers(db: D1Database): Promise<FactCheckerRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM fact_checkers WHERE active = 1 ORDER BY tier ASC, name ASC')
    .all<FactCheckerRow>();
  return results ?? [];
}

export async function countActiveFactCheckers(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM fact_checkers WHERE active = 1')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getFactCheckerBySlug(
  db: D1Database,
  slug: string
): Promise<FactCheckerRow | null> {
  return db.prepare('SELECT * FROM fact_checkers WHERE slug = ?').bind(slug).first<FactCheckerRow>();
}

/**
 * Resolves a publisher name from an external search result to a known source.
 *
 * The Google Fact Check API reports publishers by site name or domain, which
 * rarely matches our display name exactly ("boomlive.in" vs "Boom Live"). We
 * match on the homepage domain first, then loosely on name.
 *
 * Returns null for publishers not in the network — those results are ranked
 * below known sources rather than discarded, but carry no tier badge.
 */
export function matchFactChecker(
  factCheckers: FactCheckerRow[],
  publisherName: string | undefined,
  publisherSite: string | undefined
): FactCheckerRow | null {
  const site = (publisherSite ?? '').toLowerCase().replace(/^www\./, '');
  const name = (publisherName ?? '').toLowerCase().trim();

  if (site) {
    const byDomain = factCheckers.find((fc) => {
      const host = safeHost(fc.homepage_url);
      return host !== null && (host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`));
    });
    if (byDomain) return byDomain;
  }

  if (name) {
    const byName = factCheckers.find((fc) => {
      const a = fc.name.toLowerCase();
      return a === name || name.includes(a) || a.includes(name);
    });
    if (byName) return byName;
  }

  return null;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Tier 1 outranks Tier 2, which outranks anything outside the network. */
export function tierRank(tier: FactCheckerTier | null): number {
  if (tier === 1) return 0;
  if (tier === 2) return 1;
  return 2;
}

export function parseJsonArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
