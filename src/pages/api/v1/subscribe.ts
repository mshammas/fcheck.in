/**
 * POST /api/v1/subscribe — ask to be notified when a claim gets a verdict.
 *
 * Public, no auth — the same audience as /api/v1/check. Records a subscriber on
 * an unresolved claim (TYPE 3/4); the notification service (src/lib/notify)
 * delivers when a promotion or publish gives the claim a verdict. Email is
 * delivered today; WhatsApp is accepted and stored for when the bot channels
 * ship.
 */
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db/client';
import { subscribe, SubscribeError } from '../../../lib/db/subscribers';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  let body: Record<string, unknown>;
  try {
    const parsed = await context.request.json();
    if (typeof parsed !== 'object' || parsed === null) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }

  const claimId = typeof body.claim_id === 'string' ? body.claim_id.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
  if (!claimId) return json({ error: 'A claim_id is required.' }, 400);
  if (!contact) return json({ error: 'Enter an email address or phone number.' }, 400);

  try {
    const result = await subscribe(getDb(), { claimId, contact });
    const message =
      result.notify_via === 'email'
        ? "You're on the list — we'll email you when there's a verdict."
        : "You're on the list — we'll message you on WhatsApp once that channel is live.";
    return json({ subscribed: true, notify_via: result.notify_via, already: result.already, message }, 200);
  } catch (err) {
    if (err instanceof SubscribeError) return json({ error: err.message }, err.status);
    console.error('subscribe failed', err);
    return json({ error: 'Could not save your subscription. Please try again.' }, 500);
  }
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
