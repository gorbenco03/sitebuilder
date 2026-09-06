'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-acf23fc9e0fab5e11';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-http-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'seo-http-' + crypto.randomBytes(6).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = 'test';
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.DEPLOY_PROVIDER;
  delete process.env.BRAND_DOMAIN;
  delete process.env.CLOUDFLARE_API_TOKEN;

  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const registry = require(path.join(ROOT, 'bot/registry.js'));
  const auth = require(path.join(ROOT, 'bot/auth.js'));

  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;
  console.log('server base (this IS what PUBLIC_URL would be in a real deploy):', base);

  const user = registry.getOrCreateUserByEmail('seo-http-' + crypto.randomUUID().slice(0,8) + '@ex.com');
  const sessionCookie = 'hb_session=' + auth.signSession(user.id);
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8'));
  const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));
  cfg.business.name = 'SeoHttp Test';
  const slug = 'seo-http-' + crypto.randomBytes(3).toString('hex');

  const pubRes = await fetch(base + '/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie, 'CF-IPCountry': 'RO' },
    body: JSON.stringify({ templateId: 'product-menu', slug, config: cfg, images: [] }),
  });
  const pubBody = await pubRes.json();
  console.log('publish resp status', pubRes.status, JSON.stringify(pubBody).slice(0,300));
  const sessionId = String(pubBody.paymentUrl).match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/)[1];

  const completeRes = await fetch(base + '/api/test-pay/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({ sessionId }),
  });
  const completeBody = await completeRes.json();
  console.log('complete status', completeRes.status, 'site.url=', completeBody.site && completeBody.site.url);

  // Fetch the actual live pages as a visitor would, through the real HTTP server
  const liveUrl = base + '/live/' + slug + '/';
  const liveRes = await fetch(liveUrl);
  const liveHtml = await liveRes.text();
  console.log('\n--- GET ' + liveUrl + ' -> ' + liveRes.status + ' ---');
  const canon = (liveHtml.match(/<link rel=["']canonical["'][^>]*>/i) || ['NONE'])[0];
  const ogUrl = (liveHtml.match(/<meta property=["']og:url["'][^>]*>/i) || ['NONE'])[0];
  const ogImg = (liveHtml.match(/<meta property=["']og:image["'][^>]*>/i) || ['NONE'])[0];
  console.log('canonical:', canon);
  console.log('og:url:   ', ogUrl);
  console.log('og:image: ', ogImg);

  const robotsRes = await fetch(base + '/live/' + slug + '/robots.txt');
  console.log('\n--- GET /live/' + slug + '/robots.txt -> ' + robotsRes.status + ' ---');
  console.log(await robotsRes.text());

  const sitemapRes = await fetch(base + '/live/' + slug + '/sitemap.xml');
  console.log('--- GET /live/' + slug + '/sitemap.xml -> ' + sitemapRes.status + ' ---');
  console.log(await sitemapRes.text());

  await new Promise(r => server.close(r));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
