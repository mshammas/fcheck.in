/**
 * POST /api/admin/trending — approve a candidate into the trending queue.
 * Body: { claim_id }. Only published TYPE 1 / TYPE 2 claims are eligible.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db/client';
import { approveTrending } from '../../../../lib/db/admin';
import { adminOf, handle, json, readJson } from '../_shared';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    const body = await readJson(context);
    const claimId = typeof body.claim_id === 'string' ? body.claim_id : '';
    if (!claimId) return json({ error: 'Missing claim_id.' }, 400);

    await approveTrending(getDb(), admin, claimId);
    return json({ approved: true });
  });
