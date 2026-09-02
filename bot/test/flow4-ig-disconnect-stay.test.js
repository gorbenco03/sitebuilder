'use strict';
/**
 * Flow 4 oracle — Instafidget disconnect must stay disconnected.
 *
 * QA fail on 38b3dc5: after Connect → editor tab → return → Disconnect, the
 * modal says “Instagram a fost deconectat…”, then a later focus/republish path
 * toasts “Instagram e conectat.” (lying state).
 *
 * Causes locked here:
 *   1. connectInstagram left a window focus listener that re-POSTs grant and
 *      toasts connected; disconnect did not cancel it (or void in-flight grant).
 *   2. disconnect was local-only (applyEmbedUrl('')) while grant already
 *      persisted instagram.embedUrl on the site.
 *
 * Run: node bot/test/flow4-ig-disconnect-stay.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
/** Frozen base from Flow 4 QA FAIL remake card. */
const PARENT_SHA = '38b3dc5b037c388b83e8629662ce969c87daedd9';

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
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractFunction(src, name) {
  const start = new RegExp(
    '(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'
  ).exec(src);
  if (!start) return '';
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < src.length && depth > 0) {
    const char = src[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return src.slice(start.index, index);
}

// ── Causal RED on frozen parent 38b3dc5 ──────────────────────────────────

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} disconnect is local-only`, () => {
  const app = parentBlob('builder/app.js');
  const disc = extractFunction(app, 'disconnectInstagram');
  assert.ok(disc, 'parent disconnectInstagram exists');
  assert.ok(
    /applyEmbedUrl\s*\(\s*['"]['"]\s*\)/.test(disc),
    'parent clears local embedUrl'
  );
  assert.ok(
    !/social-feed\/disconnect/.test(disc),
    'parent disconnect must NOT call social-feed/disconnect'
  );
  assert.ok(
    !/cancelPendingInstagramConnect|removeEventListener\s*\(\s*['"]focus['"]/.test(disc),
    'parent disconnect must NOT cancel the connect focus listener'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} connect focus re-grants without cancel token`, () => {
  const app = parentBlob('builder/app.js');
  const connect = extractFunction(app, 'connectInstagram');
  assert.ok(connect, 'parent connectInstagram exists');
  assert.ok(
    /addEventListener\s*\(\s*['"]focus['"]\s*,\s*onFocus\s*\)/.test(connect),
    'parent registers window focus waiter'
  );
  assert.ok(
    /showToast\s*\(\s*['"]Instagram e conectat\./.test(connect),
    'parent focus path toasts Instagram e conectat'
  );
  assert.ok(
    /social-feed\/grant/.test(connect),
    'parent focus path re-POSTs grant'
  );
  assert.ok(
    !/instagramConnectGeneration|cancelPendingInstagramConnect|instagramConnectFocusHandler/.test(
      connect
    ),
    'parent connect has no cancel/generation guard for focus grant'
  );
});

check(`causal RED: parent ${PARENT_SHA.slice(0, 7)} server has no social-feed disconnect`, () => {
  const server = parentBlob('bot/server.js');
  assert.ok(
    !/social-feed\/disconnect/.test(server),
    'parent must lack /social-feed/disconnect route'
  );
  assert.ok(
    !/handleSocialFeedDisconnect|function clearEmbedUrl/.test(server),
    'parent must lack disconnect handler / clearEmbedUrl'
  );
  assert.ok(/persistEmbedUrl/.test(server), 'parent still persists grant embedUrl');
});

// ── HEAD GREEN: source contracts ─────────────────────────────────────────

check('HEAD: disconnect cancels pending focus connect and persists disconnect', () => {
  const app = headRead('builder/app.js');
  const disc = extractFunction(app, 'disconnectInstagram');
  const cancel = extractFunction(app, 'cancelPendingInstagramConnect');
  assert.ok(disc, 'disconnectInstagram exists');
  assert.ok(cancel, 'cancelPendingInstagramConnect exists');
  assert.ok(
    /cancelPendingInstagramConnect\s*\(/.test(disc),
    'disconnect must cancel pending connect focus'
  );
  assert.ok(
    /social-feed\/disconnect/.test(disc),
    'disconnect must POST social-feed/disconnect'
  );
  assert.ok(
    /applyEmbedUrl\s*\(\s*['"]['"]\s*\)/.test(disc),
    'disconnect still clears local embedUrl'
  );
  assert.ok(
    /Instagram a fost deconectat\. Feed-ul nu mai este afișat pe site\./.test(disc),
    'honest disconnect copy stays'
  );
});

check('HEAD: connect focus grant is generation-guarded and cancellable', () => {
  const app = headRead('builder/app.js');
  const connect = extractFunction(app, 'connectInstagram');
  assert.ok(/cancelPendingInstagramConnect\s*\(/.test(connect), 'connect resets prior waiter');
  assert.ok(
    /instagramConnectFocusHandler\s*=\s*onFocus/.test(connect),
    'focus handler is stored for cancel'
  );
  assert.ok(
    /connectGen\s*!==\s*instagramConnectGeneration/.test(connect),
    'in-flight grant aborts after disconnect generation bump'
  );
  assert.ok(
    /showToast\s*\(\s*['"]Instagram e conectat\./.test(connect),
    'connect path still toasts when grant finishes without disconnect'
  );
});

check('HEAD: server exposes disconnect that clears embedUrl', () => {
  const server = headRead('bot/server.js');
  assert.ok(/social-feed\/disconnect/.test(server), 'route social-feed/disconnect registered');
  assert.ok(/handleSocialFeedDisconnect/.test(server), 'handler exists');
  const clear = extractFunction(server, 'clearEmbedUrl');
  assert.ok(clear, 'clearEmbedUrl exists');
  assert.ok(/embedUrl\s*=\s*['"]['"]/.test(clear), 'clearEmbedUrl writes empty embedUrl');
  const handler = extractFunction(server, 'handleSocialFeedDisconnect');
  assert.ok(handler, 'handleSocialFeedDisconnect body');
  assert.ok(/clearEmbedUrl\s*\(/.test(handler), 'handler calls clearEmbedUrl');
  assert.ok(/disconnected:\s*true/.test(handler), 'response marks disconnected');
});

(async () => {
  await checkAsync('behavioral: disconnect voids pending focus re-grant toast', async () => {
    const app = headRead('builder/app.js');
    const cancelSrc = extractFunction(app, 'cancelPendingInstagramConnect');
    const discSrc = extractFunction(app, 'disconnectInstagram');
    const connectSrc = extractFunction(app, 'connectInstagram');
    assert.ok(cancelSrc && discSrc && connectSrc);

    const listeners = { focus: [] };
    const toasts = [];
    const apiCalls = [];
    let embedUrl = '';
    let igStatus = '';
    let deferredGrant = null;

    const sandbox = {
      window: {
        addEventListener(type, fn) {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
          listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
        },
        open() {
          return { opener: null };
        },
      },
      draft: { config: { instagram: { embedUrl: '' } } },
      currentUser: { email: 'client@exemplu.ro' },
      currentSiteId: 'site-ig-1',
      publishedSiteId: 'site-ig-1',
      listeners,
      $() {
        return {
          checked: true,
          disabled: false,
          textContent: '',
          classList: { toggle() {} },
          style: {},
        };
      },
      setBtnLoading() {},
      setIgStatus(msg) {
        igStatus = String(msg || '');
      },
      showToast(msg, kind) {
        toasts.push({ msg: String(msg || ''), kind: kind || '' });
      },
      closeModal() {},
      openModal() {},
      saveDraft() {},
      fullRerender() {},
      syncInstagramModalPanels() {},
      applyEmbedUrl(url) {
        embedUrl = String(url || '');
        sandbox.draft.config.instagram.embedUrl = embedUrl;
      },
      siteIdForInstagram() {
        return 'site-ig-1';
      },
      ensureDraftSiteForInstagram: async () => 'site-ig-1',
      apiPost: async (url) => {
        const u = String(url);
        apiCalls.push(u);
        if (u.includes('/social-feed/grant')) {
          if (apiCalls.filter((x) => x.includes('/grant')).length === 1) {
            return {
              embedUrl: 'https://isolated.local/social-feed/isolated-fixture',
            };
          }
          return await new Promise((resolve) => {
            deferredGrant = resolve;
          });
        }
        if (u.includes('/social-feed/editor-session')) {
          return {
            editorUrl: 'https://isolated.local/app/instafidget-editor.html?siteId=site-ig-1',
          };
        }
        if (u.includes('/social-feed/disconnect')) {
          return { ok: true, disconnected: true, embedUrl: null };
        }
        return {};
      },
    };

    vm.runInNewContext(
      [
        'var instagramConnectFocusHandler = null;',
        'var instagramConnectGeneration = 0;',
        'var instagramEditorUrl = "";',
        cancelSrc,
        discSrc,
        connectSrc,
        'this.cancelPendingInstagramConnect = cancelPendingInstagramConnect;',
        'this.disconnectInstagram = disconnectInstagram;',
        'this.connectInstagram = connectInstagram;',
        'this.getGen = function(){ return instagramConnectGeneration; };',
        'this.getHandler = function(){ return instagramConnectFocusHandler; };',
        'this.fireFocus = async function(){ const list = (listeners.focus || []).slice(); for (const fn of list) await fn(); };',
      ].join('\n'),
      sandbox
    );

    await sandbox.connectInstagram();
    assert.strictEqual(listeners.focus.length, 1, 'focus waiter after connect');
    assert.ok(embedUrl, 'grant1 applied embed');

    const focusPromise = sandbox.fireFocus();
    // Allow the delayed grant2 promise to register
    await new Promise((r) => setImmediate(r));
    assert.ok(typeof deferredGrant === 'function', 'focus started delayed grant2');

    await sandbox.disconnectInstagram();
    assert.strictEqual(embedUrl, '', 'cleared on disconnect');
    assert.ok(
      apiCalls.some((u) => u.includes('/social-feed/disconnect')),
      'persisted disconnect'
    );
    assert.strictEqual(listeners.focus.length, 0, 'focus waiter removed');
    assert.strictEqual(sandbox.getHandler(), null, 'stored handler cleared');

    deferredGrant({
      embedUrl: 'https://isolated.local/social-feed/should-not-apply',
    });
    await focusPromise;

    assert.strictEqual(embedUrl, '', 'stale grant2 must not re-apply embedUrl');
    assert.ok(
      !toasts.some((t) => /Instagram e conectat/i.test(t.msg)),
      'stale grant2 must not toast Instagram e conectat'
    );
    assert.match(igStatus, /deconectat/i);
  });

  await checkAsync('HTTP: grant then disconnect clears persisted embedUrl', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-disconnect-'));
    process.env.DATA_DIR = tmpDir;
    process.env.SERVER_SECRET =
      'test-secret-ig-disc-' + crypto.randomBytes(4).toString('hex');
    process.env.PUBLIC_URL = 'http://127.0.0.1:0';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.NODE_ENV = 'test';
    delete process.env.SITEBUILDER_PARTNER_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.HIDOOK_FAKE_DEPLOY;

    delete require.cache[require.resolve('../auth.js')];
    delete require.cache[require.resolve('../registry.js')];
    delete require.cache[require.resolve('../server.js')];
    const auth = require('../auth.js');
    const registry = require('../registry.js');
    const { startServer } = require('../server.js');

    const srv = startServer({ port: 0 });
    await new Promise((r) => srv.once('listening', r));
    const base = `http://127.0.0.1:${srv.address().port}`;

    try {
      const user = registry.getOrCreateUserByEmail('ig-disc@example.com');
      const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 'ig-disc-stay',
        platform: 'web',
      });
      registry.saveVersion(site.id, {
        business: { name: 'IG Disc' },
        instagram: { handle: 'x', url: 'https://instagram.com/x', gallery: [] },
      });
      const cookie = 'hb_session=' + auth.signSession(user.id);

      const grant = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ acceptedTerms: true }),
      });
      assert.strictEqual(grant.status, 200, 'grant ok');
      const grantBody = await grant.json();
      assert.ok(grantBody.embedUrl, 'grant returns embedUrl');

      let versions = registry.listVersions(site.id);
      let latest = versions[versions.length - 1];
      let cfg = registry.getVersionConfig(site.id, latest.versionId);
      assert.strictEqual(cfg.instagram.embedUrl, grantBody.embedUrl, 'persisted after grant');

      const disc = await fetch(`${base}/api/sites/${site.id}/social-feed/disconnect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({}),
      });
      assert.strictEqual(disc.status, 200, 'disconnect ok');
      const discBody = await disc.json();
      assert.strictEqual(discBody.disconnected, true);
      assert.ok(!discBody.embedUrl, 'disconnect response has no embedUrl');

      versions = registry.listVersions(site.id);
      latest = versions[versions.length - 1];
      cfg = registry.getVersionConfig(site.id, latest.versionId);
      assert.strictEqual(
        String((cfg.instagram && cfg.instagram.embedUrl) || ''),
        '',
        'persisted embedUrl cleared after disconnect'
      );

      const unauth = await fetch(`${base}/api/sites/${site.id}/social-feed/disconnect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(unauth.status, 401);
    } finally {
      srv.close();
    }
  });

  if (failed) {
    console.error('\nflow4-ig-disconnect-stay.test.js: FAILED');
    process.exit(1);
  }
  console.log('\nflow4-ig-disconnect-stay.test.js: all passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
