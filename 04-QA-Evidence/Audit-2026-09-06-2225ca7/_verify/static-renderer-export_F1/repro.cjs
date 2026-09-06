const { renderHtml } = require('/Users/Work/Desktop/sitebuilder/build.js');
const fs = require('fs');
const path = require('path');

const templatePath = '/Users/Work/Desktop/sitebuilder/templates/portfolio/template.html';
const presetsPath = '/Users/Work/Desktop/sitebuilder/templates/portfolio/presets.json';
const templateHtml = fs.readFileSync(templatePath, 'utf8');
const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));

// Start from a real preset config (realistic shape) and tamper services[0].icon,
// simulating either direct API tampering (POST /api/draft) or a future UI path.
const config = JSON.parse(JSON.stringify(presets.presets[0].config));
const payload = "<svg><a href=\"jav\tascript:alert(1)\"><text x=5 y=15>CLICK</text></a></svg>";
config.services[0].icon = payload;

const html = renderHtml(templateHtml, config);

const outPath = path.join(__dirname, 'rendered-portfolio-tampered.html');
fs.writeFileSync(outPath, html, 'utf8');

// Extract just the relevant chip markup for quick inspection.
const idx = html.indexOf('pf-chip__icon');
console.log('--- rendered fragment around first pf-chip__icon ---');
console.log(html.slice(Math.max(0, idx - 40), idx + 300));
console.log('--- contains raw "jav\\tascript:" unmodified? ---', html.includes('jav\tascript:alert(1)'));
