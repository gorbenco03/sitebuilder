'use strict';
/**
 * bot/test/audit27-u-08-icon-set-empty-states.test.js — U-08 (PLAN-UX-2026-09-27
 * §6): the builder's own chrome used system emoji as icons (clipboard for the
 * empty "Site-urile mele" dashboard, chart for the failed designs grid) and
 * gave empty/loading/error states no consistent visual treatment.
 *
 * RED on the parent commit (system emoji entities present).
 * GREEN on HEAD: no emoji-as-icon entities remain, a small inline SVG icon
 * set backs every empty/error state through one shared helper, and a
 * matching loading pattern exists — all self-contained (no icon CDN).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-08-icon-set-empty-states.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '88402c6';
const APP_JS_REL = 'builder/app.js';
const APP_CSS_REL = 'builder/app.css';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

// Any HTML numeric entity in the pictographic/emoji ranges (clipboard 128203,
// chart 128200, and the same family generally) — the exact defect the plan
// names, not a stand-in for it.
const EMOJI_ENTITY_RE = /&#(12[7-9]\d{3}|1[3-9]\d{4});/;

test('RED: parent app.js used emoji HTML entities as empty/error-state icons', () => {
  const parentSrc = parentBlob(APP_JS_REL);
  assert.match(parentSrc, EMOJI_ENTITY_RE, 'parent must contain an emoji entity (the defect this task fixes)');
  assert.match(parentSrc, /&#128203;/, 'parent used the clipboard emoji for the empty dashboard');
  assert.match(parentSrc, /&#128200;/, 'parent used the chart emoji for the failed designs grid');
});

test('GREEN: HEAD app.js has no emoji-entity icons anywhere', () => {
  const src = read(APP_JS_REL);
  assert.doesNotMatch(src, EMOJI_ENTITY_RE, 'no emoji HTML entity should remain as an icon');
});

test('GREEN: HEAD ships a small inline SVG icon set, no external icon CDN', () => {
  const src = read(APP_JS_REL);
  assert.match(src, /const STATE_ICONS\s*=\s*\{/, 'a named icon set exists');
  assert.match(src, /<svg viewBox="0 0 24 24"/, 'icons are inline SVG at a 24px viewBox');
  assert.match(src, /stroke-width="1\.5"/, 'icons use the 1.5px stroke spec');
  assert.match(src, /currentColor/, 'icons use currentColor so they inherit state color');
  // Self-contained: never a remote icon font/CDN reference anywhere in the builder chrome.
  assert.doesNotMatch(src, /fontawesome|feathericons|heroicons|unpkg\.com|cdnjs\.cloudflare\.com/i);
  const css = read(APP_CSS_REL);
  assert.doesNotMatch(css, /fontawesome|feathericons|heroicons|unpkg\.com|cdnjs\.cloudflare\.com/i);
});

test('GREEN: empty/error states share one rendering pattern (icon + title + explanation + one action)', () => {
  const src = read(APP_JS_REL);
  assert.match(
    src,
    /function stateBlockHTML\(/,
    'one shared helper builds every empty/error state block'
  );
  // The two states the plan names by name both route through the shared helper.
  const dashboardEmpty = src.slice(src.indexOf('async function loadDashboard'), src.indexOf('async function loadDashboard') + 1800);
  assert.match(dashboardEmpty, /stateBlockHTML\(\{/, 'dashboard empty/error states use the shared helper');
  assert.match(dashboardEmpty, /icon:\s*'tray'/, 'empty dashboard uses the tray icon');
  assert.match(dashboardEmpty, /icon:\s*'alert'/, 'dashboard error state uses the alert icon');

  const gridFn = src.slice(src.indexOf('function renderTemplatesGrid'), src.indexOf('function renderTemplatesGrid') + 1200);
  assert.match(gridFn, /stateBlockHTML\(\{/, 'failed designs grid uses the shared helper');
  assert.match(gridFn, /icon:\s*'alert'/, 'failed designs grid uses the alert icon, not the old chart emoji');
});

test('GREEN: loading placeholders share one pattern too (spinning icon + text)', () => {
  const src = read(APP_JS_REL);
  assert.match(src, /function loadingStateHTML\(/, 'one shared helper builds every inline loading placeholder');
  const dashboardEmpty = src.slice(src.indexOf('async function loadDashboard'), src.indexOf('async function loadDashboard') + 400);
  assert.match(dashboardEmpty, /loadingStateHTML\(/, 'dashboard loading placeholder uses the shared helper');
});

test('GREEN: app.css defines a consistent, sized icon badge and a loading spin, not raw emoji font-size', () => {
  const css = read(APP_CSS_REL);
  assert.doesNotMatch(
    css,
    /\.empty-state-icon\s*\{\s*font-size:\s*2\.5rem/,
    'the old emoji-sized icon rule must be gone'
  );
  assert.match(css, /\.empty-state-icon\s+svg\s*\{/, 'the icon badge sizes the inline svg explicitly');
  assert.match(css, /\.loading-state-icon\s*\{[^}]*animation:\s*hb-spin/, 'the loading icon animates via a named keyframe');
  assert.match(css, /@keyframes hb-spin/, 'the spin keyframe is defined once and shared');
});
