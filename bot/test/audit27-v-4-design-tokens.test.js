'use strict';
/**
 * bot/test/audit27-v-4-design-tokens.test.js — V-4 (PLAN-UX §6, builder visual system).
 *
 * builder/app.css repeated raw colours (46 unique literals), 36 distinct
 * font-size values and 13 radius spellings, including three warm greys for
 * one border role and a cool grey that belongs to no palette. The chrome now
 * reads one set of :root tokens (colours, type scale, spacing, radii,
 * shadows). RED on the old file (hundreds of raw literals); GREEN when every
 * rule outside the topbar / cookie banner / colour popover blocks uses tokens.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-v-4-design-tokens.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const raw = fs.readFileSync(process.env.V4_CSS || path.join(ROOT, 'builder', 'app.css'), 'utf8');

// Blank comments (keeping offsets), then collect the token block and the
// ranges owned by other tasks (topbar section, cookie banner, colour popover).
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
const rootMatch = css.match(/:root\s*\{[^}]*\}/);
const OWNED = /editor-topbar|cookie-banner|color-popover/;
const skips = [[rootMatch.index, rootMatch.index + rootMatch[0].length]];
const tStart = raw.indexOf('/* ---------- Editor Topbar ---------- */');
const tEnd = raw.indexOf('.btn-publish-top {');
if (tStart >= 0 && tEnd > tStart) skips.push([tStart, tEnd]);
{
  const stack = []; let seg = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') { stack.push({ sel: css.slice(seg, i), start: seg }); seg = i + 1; }
    else if (c === '}') { const r = stack.pop(); if (r && OWNED.test(r.sel)) skips.push([r.start, i + 1]); seg = i + 1; }
    else if (c === ';') seg = i + 1;
  }
}
const skipped = (o) => skips.some(([a, b]) => o >= a && o < b);
function find(rx) {
  const out = []; let m; rx.lastIndex = 0;
  while ((m = rx.exec(css))) if (!skipped(m.index)) out.push(m[0].trim());
  return out;
}
const tokens = Object.fromEntries([...rootMatch[0].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

test('V-4: the token set covers colour, type, spacing, radius and shadow roles', () => {
  for (const t of ['--bg', '--surface', '--text', '--text-muted', '--border', '--accent', '--error', '--success', '--warning',
    '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl',
    '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
    '--radius-sm', '--radius-xs', '--radius-md', '--radius-lg', '--radius-pill', '--radius-round',
    '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-pop', '--scrim']) {
    assert.ok(tokens[t], `missing token ${t}`);
  }
});

test('V-4: no raw colour literal outside the token block (mask alpha stops excepted)', () => {
  const hits = find(/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\([^)]*\)/g)
    .filter((h) => !/^#000$/i.test(h)); // gradient mask stops carry alpha only
  // Id selectors such as #add-section-modal-body never match: they are followed by [\w-].
  assert.deepEqual(hits, [], 'raw colours must be tokens: ' + hits.join(', '));
});

test('V-4: every font-size is a scale token (or an explicit exception)', () => {
  const allowed = /^font-size:\s*(var\(--fs-(2xs|xs|sm|md|base|lg|xl|display-1|display-2)\)|0|16px|9px)\s*(!important)?$/;
  const bad = find(/font-size:\s*[^;}]+/g).filter((d) => !allowed.test(d));
  assert.deepEqual(bad, [], 'off-scale font sizes: ' + bad.join(' | '));
});

test('V-4: every border-radius is a radius token (or 0 / 2px chip)', () => {
  const allowed = /^border-radius:\s*(var\(--radius-(sm|xs|md|lg|pill|round)\)|0|2px)(\s+[^;]*)?$/;
  const bad = find(/border-radius:\s*[^;}]+/g).filter((d) => !allowed.test(d.replace(/\s*!important/, '')));
  assert.deepEqual(bad, [], 'off-scale radii: ' + bad.join(' | '));
});

test('V-4: shadows and fallback-var literals are consolidated', () => {
  assert.deepEqual(find(/box-shadow:[^;}]*rgba?\(/g), [], 'box-shadow must use a shadow token');
  assert.deepEqual(find(/var\(--[\w-]+,\s*[#\d]/g), [], 'var() fallbacks must not carry raw literals');
});

// WCAG relative luminance contrast.
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('V-4: text tokens keep >= 4.5:1 on the surfaces they sit on', () => {
  const pairs = [
    ['--text', '--bg'], ['--text', '--surface'], ['--text-muted', '--bg'], ['--text-light', '--bg'],
    ['--warning-strong', '--warning-bg'], ['--warning-strong', '--warning-bg-strong'],
    ['--error-strong', '--error-bg'], ['--success-strong', '--success-bg'], ['--warning', '--warning-bg'],
  ];
  for (const [fg, bg] of pairs) {
    const r = ratio(tokens[fg], tokens[bg]);
    assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
  }
});
