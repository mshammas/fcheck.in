/**
 * DELETE /api/admin/trending/:id — remove a card from the queue.
 * PATCH  /api/admin/trending/:id — pin or unpin a card. Body: { pinned: bool }.
 *
 * `:id` is the trending_card id, not the claim id.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db/client';
import { removeTrending, setPinned } from '../../../../lib/db/admin';
import { adminOf, handle, json, readJson } from '../_shared';

export const prerender = false;

export const DELETE: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    const cardId = context.params.id;
    if (!cardId) return json({ error: 'Missing card id.' }, 400);

    await removeTrending(getDb(), admin, cardId);
    return json({ removed: true });
  });

export const PATCH: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    const cardId = context.params.id;
    if (!cardId) return json({ error: 'Missing card id.' }, 400);

    const body = await readJson(context);
    if (typeof body.pinned !== 'boolean') {
      return json({ error: 'Body must include a boolean "pinned".' }, 400);
    }

    await setPinned(getDb(), admin, cardId, body.pinned);
    return json({ pinned: body.pinned });
  });
