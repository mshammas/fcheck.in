/**
 * Stage 1 — ingestion and normalisation.
 *
 * Every channel's input converges here and leaves as one unified claim package.
 * A caption on an image is not a separate claim from the image: all components
 * of a submission are combined and analysed together.
 *
 * Text and URLs are fully processed. Images and PDFs are read by Claude (via the
 * injected `analyzeMedia`) and folded in as text; audio and video are still
 * accepted, recorded, and flagged until transcription is wired.
 */
import type { CheckRequest, CheckFile } from '../types';
import type { MediaAnalysis } from './media';
import { stripHtml } from '../util/html';

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

export interface NormalizeOptions {
  /** Reads image/PDF attachments into text. Omitted → media stays unprocessed. */
  analyzeMedia?: (files: CheckFile[]) => Promise<MediaAnalysis>;
}

export async function normalize(request: CheckRequest, opts: NormalizeOptions = {}): Promise<NormalizedInput> {
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
  for (const file of files) {
    const kind = file.type.split('/')[0] || 'document';
    if (!detectedTypes.includes(kind)) detectedTypes.push(kind);
  }

  // Images and PDFs are read into text and treated as part of the claim. What
  // the analyzer can't handle (audio/video, or bytes it wasn't given) stays
  // flagged for the review queue.
  let unprocessed = files;
  if (files.length > 0 && opts.analyzeMedia) {
    const analysis = await opts.analyzeMedia(files);
    unprocessed = analysis.unprocessed;
    for (const extract of analysis.extracts) {
      parts.push(`[Content of attached file ${extract.name}]\n${extract.text}`);
    }
    if (analysis.extracts.length > 0) {
      notes.push(`Read ${analysis.extracts.length} attached file${analysis.extracts.length > 1 ? 's' : ''}.`);
    }
  }

  const hasUnprocessedMedia = unprocessed.length > 0;
  if (hasUnprocessedMedia) {
    notes.push(
      `${unprocessed.length} attached file${unprocessed.length > 1 ? 's were' : ' was'} recorded but not analysed — ` +
        'audio, video, and unsupported document types are not yet available.'
    );
    parts.push(`[Attached, not yet analysed: ${unprocessed.map((f) => f.name).join(', ')}]`);
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
