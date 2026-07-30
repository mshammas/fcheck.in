/**
 * Claude API client.
 *
 * Two models, two jobs:
 *   - Haiku 4.5  — claim extraction (stage 2). Cheap, classification-shaped.
 *   - Sonnet 5   — AI deep-check (stage 6) with the web search server tool.
 *
 * Editorial constraint enforced at this layer: the deep-check schema requires a
 * source URL on every piece of evidence, and findings without one are dropped
 * before they reach the caller. "Every AI-generated claim must cite a source"
 * is a schema rule here, not just a line in the prompt.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { EvidenceItem, Verdict } from '../types';
import type { TldrInput, TldrVariants } from '../share';
import { clampVariants, fallbackTldr } from '../share';

const EXTRACT_MODEL = 'claude-haiku-4-5';
const DEEP_CHECK_MODEL = 'claude-sonnet-5';

export function getClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .dev.vars (local) or `wrangler secret put` (deployed).');
  }
  return new Anthropic({ apiKey });
}

/** Pulls the JSON payload out of a response constrained by output_config.format. */
function parseStructured<T>(content: Anthropic.ContentBlock[]): T {
  // With server tools in play, the JSON answer is the last text block, not the
  // first — search results and tool-use blocks come before it.
  const texts = content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const last = texts[texts.length - 1];
  if (!last) throw new Error('Claude returned no text block');
  return JSON.parse(last.text) as T;
}

// ── Stage 2: claim extraction ─────────────────────────────────

export interface ExtractedClaim {
  /** Normalised, self-contained statement of the checkable assertion. */
  canonical_text: string;
  /** Every distinct factual assertion found, most central first. */
  assertions: string[];
  /** Best-guess country and language, for filtering. Null when unclear. */
  country: string | null;
  language: string | null;
  /** False when the input carries no checkable factual claim at all. */
  is_checkable: boolean;
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    canonical_text: {
      type: 'string',
      description: 'The core checkable assertion, rewritten as one plain, self-contained sentence.',
    },
    assertions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Each distinct factual assertion, most central first.',
    },
    country: {
      type: ['string', 'null'],
      description: 'ISO 3166 alpha-2 code the claim concerns, or null if not country-specific.',
    },
    language: {
      type: ['string', 'null'],
      description: 'BCP 47 tag of the submitted text, or null if undetermined.',
    },
    is_checkable: {
      type: 'boolean',
      description: 'False if the input is opinion, a question, or has no factual assertion.',
    },
  },
  required: ['canonical_text', 'assertions', 'country', 'language', 'is_checkable'],
  additionalProperties: false,
} as const;

const EXTRACT_SYSTEM = `You extract checkable factual claims from messages people encounter online.

Strip opinion, rhetoric, and framing. Keep the assertion. Write the canonical text
as a neutral, self-contained sentence a fact-checker could verify — resolve
pronouns and vague references ("this video", "they said") into concrete terms
where the input supports it.

If the input contains no factual assertion — it is an opinion, a question, a
greeting, or pure commentary — set is_checkable to false and put your best
one-line summary in canonical_text anyway.

Never add facts that are not in the input. Never guess at what the person
"probably meant" beyond resolving obvious references.`;

