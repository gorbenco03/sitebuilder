'use strict';
/**
 * bot/test/lib/old-template-live.js — shared harness for oracles that check the
 * PUBLISHED output of the five old templates (product-menu, local-service,
 * portfolio, professionals, desserdirina).
 *
 * The form editor that used to publish them is gone (removed 2026-10-28), but
 * POST /api/publish still accepts those templateIds and build.js still renders
 * them. This reaches a /live/<slug>/ page the way the old editor's publish
 * step did, minus its UI: seed config = presets[0].config (+ the page-section
 * seed the editor applied on "start"), WhatsApp link derived and the demo
 * contact identity blanked (the same two steps its publish payload ran), then
 * sign in by magic link, POST /api/publish, finish the test checkout.
 *
 * Not itself a test (no .test.js suffix).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules', 'playwright'),
    '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) {}
  }
  throw new Error('playwright not found; install or link node_modules/playwright');
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function getPath(obj, p) {
  return String(p).split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}
function setPath(obj, p, val) {
  const parts = String(p).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

function loadPresets(templateId) {
  const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'presets.json'), 'utf8'));
  return Array.isArray(presets) ? presets : presets.presets;
}
function loadSchema(templateId) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', templateId, 'schema.json'), 'utf8'));
}

const WA_DEFAULT_MSG = 'Bună ziua, aș dori mai multe informații despre serviciile dumneavoastră.';
const DEMO_CONTACT_PATHS = [
  'contact.facebook.url',
  'contact.instagram.url',
  'contact.instagram.label',
  'instagram.handle',
  'instagram.url',
  'instagram.embedUrl',
  'contact.email',
];

function deriveWaHref(config) {
  if (!config.contact || typeof config.contact !== 'object') config.contact = {};
  const raw = config.contact.whatsapp;
  if (raw == null || String(raw).trim() === '') { config.contact.waHref = ''; return; }
  let digits = String(raw).replace(/\D/g, '');
  if (digits.indexOf('00') === 0) digits = digits.slice(2);
  else if (digits.length === 10 && digits[0] === '0') digits = '40' + digits.slice(1);
  if (!digits) { config.contact.waHref = ''; return; }
  const msgRaw = config.contact.waMessage;
  const msg = (msgRaw != null && String(msgRaw).trim() !== '') ? String(msgRaw) : WA_DEFAULT_MSG;
  config.contact.waHref = 'https://wa.me/' + digits + '?text=' + encodeURIComponent(msg);
}

/**
 * The config a customer's first publish of `templateId` carried: the default
 * preset, with addable sections seeded as pending/removed, WhatsApp link
 * derived and any demo contact value still equal to the preset blanked.
 * `mutate(config)` runs on the preset copy BEFORE those two publish steps, the
 * way an owner's edits preceded them.
 */
function publishConfig(templateId, mutate) {
  const preset = loadPresets(templateId)[0].config;
  const config = deepClone(preset);
  const schema = loadSchema(templateId);
  if (Array.isArray(schema.pageSections) && schema.pageSections.length) {
    config.sections = schema.pageSections.map((s) => (
      s && s.addable === true ? { id: s.id, removed: true, pending: true } : { id: s.id, removed: false }
    ));
  }
  if (typeof mutate === 'function') mutate(config);
  deriveWaHref(config);
  DEMO_CONTACT_PATHS.forEach((p) => {
    const demo = getPath(preset, p);
    const cur = getPath(config, p);
    if (typeof demo === 'string' && demo.trim() && typeof cur === 'string' && cur.trim() === demo.trim()) setPath(config, p, '');
  });
  return config;
}

/**
 * Start the real server in isolated test-pay mode. Env vars are set BEFORE
 * bot/server.js is required, so call this before anything else loads it.
 */
async function startHarness(prefix) {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
  process.env.DATA_DIR = dataDir;
  process.env.SERVER_SECRET = prefix + '-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'VERCEL_TOKEN', 'HIDOOK_FAKE_DEPLOY', 'DEPLOY_PROVIDER']) {
    delete process.env[k];
  }
  delete require.cache[require.resolve(path.join(ROOT, 'bot', 'server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  /** Sign in by magic link; returns a cookie-jar API client. */
  async function signIn(label) {
    const jar = {};
    const call = async (p, opts = {}) => {
      const headers = { ...(opts.headers || {}) };
      const cs = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
      if (cs) headers.Cookie = cs;
      const res = await fetch(base + p, { ...opts, headers, redirect: 'manual' });
      for (const sc of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const first = sc.split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
      }
      return res;
    };
    const post = (p, body) => call(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const email = prefix + '-' + String(label || 'u') + '-' + crypto.randomUUID().slice(0, 8) + '@example.com';
    const login = await (await post('/api/auth/email', { email })).json();
    const token = new URL(login.devLink, base).searchParams.get('token');
    const v = await call('/auth/verify?token=' + encodeURIComponent(token));
    if (v.status !== 302) throw new Error('magic-link verify failed: ' + v.status);
    return { call, post, email };
  }

  /**
   * Publish `config` as `templateId` (new site), pay through the test
   * checkout and wait until /live/<slug>/ answers. Returns
   * { siteId, slug, liveUrl, client }.
   */
  async function publish(templateId, config, opts = {}) {
    const client = opts.client || await signIn(opts.label || templateId);
    const body = { templateId, config, images: [] };
    // Unique slug by default: the name-derived one collides on a 2nd publish of a template.
    body.slug = opts.slug || (templateId + '-' + crypto.randomBytes(3).toString('hex'));
    if (opts.siteId) body.siteId = opts.siteId;
    const pub = await client.post('/api/publish', body);
    if (pub.status !== 200) throw new Error('publish failed ' + pub.status + ': ' + await pub.text());
    const data = await pub.json();
    const m = String(data.paymentUrl || '').match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
    if (!m) throw new Error('no test-checkout session in paymentUrl: ' + data.paymentUrl);
    const done = await client.post('/api/test-pay/complete', { sessionId: m[1] });
    if (done.status !== 200) throw new Error('test-pay failed ' + done.status + ': ' + await done.text());
    const slug = data.site.slug;
    const liveUrl = base + '/live/' + slug + '/';
    const deadline = Date.now() + 20000;
    for (;;) {
      const r = await fetch(liveUrl, { redirect: 'manual' });
      if (r.status === 200) break;
      if (Date.now() > deadline) throw new Error('site never went live: ' + liveUrl + ' (' + r.status + ')');
      await new Promise((r2) => setTimeout(r2, 100));
    }
    return { siteId: data.site.id, slug, liveUrl, client };
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }

  return { base, server, dataDir, signIn, publish, close };
}

module.exports = { ROOT, loadPlaywright, loadPresets, loadSchema, publishConfig, startHarness, deepClone, getPath, setPath };
