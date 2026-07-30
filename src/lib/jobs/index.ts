/**
 * Background job registry.
 *
 * One dispatch point shared by the manual HTTP endpoint (`/api/jobs/:job`) and
 * the cron scheduler worker (`workers/cron/`), so both run identical logic.
 *
 * Jobs take an explicit `(db, deps)` — no `cloudflare:workers` global — so they
 * are unit-testable and portable between the app worker and the cron worker.
 */
import type { JobDeps } from './recheck';
import { recheckSubmitted } from './recheck';
import { crawlForExternal } from './crawler';
import { expireTrending } from './trending';
import { dispatchAdminAlerts } from './alerts';

export type JobName = 'recheck' | 'crawler' | 'trending' | 'alerts';

export const JOB_NAMES: readonly JobName[] = ['recheck', 'crawler', 'trending', 'alerts'];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/** Runs a job by name and returns its summary. Throws if the name is unknown. */
export async function runJob(name: JobName, db: D1Database, deps: JobDeps): Promise<unknown> {
  switch (name) {
    case 'recheck':
      return recheckSubmitted(db, deps);
    case 'crawler':
      return crawlForExternal(db, deps);
    case 'trending':
      return expireTrending(db);
    case 'alerts':
      return dispatchAdminAlerts(db, { email: deps.email, siteUrl: deps.siteUrl });
  }
}

export type { JobDeps };
