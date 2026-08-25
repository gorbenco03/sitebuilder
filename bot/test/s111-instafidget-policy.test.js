#!/usr/bin/env node
'use strict';
/**
 * bot/test/s111-instafidget-policy.test.js — S111 owner policy + S110 advocate leaks.
 *
 * Policy (owner):
 *   - Live Instagram section only when Instafidget/partner embed is connected.
 *   - Never render direct instagram.com iframe (X-Frame-Options deny → gray hole).
 *   - When not connected: omit public Instagram section (no gallery pretending).
 *   - Mobile chrome at 390: nav/email/site name readable (no Cum/e, no letter-shred email, no qaliv…).
 *   - /app without trailing slash redirects to /app/; HEAD /app/ is 200 HTML not JSON 404.
 *
 * Run: node bot/test/s111-instafidget-policy.test.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '87ab5528278d144926b33e83efafab46fb818564';

const BUILD_JS = 'build.js';
const APP_CSS = 'builder/app.css';
const APP_HTML = 'builder/index.html';
const SERVER_JS = 'bot/server.js';
const SYSTEMS = ['product-menu', 'portfolio', 'local-service', 'professionals'];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function parentBlob(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function cssRule(css, selector) {
  const re = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
    'm'
  );
  const m = re.exec(css);
  return m ? m[1] : '';
}

// ─── Causal RED on parent 87ab552 ───────────────────────────────────

check('causal RED: parent renderHtml does not strip direct instagram.com embedUrl', () => {
  const src = parentBlob(BUILD_JS);
  assert.ok(src, 'parent build.js');
  assert.ok(
    !/isConnectedSocialFeedEmbed|normalizeInstagramForPublic/.test(src),
    'parent lacks S111 Instagram public normalizer'
  );
  // Parent presets ship instagram.com as embedUrl (dead iframe source)
  const pm = parentBlob('templates/product-menu/presets.json');
  assert.ok(pm, 'parent product-menu presets');
  assert.ok(
    /"embedUrl"\s*:\s*"https:\/\/www\.instagram\.com\//.test(pm),
    'parent presets still use direct instagram.com embedUrl'
  );
});

check('causal RED: parent serves bare /app without redirect (relative asset break)', () => {
  const src = parentBlob(SERVER_JS);
  assert.ok(src, 'parent server.js');
  // Parent treats /app and /app/ the same GET path without bare-/app redirect
  assert.ok(
    /url === '\/app' \|\| url === '\/app\/'/.test(src) ||
      /url === "\/app" \|\| url === "\/app\/"/.test(src),
    'parent matches /app and /app/ together'
  );
  assert.ok(
    !/url === '\/app'[\s\S]{0,120}sendRedirect/.test(src),
    'parent has no bare /app → /app/ redirect'
  );
});

check('causal RED: parent HEAD /app/ falls through (no HEAD on static)', () => {
  const src = parentBlob(SERVER_JS);
  assert.ok(src, 'parent server.js');
  assert.ok(
    /req\.method === 'GET' && \(url === '\/app'/.test(src) ||
      /req\.method === 'GET' && \(url === "\/app"/.test(src),
    'parent static only accepts GET'
  );
  assert.ok(
    !/\(req\.method === 'GET' \|\| req\.method === 'HEAD'\).*\/app\//.test(src),
    'parent does not accept HEAD for /app/'
  );
});

check('causal RED: parent .header-nav a can wrap mid-label at narrow width', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block = cssRule(css, '.header-nav a');
  assert.ok(block, 'parent .header-nav a');
  assert.ok(
    !/white-space\s*:\s*nowrap/i.test(block),
    'parent nav links lack nowrap (Cum e can shred)'
  );
});

check('causal RED: parent .user-badge uses break-word (letter shred at 390)', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block = cssRule(css, '.user-badge');
  assert.ok(block, 'parent .user-badge');
  assert.ok(
    /word-break\s*:\s*break-word/i.test(block),
    'parent user-badge break-word shreds email'
  );
});

check('causal RED: parent .site-card-name nowrap+ellipsis mid-clips long names', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block = cssRule(css, '.site-card-name');
  assert.ok(block, 'parent .site-card-name');
  assert.ok(/white-space\s*:\s*nowrap/i.test(block), 'parent nowrap');
  assert.ok(/text-overflow\s*:\s*ellipsis/i.test(block), 'parent ellipsis');
});

check('causal RED: parent Detalii URL uses overflow-wrap:anywhere (mid-handle split)', () => {
  const css = parentBlob(APP_CSS);
  assert.ok(css, 'parent app.css');
  const block =
    cssRule(css, '.field-input--url') ||
    cssRule(css, '.field-textarea--url');
  // Multi-selector rule — scan full css for the pair block
  const m = css.match(
    /\.field-input--url\s*,\s*\.field-textarea--url\s*\{([^}]*)\}/m
  );
  const body = (m && m[1]) || block;
  assert.ok(body, 'parent URL field rule');
  assert.ok(
    /overflow-wrap\s*:\s*anywhere/i.test(body),
    'parent overflow-wrap:anywhere'
  );
});

// ─── GREEN on HEAD ──────────────────────────────────────────────────

check('HEAD: isConnectedSocialFeedEmbed rejects instagram.com, accepts partner', () => {
  const {
    isConnectedSocialFeedEmbed,
  } = require(path.join(ROOT, 'build.js'));
  assert.strictEqual(
    isConnectedSocialFeedEmbed('https://www.instagram.com/foo'),
    false
  );
  assert.strictEqual(
    isConnectedSocialFeedEmbed('https://instagram.com/foo/'),
    false
  );
  assert.strictEqual(
    isConnectedSocialFeedEmbed('https://www.facebook.com/foo'),
    false
  );
  assert.strictEqual(isConnectedSocialFeedEmbed(''), false);
  assert.strictEqual(isConnectedSocialFeedEmbed(null), false);
  assert.strictEqual(
    isConnectedSocialFeedEmbed('https://example.com/embed/demo'),
    true
  );
  assert.strictEqual(
    isConnectedSocialFeedEmbed(
      'https://isolated.local/social-feed/isolated-abc'
    ),
    true
  );
  assert.strictEqual(
    isConnectedSocialFeedEmbed(
      'https://hearth-tan-xi.vercel.app/embed/instagram?widgetKey=x'
    ),
    true
  );
});

check('HEAD: renderHtml with direct IG embedUrl omits section and iframe', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  const tpl = read('templates/product-menu/template.html');
  const html = renderHtml(tpl, {
    business: { name: 'Test' },
    labels: { instaTitle: 'IG', instaFollow: 'Follow' },
    footer: { address: 'x', year: '2026', note: 'n' },
    contact: {},
    instagram: {
      handle: 'qalive.s110.v2.bucuresti',
      url: 'https://www.instagram.com/qalive.s110.v2.bucuresti',
      embedUrl: 'https://www.instagram.com/qalive.s110.v2.bucuresti',
      gallery: ['images/a.jpg', 'images/b.jpg'],
    },
  });
  assert.ok(
    !/instagram\.com\/qalive/i.test(html),
    'no direct instagram.com URL in live HTML'
  );
  assert.ok(
    !/<iframe[^>]+instagram/i.test(html) &&
      !/class="instagram-embed-iframe"/.test(html),
    'no Instagram iframe when not connected'
  );
  assert.ok(
    !/id="instagram-heading"|pm-social|aria-labelledby="instagram-heading"/.test(
      html
    ),
    'no public Instagram section when not connected'
  );
  assert.ok(!/images\/a\.jpg/.test(html), 'no gallery fallback pretending to be IG');
});

check('HEAD: renderHtml with partner embedUrl renders iframe only', () => {
  const { renderHtml } = require(path.join(ROOT, 'build.js'));
  for (const tid of SYSTEMS) {
    const tplPath = path.join(ROOT, 'templates', tid, 'template.html');
    if (!fs.existsSync(tplPath)) continue;
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const embed = 'https://partner.example/embed/ig?k=s111';
    const html = renderHtml(tpl, {
      business: { name: 'Test ' + tid },
      labels: { instaTitle: 'Din bucătărie', instaFollow: 'Follow' },
      footer: { address: 'x', year: '2026', note: 'n' },
      contact: {},
      instagram: {
        handle: 'demo.handle',
        url: 'https://www.instagram.com/demo.handle',
        embedUrl: embed,
        gallery: ['images/g1.jpg', 'images/g2.jpg'],
      },
    });
    assert.ok(
      html.includes(embed),
      tid + ': partner embedUrl in iframe src'
    );
    assert.ok(
      html.includes('instagram-embed-iframe'),
      tid + ': iframe class present'
    );
    assert.ok(
      !html.includes('images/g1.jpg'),
      tid + ': gallery filler omitted when partner connected'
    );
    assert.ok(
      !/src="https:\/\/www\.instagram\.com/i.test(html),
      tid + ': no direct IG iframe src'
    );
  }
});

check('HEAD: commercial presets do not ship instagram.com as embedUrl', () => {
  for (const tid of ['product-menu', 'portfolio', 'local-service', 'professionals']) {
    const p = path.join(ROOT, 'templates', tid, 'presets.json');
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const pr of data.presets || []) {
      const eu = (pr.config && pr.config.instagram && pr.config.instagram.embedUrl) || '';
      assert.ok(
        !/instagram\.com|instagr\.am/i.test(String(eu)),
        tid + '/' + pr.id + ' must not use direct IG embedUrl'
      );
    }
  }
});

check('HEAD: .header-nav a is nowrap (Cum e / Proiectele mele intact)', () => {
  const css = read(APP_CSS);
  const block = cssRule(css, '.header-nav a');
  assert.ok(block, '.header-nav a rule');
  assert.ok(/white-space\s*:\s*nowrap/i.test(block), 'nowrap on nav links');
});

check('HEAD: .user-badge does not letter-shred (no break-word; ellipsis ok)', () => {
  const css = read(APP_CSS);
  const block = cssRule(css, '.user-badge');
  assert.ok(block, '.user-badge rule');
  assert.ok(
    !/word-break\s*:\s*break-word/i.test(block),
    'no break-word on user-badge'
  );
  assert.ok(
    /white-space\s*:\s*nowrap/i.test(block) ||
      /text-overflow\s*:\s*ellipsis/i.test(block),
    'email stays one line with ellipsis if needed'
  );
  // Must not reintroduce the S89 exact 140px clip combo
  const has140 =
    /max-width\s*:\s*140px/i.test(block) &&
    /white-space\s*:\s*nowrap/i.test(block) &&
    /text-overflow\s*:\s*ellipsis/i.test(block);
  assert.ok(!has140, 'no S89 max-width:140px+nowrap+ellipsis combo');
});

check('HEAD: .site-card-name is not nowrap+ellipsis mid-clip', () => {
  const css = read(APP_CSS);
  const block = cssRule(css, '.site-card-name');
  assert.ok(block, '.site-card-name rule');
  assert.ok(
    !(/white-space\s*:\s*nowrap/i.test(block) &&
      /text-overflow\s*:\s*ellipsis/i.test(block)),
    'site name must not nowrap+ellipsis'
  );
  assert.ok(
    /white-space\s*:\s*normal/i.test(block) ||
      /overflow-wrap/i.test(block),
    'site name can wrap for full readability'
  );
});

check('HEAD: Detalii URL fields do not use overflow-wrap:anywhere', () => {
  const css = read(APP_CSS);
  const m = css.match(
    /\.field-input--url\s*,\s*\.field-textarea--url\s*\{([^}]*)\}/m
  );
  assert.ok(m, 'URL field rule');
  assert.ok(
    !/overflow-wrap\s*:\s*anywhere/i.test(m[1]),
    'no overflow-wrap:anywhere on URL fields'
  );
});

check('HEAD: builder assets use absolute /app/ paths', () => {
  const html = read(APP_HTML);
  assert.ok(/href="\/app\/app\.css"/.test(html), 'absolute /app/app.css');
  assert.ok(/src="\/app\/app\.js"/.test(html), 'absolute /app/app.js');
  assert.ok(
    /src="\/app\/generated\/engine\.js"/.test(html),
    'absolute engine.js'
  );
});

check('HEAD: server redirects bare /app and accepts HEAD on /app/', () => {
  const src = read(SERVER_JS);
  assert.ok(
    /url === '\/app'[\s\S]{0,200}sendRedirect/.test(src),
    'bare /app redirects'
  );
  assert.ok(
    /\(req\.method === 'GET' \|\| req\.method === 'HEAD'\)/.test(src) &&
      /url === '\/app\/' \|\| url\.startsWith\('\/app\/'\)/.test(src),
    'HEAD accepted for /app/'
  );
});

// ─── Live HTTP: /app routing ────────────────────────────────────────

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's111-app-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET =
    'test-secret-s111-' + require('crypto').randomBytes(4).toString('hex');
  process.env.PUBLIC_URL = 'http://127.0.0.1:0';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.HIDOOK_FAKE_DEPLOY;

  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const srv = startServer({ port: 0 });
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;

  await checkAsync('HTTP: GET /app → 302 Location /app/', async () => {
    const res = await fetch(base + '/app', { redirect: 'manual' });
    assert.ok([301, 302, 303, 307, 308].includes(res.status), 'redirect status ' + res.status);
    const loc = res.headers.get('location') || '';
    assert.ok(loc === '/app/' || loc.endsWith('/app/'), 'Location is /app/, got ' + loc);
  });

  await checkAsync('HTTP: HEAD /app/ → 200 text/html (not JSON 404)', async () => {
    const res = await fetch(base + '/app/', { method: 'HEAD' });
    assert.strictEqual(res.status, 200, 'HEAD status');
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    assert.ok(ct.includes('text/html'), 'content-type html, got ' + ct);
    assert.ok(!ct.includes('application/json'), 'not JSON');
  });

  await checkAsync('HTTP: GET /app/ → HTML and GET /app/app.css → 200 css', async () => {
    const res = await fetch(base + '/app/');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(/text\/html/i.test(res.headers.get('content-type') || ''));
    assert.ok(/\/app\/app\.css/.test(html), 'HTML references /app/app.css');
    const cssRes = await fetch(base + '/app/app.css');
    assert.strictEqual(cssRes.status, 200, 'app.css status');
    const cssCt = (cssRes.headers.get('content-type') || '').toLowerCase();
    assert.ok(cssCt.includes('css') || cssCt.includes('text/plain'), 'css mime ' + cssCt);
  });

  srv.close();

  if (failed) {
    console.error('\n' + failed + ' failed');
    process.exit(1);
  }
  console.log('\nAll s111-instafidget-policy checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
