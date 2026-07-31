---
description: Check CLAUDE.md + docs/ are still accurate after code changes, and update them
---

Keep the project docs honest about the code. Do this:

1. **Run the mechanical check** — `npm run check:docs` (broken doc links, stale
   migrations range). Fix anything it reports.

2. **Review semantic drift** against the current changes. Look at
   `git diff` (working tree) and `git diff main...HEAD` if on a branch, then ask
   whether any of these are now out of date:
   - **CLAUDE.md** — "Current status", the Response TYPE table, repo map, tech
     stack. (It's the always-loaded map; keep it thin.)
   - **docs/** — the single doc that *owns* the changed topic (see the Docs index
     table in CLAUDE.md). Common ones: `setup.md` (run/test/deploy, go-live,
     build gotchas), `pipeline.md`, `data-model.md`, `product.md`, `admin.md`,
     `homepage.md`, `roadmap.md` (what's not built yet).

3. **Update, respecting single-homing** — each topic lives in exactly one doc;
   cross-link instead of duplicating. Put status in CLAUDE.md, detail in the
   owning doc. Don't touch docs whose topic didn't change.

4. Report a short summary of what you changed (or "docs already accurate").
