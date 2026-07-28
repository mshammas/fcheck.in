/**
 * GET /api/v1/trending — the current trending queue.
 *
 * Pinned cards first, then unexpired queue cards in admin-set order. Only
 * TYPE 1 and TYPE 2 are eligible for the queue, so nothing preliminary or
 * unreviewed can surface here.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db/client';
import { getTrending } from '../../../lib/db/claims';
import { TYPE_NUMBER, type SourceType } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const db = getDb();
  const limitParam = Number(new URL(context.request.url).searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 24) : 12;

  const rows = await getTrending(db, limit);

  const cards = rows.map((row) => {
    const r = row as Record<string, unknown>;
    const sourceType = r.source_type as SourceType;
    return {
      claim_id: r.claim_id,
      type: TYPE_NUMBER[sourceType],
      source_type: sourceType,
      verdict: r.verdict,
      headline: r.headline,
      published_at: r.published_at,
      country: r.country,
      pinned: r.pinned === 1,
      // Only originals live at /article/[slug]; externals go to their TYPE 2 page.
      url: sourceType === 'original' && r.slug ? `/article/${r.slug}` : `/check/${r.claim_id}`,
      attribution: r.fact_checker_name
        ? { name: r.fact_checker_name, tier: r.fact_checker_tier, url: r.external_url }
        : null,
    };
  });

  return new Response(JSON.stringify({ cards }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Short cache: the queue rotates on a 48h cycle, not per second.
      'cache-control': 'public, max-age=60',
    },
  });
};
