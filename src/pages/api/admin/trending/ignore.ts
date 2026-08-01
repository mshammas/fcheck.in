/**
 * POST /api/admin/trending/ignore — dismiss a candidate from the queue for now.
 * Body: { claim_id }. Not permanent: the candidate returns once a fresh
 * submission of the same story arrives (see ignoreTrendingCandidate).
 *
 * A static route, so it wins over the dynamic `[id].ts` sibling for this path.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db/client';
import { ignoreTrendingCandidate } from '../../../../lib/db/admin';
import { adminOf, handle, json, readJson } from '../_shared';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    const body = await readJson(context);
    const claimId = typeof body.claim_id === 'string' ? body.claim_id : '';
    if (!claimId) return json({ error: 'Missing claim_id.' }, 400);

    await ignoreTrendingCandidate(getDb(), admin, claimId);
    return json({ ignored: true });
  });
