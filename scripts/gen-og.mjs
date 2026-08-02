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
// Verdict icons — drawn as inline SVG (white on the coloured badge) so they render
// crisp and monochrome, with none of the colour-emoji surprises a font glyph risks.
const ICON = {
  check: '<polyline points="26,52 44,70 76,32" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<line x1="33" y1="33" x2="67" y2="67" stroke="#fff" stroke-width="12" stroke-linecap="round"/><line x1="67" y1="33" x2="33" y2="67" stroke="#fff" stroke-width="12" stroke-linecap="round"/>',
  bang: '<line x1="50" y1="27" x2="50" y2="57" stroke="#fff" stroke-width="12" stroke-linecap="round"/><circle cx="50" cy="74" r="7" fill="#fff"/>',
  clock: '<circle cx="50" cy="50" r="27" fill="none" stroke="#fff" stroke-width="9"/><line x1="50" y1="50" x2="50" y2="33" stroke="#fff" stroke-width="8" stroke-linecap="round"/><line x1="50" y1="50" x2="63" y2="57" stroke="#fff" stroke-width="8" stroke-linecap="round"/>',
  query: '<text x="50" y="53" text-anchor="middle" dominant-baseline="central" font-family="\'Plus Jakarta Sans\',sans-serif" font-weight="800" font-size="66" fill="#fff">?</text>',
  smile: '<circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="8"/><circle cx="40" cy="44" r="4.5" fill="#fff"/><circle cx="60" cy="44" r="4.5" fill="#fff"/><path d="M38 58 Q50 69 62 58" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
};

// `plain` is the elderly-friendly, plain-language line shown on the card. The
// precise definitions still live in src/lib/types.ts (VERDICT_MEANINGS) for the
// on-page copy; these are deliberately shorter and simpler for a glanceable image.
const CARDS = [
  { file: 'verdict-false',        label: 'FALSE',        plain: 'This claim is not true.',            icon: ICON.cross, bg: '#FEF2F2', text: '#B91C1C', bd: '#FECACA', dot: '#EF4444' },
  { file: 'verdict-true',         label: 'TRUE',         plain: 'This claim is true.',                icon: ICON.check, bg: '#F0FDF4', text: '#15803D', bd: '#BBF7D0', dot: '#22C55E' },
  { file: 'verdict-misleading',   label: 'MISLEADING',   plain: 'This claim is misleading.',          icon: ICON.bang,  bg: '#FFFBEB', text: '#B45309', bd: '#FDE68A', dot: '#F97316' },
  { file: 'verdict-outdated',     label: 'OUTDATED',     plain: 'This was true before — not anymore.', icon: ICON.clock, bg: '#EFF6FF', text: '#1D4ED8', bd: '#BFDBFE', dot: '#EAB308' },
  { file: 'verdict-unverifiable', label: 'UNVERIFIABLE', plain: "There isn't enough evidence to say.", icon: ICON.query, bg: '#F8FAFC', text: '#475569', bd: '#CBD5E1', dot: '#8B5CF6' },
  { file: 'verdict-satire',       label: 'SATIRE',       plain: 'This is satire, not real news.',      icon: ICON.smile, bg: '#F5F3FF', text: '#6D28D9', bd: '#DDD6FE', dot: '#EC4899' },
];

// TYPE 4 (submitted, no verdict) — its own single card, not shareable but kept
// for completeness. Neutral wordmark, no "verified" claim.
const UNDER_REVIEW = { file: 'under-review', label: 'UNDER REVIEW', plain: 'Being checked by our team.', icon: ICON.clock, bg: '#F8FAFC', text: '#475569', bd: '#CBD5E1', dot: '#94A3B8' };

// Two branding variants of each verdict card:
//   ''      → TYPE 1 originals — "Verified by fcheck.in" is accurate (our verdict)
//   '-ext'  → TYPE 2 external  — neutral "fcheck.in" wordmark, because the verdict
//             belongs to the attributed external fact-checker, not us. Claiming
//             "Verified by fcheck.in" there would breach the credit-external rule.
const VARIANTS = [
  { suffix: '',     header: '✓ Verified by <b>fcheck.in</b>' },
  { suffix: '-ext', header: '✓ <b>fcheck.in</b>' },
];

const BRAND = '#0D9488';

function html(c, header) {
  // Verdict word shrinks for the longest labels so the badge + word stay on one line.
  const len = c.label.replace(/\s/g, '').length;
  const wordSize = len >= 12 ? 96 : len >= 10 ? 108 : 124;
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
    padding:80px 90px; display:flex; flex-direction:column; justify-content:center;
  }
  .glow { position:absolute; top:-30%; right:-8%; width:55%; height:150%;
    background:radial-gradient(closest-side, ${c.dot} 0%, transparent 70%); opacity:.16; }
  .tick { position:absolute; top:64px; left:90px; font-size:32px; font-weight:700; color:${BRAND}; letter-spacing:.3px; }
  .tick b { font-weight:800; }
  .row { display:flex; align-items:center; gap:40px; }
  .badge { width:168px; height:168px; border-radius:50%; background:${c.dot}; flex:none; display:flex; align-items:center; justify-content:center; }
  .badge svg { width:168px; height:168px; }
  .word { font-family:'Plus Jakarta Sans',sans-serif; font-weight:800; font-size:${wordSize}px; letter-spacing:-2px; line-height:1; }
  .mean { font-size:52px; font-weight:600; color:${c.text}; margin-top:38px; line-height:1.2; }
  .foot { position:absolute; left:90px; bottom:60px; font-size:25px; font-weight:600; color:${c.text}; opacity:.7; }
</style></head>
<body><div class="card">
  <div class="glow"></div>
  <div class="tick">${header}</div>
  <div class="row">
    <div class="badge"><svg viewBox="0 0 100 100">${c.icon}</svg></div>
    <div class="word">${c.label}</div>
  </div>
  <div class="mean">${c.plain}</div>
  <div class="foot">fcheck.in · Non-partisan · Sources shown on every report</div>
</div></body></html>`;
}

mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'fcheck-og-'));

function render(file, markup) {
  const htmlPath = join(work, `${file}.html`);
  const outPath = join(OUT_DIR, `${file}.png`);
  writeFileSync(htmlPath, markup);
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
  console.log(`  ✓ public/og/${file}.png`);
}

let count = 0;
for (const c of CARDS) {
  for (const v of VARIANTS) {
    render(`${c.file}${v.suffix}`, html(c, v.header));
    count++;
  }
}
render(UNDER_REVIEW.file, html(UNDER_REVIEW, '✓ <b>fcheck.in</b>'));
count++;

console.log(`\nGenerated ${count} share cards → public/og/`);
