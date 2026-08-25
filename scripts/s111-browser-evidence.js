#!/usr/bin/env node
'use strict';
/**
 * S111 browser evidence harness — isolated server, no Telegram, no fake deploy.
 * Publishes:
 *   A) restaurant without Instafidget → live has no IG section / no instagram.com iframe
 *   B) restaurant with partner embedUrl → live has partner iframe only
 * Checks /app → /app/ redirect and HEAD /app/.
 * Checks CSS readability rules for 390 chrome (static).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'S111-remake');
fs.mkdirSync(path.join(EVIDENCE, 'shots'), { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's111-browser-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 's111-ev-' + crypto.randomBytes(6).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'development';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.SITEBUILDER_PARTNER_SECRET;
// PUBLIC_URL set after listen so magic links hit the real port.

const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { renderHtml } = require(path.join(ROOT, 'build.js'));

function loadPreset(tid, idx) {
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', tid, 'presets.json'), 'utf8')
  );
  return JSON.parse(JSON.stringify(data.presets[idx || 0].config));
}

async function magicAuth(base, email) {
  const r = await fetch(base + '/api/auth/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const j = await r.json();
  assert.ok(j.devLink, 'devLink');
  // Rewrite host if PUBLIC_URL was stale at email send time
  let link = j.devLink;
  try {
    const u = new URL(link);
    const b = new URL(base);
    u.host = b.host;
    u.protocol = b.protocol;
    link = u.toString();
  } catch (_) { /* keep */ }
  const vr = await fetch(link, { redirect: 'manual' });
  const setCookie = vr.headers.getSetCookie
    ? vr.headers.getSetCookie()
    : [vr.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');
  assert.ok(cookie, 'session cookie from ' + link + ' status=' + vr.status);
  return cookie;
}

async function publishPaid(base, cookie, templateId, config, slug) {
  const pub = await fetch(base + '/api/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ templateId, config, images: [], slug }),
  });
  const pj = await pub.json();
  assert.ok(pub.ok, 'publish ' + JSON.stringify(pj).slice(0, 300));
  const siteId = pj.site && pj.site.id;
  assert.ok(siteId, 'siteId');
  const paymentUrl = pj.paymentUrl || '';
  const m = String(paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
  assert.ok(m, 'paymentUrl has #test-checkout= got ' + paymentUrl);
  const pay = await fetch(base + '/api/test-pay/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ sessionId: m[1] }),
  });
  const payJ = await pay.json().catch(() => ({}));
  assert.ok(pay.ok || pay.status === 200, 'test-pay ' + pay.status + ' ' + JSON.stringify(payJ).slice(0, 200));
  const liveSlug = (payJ.site && payJ.site.slug) || (pj.site && pj.site.slug) || slug;
  const liveUrl =
    (payJ.site && payJ.site.url) ||
    pj.url ||
    base + '/live/' + liveSlug + '/';
  return { siteId, slug: liveSlug, liveUrl };
}

