/**
 * Gates every admin surface.
 *
 * One place, matched by path prefix, so a new admin page cannot be added
 * without inheriting the check — the failure mode of per-page guards is that
 * someone forgets one.
 */
import { defineMiddleware } from 'astro:middleware';
import { getDb, getEnv } from './lib/db/client';
import { requireAdmin, AuthError } from './lib/auth';

const PROTECTED = ['/admin', '/api/admin'];

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const needsAuth = PROTECTED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (!needsAuth) return next();

  try {
    const identity = await requireAdmin(context.request, getDb(), getEnv());
    context.locals.admin = identity.user;
    return next();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;

    // API callers get JSON; humans get a page explaining what went wrong.
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return new Response(deniedPage(err), {
      status: err.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
});

function deniedPage(err: AuthError): string {
  const heading = err.status === 403 ? 'Not authorised' : 'Sign in required';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} — fcheck.in admin</title>
<style>
  body { font-family: system-ui, sans-serif; background: #F8FAFC; color: #0F172A;
         display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
          padding: 32px; max-width: 420px; box-shadow: 0 4px 12px rgba(0,0,0,.08); }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { font-size: 14px; line-height: 1.65; color: #475569; margin: 0 0 8px; }
  a { color: #0D9488; }
</style></head>
<body><div class="card">
  <h1>${heading}</h1>
  <p>${escapeHtml(err.message)}</p>
  <p>The fcheck.in admin panel is restricted to the editorial team.</p>
  <p><a href="/">← Back to fcheck.in</a></p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
