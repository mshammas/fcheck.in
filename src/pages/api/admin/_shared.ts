/**
 * Shared helpers for admin API routes.
 *
 * Auth is already handled by src/middleware.ts before any of these run — it
 * sets `locals.admin`. These helpers just surface it and translate
 * AdminActionError into a response.
 */
import type { APIContext } from 'astro';
import type { AdminUser } from '../../../lib/types';
import { AdminActionError } from '../../../lib/db/admin';
import { canPublish } from '../../../lib/auth';

export function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** The middleware guarantees this is set; the check is a belt-and-braces guard. */
export function adminOf(context: APIContext): AdminUser {
  const admin = context.locals.admin;
  if (!admin) throw new AdminActionError('Admin identity missing.', 401);
  return admin;
}

export function requirePublisher(admin: AdminUser): void {
  if (!canPublish(admin)) {
    throw new AdminActionError('Your role can review drafts but not publish or reject them.', 403);
  }
}

/** Runs an admin action, mapping AdminActionError to its status and anything else to 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AdminActionError) return json({ error: err.message }, err.status);
    console.error('admin action failed', err);
    return json({ error: 'The action could not be completed.' }, 500);
  }
}

export async function readJson(context: APIContext): Promise<Record<string, unknown>> {
  try {
    const body = await context.request.json();
    if (typeof body !== 'object' || body === null) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}
