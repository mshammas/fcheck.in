/**
 * POST /api/admin/drafts/:id/publish — promote a reviewed draft to TYPE 1.
 *
 * The only route in the system that produces an fcheck.in original. Publisher
 * roles only (super_admin, editor).
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../../lib/db/client';
import { publishDraft } from '../../../../../lib/db/admin';
import { adminOf, requirePublisher, handle, json } from '../../_shared';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    requirePublisher(admin);

    const claimId = context.params.id;
    if (!claimId) return json({ error: 'Missing claim id.' }, 400);

    const result = await publishDraft(getDb(), admin, claimId);
    return json({ published: true, url: `/article/${result.slug}`, ...result });
  });