export async function extractClaim(
  client: Anthropic,
  input: string
): Promise<ExtractedClaim> {
  const response = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 2000,
    system: EXTRACT_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    messages: [{ role: 'user', content: input }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  return parseStructured<ExtractedClaim>(response.content);
}

// ── Stage 1: media extraction (image / PDF) ───────────────────

/** A file whose bytes Claude can read directly — image or PDF, base64-encoded. */
export interface AnalyzableMedia {
  name: string;
  /** MIME type: an `image/*` or `application/pdf`. */
  type: string;
  /** base64-encoded bytes, no `data:` prefix. */
  data: string;
}

export interface MediaExtract {
  name: string;
  text: string;
}

const MEDIA_SYSTEM = `You transcribe the factual content of an attached image or document so it can be fact-checked.

Read every piece of visible text verbatim — captions, overlays, headlines, chyrons, posts, document body. If the file is a photo or screenshot with little text, describe plainly what it depicts, but only the parts that bear on a factual claim (who, what, where, when).

Do not assess whether anything is true or false. Do not add context the file does not contain. If the file carries no factual claim at all, say so in one line. Output plain text only.`;

/**
 * Reads image and PDF attachments into text, one Claude call per file so a
 * single unreadable file can't sink the rest. The returned text is folded into
 * the claim package by normalize(); stage 2 then extracts the canonical claim
 * from it exactly as it would from pasted text or a fetched page. The verdict is
 * never formed here — this only surfaces what the file says.
 */
export async function extractFromMedia(
  client: Anthropic,
  files: AnalyzableMedia[]
): Promise<MediaExtract[]> {
  const out: MediaExtract[] = [];

  for (const file of files) {
    const block: Anthropic.ContentBlockParam =
      file.type === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
        : {
            type: 'image',
            source: { type: 'base64', media_type: file.type as Anthropic.Base64ImageSource['media_type'], data: file.data },
          };

    try {
      const response = await client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: 1500,
        system: MEDIA_SYSTEM,
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Transcribe and describe this file.' }] }],
      } as Anthropic.MessageCreateParamsNonStreaming);

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (text) out.push({ name: file.name, text });
    } catch (err) {
      // One bad file doesn't fail the submission — it falls back to "recorded,
      // not analysed" like an unsupported type.
      console.error(`media extract failed for ${file.name}`, err);
    }
  }

  return out;
}

// ── Share: per-platform TL;DR ─────────────────────────────────

const TLDR_SCHEMA = {
  type: 'object',
  properties: {
    generic: { type: 'string', description: 'One neutral sentence, under 200 chars, for copy/share.' },
    twitter: { type: 'string', description: 'Under 230 chars, fits a tweet beside a link. Lead with the verdict.' },
    whatsapp: { type: 'string', description: 'A short forward, under 600 chars. May use *bold*. Lead with the verdict.' },
  },
  required: ['generic', 'twitter', 'whatsapp'],
  additionalProperties: false,
} as const;

const TLDR_SYSTEM = `You write short, shareable summaries of a fact-check that has ALREADY been researched, reviewed, and published.

Absolute rules:
1. Use ONLY the verdict, headline, and summary you are given. Never introduce a
   fact, number, source, or claim that is not in them. No extrapolation.
2. Lead with the verdict so a reader sees the conclusion first.
3. Plain language, non-partisan, no hashtags, no emoji spam (at most one leading
   emoji), and never a URL — the link is added separately.
4. Respect the length hint for each platform.

You are compressing an existing verdict for sharing, not writing a new one.`;

/**
 * Produces the platform TL;DRs for a published report. Scoped strictly to the
 * report's own fields; the output is clamped to the same char budgets as the
 * deterministic fallback, and any failure (or a missing key upstream) falls back
 * to `fallbackTldr` so the share control always has text.
 */
export async function generateTldr(client: Anthropic, input: TldrInput): Promise<TldrVariants> {
  try {
    const response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1000,
      system: TLDR_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: TLDR_SCHEMA } },
      messages: [
        {
          role: 'user',
          content:
            `Verdict: ${input.verdict ?? 'Checked'}\n` +
            (input.attributedTo ? `Attributed to: ${input.attributedTo}\n` : '') +
            `Headline: ${input.headline}\n` +
            `Summary: ${input.summary}`,
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const parsed = parseStructured<TldrVariants>(response.content);
    // Enforce the budgets regardless of what the model returned.
    return clampVariants(parsed);
  } catch (err) {
    console.error('TL;DR generation failed — using deterministic fallback', err);
    return fallbackTldr(input);
  }
}

// ── Stage 6: AI deep-check ────────────────────────────────────

export interface DeepCheckResult {
  /** True when the sources found are enough to form a view (→ TYPE 3). */
  sufficient_evidence: boolean;
  verdict: Verdict | null;
  /** 0-100. Must reflect real source quality and quantity — no padding. */
  confidence: number | null;
  headline: string;
  summary: string;
  body: string;
  evidence: EvidenceItem[];
  tags: string[];
}

