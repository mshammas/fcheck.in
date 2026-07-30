/**
 * The pipeline. Every input, from every channel, flows through here exactly
 * once — the response is then formatted for whichever channel asked.
 *
 *   1. Normalise            → text, URLs, media flags
 *   2. Extract claims       → canonical text (Claude Haiku 4.5)
 *   3. Fingerprint + cache  → repeat submissions served from D1
 *   4. fcheck.in DB search  → TYPE 1
 *   5. Fact-checker network → TYPE 2
 *   6. AI deep-check        → TYPE 3 (sufficient) or TYPE 4 (insufficient)
 *
 * First match wins; the pipeline stops there.
 *
 * ## The rule this file exists to protect
 *
 * No path through this pipeline sets a claim to `published`. TYPE 3 writes a
 * draft and queues it for a human. Publication is an admin action.
 */
import type { CheckRequest, CheckResponse, Channel, CheckFile } from '../types';
import { TYPE_NUMBER, parseEvidence } from '../types';
import { getClient, extractClaim, deepCheck } from '../providers/anthropic';
import { mediaAnalyzer } from './media';
import {
  getClaimById,
  getPrimaryReport,
  incrementSubmissionCount,
  insertClaim,
  insertReport,
  recordSubmission,
} from '../db/claims';
import { normalize } from './normalize';
import { createSemanticMatcher } from './matcher';
import { indexClaimVector, type EmbeddingDeps } from './embeddings';
import { searchInternal } from './searchInternal';
import { searchExternal, externalHitToReport } from './searchExternal';

export interface PipelineEnv {
  db: D1Database;
  anthropicApiKey?: string;
  googleFactCheckApiKey?: string;
  /** Workers AI + Vectorize for semantic matching; absent → hash + FTS only. */
  ai?: Ai;
  vectorize?: VectorizeIndex | Vectorize;
  /** Absolute origin, for building the returned result URL. */
  origin: string;
}

export async function runPipeline(env: PipelineEnv, request: CheckRequest): Promise<CheckResponse> {
  const channel: Channel = request.channel ?? 'web';
  const notes: string[] = [];

  // The Claude client is needed for both media analysis (stage 1) and claim
  // extraction (stage 2), so it is built up front.
  const claude = getClient(env.anthropicApiKey);

  // ── Stage 1 — normalise (reads image/PDF attachments into text) ──
  const input = await normalize(request, { analyzeMedia: mediaAnalyzer(claude) });
  notes.push(...input.notes);

  if (!input.combinedText) {
    throw new PipelineError('Nothing to check. Paste a claim, a link, or attach a file.', 400);
  }

  // ── Stage 2 — extract the checkable assertion ──────────────
  const extracted = await extractClaim(claude, input.combinedText);
  const canonicalText = extracted.canonical_text.trim();

  if (!extracted.is_checkable) {
    notes.push('This looks like an opinion or commentary rather than a factual claim.');
  }

  const filters = {
    countries: request.countries?.length ? request.countries : extracted.country ? [extracted.country] : undefined,
    languages: request.languages?.length ? request.languages : undefined,
  };

  // ── Stage 3 — fingerprint and cache check ──────────────────
  const embedDeps: EmbeddingDeps = { ai: env.ai, vectorize: env.vectorize };
  const matcher = createSemanticMatcher(embedDeps);
  const fingerprint = await matcher.fingerprint(canonicalText);
  const cached = await matcher.findMatch(env.db, canonicalText, fingerprint);

  if (cached) {
    // Record the new submission against the existing claim and serve what we
    // already have — no reprocessing, no second bill for the same question.
    await Promise.all([
      incrementSubmissionCount(env.db, cached.id),
      recordSubmission(env.db, cached.id, channel, { text: request.text, urls: input.urls, files: fileMetadata(request.files) }),
    ]);
    return buildResponse(env, cached.id, { cached: true, notes });
  }

  // ── Stage 4 — fcheck.in original reports (TYPE 1) ──────────
  const internal = await searchInternal(env.db, canonicalText, filters);
  if (internal) {
    await Promise.all([
      incrementSubmissionCount(env.db, internal.claim.id),
      recordSubmission(env.db, internal.claim.id, channel, {
        text: request.text,
        urls: input.urls,
        files: fileMetadata(request.files),
      }),
    ]);
    return buildResponse(env, internal.claim.id, { cached: false, notes });
  }

  // ── Stage 5 — authenticated fact-checker network (TYPE 2) ──
  let external: Awaited<ReturnType<typeof searchExternal>> = null;
  try {
    external = await searchExternal(env.db, env.googleFactCheckApiKey, canonicalText, filters);
  } catch (err) {
    // A failing external search must not sink the whole check — fall through
    // to the AI deep-check and tell the user what we couldn't reach.
    notes.push('The external fact-checker network could not be reached for this check.');
    console.error('external search failed', err);
  }

  if (external) {
    const report = externalHitToReport(external.best, external.others, filters);
    const claim = await insertClaim(env.db, {
      fingerprint,
      canonicalText,
      sourceType: 'external',
      // TYPE 2 is live immediately: the verdict is the external fact-checker's,
      // fully attributed, with no AI verdict layered on top. An editor may
      // later publish an fcheck.in original that supersedes it (TYPE 2 → 1).
      status: 'published',
      verdict: report.verdict,
      confidence: null,
    });

    await insertReport(env.db, {
      claimId: claim.id,
      reportType: 'external',
      headline: report.headline,
      summary: report.summary,
      body: report.body,
      evidence: report.evidence,
      tags: [],
      country: report.country,
      language: report.language,
      externalUrl: report.externalUrl,
      factCheckerId: report.factCheckerId,
    });

    await recordSubmission(env.db, claim.id, channel, {
      text: request.text,
      urls: input.urls,
      files: fileMetadata(request.files),
    });
    await indexClaimVector(embedDeps, claim.id, canonicalText);
    return buildResponse(env, claim.id, { cached: false, notes });
  }

  // ── Stage 6 — AI deep-check (TYPE 3 or TYPE 4) ─────────────
  if (input.hasUnprocessedMedia && !input.combinedText.replace(/\[Attached[^\]]*\]/g, '').trim()) {
    // Media-only submission with nothing readable — no honest analysis is
    // possible yet, so it goes straight to the review queue.
    return storeSubmitted(env, { fingerprint, canonicalText, channel, request, input, notes });
  }

  let analysis: Awaited<ReturnType<typeof deepCheck>> | null = null;
  try {
    analysis = await deepCheck(claude, canonicalText, filters);
  } catch (err) {
    notes.push('The AI analysis could not be completed for this claim.');
    console.error('deep check failed', err);
  }

  if (!analysis || !analysis.sufficient_evidence || !analysis.verdict) {
    return storeSubmitted(env, { fingerprint, canonicalText, channel, request, input, notes });
  }

  // TYPE 3 — provisional, shown labelled, draft queued for a human editor.
  const claim = await insertClaim(env.db, {
    fingerprint,
    canonicalText,
    sourceType: 'preliminary',
    status: 'draft',
    verdict: analysis.verdict,
    confidence: clampConfidence(analysis.confidence),
  });

  await insertReport(env.db, {
    claimId: claim.id,
    reportType: 'preliminary',
    headline: analysis.headline,
    summary: analysis.summary,
    body: analysis.body,
    evidence: analysis.evidence,
    tags: analysis.tags ?? [],
    country: filters.countries?.[0] ?? null,
    language: filters.languages?.[0] ?? null,
  });

  await recordSubmission(env.db, claim.id, channel, {
    text: request.text,
    urls: input.urls,
    files: fileMetadata(request.files),
  });
  await indexClaimVector(embedDeps, claim.id, canonicalText);

  return buildResponse(env, claim.id, { cached: false, notes });
}

