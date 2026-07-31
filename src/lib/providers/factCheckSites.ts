/**
 * Direct fact-check-site search — the fallback beneath the Google aggregator.
 *
 * When the Google Fact Check Tools API returns nothing (a story it hasn't indexed
 * yet, or no key at all), we go to the sources themselves. Two adapters, no AI,
 * no API key:
 *
 *   - feed   — a source's RSS/Atom feed (`fact_checkers.api_endpoint`)
 *   - search — a source's HTML search page (`fact_checkers.search_url`, `{q}`)
 *
 * Both are best-effort: results are matched to the claim by keyword overlap only,
 * so they surface as attributed report *links* — the ranking/attribution in
 * searchExternal still applies, but a machine-readable verdict is rarely present.
 *
 * Every network call is time-boxed and isolated with `Promise.allSettled`: a
 * slow, dead, or redesigned site degrades to "no hit", never an error.
 */
import type { FactCheckerRow } from '../types';
import type { ExternalReview } from './googleFactCheck';
import { keywordsOf } from '../db/util';
import { parseJsonArray } from '../db/factCheckers';
import { stripHtml, decodeEntities } from '../util/html';

const DEFAULT_TIMEOUT_MS = 6000;
/** How many sources we're willing to fan out to on a single Google miss. */
const DEFAULT_SOURCE_LIMIT = 6;
/** Items/anchors scanned per source, and hits kept per source. */
const MAX_ITEMS_SCANNED = 40;
const MAX_HITS_PER_SOURCE = 3;

export interface SiteSearchOptions {
  limit?: number;
  timeoutMs?: number;
  /** For prioritising which sources to query first. */
  filters?: { countries?: string[]; languages?: string[] };
}

/**
 * Searches the configured fact-checking sites directly and returns a flat,
 * URL-deduplicated list of `ExternalReview`s, ready to feed the same ranking and
 * attribution path Google results use.
 */
export async function searchSites(
  sources: FactCheckerRow[],
  query: string,
  opts: SiteSearchOptions = {}
): Promise<ExternalReview[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = opts.limit ?? DEFAULT_SOURCE_LIMIT;
  const keywords = keywordsOf(query);
  if (keywords.size === 0) return [];

  const chosen = selectSources(sources, opts.filters).slice(0, limit);

  const settled = await Promise.allSettled(
    chosen.map((source) => searchOneSource(source, query, keywords, timeoutMs))
  );

  const seen = new Set<string>();
  const out: ExternalReview[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const review of r.value) {
      const key = normalizeUrl(review.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(review);
    }
  }
  return out;
}

/** Configured, active sources first; those matching the claim's locale ranked ahead. */
function selectSources(sources: FactCheckerRow[], filters?: SiteSearchOptions['filters']): FactCheckerRow[] {
  const configured = sources.filter((s) => s.active === 1 && (s.api_endpoint || s.search_url));
  const { countries, languages } = filters ?? {};
  if (!countries?.length && !languages?.length) return configured;

  const relevant = (s: FactCheckerRow): boolean => {
    const c = parseJsonArray(s.countries);
    const l = parseJsonArray(s.languages);
    const cOk = !countries?.length || c.length === 0 || c.some((x: string) => countries.includes(x));
    const lOk = !languages?.length || l.length === 0 || l.some((x: string) => languages.includes(x));
    return cOk && lOk;
  };
  return [...configured].sort((a, b) => Number(relevant(b)) - Number(relevant(a)));
}

/** Feed first (structured, cheap); fall back to the search page if it yields nothing. */
async function searchOneSource(
  source: FactCheckerRow,
  query: string,
  keywords: Set<string>,
  timeoutMs: number
): Promise<ExternalReview[]> {
  if (source.api_endpoint) {
    const viaFeed = await searchFeed(source, keywords, timeoutMs).catch(() => []);
    if (viaFeed.length > 0) return viaFeed;
  }
  if (source.search_url) {
    return searchPage(source, query, keywords, timeoutMs).catch(() => []);
  }
  return [];
}

// ── Feed adapter ──────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  date: string | null;
}