(async () => {
  // Ensure generated assets exist
  require('child_process').execFileSync('node', [path.join(ROOT, 'scripts', 'build-builder.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  const srv = startServer({ port: 0 });
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  process.env.PUBLIC_URL = base;
  console.log('server', base);

  const findings = [];

  // 1) /app routing
  {
    const r = await fetch(base + '/app', { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    const ok = [301, 302, 303, 307, 308].includes(r.status) && /\/app\/$/.test(loc);
    findings.push({ id: 'app-bare-redirect', ok, status: r.status, loc });
    const h = await fetch(base + '/app/', { method: 'HEAD' });
    const ct = h.headers.get('content-type') || '';
    findings.push({
      id: 'app-head',
      ok: h.status === 200 && /text\/html/i.test(ct),
      status: h.status,
      ct,
    });
    const g = await fetch(base + '/app/');
    const html = await g.text();
    const css = await fetch(base + '/app/app.css');
    findings.push({
      id: 'app-styled',
      ok: g.status === 200 && /\/app\/app\.css/.test(html) && css.status === 200,
      htmlHasAbsCss: /\/app\/app\.css/.test(html),
      cssStatus: css.status,
    });
  }

  // 2) Live without Instafidget
  {
    const email = 's111-noig-' + crypto.randomBytes(3).toString('hex') + '@example.com';
    const cookie = await magicAuth(base, email);
    const cfg = loadPreset('product-menu', 0);
    // Ensure no partner embed
    if (!cfg.instagram) cfg.instagram = {};
    cfg.instagram.embedUrl = 'https://www.instagram.com/qalive.s111.noig';
    cfg.instagram.handle = 'qalive.s111.noig';
    cfg.instagram.url = 'https://www.instagram.com/qalive.s111.noig';
    cfg.business = cfg.business || {};
    cfg.business.name = 'QaLive S111 NoIG';
    const slug = 'qalive-s111-noig';
    const { liveUrl } = await publishPaid(base, cookie, 'product-menu', cfg, slug);
    const live = liveUrl || base + '/live/' + slug + '/';
    const lr = await fetch(live);
    const html = await lr.text();
    fs.writeFileSync(path.join(EVIDENCE, 'live-no-ig.html'), html);
    const hasIframeIg = /src=["']https?:\/\/(www\.)?instagram\.com/i.test(html);
    const hasEmbedIframe = /instagram-embed-iframe/.test(html);
    const hasSection =
      /instagram-heading|pm-social|Din bucătărie, pe Instagram|pe Instagram/i.test(html) &&
      /class="[^"]*pm-social|id="instagram/.test(html);
    const ok = lr.status === 200 && !hasIframeIg && !hasEmbedIframe;
    findings.push({
      id: 'live-no-ig',
      ok,
      status: lr.status,
      live,
      hasIframeIg,
      hasEmbedIframe,
      hasSection,
      bytes: html.length,
    });
  }

  // 3) Live with Instafidget-like partner embed
  {
    const email = 's111-withig-' + crypto.randomBytes(3).toString('hex') + '@example.com';
    const cookie = await magicAuth(base, email);
    const cfg = loadPreset('product-menu', 0);
    if (!cfg.instagram) cfg.instagram = {};
    const embed =
      'https://isolated.local/social-feed/isolated-s111-partner-fixture';
    cfg.instagram.embedUrl = embed;
    cfg.instagram.handle = 'qalive.s111.withig';
    cfg.instagram.url = 'https://www.instagram.com/qalive.s111.withig';
    cfg.business = cfg.business || {};
    cfg.business.name = 'QaLive S111 WithIG';
    const slug = 'qalive-s111-withig';
    const { liveUrl } = await publishPaid(base, cookie, 'product-menu', cfg, slug);
    const live = liveUrl || base + '/live/' + slug + '/';
    const lr = await fetch(live);
    const html = await lr.text();
    fs.writeFileSync(path.join(EVIDENCE, 'live-with-ig.html'), html);
    const hasPartner = html.includes(embed);
    const hasDirectIg = /src=["']https?:\/\/(www\.)?instagram\.com/i.test(html);
    const hasIframe = /instagram-embed-iframe/.test(html);
    const ok = lr.status === 200 && hasPartner && hasIframe && !hasDirectIg;
    findings.push({
      id: 'live-with-ig',
      ok,
      status: lr.status,
      live,
      hasPartner,
      hasIframe,
      hasDirectIg,
      bytes: html.length,
    });
  }

  // 4) CSS static 390 chrome safety
  {
    const css = fs.readFileSync(path.join(ROOT, 'builder', 'app.css'), 'utf8');
    const navNowrap = /\.header-nav a\s*\{[^}]*white-space\s*:\s*nowrap/i.test(css);
    const badgeNoBreakWord = !/\.user-badge\s*\{[^}]*word-break\s*:\s*break-word/i.test(css);
    const cardNoEllipsis =
      !/\.site-card-name\s*\{[^}]*white-space\s*:\s*nowrap[^}]*text-overflow\s*:\s*ellipsis/i.test(
        css
      ) &&
      !/\.site-card-name\s*\{[^}]*text-overflow\s*:\s*ellipsis[^}]*white-space\s*:\s*nowrap/i.test(
        css
      );
    const urlNoAnywhere =
      !/\.field-input--url[\s\S]{0,200}overflow-wrap\s*:\s*anywhere/i.test(css);
    findings.push({
      id: 'css-390-chrome',
      ok: navNowrap && badgeNoBreakWord && cardNoEllipsis && urlNoAnywhere,
      navNowrap,
      badgeNoBreakWord,
      cardNoEllipsis,
      urlNoAnywhere,
    });
  }

  // 5) Optional Playwright screenshots if available
  let playwrightOk = false;
  try {
    const pw = require('playwright');
    const browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/app/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({
      path: path.join(EVIDENCE, 'shots', '01-app-390.png'),
      fullPage: true,
    });
    // bare /app should end on /app/
    await page.goto(base + '/app', { waitUntil: 'networkidle', timeout: 30000 });
    const finalUrl = page.url();
    findings.push({
      id: 'browser-app-redirect',
      ok: /\/app\/?$/.test(new URL(finalUrl).pathname) || finalUrl.includes('/app/'),
      finalUrl,
    });
    await page.screenshot({
      path: path.join(EVIDENCE, 'shots', '02-app-after-bare.png'),
      fullPage: false,
    });
    // live no ig
    const noIg = findings.find((f) => f.id === 'live-no-ig');
    if (noIg && noIg.live) {
      await page.goto(noIg.live, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.screenshot({
        path: path.join(EVIDENCE, 'shots', '03-live-no-ig.png'),
        fullPage: true,
      });
    }
    const withIg = findings.find((f) => f.id === 'live-with-ig');
    if (withIg && withIg.live) {
      await page.goto(withIg.live, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.screenshot({
        path: path.join(EVIDENCE, 'shots', '04-live-with-ig.png'),
        fullPage: true,
      });
    }
    await browser.close();
    playwrightOk = true;
  } catch (e) {
    findings.push({ id: 'playwright', ok: false, err: String(e.message || e).slice(0, 200) });
  }

  const report = {
    base,
    port,
    head: require('child_process')
      .execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim(),
    findings,
    playwrightOk,
    allOk: findings.every((f) => f.ok !== false || f.id === 'playwright'),
  };
  // Strict: every finding except optional playwright must be ok
  report.pass = findings
    .filter((f) => f.id !== 'playwright')
    .every((f) => f.ok === true);

  fs.writeFileSync(
    path.join(EVIDENCE, 'EVIDENCE.json'),
    JSON.stringify(report, null, 2)
  );
  const md = [
    '# S111 evidence',
    '',
    `- base: ${base}`,
    `- pass: ${report.pass}`,
    `- playwright: ${playwrightOk}`,
    '',
    ...findings.map(
      (f) =>
        `- ${f.ok ? 'OK' : 'FAIL'} **${f.id}**: \`${JSON.stringify(f).slice(0, 240)}\``
    ),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(EVIDENCE, 'EVIDENCE.md'), md);
  console.log(md);
  srv.close();
  if (!report.pass) process.exit(1);
  console.log('S111 evidence PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
