// ─────────────────────────────────────────────────────────────────────────────
// gen-og.mjs — regenerate the static social share cards in public/og/.
//
// One 1200×630 PNG per verdict (plus "under review"), used as the og:image on
// article pages. Rendered with headless Chrome so the brand fonts (Plus Jakarta
// Sans / Inter, via Google Fonts) come out pixel-accurate. Run after changing the
// design or the verdict palette:
//
//     npm run gen:og
//
// Colours below mirror src/styles/tokens.css — keep them in sync (there is no
// runtime CSS-var access from a standalone Node script).
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'og');

const CHROME =
  process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// { file, label, meaning, bg, text, bd, dot } — palette values from tokens.css.
const CARDS = [
  { file: 'verdict-false',        label: 'FALSE',        meaning: 'Claim is factually incorrect',                     bg: '#FEF2F2', text: '#B91C1C', bd: '#FECACA', dot: '#EF4444' },
  { file: 'verdict-true',         label: 'TRUE',         meaning: 'Claim is accurate and supported by evidence',      bg: '#F0FDF4', text: '#15803D', bd: '#BBF7D0', dot: '#22C55E' },
  { file: 'verdict-misleading',   label: 'MISLEADING',   meaning: 'Contains partial truth, presented deceptively',    bg: '#FFFBEB', text: '#B45309', bd: '#FDE68A', dot: '#F97316' },
  { file: 'verdict-outdated',     label: 'OUTDATED',     meaning: 'Was true at the time, but no longer accurate',     bg: '#EFF6FF', text: '#1D4ED8', bd: '#BFDBFE', dot: '#EAB308' },
  { file: 'verdict-unverifiable', label: 'UNVERIFIABLE', meaning: 'Insufficient evidence to confirm or deny',         bg: '#F8FAFC', text: '#475569', bd: '#CBD5E1', dot: '#8B5CF6' },
  { file: 'verdict-satire',       label: 'SATIRE',       meaning: 'Originates from a satirical source',               bg: '#F5F3FF', text: '#6D28D9', bd: '#DDD6FE', dot: '#EC4899' },
  { file: 'under-review',         label: 'UNDER REVIEW', meaning: 'Submitted for review — no verdict yet',            bg: '#F8FAFC', text: '#475569', bd: '#CBD5E1', dot: '#94A3B8', small: true },
];

const BRAND = '#0D9488';

function html(c) {
  const wordSize = c.small ? 88 : 108;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Plus+Jakarta+Sans:wght@700;800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1200px; height:630px; }
  .card {
    width:1200px; height:630px; position:relative; overflow:hidden;
    background:${c.bg}; border:1px solid ${c.bd};
    font-family:'Inter',system-ui,sans-serif; color:${c.text};
    padding:84px 90px; display:flex; flex-direction:column; justify-content:center;
  }
  .glow { position:absolute; top:-30%; right:-8%; width:55%; height:150%;
    background:radial-gradient(closest-side, ${c.dot} 0%, transparent 70%); opacity:.16; }
  .tick { font-size:30px; font-weight:700; color:${BRAND}; letter-spacing:.3px; margin-bottom:26px; }
  .tick b { font-weight:800; }
  .verdict { display:flex; align-items:center; gap:30px; }
  .dot { width:${c.small ? 30 : 38}px; height:${c.small ? 30 : 38}px; border-radius:50%; background:${c.dot}; flex:none; }
  .word { font-family:'Plus Jakarta Sans',sans-serif; font-weight:800; font-size:${wordSize}px; letter-spacing:-2px; line-height:1; }
  .mean { font-size:34px; font-weight:500; color:${c.text}; opacity:.8; margin-top:26px; }
  .foot { position:absolute; left:90px; bottom:64px; font-size:24px; font-weight:600; color:${c.text}; opacity:.7; }
</style></head>
<body><div class="card">
  <div class="glow"></div>
  <div class="tick">✓ Verified by <b>fcheck.in</b></div>
  <div class="verdict"><span class="dot"></span><span class="word">${c.label}</span></div>
  <div class="mean">${c.meaning}</div>
  <div class="foot">fcheck.in · Non-partisan · Sources shown on every report</div>
</div></body></html>`;
}

mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'fcheck-og-'));

for (const c of CARDS) {
  const htmlPath = join(work, `${c.file}.html`);
  const outPath = join(OUT_DIR, `${c.file}.png`);
  writeFileSync(htmlPath, html(c));
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      '--virtual-time-budget=6000',
      `--screenshot=${outPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: 'ignore' },
  );
  console.log(`  ✓ public/og/${c.file}.png`);
}

console.log(`\nGenerated ${CARDS.length} share cards → public/og/`);
