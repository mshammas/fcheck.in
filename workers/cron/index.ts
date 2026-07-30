/// <reference path="../../worker-configuration.d.ts" />
/**
 * Cron scheduler worker.
 *
 * Deliberately dumb: it holds no business logic and no database binding. On each
 * cron tick it makes one authenticated HTTP call to the app's job endpoint,
 * which owns all the logic and D1 access. This split exists because the Astro
 * Cloudflare adapter's generated worker exports only `fetch`, not `scheduled` —
 * so the schedule lives here while the work stays in the app.
 *
 * Deploy separately: see docs/setup.md. `APP_BASE_URL` and the `CRON_SECRET`
 * secret must match the deployed app.
 */

interface CronEnv {
  /** Origin of the deployed app, e.g. https://fcheck.in. No trailing slash. */
  APP_BASE_URL: string;
  /** Shared bearer, identical to the app's CRON_SECRET. */
  CRON_SECRET: string;
}

// Each cron expression (declared in this worker's wrangler.jsonc) maps to one
// job. Keep these in sync with `triggers.crons`.
const SCHEDULE: Record<string, string> = {
  '0 */6 * * *': 'recheck', // re-check TYPE 4 claims every 6 hours
  '*/15 * * * *': 'crawler', // poll the fact-checker network every 15 minutes
  '*/30 * * * *': 'trending', // expire trending cards every 30 minutes
  '*/20 * * * *': 'alerts', // notify admins of new drafts / low trending every 20 minutes
};

export default {
  async scheduled(controller: ScheduledController, env: CronEnv, ctx: ExecutionContext): Promise<void> {
    const job = SCHEDULE[controller.cron];
    if (!job) {
      console.error(`No job mapped to cron "${controller.cron}"`);
      return;
    }
    ctx.waitUntil(trigger(job, env));
  },
} satisfies ExportedHandler<CronEnv>;

async function trigger(job: string, env: CronEnv): Promise<void> {
  const url = `${env.APP_BASE_URL.replace(/\/$/, '')}/api/jobs/${job}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      // The JSON content-type is required: Astro's CSRF guard rejects POSTs with
      // form-like content types and no matching Origin, which a cron call has.
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`job ${job}: ${body}`);
    } else {
      console.error(`job ${job} failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error(`job ${job} could not be reached`, err);
  }
}
