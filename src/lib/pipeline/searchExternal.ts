/**
 * Stage 5 — authenticated fact-checker network search → TYPE 2.
 *
 * External authoritative sources are treated as authoritative: no "preliminary"
 * label, and no AI verdict layered on top of theirs. What we add is
 * normalisation (their rating mapped to our six verdicts, with their original
 * wording kept) and a trust tier.
 *
 * Attribution is not optional. Every TYPE 2 result carries the source name,
 * their verdict, their date, and a link to the original.
 */
import type { FactCheckerRow, Verdict } from '../types';
import { getActiveFactCheckers, matchFactChecker, parseJsonArray, tierRank } from '../db/factCheckers';
import { searchFactChecks, normalizeVerdict, type ExternalReview } from '../providers/googleFactCheck';

export interface ExternalHit {
  review: ExternalReview;
  /** The matching network entry, or null for a publisher outside the network. */
  factChecker: FactCheckerRow | null;
  verdict: Verdict | null;
}

export interface ExternalSearchFilters {
  countries?: string[];
  languages?: string[];
}

/**
 * Returns the best external result plus the runners-up, which the results page
 * shows as "Also reported by".
 */
export async function searchExternal(
  db: D1Database,
  apiKey: string | undefined,
  canonicalText: string,
  filters: ExternalSearchFilters = {}
): Promise<{ best: ExternalHit; others: ExternalHit[] } | null> {
  const [reviews, factCheckers] = await Promise.all([
    searchFactChecks(apiKey, canonicalText, {
      languageCode: filters.languages?.[0],
      pageSize: 10,
    }),
    getActiveFactCheckers(db),
  ]);

  if (reviews.length === 0) return null;

  const hits: ExternalHit[] = reviews.map((review) => ({
    review,
    factChecker: matchFactChecker(factCheckers, review.publisherName, review.publisherSite),
    verdict: normalizeVerdict(review.textualRating),
  }));

  const filtered = applyFilters(hits, filters);
  if (filtered.length === 0) return null;

  // Rank by tier first (Tier 1 > Tier 2 > outside the network), then recency.
  const ranked = filtered.sort((a, b) => {
    const byTier = tierRank(a.factChecker?.tier ?? null) - tierRank(b.factChecker?.tier ?? null);
    if (byTier !== 0) return byTier;
    return dateValue(b.review.reviewDate) - dateValue(a.review.reviewDate);
  });

  return { best: ranked[0]!, others: ranked.slice(1, 5) };
}

/**
 * Country and language filters narrow by the *source's* coverage, per the
 * homepage filter spec — language filters the report returned, not the input.
 * A publisher outside the network has no declared coverage, so it is kept
 * rather than dropped; ranking already places it last.
 */
function applyFilters(hits: ExternalHit[], filters: ExternalSearchFilters): ExternalHit[] {
  const { countries, languages } = filters;
  if (!countries?.length && !languages?.length) return hits;

  return hits.filter(({ factChecker, review }) => {
    if (!factChecker) return true;

    if (countries?.length) {
      const covered = parseJsonArray(factChecker.countries);
      if (covered.length && !covered.some((c) => countries.includes(c))) return false;
    }

    if (languages?.length) {
      const spoken = parseJsonArray(factChecker.languages);
      const reviewLang = review.languageCode?.split('-')[0];
      const matchesSource = spoken.length === 0 || spoken.some((l) => languages.includes(l));
      const matchesReview = !reviewLang || languages.includes(reviewLang);
      if (!matchesSource && !matchesReview) return false;
    }

    return true;
  });
}

function dateValue(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
