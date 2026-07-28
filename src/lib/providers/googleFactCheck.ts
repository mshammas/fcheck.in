/**
 * Google Fact Check Tools API — the first call in every external search.
 *
 * It indexes ClaimReview markup from 100+ publishers, which covers most of the
 * authenticated network in one request. Per-source crawlers are additive on top
 * of this, not a replacement for it.
 *
 * https://developers.google.com/fact-check/tools/api
 */

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

interface GoogleClaimReview {
  publisher?: { name?: string; site?: string };
  url?: string;
  title?: string;
  reviewDate?: string;
  textualRating?: string;
  languageCode?: string;
}

interface GoogleClaim {
  text?: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: GoogleClaimReview[];
}

interface GoogleResponse {
  claims?: GoogleClaim[];
}

/** One external fact-check, flattened from Google's nested shape. */
export interface ExternalReview {
  claimText: string;
  publisherName: string;
  publisherSite: string;
  url: string;
  title: string;
  reviewDate: string | null;
  /** The publisher's own wording, e.g. "Pants on Fire", "Mostly false". */
  textualRating: string;
  languageCode: string | null;
}

export interface FactCheckSearchOptions {
  languageCode?: string;
  maxAgeDays?: number;
  pageSize?: number;
}

export async function searchFactChecks(
  apiKey: string | undefined,
  query: string,
  options: FactCheckSearchOptions = {}
): Promise<ExternalReview[]> {
  if (!apiKey) {
    throw new Error(
      'GOOGLE_FACT_CHECK_API_KEY is not set. Add it to .dev.vars (local) or `wrangler secret put` (deployed).'
    );
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(options.pageSize ?? 10));
  if (options.languageCode) url.searchParams.set('languageCode', options.languageCode);
  if (options.maxAgeDays) url.searchParams.set('maxAgeDays', String(options.maxAgeDays));

  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Fact Check API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as GoogleResponse;

  return (data.claims ?? []).flatMap((claim) =>
    (claim.claimReview ?? [])
      .filter((review) => typeof review.url === 'string' && review.url.length > 0)
      .map<ExternalReview>((review) => ({
        claimText: claim.text ?? '',
        publisherName: review.publisher?.name ?? 'Unknown publisher',
        publisherSite: review.publisher?.site ?? '',
        url: review.url!,
        title: review.title ?? claim.text ?? 'Fact check',
        reviewDate: review.reviewDate ?? null,
        textualRating: review.textualRating ?? '',
        languageCode: review.languageCode ?? null,
      }))
  );
}

/**
 * Maps a publisher's own rating wording onto our six standard verdicts.
 *
 * Publishers use wildly different scales ("Pants on Fire", "Four Pinocchios",
 * "Mixture"). We normalise so users see one consistent vocabulary — but the
 * publisher's original wording is always displayed alongside, so nothing is
 * lost in translation.
 *
 * Returns null when the rating doesn't map cleanly. A null verdict shows the
 * external rating verbatim rather than guessing.
 */
export function normalizeVerdict(rating: string): import('../types').Verdict | null {
  const r = rating.toLowerCase().trim();
  if (!r) return null;

  // Order matters: "not true" and "mostly false" must not match the TRUE branch.
  if (/\b(satire|parody|humou?r)\b/.test(r)) return 'SATIRE';
  if (/\b(outdated|out of date|no longer( true| accurate)?)\b/.test(r)) return 'OUTDATED';
  if (/\b(misleading|mixture|half[- ]true|partly (true|false)|mostly false|exaggerat|missing context|cherry)\b/.test(r))
    return 'MISLEADING';
  if (/\b(false|fake|incorrect|pants on fire|debunk|hoax|fabricat|not true|untrue)\b/.test(r)) return 'FALSE';
  if (/\b(unproven|unverifi|unsubstantiat|no evidence|insufficient|research in progress)\b/.test(r))
    return 'UNVERIFIABLE';
  if (/\b(true|accurate|correct|confirmed|mostly true|verified)\b/.test(r)) return 'TRUE';

  return null;
}
