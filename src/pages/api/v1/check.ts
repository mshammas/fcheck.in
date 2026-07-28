/**
 * POST /api/v1/check — submit a claim for fact-checking.
 *
 * Public, no auth. Every channel (web, bots, extension, API) lands here or on
 * a channel webhook that calls the same pipeline.
 */
import type { APIRoute } from 'astro';
import type { CheckRequest, Channel } from '../../../lib/types';
import { getDb, getEnv } from '../../../lib/db/client';
import { runPipeline, PipelineError } from '../../../lib/pipeline';

export const prerender = false;

const CHANNELS: Channel[] = ['web', 'whatsapp', 'telegram', 'email', 'extension', 'api'];

const MAX_TEXT_LENGTH = 20_000;
const MAX_URLS = 10;
const MAX_FILES = 10;

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }

  let request: CheckRequest;
  try {
    request = validate(body);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Invalid request.' }, 400);
  }

  try {
    const env = getEnv();
    const result = await runPipeline(
      {
        db: getDb(),
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        googleFactCheckApiKey: env.GOOGLE_FACT_CHECK_API_KEY,
        origin: new URL(context.request.url).origin,
      },
      request
    );

    return json(result, 200);
  } catch (err) {
    if (err instanceof PipelineError) return json({ error: err.message }, err.status);
    console.error('check failed', err);
    return json({ error: 'The check could not be completed. Please try again.' }, 500);
  }
};

function validate(body: unknown): CheckRequest {
  if (typeof body !== 'object' || body === null) throw new Error('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;

  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text is too long — the limit is ${MAX_TEXT_LENGTH.toLocaleString()} characters.`);
  }

  const urls = toStringArray(b.urls, MAX_URLS, 'urls').filter((u) => /^https?:\/\//i.test(u));

  const files = Array.isArray(b.files)
    ? b.files.slice(0, MAX_FILES).map((f) => {
        const file = f as Record<string, unknown>;
        return {
          name: String(file.name ?? 'file'),
          type: String(file.type ?? 'application/octet-stream'),
          size: Number(file.size ?? 0),
        };
      })
    : [];

  if (!text && urls.length === 0 && files.length === 0) {
    throw new Error('Nothing to check. Send text, a URL, or a file.');
  }

  const channel = typeof b.channel === 'string' && CHANNELS.includes(b.channel as Channel)
    ? (b.channel as Channel)
    : 'web';

  return {
    text,
    urls,
    files,
    channel,
    countries: toStringArray(b.countries, 10, 'countries'),
    languages: toStringArray(b.languages, 10, 'languages'),
  };
}

function toStringArray(value: unknown, max: number, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`"${field}" must be an array.`);
  return value.filter((v): v is string => typeof v === 'string').slice(0, max);
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
