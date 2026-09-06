'use strict';
/**
 * wave5-portfolio-xss-icon — re-verifies the AUDIT-10 stored XSS fix, audit
 * 2026-09-06 (04-QA-Evidence/Audit-2026-09-06-2225ca7, finding #10):
 *
 *   "Stored XSS: sink-ul raw `{{& icon}}` poate fi ocolit cu `jav<TAB>ascript:`
 *    în href — `alert()` executat real în Chromium."
 *
 * A fix landed in build.js's raw-sink handling for the `icon` token
 * (services[].icon, rendered via `{{& icon}}` in templates/portfolio/
 * template.html): it strips <script>/<foreignObject> blocks, neutralises
 * on*= handlers, and blanks href/xlink:href/src/action/formaction values
 * whose scheme matches /(?:javascript|data|vbscript)\s*:/i.
 *
 * That regex requires the literal, CONTIGUOUS string "javascript" (only
 * surrounding whitespace is tolerated, via \s*, and only right before the
 * colon) — it does NOT strip whitespace/control characters that land INSIDE
 * the word itself before checking, and it does NOT decode HTML entities
 * first. Browsers do both: the WHATWG URL spec strips every ASCII tab/CR/LF
 * from a URL string wherever it appears (not just at the ends) before parsing
 * the scheme, and the HTML parser decodes entities in attribute values before
 * the attribute's string value even exists. So `jav<TAB>ascript:`,
 * `jav<CR>ascript:`, `jav<LF>ascript:`, and `&#106;avascript:` (entity for
 * "j") all read as a non-matching string to the sanitizer's regex, but as
 * plain `javascript:` to the browser that ultimately navigates the link.
 *
 * This oracle runs a service list carrying one icon per bypass variant
 * through the FULL production pipeline (build.js's `build()` — the exact
 * function a real publish calls, which also writes cookie-banner.css/js
 * etc.), loads the built page in real Chromium, and clicks each icon's link
 * to see whether it actually navigates to `javascript:` (in which case the
 * page would execute arbitrary JS on click) or was neutralised to `#`.
 *
 * Run: node bot/test/wave5-portfolio-xss-icon.test.js
 * Evidence: 04-QA-Evidence/Wave5-portfolio/xss/
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave5-portfolio', 'xss');
const TPL_DIR = path.join(ROOT, 'templates', 'portfolio');

function loadPlaywright() {
  return require('playwright'); // bare specifier: resolves via node_modules walk-up
}

// Each variant wraps a visible 24x24 rect in an <a> whose href carries the
// payload. If the sanitizer misses it, clicking the rect runs this JS.
const MARKER = 'window.__xssFired = (window.__xssFired||0) + 1;';
function svgWithHref(href) {
  return `<svg viewBox='0 0 24 24'><a href="${href}"><rect width='24' height='24' fill='red'/></a></svg>`;
}

const VARIANTS = [
  {
    id: 'tab',
    label: 'TAB inside the scheme word (jav<TAB>ascript:)',
    icon: svgWithHref('jav\tascript:' + MARKER),
  },
  {
    id: 'cr',
    label: 'CR inside the scheme word (jav<CR>ascript:)',
    icon: svgWithHref('jav\rascript:' + MARKER),
  },
  {
    id: 'lf',
    label: 'LF inside the scheme word (jav<LF>ascript:)',
    icon: svgWithHref('jav\nascript:' + MARKER),
  },
  {
    id: 'entity-decimal',
    label: 'HTML decimal entity for "j" (&#106;avascript:)',
    icon: svgWithHref('&#106;avascript:' + MARKER),
  },
  {
    id: 'entity-hex',
    label: 'HTML hex entity for "j" (&#x6a;avascript:)',
    icon: svgWithHref('&#x6a;avascript:' + MARKER),
  },
  {
    id: 'plain-control',
    label: 'sanity: plain javascript: with no obfuscation (must already be blocked)',
    icon: svgWithHref('javascript:' + MARKER),
  },
];

function buildSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-portfolio-xss-'));
  for (const name of ['template.html', 'styles.css', 'script.js', 'collage.js', 'qrcode.js']) {
    fs.copyFileSync(path.join(TPL_DIR, name), path.join(dir, name));
  }
  fs.cpSync(path.join(TPL_DIR, 'images'), path.join(dir, 'images'), { recursive: true });

  const presets = JSON.parse(fs.readFileSync(path.join(TPL_DIR, 'presets.json'), 'utf8')).presets;
  const preset = presets.find((p) => p.id === 'atelier-ivoire-ro');
  assert.ok(preset, 'preset atelier-ivoire-ro must exist');
  const config = JSON.parse(JSON.stringify(preset.config));
  // Replace the services list with one crafted entry per bypass variant —
  // this is exactly the field (services[].icon) an attacker with editor
  // access (or a compromised/malicious AI-drafted config) would use, and
  // exactly what the audit's PoC exploited.
  config.services = VARIANTS.map((v, i) => ({ icon: v.icon, label: 'Variant ' + i + ': ' + v.id, price: '' }));

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

  const { build } = require(path.join(ROOT, 'build.js'));
  build(dir);
  return dir;
}

function serveDir(dir) {
  const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json',
  };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.join(dir, p);
    if (!fp.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = loadPlaywright();
  const dir = buildSite();
  const server = await serveDir(dir);
  const base = 'http://127.0.0.1:' + server.address().port;

  const report = [];
  let vulnerableCount = 0;

  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
      const dialogs = [];
      page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
        await page.locator('#hb-cookie-accept').click().catch(() => {});
      }
      await page.waitForSelector('.pf-chip', { timeout: 10000 });

      // First: confirm what actually landed in the DOM for each icon — this
      // is the ground truth of what the sanitizer produced.
      const renderedHrefs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.pf-chip__icon')).map((el) => {
          const a = el.querySelector('a');
          return a ? a.getAttribute('href') : null;
        });
      });

      for (let i = 0; i < VARIANTS.length; i++) {
        const v = VARIANTS[i];
        const chip = page.locator('.pf-chip').nth(i).locator('a').first();
        const before = await page.evaluate(() => window.__xssFired || 0);
        let navigationError = null;
        try {
          await chip.click({ timeout: 3000, force: true });
        } catch (e) {
          navigationError = e.message;
        }
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => window.__xssFired || 0);
        const fired = after > before;
        if (fired) vulnerableCount++;
        report.push({
          id: v.id,
          label: v.label,
          renderedHref: renderedHrefs[i],
          xssFired: fired,
          navigationError,
          verdict: fired ? 'VULNERABLE — payload executed' : 'safe — neutralised',
        });
        console.log((fired ? 'VULNERABLE' : 'safe'), v.id, '-', v.label, '| rendered href =', JSON.stringify(renderedHrefs[i]));
      }

      await page.screenshot({ path: path.join(EVIDENCE, 'services-with-payloads.png'), fullPage: true });
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(EVIDENCE, 'bypass-attempts.json'), JSON.stringify(report, null, 2));

  console.log('\n--- summary ---');
  for (const r of report) console.log(' ', r.id.padEnd(16), r.verdict, ' href=' + JSON.stringify(r.renderedHref));

  if (vulnerableCount > 0) {
    console.error('\nFAILED:', vulnerableCount, 'of', VARIANTS.length, 'variant(s) bypass the icon sanitizer.');
    process.exit(1);
  }
  console.log('\nOK wave5-portfolio-xss-icon (all', VARIANTS.length, 'bypass variants neutralised)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
