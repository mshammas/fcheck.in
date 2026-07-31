#!/usr/bin/env node
/**
 * Deterministic doc-drift guard for CLAUDE.md + docs/.
 *
 * These docs are hand-maintained (nothing regenerates them), so they drift when
 * code changes and the docs don't. This catches the *mechanical* drift a machine
 * can verify; semantic freshness is the job of the `/doc-check` slash command.
 *
 * Checks:
 *   1. Every local Markdown link in CLAUDE.md and docs/*.md resolves to a file.
 *   2. The migrations range quoted in CLAUDE.md matches migrations/ on disk.
 *
 * Exit non-zero on any failure (so it can gate a commit). Bypass with
 * `git commit --no-verify` when you knowingly want to skip it.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

// ── 1. Local Markdown links resolve ────────────────────────────────
const docFiles = ['CLAUDE.md', ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;

for (const rel of docFiles) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, 'utf8');
  for (const m of text.matchAll(linkRe)) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue; // external or in-page anchor
    target = target.split('#')[0].split(':')[0]; // strip #anchor and :line
    if (!target) continue;
    const resolved = resolve(dirname(abs), target);
    if (!existsSync(resolved)) {
      errors.push(`${rel}: broken link -> ${m[1]}`);
    }
  }
}

// ── 2. Migrations range in CLAUDE.md matches disk ──────────────────
const migrations = readdirSync(join(root, 'migrations'))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .map((f) => parseInt(f.slice(0, 4), 10))
  .sort((a, b) => a - b);

if (migrations.length) {
  const lastOnDisk = String(migrations[migrations.length - 1]).padStart(4, '0');
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  // Matches `0001`–`0007` (en-dash or hyphen), the range in the repo map.
  const rangeMatch = claude.match(/`0001`\s*[–-]\s*`(\d{4})`/);
  if (!rangeMatch) {
    errors.push('CLAUDE.md: migrations range (`0001`–`NNNN`) not found in repo map');
  } else if (rangeMatch[1] !== lastOnDisk) {
    errors.push(`CLAUDE.md: migrations range ends at \`${rangeMatch[1]}\` but latest on disk is \`${lastOnDisk}\``);
  }
}

// ── Report ─────────────────────────────────────────────────────────
if (errors.length) {
  console.error('✘ doc-drift check failed:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nFix the docs, or run `git commit --no-verify` to bypass.');
  process.exit(1);
}
console.log('✓ docs check passed');
