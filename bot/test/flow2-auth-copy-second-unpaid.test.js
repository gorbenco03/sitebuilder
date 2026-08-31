'use strict';
/**
 * Flow 2 Romanian auth/copy and cancelled-trial draft regression oracle.
 *
 * Run: node bot/test/flow2-auth-copy-second-unpaid.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appSrc = read('builder/app.js');
const serverSrc = read('bot/server.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow2-auth-copy-unpaid-'));

process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'flow2-auth-copy-unpaid-' + crypto.randomBytes(6).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = 'test';
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.VERCEL_TOKEN;
delete process.env.NETLIFY_TOKEN;

const registry = require('../registry.js');
const auth = require('../auth.js');
const { startServer } = require('../server.js');

const INVALID_EMAIL_RO = 'Introdu o adresă de email validă.';
const SECOND_UNPAID_RO = 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul.';
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (error) {
    failed++;
    console.error('FAIL', name, '-', error.message);
    if (process.env.VERBOSE) console.error(error.stack);
  }
}

function extractFunction(src, name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  assert.ok(start, `${name} remains extractable`);
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < src.length && depth > 0) {
    const char = src[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return src.slice(start.index, index);
}

(async () => {
  const authHandler = extractFunction(serverSrc, 'handleAuthEmail');
  await check('invalid-email auth response is Romanian only', () => {
    assert.ok(authHandler.includes(INVALID_EMAIL_RO), 'Romanian invalid-email error is present');
    assert.ok(!authHandler.includes('Enter a valid email address.'), 'English invalid-email error is absent');
  });

  const copyStart = appSrc.indexOf('// Copy URL button');
  const copyEnd = appSrc.indexOf('// Logout', copyStart);
  const copyHandler = appSrc.slice(copyStart, copyEnd);
  await check('copy-address success, idle, and error states are Romanian only', () => {
    assert.ok(copyStart >= 0 && copyEnd > copyStart, 'copy-address handler remains extractable');
    assert.ok(copyHandler.includes("copyBtn.textContent = 'Copiat!'"), 'success state says Copiat!');
    assert.ok(copyHandler.includes('Copiază'), 'idle state says Copiază');
    assert.ok(!copyHandler.includes('Copied!'), 'English success state is absent');
    assert.ok(!/> Copy['<]/.test(copyHandler), 'English idle state is absent');
    assert.ok(!copyHandler.includes("Couldn't copy"), 'English error state is absent');
  });

  const server = startServer({ port: 0 });
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    await check('invalid-email HTTP 400 returns Romanian customer copy', async () => {
      const response = await fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nu-este-email' }),
      });
      assert.strictEqual(response.status, 400);
      assert.deepStrictEqual(await response.json(), { error: INVALID_EMAIL_RO });
    });

    await check('cancelled trial draft blocks a second site without inserting it', async () => {
      const user = registry.getOrCreateUserByEmail('flow2-' + crypto.randomUUID().slice(0, 8) + '@ex.com');
      const first = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'primul-site-' + crypto.randomUUID().slice(0, 6),
        platform: 'web',
      });
      registry.updateSite(first.id, {
        paid: true,
        status: 'unpublished',
        canceledAt: new Date().toISOString(),
        stripeSubscriptionStatus: 'canceled',
      });
      const before = registry.listSites(user.id);
      assert.strictEqual(before.length, 1, 'one cancelled trial draft exists before publish');

      const response = await fetch(base + '/api/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'hb_session=' + auth.signSession(user.id),
        },
        body: JSON.stringify({
          templateId: 'product-menu',
          slug: 'al-doilea-site-' + crypto.randomUUID().slice(0, 6),
          config: { business: { name: 'Al doilea site' } },
          images: [],
        }),
      });

      assert.strictEqual(response.status, 409, await response.clone().text());
      const body = await response.json();
      assert.strictEqual(body.error, SECOND_UNPAID_RO);
      assert.strictEqual(body.siteId, first.id);
      const after = registry.listSites(user.id);
      assert.strictEqual(after.length, 1, '409 cannot insert a second site row');
      assert.strictEqual(after[0].id, first.id, 'cancelled draft remains the only site');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failed) process.exitCode = 1;
  else console.log('PASS Flow 2 Romanian auth/copy and cancelled-trial draft guard');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
