'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-acf23fc9e0fab5e11';

async function run(label, publicUrl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-check-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'seo-check-' + crypto.randomBytes(6).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = 'test';
  if (publicUrl) process.env.PUBLIC_URL = publicUrl; else delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.DEPLOY_PROVIDER;
  delete process.env.BRAND_DOMAIN;
  delete process.env.CLOUDFLARE_API_TOKEN;

  // fresh modules per run (env-sensitive caching)
  Object.keys(require.cache).forEach(k => { if (k.includes('/bot/')) delete require.cache[k]; });

  const webpublish = require(path.join(ROOT, 'bot/webpublish.js'));
  const registry = require(path.join(ROOT, 'bot/registry.js'));

  const slug = 'seo-' + label + '-' + crypto.randomBytes(3).toString('hex');
  const user = registry.getOrCreateUserByEmail('seo-' + crypto.randomUUID().slice(0,8) + '@ex.com');
  const site = registry.createSite({ userId: user.id, templateId: 'product-menu', projectName: slug, slug, status: 'draft', paid: true });
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/product-menu/presets.json'), 'utf8'));
  const cfg = JSON.parse(JSON.stringify(raw.presets[0].config));
  cfg.business = cfg.business || {};
  cfg.business.name = 'SeoCheck ' + label;

  const result = await webpublish.publishSite({ site, config: cfg, images: [] });
  console.log('=== ' + label + ' (PUBLIC_URL=' + (publicUrl||'<unset>') + ') ===');
  console.log('publish url:', result.url);

  const dir = path.join(tmpDir, 'published', slug);
  const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const canon = (idx.match(/<link rel=["']canonical["'][^>]*>/i) || ['NONE'])[0];
  const ogUrl = (idx.match(/<meta property=["']og:url["'][^>]*>/i) || ['NONE'])[0];
  const ogImg = (idx.match(/<meta property=["']og:image["'][^>]*>/i) || ['NONE'])[0];
  const twImg = (idx.match(/<meta name=["']twitter:image["'][^>]*>/i) || ['NONE'])[0];
  const jsonLd = (idx.match(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i) || [null,'NONE'])[1];
  console.log('canonical:', canon);
  console.log('og:url:   ', ogUrl);
  console.log('og:image: ', ogImg);
  console.log('tw:image: ', twImg);
  console.log('jsonLd:   ', jsonLd);
  let robots = 'MISSING', sitemap = 'MISSING';
  try { robots = fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8'); } catch(_) {}
  try { sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'); } catch(_) {}
  console.log('robots.txt:\n' + robots);
  console.log('sitemap.xml:\n' + sitemap);
  console.log('');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
}

(async () => {
  await run('withpuburl', 'http://127.0.0.1:4321');
  await run('nopuburl', '');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
