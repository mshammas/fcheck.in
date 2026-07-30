/**
 * Editorial-mode helpers — pure mapping used by the homepage's editorial view
 * (src/pages/index.astro) to group published reports for the sidebar filters.
 *
 * Kept free of any DB or runtime coupling so both the page (server render) and
 * the client-side filter script can rely on the same category/region logic, and
 * so it is unit-tested without a database.
 */

export const REGIONS = ['Global', 'South Asia', 'Middle East', 'Africa', 'Europe', 'Americas', 'East Asia'] as const;
export type Region = (typeof REGIONS)[number];

// A pragmatic ISO 3166 alpha-2 → region map. Not exhaustive — anything unmapped
// (or a null country) falls back to Global, which is also the "all" filter.
const COUNTRY_REGION: Record<string, Region> = {
  IN: 'South Asia', PK: 'South Asia', BD: 'South Asia', LK: 'South Asia', NP: 'South Asia',
  AE: 'Middle East', SA: 'Middle East', QA: 'Middle East', IL: 'Middle East', IR: 'Middle East', TR: 'Middle East', EG: 'Middle East',
  NG: 'Africa', ZA: 'Africa', KE: 'Africa', ET: 'Africa', GH: 'Africa',
  GB: 'Europe', FR: 'Europe', DE: 'Europe', ES: 'Europe', IT: 'Europe', NL: 'Europe', SE: 'Europe',
  US: 'Americas', CA: 'Americas', BR: 'Americas', MX: 'Americas', AR: 'Americas',
  CN: 'East Asia', JP: 'East Asia', KR: 'East Asia', TW: 'East Asia', HK: 'East Asia',
};

export function regionForCountry(code: string | null | undefined): Region {
  if (!code) return 'Global';
  return COUNTRY_REGION[code.toUpperCase()] ?? 'Global';
}

/** The category pills, each with the tag keywords that map a report to it. */
export const CATEGORIES = [
  { label: 'Politics', keywords: ['politic', 'election', 'government', 'policy', 'minister'] },
  { label: 'Health & Medicine', keywords: ['health', 'medic', 'vaccine', 'covid', 'disease', 'drug', 'virus'] },
  { label: 'Science', keywords: ['science', 'research', 'space', 'study'] },
  { label: 'Social Media', keywords: ['social', 'viral', 'whatsapp', 'video', 'post', 'meme'] },
  { label: 'Finance', keywords: ['financ', 'money', 'tax', 'bank', 'economy', 'crypto', 'rupee', 'rbi'] },
  { label: 'Religion', keywords: ['religio', 'temple', 'church', 'mosque', 'faith'] },
  { label: 'Environment', keywords: ['environment', 'climate', 'pollution', 'weather', 'flood'] },
  { label: 'Technology', keywords: ['tech', 'ai ', 'artificial intelligence', '5g', 'app', 'cyber'] },
] as const;

export const CATEGORY_LABELS: readonly string[] = CATEGORIES.map((c) => c.label);

/** The category labels a report's tags map to — a report can match several. */
export function categoriesForTags(tags: string[]): string[] {
  const hay = ` ${tags.join(' ').toLowerCase()} `;
  return CATEGORIES.filter((c) => c.keywords.some((k) => hay.includes(k))).map((c) => c.label);
}