const DEEP_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    sufficient_evidence: {
      type: 'boolean',
      description: 'True only if the sources found are enough to state a verdict honestly.',
    },
    verdict: {
      type: ['string', 'null'],
      enum: ['TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIABLE', 'OUTDATED', 'SATIRE', null],
      description: 'Null when sufficient_evidence is false.',
    },
    confidence: {
      type: ['integer', 'null'],
      description: '0-100, reflecting actual source quality and quantity. Null when sufficient_evidence is false.',
    },
    headline: { type: 'string', description: 'Plain-language headline stating the finding. No jargon.' },
    summary: { type: 'string', description: 'Two or three sentences a phone reader can scan.' },
    body: { type: 'string', description: 'Markdown: what is claimed, what the evidence shows, the verdict.' },
    evidence: {
      type: 'array',
      description: 'Every source consulted that informed the finding. Each needs a real, working URL.',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Publisher or organisation name.' },
          url: { type: 'string', description: 'Direct URL to the source.' },
          snippet: { type: 'string', description: 'The specific passage that supports or contradicts the claim.' },
          date: { type: ['string', 'null'], description: 'ISO 8601 publication date, or null.' },
        },
        required: ['source', 'url', 'snippet', 'date'],
        additionalProperties: false,
      },
    },
    tags: { type: 'array', items: { type: 'string' }, description: 'One to three category tags.' },
  },
  required: ['sufficient_evidence', 'verdict', 'confidence', 'headline', 'summary', 'body', 'evidence', 'tags'],
  additionalProperties: false,
} as const;

const DEEP_CHECK_SYSTEM = `You are producing a preliminary fact-check analysis for fcheck.in.
It will be shown to the public labelled as provisional and AI-generated, and
queued for review by a human editor. Write accordingly.

Search the web for primary sources: government data, research papers,
authoritative statements from the organisations involved, and reporting from
established outlets. Look for evidence that contradicts the claim as hard as you
look for evidence that supports it.

Rules you must not break:

1. Every assertion in your body must trace to an item in the evidence array.
   An evidence item with no real URL is worse than no evidence — omit it.
2. Set sufficient_evidence to false when you cannot find enough to form an
   honest view. This is a normal, expected outcome. Do not stretch thin
   sourcing into a verdict.
3. Confidence must reflect what you actually found. Two strong primary sources
   that agree is high confidence. One blog post is not. Never pad the number.
4. Write for someone reading on a phone who is not an expert in the subject.
   No jargon, no hedging language that obscures the finding.
5. fcheck.in is non-partisan. Report what the sources show; take no side.

Verdicts: TRUE (accurate and supported), FALSE (factually incorrect),
MISLEADING (partial truth presented deceptively), UNVERIFIABLE (insufficient
evidence either way), OUTDATED (was true, no longer), SATIRE (originates from a
satirical source).`;

export async function deepCheck(
  client: Anthropic,
  canonicalText: string,
  context: { countries?: string[]; languages?: string[] } = {}
): Promise<DeepCheckResult> {
  const scope: string[] = [];
  if (context.countries?.length) scope.push(`Countries of interest: ${context.countries.join(', ')}.`);
  if (context.languages?.length) scope.push(`Preferred source languages: ${context.languages.join(', ')}.`);

  const response = await client.messages.create({
    model: DEEP_CHECK_MODEL,
    max_tokens: 16000,
    system: DEEP_CHECK_SYSTEM,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: DEEP_CHECK_SCHEMA },
    },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages: [
      {
        role: 'user',
        content: `Fact-check this claim:\n\n${canonicalText}${scope.length ? `\n\n${scope.join(' ')}` : ''}`,
      },
    ],
  } as Anthropic.MessageCreateParamsNonStreaming);

  // A long server-tool turn can stop at the iteration limit rather than finishing.
  if (response.stop_reason === 'pause_turn') {
    throw new Error('Deep-check paused before completing — retry or raise the search budget.');
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('Deep-check declined by safety classifiers.');
  }

  const result = parseStructured<DeepCheckResult>(response.content);

  // Enforce the sourcing rule regardless of what the model returned.
  result.evidence = (result.evidence ?? []).filter(
    (e) => e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url)
  );
  if (result.evidence.length === 0) {
    result.sufficient_evidence = false;
    result.verdict = null;
    result.confidence = null;
  }

  return result;
}
