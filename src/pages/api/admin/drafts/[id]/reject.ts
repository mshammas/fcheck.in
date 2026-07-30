/**
 * POST /api/admin/drafts/:id/reject — reject a draft (duplicate, low interest,
 * etc.). Publisher roles only. No subscriber notification is sent on rejection.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../../lib/db/client';
import { rejectDraft } from '../../../../../lib/db/admin';
import { adminOf, requirePublisher, handle, json, readJson } from '../../_shared';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    requirePublisher(admin);

    const claimId = context.params.id;
    if (!claimId) return json({ error: 'Missing claim id.' }, 400);

    const body = await readJson(context);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    await rejectDraft(getDb(), admin, claimId, reason);
    return json({ rejected: true });
  });
