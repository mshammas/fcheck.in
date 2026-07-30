/**
 * POST /api/jobs/:job — run a background job.
 *
 * This is the real execution surface for the jobs: the cron scheduler worker
 * (workers/cron/) fires these on a schedule, and an operator can run one
 * manually. It is guarded by a shared `CRON_SECRET` bearer token, not by admin
 * Access — the caller is a machine, not a person.
 *
 * These routes are deliberately outside the `/api/admin` prefix so the admin
 * middleware does not gate them; the secret check below is their only gate.
 */
import type { APIRoute } from 'astro';
import { getDb, getEnv } from '../../../lib/db/client';
import { runJob, isJobName } from '../../../lib/jobs';
import { emailConfigFromEnv } from '../../../lib/notify/email';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const env = getEnv();

  const configured = env.CRON_SECRET;
  if (!configured) {
    // Fail closed: with no secret set, the endpoint is inert rather than open.
    return json({ error: 'Jobs are not enabled — CRON_SECRET is not configured.' }, 503);
  }

  if (!bearerMatches(context.request, configured)) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const name = context.params.job ?? '';
  if (!isJobName(name)) {
    return json({ error: `Unknown job "${name}".` }, 404);
  }

  try {
    const summary = await runJob(name, getDb(), {
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      googleFactCheckApiKey: env.GOOGLE_FACT_CHECK_API_KEY,
      email: emailConfigFromEnv(env),
    });
    return json({ job: name, ran_at: new Date().toISOString(), summary }, 200);
  } catch (err) {
    console.error(`job ${name} failed`, err);
    return json({ error: err instanceof Error ? err.message : 'Job failed.' }, 500);
  }
};

/** Constant-time-ish bearer comparison. */
function bearerMatches(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
