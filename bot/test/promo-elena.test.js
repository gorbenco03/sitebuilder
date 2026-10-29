'use strict';
/**
 * /elena event page (bot/promo-elena.js): off without ELENA_KEY, key-gated,
 * and an added buyer's first site publishes paid with no card while anyone
 * else still gets the normal unpaid draft.
 */
const test = require('node:test');
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function boot(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elena-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--experimental-sqlite', path.join(ROOT, 'bot', 'web.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, HIDOOK_FAKE_DEPLOY: '1', NODE_ENV: 'test',
      SERVER_SECRET: 'test-secret-test-secret-test-secret-00', PUBLIC_URL: `http://127.0.0.1:${port}`, RESEND_API_KEY: '', ...env },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/health')).ok) return; } catch (_) { /* booting */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('server did not start');
  })();
  return { base, ready, stop: () => child.kill() };
}

async function signIn(base, devLink) {
  const r = await fetch(devLink, { redirect: 'manual' });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function publish(base, cookie) {
  const site = { v: 2 };
  const r = await fetch(base + '/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base },
    body: JSON.stringify({ templateId: 'blocks', config: require(path.join(ROOT, 'builder', 'blocks', 'blocks.js')).defaultSite('salon'), images: [] }),
  });
  return { status: r.status, body: await r.json() };
}

test('without ELENA_KEY everything is a 404', async (t) => {
  const s = boot({ ELENA_KEY: '' });
  t.after(s.stop);
  await s.ready;
  assert.strictEqual((await fetch(s.base + '/elena')).status, 404);
  assert.strictEqual((await fetch(s.base + '/api/elena/buyers', { headers: { 'X-Elena-Key': 'x' } })).status, 404);
});

test('key-gated list, buyer publishes free once, stranger does not', async (t) => {
  const KEY = 'event-key-123';
  const s = boot({ ELENA_KEY: KEY });
  t.after(s.stop);
  await s.ready;
  const H = { 'Content-Type': 'application/json', 'X-Elena-Key': KEY, Origin: s.base };

  assert.strictEqual((await fetch(s.base + '/elena')).status, 200);
  assert.strictEqual((await fetch(s.base + '/api/elena/buyers', { headers: { 'X-Elena-Key': 'wrong' } })).status, 401);

  const add = await (await fetch(s.base + '/api/elena/buyers', { method: 'POST', headers: H, body: JSON.stringify({ email: 'Buyer@Example.ro', name: 'Salon' }) })).json();
  assert.ok(add.ok && add.devLink, 'buyer added, sign-in link issued');

  const cookie = await signIn(s.base, add.devLink);
  const me = await (await fetch(s.base + '/api/me', { headers: { Cookie: cookie } })).json();
  assert.strictEqual(me.freePublish, true);

  const pub = await publish(s.base, cookie);
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.body));
  assert.strictEqual(pub.body.paymentUrl, null);
  assert.strictEqual(pub.body.site.paid, true);
  assert.ok(Date.parse(pub.body.site.paidUntil) > Date.now() + 360 * 864e5);

  const me2 = await (await fetch(s.base + '/api/me', { headers: { Cookie: cookie } })).json();
  assert.ok(!me2.freePublish, 'only the first site is free');

  const list = await (await fetch(s.base + '/api/elena/buyers', { headers: H })).json();
  assert.strictEqual(list.buyers.length, 1);
  assert.strictEqual(list.buyers[0].email, 'buyer@example.ro');
  assert.ok(list.buyers[0].sites.some((x) => x.live), 'Elena sees it live');

  const paid = await (await fetch(s.base + '/api/elena/paid', { method: 'POST', headers: H, body: JSON.stringify({ email: 'buyer@example.ro', cashPaid: true }) })).json();
  assert.strictEqual(paid.cashPaid, true);

  const auth = await (await fetch(s.base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: 'stranger@example.ro' }) })).json();
  const other = await signIn(s.base, auth.devLink);
  const pub2 = await publish(s.base, other);
  assert.notStrictEqual(pub2.body.site && pub2.body.site.paid, true, 'a stranger is not published for free');
});