async function searchFeed(source: FactCheckerRow, keywords: Set<string>, timeoutMs: number): Promise<ExternalReview[]> {
  const body = await fetchText(source.api_endpoint!, timeoutMs, 'application/rss+xml, application/atom+xml, application/xml, text/xml');
  if (!body) return [];

  return parseFeedItems(body)
    .map((item) => ({ item, score: overlap(keywords, keywordsOf(item.title)) }))
    .filter(({ score }) => matches(score, keywords.size))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS_PER_SOURCE)
    .map(({ item }) => toReview(source, item.title, item.link, item.date));
}

/** Minimal RSS + Atom item extraction — no XML dependency. */
export function parseFeedItems(xml: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const block of blocks.slice(0, MAX_ITEMS_SCANNED)) {
    const title = decodeEntities(stripTag(tag(block, 'title')));
    const link = feedLink(block);
    const date = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || null;
    if (title && link) items.push({ title, link, date: date ? date.trim() : null });
  }
  return items;
}

function feedLink(block: string): string {
  // Atom: <link href="…"/> (prefer rel="alternate" or no rel). RSS: <link>…</link>.
  const hrefs = [...block.matchAll(/<link\b[^>]*?href="([^"]+)"[^>]*>/gi)];
  if (hrefs.length) {
    const alt = hrefs.find((m) => /rel="alternate"/i.test(m[0])) ?? hrefs.find((m) => !/rel="/i.test(m[0])) ?? hrefs[0];
    return alt[1].trim();
  }
  return stripTag(tag(block, 'link')).trim();
}

// ── Search-page adapter ───────────────────────────────────────

async function searchPage(
  source: FactCheckerRow,
  query: string,
  keywords: Set<string>,
  timeoutMs: number
): Promise<ExternalReview[]> {
  const url = source.search_url!.replace(/\{q\}/g, encodeURIComponent(query));
  const html = await fetchText(url, timeoutMs, 'text/html');
  if (!html) return [];

  const host = safeHost(source.homepage_url);
  return extractAnchors(html, host)
    .map((a) => ({ a, score: overlap(keywords, keywordsOf(a.text)) }))
    .filter(({ score }) => matches(score, keywords.size))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HITS_PER_SOURCE)
    .map(({ a }) => toReview(source, a.text, a.href, null));
}

/** Pulls on-site article links and their anchor text from a search-results page. */
export function extractAnchors(html: string, host: string | null): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (out.length >= MAX_ITEMS_SCANNED) break;
    const href = m[1].trim();
    const text = decodeEntities(stripHtml(m[2]));
    if (!text || text.length < 12) continue; // skip nav/chrome links
    const abs = absoluteUrl(href, host);
    if (!abs || !onHost(abs, host) || seen.has(abs)) continue;
    seen.add(abs);
    out.push({ href: abs, text });
  }
  return out;
}

// ── Shared helpers ────────────────────────────────────────────

function toReview(source: FactCheckerRow, title: string, url: string, date: string | null): ExternalReview {
  return {
    claimText: title,
    publisherName: source.name, // matchFactChecker re-attaches the tier badge
    publisherSite: safeHost(source.homepage_url) ?? '',
    url,
    title,
    reviewDate: date,
    textualRating: '', // feeds/pages seldom expose a machine-readable rating
    languageCode: parseJsonArray(source.languages)[0] ?? null,
  };
}

/** Overlap must clear a small bar: 2 shared terms, or all of a 1–2 word query. */
function matches(score: number, querySize: number): boolean {
  return score >= Math.min(2, querySize);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

async function fetchText(url: string, timeoutMs: number, accept: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'fcheck.in/0.1 (+https://fcheck.in) fact-check bot', accept },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}

/** Unwraps CDATA and strips any nested markup from an element's inner text. */
function stripTag(inner: string): string {
  return stripHtml(inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function absoluteUrl(href: string, host: string | null): string | null {
  try {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/') && host) return new URL(href, `https://${host}`).toString();
    return null;
  } catch {
    return null;
  }
}

function onHost(url: string, host: string | null): boolean {
  if (!host) return true;
  const h = safeHost(url);
  return h !== null && (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`));
}

function normalizeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}
