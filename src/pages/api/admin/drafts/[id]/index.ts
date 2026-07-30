/**
 * PUT /api/admin/drafts/:id — edit a draft's verdict, headline, summary, body,
 * evidence, or tags before publication. All admin roles may edit.
 */
import type { APIRoute } from 'astro';
import type { DraftEdits } from '../../../../../lib/db/admin';
import type { EvidenceItem, Verdict } from '../../../../../lib/types';
import { getDb } from '../../../../../lib/db/client';
import { updateDraft, AdminActionError } from '../../../../../lib/db/admin';
import { adminOf, handle, json, readJson } from '../../_shared';

export const prerender = false;

const VERDICTS: Verdict[] = ['TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIABLE', 'OUTDATED', 'SATIRE'];

export const PUT: APIRoute = (context) =>
  handle(async () => {
    const admin = adminOf(context);
    const claimId = context.params.id;
    if (!claimId) return json({ error: 'Missing claim id.' }, 400);

    const body = await readJson(context);
    const edits = parseEdits(body);

    await updateDraft(getDb(), admin, claimId, edits);
    return json({ updated: true });
  });

function parseEdits(body: Record<string, unknown>): DraftEdits {
  const edits: DraftEdits = {};

  if (typeof body.verdict === 'string') {
    if (!VERDICTS.includes(body.verdict as Verdict)) {
      throw new AdminActionError(`Unknown verdict "${body.verdict}".`, 400);
    }
    edits.verdict = body.verdict as Verdict;
  }
  if (body.confidence === null || typeof body.confidence === 'number') {
    edits.confidence = body.confidence === null ? null : clamp(body.confidence as number);
  }
  if (typeof body.headline === 'string') edits.headline = body.headline.trim();
  if (typeof body.summary === 'string') edits.summary = body.summary.trim();
  if (typeof body.body === 'string') edits.body = body.body;
  if (Array.isArray(body.tags)) edits.tags = body.tags.filter((t): t is string => typeof t === 'string');
  if (Array.isArray(body.evidence)) edits.evidence = parseEvidence(body.evidence);

  return edits;
}

function parseEvidence(items: unknown[]): EvidenceItem[] {
  return items.map((raw) => {
    const e = raw as Record<string, unknown>;
    return {
      source: String(e.source ?? '').trim(),
      url: String(e.url ?? '').trim(),
      snippet: String(e.snippet ?? '').trim(),
      date: typeof e.date === 'string' ? e.date : undefined,
    };
  });
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
