/**
 * POST /api/v1/tldr — the shareable TL;DRs for a published report.
 *
 * Public, no auth. The share control on a report page calls this once when the
 * user opens it, then builds the WhatsApp/X/copy links client-side. Only
 * published TYPE 1/2 claims have a settled verdict worth sharing; anything else
 * is a 409. Without an API key it returns the deterministic fallback, so the
 * feature works locally and never blocks on Claude.
 */
import type { APIRoute } from 'astro';
import { getDb, getEnv } from '../../../lib/db/client';
import { getClaimById, getPrimaryReport } from '../../../lib/db/claims';
import { getClient, generateTldr } from '../../../lib/providers/anthropic';
import { fallbackTldr, type TldrInput } from '../../../lib/share';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let claimId: string;
  try {
    const body = (await context.request.json()) as { claim_id?: unknown };
    claimId = typeof body.claim_id === 'string' ? body.claim_id.trim() : '';
  } catch {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }
  if (!claimId) return json({ error: 'A claim_id is required.' }, 400);

  const db = getDb();
  const claim = await getClaimById(db, claimId);
  if (!claim) return json({ error: 'That claim no longer exists.' }, 404);

  // Only a live, attributed or reviewed verdict is shareable.
  if (claim.status !== 'published' || (claim.source_type !== 'original' && claim.source_type !== 'external')) {
    return json({ error: 'This claim does not have a published verdict to share yet.' }, 409);
  }

  const report = await getPrimaryReport(db, claimId);
  if (!report) return json({ error: 'No report found for this claim.' }, 404);

  let attributedTo: string | null = null;
  if (claim.source_type === 'external' && report.fact_checker_id) {
    const fc = await db
      .prepare('SELECT name FROM fact_checkers WHERE id = ?')
      .bind(report.fact_checker_id)
      .first<{ name: string }>();
    attributedTo = fc?.name ?? null;
  }

  const input: TldrInput = {
    headline: report.headline,
    summary: report.summary,
    verdict: claim.verdict,
    attributedTo,
  };

  const apiKey = getEnv().ANTHROPIC_API_KEY;
  const tldr = apiKey ? await generateTldr(getClient(apiKey), input) : fallbackTldr(input);

  return json({ tldr }, 200);
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
