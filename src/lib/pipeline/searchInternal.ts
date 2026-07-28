/**
 * Stage 4 — fcheck.in database search → TYPE 1.
 *
 * Searches published fcheck.in original reports. A hit here is the highest
 * trust indicator we can show, so it wins over everything downstream and the
 * pipeline stops.
 */
import type { ClaimRow, ReportRow } from '../types';
import { toFtsQuery } from '../db/client';

export interface InternalHit {
  claim: ClaimRow;
  report: ReportRow;
}

export async function searchInternal(
  db: D1Database,
  canonicalText: string,
  filters: { countries?: string[]; languages?: string[] } = {}
): Promise<InternalHit | null> {
  const query = toFtsQuery(canonicalText);
  if (!query) return null;

  const conditions: string[] = [
    "r.report_type = 'original'",
    "c.status = 'published'",
    'reports_fts MATCH ?',
  ];
  const bindings: unknown[] = [query];

  if (filters.countries?.length) {
    conditions.push(`(r.country IS NULL OR r.country IN (${filters.countries.map(() => '?').join(',')}))`);
    bindings.push(...filters.countries);
  }
  if (filters.languages?.length) {
    conditions.push(`(r.language IS NULL OR r.language IN (${filters.languages.map(() => '?').join(',')}))`);
    bindings.push(...filters.languages);
  }

  const row = await db
    .prepare(
      `SELECT r.id AS report_id, c.id AS claim_id
       FROM reports_fts f
       JOIN reports r ON r.rowid = f.rowid
       JOIN claims  c ON c.id = r.claim_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY rank
       LIMIT 1`
    )
    .bind(...bindings)
    .first<{ report_id: string; claim_id: string }>()
    .catch(() => null);

  if (!row) return null;

  const [claim, report] = await Promise.all([
    db.prepare('SELECT * FROM claims WHERE id = ?').bind(row.claim_id).first<ClaimRow>(),
    db.prepare('SELECT * FROM reports WHERE id = ?').bind(row.report_id).first<ReportRow>(),
  ]);

  return claim && report ? { claim, report } : null;
}
