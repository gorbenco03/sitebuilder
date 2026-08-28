'use strict';
/**
 * S60: stranger /app/ leftover chrome after S59 (not photos).
 *
 * Exact leftovers remade this slice:
 *   1. Isolated/dev + no CF country → USD $99 (must be EUR 99€ for RO stranger)
 *   2. Builder chrome "Deschide linkul de testare" / English "publish" label
 *   3. First local-service preset Londra +44
 *   4. Unknown browser route → raw JSON `{ error: 'not found' }`
 *
 * Overlay parent SHA 08fec42 → RED on those leftovers; HEAD → GREEN.
 * Run: node bot/test/s60-stranger-chrome.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '08fec42070d3c0b1fa8d3f897588c1713588d5ed';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's60-stranger-chrome-'));
process.env.DATA_DIR = tmpDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.SERVER_SECRET = 's60-test-' + crypto.randomBytes(8).toString('hex');
process.env.PUBLIC_URL = 'http://127.0.0.1:0';
delete process.env.NODE_ENV;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.BRAND_DOMAIN;
delete process.env.CONTACT_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;

let failed = 0;
function check(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      return ret
        .then(() => console.log('PASS', name))
        .catch((e) => {
          failed++;
          console.error('FAIL', name, '-', e.message);
        });
    }
    console.log('PASS', name);
    return Promise.resolve();
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    return Promise.resolve();
  }
}

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadPricingFromSource(src, env) {
  const tmp = path.join(tmpDir, 'pricing-' + crypto.randomBytes(4).toString('hex') + '.js');
  fs.writeFileSync(tmp, src);
  // Fresh process env via child would be heavier; instead mutate process.env around require.
  const prev = {
    ISO: process.env.HIDOOK_ISOLATED_DEPLOY,
    TP: process.env.HIDOOK_TEST_PAY,
    NE: process.env.NODE_ENV,
  };
  try {
    if (env.HIDOOK_ISOLATED_DEPLOY == null) delete process.env.HIDOOK_ISOLATED_DEPLOY;
    else process.env.HIDOOK_ISOLATED_DEPLOY = env.HIDOOK_ISOLATED_DEPLOY;
    if (env.HIDOOK_TEST_PAY == null) delete process.env.HIDOOK_TEST_PAY;
    else process.env.HIDOOK_TEST_PAY = env.HIDOOK_TEST_PAY;
    if (env.NODE_ENV == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env.NODE_ENV;
    delete require.cache[require.resolve(tmp)];
    // path may not be in require cache by resolve — use absolute
    delete require.cache[tmp];
    return require(tmp);
  } finally {
    if (prev.ISO == null) delete process.env.HIDOOK_ISOLATED_DEPLOY;
    else process.env.HIDOOK_ISOLATED_DEPLOY = prev.ISO;
    if (prev.TP == null) delete process.env.HIDOOK_TEST_PAY;
    else process.env.HIDOOK_TEST_PAY = prev.TP;
    if (prev.NE == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev.NE;
  }
}

function httpGet(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  // ── Causal RED on parent SHA ────────────────────────────────────────────
  await check(`parent ${PARENT_SHA.slice(0, 7)} isolated default is USD without CF`, () => {
    const src = parentBlob('bot/pricing.js');
    // Parent has no isolated RO default path
    assert.ok(
      !/HIDOOK_ISOLATED_DEPLOY|isIsolatedDevBoot|accept-language/i.test(src),
      'parent pricing already has isolated Accept-Language/RO path — pick another RED'
    );
    const pricing = loadPricingFromSource(src, {
      HIDOOK_ISOLATED_DEPLOY: '1',
      HIDOOK_TEST_PAY: '1',
    });
    const p = pricing.getPricing({ headers: {} });
    assert.strictEqual(p.currency, 'usd', 'parent isolated empty headers must default USD');
    assert.strictEqual(pricing.formatMoney(p.amount, p.currency), '$100');
  });

  await check(`parent ${PARENT_SHA.slice(0, 7)} builder still says linkul de testare`, () => {
    const html = parentBlob('builder/index.html');
    const js = parentBlob('builder/app.js');
    assert.ok(
      /linkul de testare/i.test(html) || /linkul de testare/i.test(js),
      'parent builder no longer has linkul de testare'
    );
    assert.ok(
      /primul publish/i.test(html),
      'parent builder no longer has English publish label "primul publish"'
    );
  });

  await check(`parent ${PARENT_SHA.slice(0, 7)} first local-service is Londra +44`, () => {
    const raw = parentBlob('templates/local-service/presets.json');
    const data = JSON.parse(raw);
    const first = data.presets[0];
    assert.ok(first && first.id, 'parent first preset missing');
    const blob = JSON.stringify(first);
    assert.ok(/\bLondra\b/i.test(blob), 'parent first preset no longer names Londra');
    assert.ok(/\+44|4479/i.test(blob), 'parent first preset no longer has +44 contact');
  });

  await check(`parent ${PARENT_SHA.slice(0, 7)} unknown browser route is raw JSON 404`, () => {
    const src = parentBlob('bot/server.js');
    assert.ok(
      /sendJson\(\s*res,\s*404,\s*\{\s*error:\s*['"]not found['"]\s*\}\s*\)/.test(src),
      'parent catch-all must send JSON not found'
    );
    assert.ok(
      !/sendHtmlNotFound|wantsHtmlDocument|Pagina nu a fost g[ăa]sit[ăa]/i.test(src),
      'parent already has HTML document 404 — pick another RED'
    );
  });

  // ── HEAD GREEN ──────────────────────────────────────────────────────────
  await check('HEAD isolated/dev no CF → EUR 99€ (not $99)', () => {
    // Ensure isolated env active for in-process pricing module
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.HIDOOK_TEST_PAY = '1';
    delete process.env.NODE_ENV;
    delete require.cache[require.resolve('../pricing.js')];
    const pricing = require('../pricing.js');
    const bare = pricing.getPricing({ headers: {} });
    assert.strictEqual(bare.currency, 'eur', 'isolated bare headers → eur');
    assert.strictEqual(bare.countryCode, 'RO');
    assert.strictEqual(pricing.formatMoney(bare.amount, bare.currency), '99€');
    assert.strictEqual(pricing.formatMoney(bare.renewal, bare.currency), '29€');

    const ro = pricing.getPricing({ headers: { 'accept-language': 'ro-RO,ro;q=0.9' } });
    assert.strictEqual(ro.currency, 'eur');
    assert.strictEqual(ro.countryCode, 'RO');

    // CF still wins (production buckets)
    const us = pricing.getPricing({ headers: { 'cf-ipcountry': 'US' } });
    assert.strictEqual(us.currency, 'usd');
    assert.strictEqual(pricing.formatMoney(us.amount, us.currency), '$99');

    const de = pricing.getPricing({ headers: { 'cf-ipcountry': 'DE' } });
    assert.strictEqual(de.currency, 'eur');
  });

  await check('HEAD non-isolated still defaults USD (production path)', () => {
    process.env.HIDOOK_ISOLATED_DEPLOY = '0';
    process.env.HIDOOK_TEST_PAY = '0';
    delete require.cache[require.resolve('../pricing.js')];
    const pricing = require('../pricing.js');
    const p = pricing.getPricing({ headers: {} });
    assert.strictEqual(p.currency, 'usd');
    // restore isolated for server integration
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.HIDOOK_TEST_PAY = '1';
    delete require.cache[require.resolve('../pricing.js')];
  });

  await check('HEAD builder chrome has no factory testare / English publish label', () => {
    const html = headRead('builder/index.html');
    const js = headRead('builder/app.js');
    const surface = html + '\n' + js;
    assert.ok(!/linkul de testare/i.test(surface), 'must not say linkul de testare');
    assert.ok(!/primul publish/i.test(html), 'must not use English publish as visible label');
    assert.ok(
      !/\bverticale\b/i.test(surface),
      'builder surface must not show verticale'
    );
    assert.ok(!/\bDESSERD\b/i.test(surface));
    assert.ok(!/desserdina/i.test(surface));
    assert.ok(!/MENU\s*BOARD/i.test(surface));
    assert.ok(!/SERVER_SECRET/.test(surface));
    // Commercial verbs (RO product surface; EN publish may still appear in residual chrome)
    assert.ok(/Publish site|Publică site|Publică/i.test(html), 'publish verb expected');
    assert.ok(/Open the site|Deschide site|Deschide site-ul/i.test(surface), 'live site label expected');
  });

  await check('HEAD first local-service preset is commercial US market (not Londra +44)', () => {
    const data = JSON.parse(headRead('templates/local-service/presets.json'));
    const first = data.presets[0];
    assert.strictEqual(first.id, 'renovari-interioare-londra', 'keep stable id');
    const surface = JSON.stringify({ name: first.name, config: first.config });
    assert.ok(!/\bLondra\b/i.test(surface), 'no Londra in human surface');
    assert.ok(!/\+44\b|4479/i.test(surface), 'no +44 contact');
    assert.ok(/\+1[\s-]?512|512-555/.test(surface), 'US (Austin) phone expected');
    assert.ok(/Austin/i.test(surface), 'US zone expected');
    // Keep image refs
    assert.ok(/images\/pr-hero\.jpg/.test(surface), 'keep existing images/ refs');
    assert.ok(!/picsum|unsplash/i.test(surface), 'no external stock conveyor');
  });

  // Live server: /api/config + HTML 404
  delete require.cache[require.resolve('../server.js')];
  delete require.cache[require.resolve('../pricing.js')];
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  delete process.env.NODE_ENV;
  const { startServer } = require('../server.js');
  const srv = startServer({ port: 0 });
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();

  await check('HEAD GET /api/config isolated bare → eur 99 / renewal 29', async () => {
    const res = await httpGet(port, '/api/config', {
      Accept: 'application/json',
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.currency, 'eur');
    assert.strictEqual(json.amount, 99);
    assert.strictEqual(json.renewal, 29);
  });

  await check('HEAD GET /api/config Accept-Language ro → eur', async () => {
    const res = await httpGet(port, '/api/config', {
      Accept: 'application/json',
      'Accept-Language': 'ro,en;q=0.8',
    });
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.currency, 'eur');
  });

  await check('HEAD browser unknown path → Romanian HTML 404 (not raw JSON)', async () => {
    const res = await httpGet(port, '/this-route-does-not-exist-s60', {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    assert.strictEqual(res.status, 404);
    const ct = String(res.headers['content-type'] || '');
    assert.ok(/text\/html/i.test(ct), 'content-type must be text/html, got ' + ct);
    assert.ok(!/^\s*\{/.test(res.body.trim()), 'body must not be JSON object');
    assert.ok(
      /Pagină negăsită|Page not found|nu mai este public/i.test(res.body),
      'Romanian not-found copy required'
    );
    assert.ok(/\/app\//.test(res.body), 'should link back to /app/');
    assert.ok(!/SERVER_SECRET/.test(res.body));
  });

  await check('HEAD API unknown path stays JSON 404', async () => {
    const res = await httpGet(port, '/api/nope-s60', {
      Accept: 'text/html,application/json',
    });
    assert.strictEqual(res.status, 404);
    const ct = String(res.headers['content-type'] || '');
    assert.ok(/application\/json/i.test(ct), 'API 404 stays JSON');
    const json = JSON.parse(res.body);
    assert.strictEqual(json.error, 'not found');
  });

  await new Promise((r) => srv.close(r));

  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
