'use strict';
/**
 * bot/test/wave1-perf-theme.test.js — ITEM 9 + ITEM 11 regression gates.
 *
 * ITEM 9: light boot registry, no base64 in JS, static assets, 304 on revalidate.
 * ITEM 11: --accent/--paper alias themable --color-primary/--color-cream;
 *          hero.background is structured type "background" (drawer-visible).
 *
 * Run: node bot/test/wave1-perf-theme.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const GEN = path.join(ROOT, 'builder', 'generated');
const TPLS = ['product-menu', 'local-service', 'portfolio', 'professionals'];

let failed = false;
function check(name, fn) {
  try {
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      return ret.then(
        () => console.log('PASS', name),
        (e) => {
          failed = true;
          console.error('FAIL', name, '-', e.message);
        }
      );
    }
    console.log('PASS', name);
    return Promise.resolve();
  } catch (e) {
    failed = true;
    console.error('FAIL', name, '-', e.message);
    return Promise.resolve();
  }
}

(async () => {
  await check('build:app produces light registry + heavies + static assets', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-builder.js')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const light = fs.readFileSync(path.join(GEN, 'templates-data.js'), 'utf8');
    assert.ok(light.length < 64 * 1024, 'light registry < 64KB, got ' + light.length);
    assert.ok(!/data:image\/[^;]+;base64,/.test(light), 'no base64 in light registry');
    assert.ok(light.includes('thumbnail'), 'registry entries expose thumbnail');
    assert.ok(light.includes('heavyPathPrefix'), 'heavyPathPrefix present');
    for (const id of TPLS) {
      const heavyPath = path.join(GEN, 'templates', id + '.js');
      assert.ok(fs.existsSync(heavyPath), 'missing heavy ' + id);
      const body = fs.readFileSync(heavyPath, 'utf8');
      assert.ok(!/data:image\/[^;]+;base64,/.test(body), id + ' heavy has no base64');
      assert.ok(body.includes('HIDOOK_TEMPLATE_HEAVY'), id + ' heavy marker');
    }
  });

  await check('theme CSS aliases --accent/--paper to themable vars on all templates', () => {
    for (const id of TPLS) {
      const css = fs.readFileSync(path.join(ROOT, 'templates', id, 'styles.css'), 'utf8');
      assert.ok(
        /--accent\s*:\s*var\(\s*--color-primary/.test(css),
        id + ' must alias --accent → --color-primary'
      );
      assert.ok(
        /--paper\s*:\s*var\(\s*--color-cream/.test(css),
        id + ' must alias --paper → --color-cream'
      );
      // Must actually *use* the themable aliases (not only declare them).
      // product-menu / local-service / portfolio paint via --cta; professionals via --accent.
      const accentUses =
        (css.match(/var\(\s*--accent/g) || []).length +
        (css.match(/var\(\s*--cta/g) || []).length;
      assert.ok(
        accentUses >= 1,
        id + ' must consume var(--accent) or var(--cta)'
      );
      assert.ok(
        (css.match(/var\(\s*--paper/g) || []).length >= 1,
        id + ' must consume var(--paper)'
      );
    }
  });

  await check('rendered HTML injects configured theme colors into CSS vars', () => {
    const { renderHtml } = require(path.join(ROOT, 'build.js'));
    const probePrimary = '#16A34A';
    const probeCream = '#FF0000';
    for (const id of TPLS) {
      const dir = path.join(ROOT, 'templates', id);
      const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
      const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
      const presets = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8')).presets;
      const base = JSON.parse(JSON.stringify((presets[0] && presets[0].config) || {}));
      base.theme = Object.assign({}, base.theme || {}, {
        primary: probePrimary,
        primaryLight: '#4ADE80',
        primaryDark: '#14532D',
        cream: probeCream,
      });
      const html = renderHtml(tpl, base);
      assert.ok(
        html.includes('--color-primary') && html.includes(probePrimary),
        id + ' HTML must declare --color-primary: ' + probePrimary
      );
      assert.ok(
        html.includes('--color-cream') && html.includes(probeCream),
        id + ' HTML must declare --color-cream: ' + probeCream
      );
      // styles.css still hardcodes defaults in :root, but aliases must remain var()-based
      // so the later inline :root from template wins for consumers.
      assert.ok(/--accent\s*:\s*var\(\s*--color-primary/.test(css), id + ' accent alias');
      assert.ok(/--paper\s*:\s*var\(\s*--color-cream/.test(css), id + ' paper alias');
      // Causal RED shape: dead theme would use bare hex for --accent/--paper without var().
      assert.ok(
        !/--accent\s*:\s*#[0-9a-fA-F]{3,8}\s*;/.test(css),
        id + ' must not hardcode --accent hex (Opus dead-control RED)'
      );
      assert.ok(
        !/--paper\s*:\s*#[0-9a-fA-F]{3,8}\s*;/.test(css),
        id + ' must not hardcode --paper hex (Opus dead-control RED)'
      );
    }
  });

  await check('hero.background is type background in every schema', () => {
    for (const id of TPLS) {
      const schema = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'templates', id, 'schema.json'), 'utf8')
      );
      let found = null;
      for (const sec of schema.sections || []) {
        for (const f of sec.fields || []) {
          if (f.key === 'hero.background') found = f;
        }
      }
      assert.ok(found, id + ' missing hero.background field');
      assert.strictEqual(found.type, 'background', id + ' hero.background type');
    }
  });

  await check('builder app treats background as drawer field + lazy heavy load', () => {
    const app = fs.readFileSync(path.join(ROOT, 'builder', 'app.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
    assert.ok(app.includes("DRAWER_TYPES = new Set(['phone', 'url', 'color', 'background'])") ||
      /DRAWER_TYPES[\s\S]*'background'/.test(app), 'background in DRAWER_TYPES');
    assert.ok(app.includes('ensureTemplateLoaded'), 'ensureTemplateLoaded present');
    assert.ok(app.includes('parseHeroBackground') && app.includes('composeHeroBackground'),
      'structured hero background helpers');
    assert.ok(app.includes('template-card-preview-thumb') || app.includes('meta.thumbnail'),
      'catalog uses thumbnails');
    assert.ok(app.includes('applyThemeBackground'), 'applyThemeBackground for theme.cream');
    assert.ok(
      indexHtml.includes('color-bg-swatch') && indexHtml.includes('Page background'),
      'color popover exposes page background control'
    );
  });

  await check('light boot bundle stays tiny (no 32MB blocking payload)', () => {
    const light = fs.readFileSync(path.join(GEN, 'templates-data.js'), 'utf8');
    assert.ok(light.length < 32 * 1024, 'templates-data.js < 32KB (was ~32MB)');
    assert.ok(!/data:image\/[^;]+;base64,/.test(light), 'no base64 images in boot');
    // Heavies must not be referenced as classic blocking multi-MB scripts in index.
    const indexHtml = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
    const scriptSrcs = [...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    assert.ok(
      scriptSrcs.some((s) => s.includes('templates-data.js')),
      'index loads light templates-data.js'
    );
    assert.ok(
      !scriptSrcs.some((s) => /generated\/templates\/[^/]+\.js/.test(s)),
      'index must not block on heavy per-template scripts'
    );
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave1-perf-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'wave1-' + crypto.randomBytes(6).toString('hex');
  process.env.HIDOOK_FAKE_DEPLOY = '1';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;

  const { startServer } = require('../server');
  const srv = startServer({ port: 0 });
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  try {
    await check('serveStatic sends Cache-Control + ETag and 304 on revalidate', async () => {
      const url = `${base}/app/generated/templates-data.js`;
      const res = await fetch(url);
      assert.strictEqual(res.status, 200);
      const etag = res.headers.get('etag');
      const cc = res.headers.get('cache-control');
      const lm = res.headers.get('last-modified');
      assert.ok(etag, 'ETag');
      assert.ok(cc, 'Cache-Control');
      assert.ok(lm, 'Last-Modified');
      const res2 = await fetch(url, { headers: { 'If-None-Match': etag } });
      assert.strictEqual(res2.status, 304, 'If-None-Match → 304');
    });

    await check('static template image is served as image/* not SPA HTML', async () => {
      const thumbs = fs.readdirSync(path.join(GEN, 'thumbs'));
      assert.ok(thumbs.length, 'thumbs exist');
      const name = thumbs[0];
      const res = await fetch(`${base}/app/generated/thumbs/${name}`);
      assert.strictEqual(res.status, 200);
      const ct = res.headers.get('content-type') || '';
      assert.ok(
        ct.startsWith('image/') || ct.includes('svg'),
        'thumb content-type image, got ' + ct
      );
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.length > 20, 'thumb has bytes');
      assert.ok(body[0] !== 0x3c || body.toString('utf8', 0, 5).includes('svg') || body.toString('utf8', 0, 5) === '<?xml',
        'not HTML SPA fallback');
    });
  } finally {
    await new Promise((r) => srv.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failed) {
    console.error('\nwave1-perf-theme.test.js: FAILED');
    process.exit(1);
  }
  console.log('\nwave1-perf-theme.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