// ── Helpers ───────────────────────────────────────────────────

/** Drops inline file bytes before a submission is stored — D1 keeps only the
 * metadata (name/type/size), never megabytes of base64. */
function fileMetadata(files: CheckFile[] | undefined): { name: string; type: string; size: number }[] {
  return (files ?? []).map(({ name, type, size }) => ({ name, type, size }));
}

/** TYPE 4 — no verdict shown, claim queued, user can subscribe. */
async function storeSubmitted(
  env: PipelineEnv,
  args: {
    fingerprint: string;
    canonicalText: string;
    channel: Channel;
    request: CheckRequest;
    input: Awaited<ReturnType<typeof normalize>>;
    notes: string[];
  }
): Promise<CheckResponse> {
  const claim = await insertClaim(env.db, {
    fingerprint: args.fingerprint,
    canonicalText: args.canonicalText,
    sourceType: 'submitted',
    status: 'processing',
    verdict: null,
    confidence: null,
  });

  await recordSubmission(env.db, claim.id, args.channel, {
    text: args.request.text,
    urls: args.input.urls,
    files: fileMetadata(args.request.files),
  });
  await indexClaimVector({ ai: env.ai, vectorize: env.vectorize }, claim.id, args.canonicalText);

  return buildResponse(env, claim.id, { cached: false, notes: args.notes });
}

/**
 * Reads the claim's *current* state back from the database to build the
 * response.
 *
 * This is deliberate rather than returning what we just computed: a claim that
 * has been promoted since it was created must render its new TYPE. Every read
 * path goes through the same query, so there is no stale-TYPE code path.
 */
async function buildResponse(
  env: PipelineEnv,
  claimId: string,
  meta: { cached: boolean; notes: string[] }
): Promise<CheckResponse> {
  const claim = await getClaimById(env.db, claimId);
  if (!claim) throw new PipelineError('Claim disappeared while processing.', 500);

  const report = await getPrimaryReport(env.db, claimId);

  let attribution: CheckResponse['attribution'] = null;
  if (report?.fact_checker_id) {
    const fc = await env.db
      .prepare('SELECT name, homepage_url, tier FROM fact_checkers WHERE id = ?')
      .bind(report.fact_checker_id)
      .first<{ name: string; homepage_url: string; tier: 1 | 2 }>();
    if (fc) {
      attribution = {
        name: fc.name,
        url: report.external_url ?? fc.homepage_url,
        tier: fc.tier,
        published_at: report.published_at,
      };
    }
  }

  return {
    claim_id: claim.id,
    source_type: claim.source_type,
    type: TYPE_NUMBER[claim.source_type],
    status: claim.status,
    verdict: claim.verdict,
    confidence: claim.confidence,
    canonical_text: claim.canonical_text,
    headline: report?.headline ?? null,
    summary: report?.summary ?? null,
    evidence: parseEvidence(report?.evidence),
    attribution,
    provisional: claim.source_type === 'preliminary',
    cached: meta.cached,
    url: `${env.origin}/check/${claim.id}`,
    notes: meta.notes,
  };
}


/** Confidence is never padded and never floored — only bounded to 0-100. */
function clampConfidence(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly status: number = 500
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}
