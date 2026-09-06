'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-acf23fc9e0fab5e11';
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xss-check-'));
// Copy portfolio template tree
execFileSync('cp', ['-R', path.join(ROOT, 'templates/portfolio'), path.join(tmp, 'site')]);
const siteDir = path.join(tmp, 'site');
const raw = JSON.parse(fs.readFileSync(path.join(siteDir, 'presets.json'), 'utf8'));
const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));

// Find a services-like @each block with an 'icon' raw sink target, inject payload.
const payload1 = '<a href="jav\tascript:alert(1)">x</a>'; // tab-in-scheme bypass
const payload2 = '<a href="&#106;avascript:alert(2)">x</a>'; // decimal-entity bypass

function injectIconEverywhere(obj) {
  if (Array.isArray(obj)) { obj.forEach(injectIconEverywhere); return; }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (k === 'icon' && typeof obj[k] === 'string') {
        obj[k] = payload1 + payload2;
      } else {
        injectIconEverywhere(obj[k]);
      }
    }
  }
}
injectIconEverywhere(cfg);

fs.writeFileSync(path.join(siteDir, 'config.json'), JSON.stringify(cfg, null, 2));
execFileSync('node', [path.join(ROOT, 'build.js'), siteDir], { cwd: siteDir, stdio: 'inherit' });

const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const hasRawJs1 = /jav\tascript:/i.test(html) || /href=["']jav[\s\S]{0,3}ascript:/i.test(html);
const hasRawJs2 = /&#106;avascript:/i.test(html);
console.log('Contains tab-bypass javascript: href in output?', hasRawJs1);
console.log('Contains decimal-entity bypass in output (unresolved)?', hasRawJs2);
console.log('Any literal href="javascript: in output?', html.includes('href="javascript:') || html.includes("href='javascript:"));

fs.rmSync(tmp, { recursive: true, force: true });
