/**
 * Stage 1 — ingestion and normalisation.
 *
 * Every channel's input converges here and leaves as one unified claim package.
 * A caption on an image is not a separate claim from the image: all components
 * of a submission are combined and analysed together.
 *
 * M1 scope: text and URLs are fully processed. Media is accepted, recorded, and
 * flagged — OCR, transcription, and frame extraction land in M2.
 */
import type { CheckRequest } from '../types';

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

export interface NormalizedInput {
  /** Everything textual, combined — what stages 2 onward actually read. */
  combinedText: string;
  /** URLs found anywhere in the submission, deduplicated. */
  urls: string[];
  /** Detected content types, for the UI chips and for the submission record. */
  detectedTypes: string[];
  /** Human-readable caveats to surface on the result. */
  notes: string[];
  /** True when the submission carries media we cannot yet analyse. */
  hasUnprocessedMedia: boolean;
}

/** How much of a fetched page we keep. Enough for context, bounded for cost. */
const MAX_FETCHED_CHARS = 6000;
const FETCH_TIMEOUT_MS = 8000;

export async function normalize(request: CheckRequest): Promise<NormalizedInput> {
  const notes: string[] = [];
  const detectedTypes: string[] = [];
  const parts: string[] = [];

  const rawText = (request.text ?? '').trim();

  // URLs embedded in pasted text are extracted and processed alongside it —
  // the surrounding text is never discarded.
  const inlineUrls = rawText.match(URL_RE) ?? [];
  const urls = [...new Set([...inlineUrls, ...(request.urls ?? [])])];

  const textWithoutUrls = rawText.replace(URL_RE, '').trim();
  if (textWithoutUrls) {
    detectedTypes.push('text');
    parts.push(textWithoutUrls);
  }

  if (urls.length > 0) {
    detectedTypes.push('url');
    const fetched = await Promise.all(urls.map(fetchReadableText));
    fetched.forEach((result, i) => {
      if (result.text) {
        parts.push(`[Content of ${urls[i]}]\n${result.text}`);
      } else {
        notes.push(`Could not read ${urls[i]}${result.reason ? ` — ${result.reason}` : ''}.`);
        parts.push(`[Linked URL, content unavailable: ${urls[i]}]`);
      }
    });
  }

  const files = request.files ?? [];
  const hasUnprocessedMedia = files.length > 0;
  if (hasUnprocessedMedia) {
    for (const file of files) {
      const kind = file.type.split('/')[0] || 'document';
      if (!detectedTypes.includes(kind)) detectedTypes.push(kind);
    }
    notes.push(
      `${files.length} attached file${files.length > 1 ? 's were' : ' was'} recorded but not analysed — ` +
        'image, video, audio and document analysis is not yet available.'
    );
    parts.push(`[Attached, not yet analysed: ${files.map((f) => f.name).join(', ')}]`);
  }

  return {
    combinedText: parts.join('\n\n').trim(),
    urls,
    detectedTypes,
    notes,
    hasUnprocessedMedia,
  };
}

/**
 * Fetches a URL and strips it to readable text.
 *
 * Deliberately simple: no headless browser, no readability heuristics beyond
 * removing script/style/nav. A JS-rendered page yields little, which is why the
 * original URL always stays in the claim record for a human to open.
 */
async function fetchReadableText(url: string): Promise<{ text: string | null; reason?: string }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'fcheck.in/0.1 (+https://fcheck.in) fact-check bot',
        accept: 'text/html,application/xhtml+xml,text/plain',
      },
    });

    if (!res.ok) return { text: null, reason: `HTTP ${res.status}` };

    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(contentType)) {
      return { text: null, reason: `unsupported content type ${contentType.split(';')[0]}` };
    }

    const html = await res.text();
    const text = stripHtml(html);
    return { text: text.slice(0, MAX_FETCHED_CHARS) || null };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'fetch failed';
    return { text: null, reason };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
