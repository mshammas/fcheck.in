/**
 * GET /api/v1/claims/:id — retrieve a claim's current state.
 *
 * Always reflects the claim's current source_type. A user returning via a
 * notification link sees the promoted TYPE, never a stale one.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db/client';
import { getClaimById, getPrimaryReport, getReportsForClaim } from '../../../../lib/db/claims';
import { TYPE_NUMBER, parseEvidence, parseTags } from '../../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const id = context.params.id;
  if (!id) return json({ error: 'Missing claim id.' }, 400);

  const db = getDb();
  const claim = await getClaimById(db, id);
  if (!claim) return json({ error: 'Claim not found.' }, 404);

  const [primary, all] = await Promise.all([getPrimaryReport(db, id), getReportsForClaim(db, id)]);

  let attribution = null;
  if (primary?.fact_checker_id) {
    const fc = await db
      .prepare('SELECT name, slug, homepage_url, tier FROM fact_checkers WHERE id = ?')
      .bind(primary.fact_checker_id)
      .first<{ name: string; slug: string; homepage_url: string; tier: 1 | 2 }>();
    if (fc) {
      attribution = {
        name: fc.name,
        slug: fc.slug,
        url: primary.external_url ?? fc.homepage_url,
        tier: fc.tier,
        published_at: primary.published_at,
      };
    }
  }

  return json(
    {
      claim_id: claim.id,
      source_type: claim.source_type,
      type: TYPE_NUMBER[claim.source_type],
      status: claim.status,
      verdict: claim.verdict,
      confidence: claim.confidence,
      canonical_text: claim.canonical_text,
      submission_count: claim.submission_count,
      published_at: claim.published_at,
      promoted_from: claim.promoted_from,
      promoted_at: claim.promoted_at,
      created_at: claim.created_at,
      provisional: claim.source_type === 'preliminary',
      report: primary
        ? {
            headline: primary.headline,
            summary: primary.summary,
            body: primary.body,
            evidence: parseEvidence(primary.evidence),
            tags: parseTags(primary.tags),
            country: primary.country,
            language: primary.language,
            external_url: primary.external_url,
            slug: primary.slug,
          }
        : null,
      attribution,
      // Superseded reports stay visible as "Also reported by" — external work
      // is never hidden once an fcheck.in original supersedes it.
      also_reported_by: all
        .filter((r) => r.id !== primary?.id && r.report_type === 'external')
        .map((r) => ({ headline: r.headline, url: r.external_url, published_at: r.published_at })),
    },
    200
  );
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
