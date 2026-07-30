/**
 * POST /api/admin/drafts/:id/publish — promote a reviewed draft to TYPE 1.
 *
 * The only route in the system that produces an fcheck.in original. Publisher
 * roles only (super_admin, editor).
 */
import type { APIRoute } from 'astro';
import { getDb, getEnv } from '../../../../../lib/db/client';
import { publishDraft } from '../../../../../lib/db/admin';
import { notifyClaimSubscribers } from '../../../../../lib/notify';
import { emailConfigFromEnv } from '../../../../../lib/notify/email';
import { adminOf, requirePublisher, handle, json } from '../../_shared';

export const prerender = false;

export const POST: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    requirePublisher(admin);

    const claimId = context.params.id;
    if (!claimId) return json({ error: 'Missing claim id.' }, 400);

    const db = getDb();
    const result = await publishDraft(db, admin, claimId);

    // TYPE 3 → 1: the claim now has a reviewed verdict. Tell its subscribers.
    // Delivery is best-effort — a send failure must not fail the publish, which
    // has already committed.
    const notified = await notifyClaimSubscribers(db, { email: emailConfigFromEnv(getEnv()) }, claimId).catch(
      (err) => {
        console.error('publish notification failed', err);
        return null;
      }
    );

    return json({ published: true, url: `/article/${result.slug}`, ...result, notified });
  });
