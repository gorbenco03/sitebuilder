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
 * Form editor removed 2026-10-28: the browser half (connectInstagram /
 * disconnectInstagram / cancelPendingInstagramConnect in builder/app.js, the
 * focus-waiter behavioral sandbox and the parent-commit app.js RED checks)
 * lived in the deleted Instagram modal and was dropped. The server half
 * (social-feed grant/disconnect generation guard) is unchanged and still
 * covered below, source-level and over HTTP.
 *
 * Run: node bot/test/flow4-ig-disconnect-stay.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

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

check('HEAD: server exposes disconnect that clears embedUrl', () => {
  const server = headRead('bot/server.js');
  assert.ok(/social-feed\/disconnect/.test(server), 'route social-feed/disconnect registered');
  assert.ok(/handleSocialFeedDisconnect/.test(server), 'handler exists');
  const clear = extractFunction(server, 'clearEmbedUrl');
  assert.ok(clear, 'clearEmbedUrl exists');
  assert.ok(/embedUrl\s*=\s*['"]['"]/.test(clear), 'clearEmbedUrl writes empty embedUrl');
  assert.ok(
    /bumpSocialFeedGeneration\s*\(/.test(clear),
    'clearEmbedUrl bumps op generation so in-flight grants are void'
  );
  const handler = extractFunction(server, 'handleSocialFeedDisconnect');
  assert.ok(handler, 'handleSocialFeedDisconnect body');
  assert.ok(/clearEmbedUrl\s*\(/.test(handler), 'handler calls clearEmbedUrl');
  assert.ok(/disconnected:\s*true/.test(handler), 'response marks disconnected');
});

check('HEAD: grant persists only when op generation still matches', () => {
  const server = headRead('bot/server.js');
  assert.ok(/socialFeedOpGeneration|function socialFeedGeneration/.test(server), 'generation map');
  assert.ok(/function persistEmbedUrlIfCurrent/.test(server), 'guarded persist helper');
  const grant = extractFunction(server, 'handleSocialFeedGrant');
  assert.ok(grant, 'handleSocialFeedGrant body');
  assert.ok(
    /genAtStart\s*=\s*socialFeedGeneration\s*\(/.test(grant),
    'grant captures generation before partner await'
  );
  assert.ok(
    /persistEmbedUrlIfCurrent\s*\(/.test(grant),
    'grant uses generation-guarded persist'
  );
  assert.ok(
    /stale:\s*true/.test(grant),
    'stale grant response marks stale (does not re-connect silently)'
  );
  // Unconditional post-await persistEmbedUrl( would reintroduce the race.
  assert.ok(
    !/persistEmbedUrl\s*\(\s*ctx\.reg\s*,\s*siteId\s*,\s*(?:partnerRes|embedUrl)/.test(grant),
    'grant must not call bare persistEmbedUrl after partner without generation check'
  );
});

(async () => {
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
        instagram: { handle: 'x', url: 'https://instagram.com/x' },
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

  /**
   * Concurrent race oracle (not serial grant-then-disconnect):
   * hold partner grant pending → disconnect completes → release grant →
   * latest persisted config must remain disconnected (empty embedUrl).
   */
  await checkAsync(
    'HTTP concurrent: in-flight grant after disconnect must not re-persist embedUrl',
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-disc-race-'));
      process.env.DATA_DIR = tmpDir;
      process.env.SERVER_SECRET =
        'test-secret-ig-race-' + crypto.randomBytes(4).toString('hex');
      process.env.PUBLIC_URL = 'http://127.0.0.1:0';
      process.env.HIDOOK_ISOLATED_DEPLOY = '1';
      process.env.HIDOOK_TEST_PAY = '1';
      process.env.NODE_ENV = 'test';
      // Partner path required so grant actually awaits external I/O.
      process.env.SITEBUILDER_PARTNER_SECRET = 'unit-test-secret-ig-race-not-real';
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.HIDOOK_FAKE_DEPLOY;

      delete require.cache[require.resolve('../auth.js')];
      delete require.cache[require.resolve('../registry.js')];
      delete require.cache[require.resolve('../instafidget-partner.js')];
      delete require.cache[require.resolve('../server.js')];

      const auth = require('../auth.js');
      const registry = require('../registry.js');
      const { startServer } = require('../server.js');

      const realFetch = global.fetch;
      let releaseGrant = null;
      let grantPartnerSeen = null;
      const grantPartnerReady = new Promise((resolve) => {
        grantPartnerSeen = resolve;
      });
      const STALE_EMBED = 'https://isolated.local/social-feed/stale-after-disconnect';

      global.fetch = async (url, opts) => {
        const u = String(url);
        if (u.includes('/billing/partner/site-bundle-grant')) {
          if (grantPartnerSeen) grantPartnerSeen();
          await new Promise((resolve) => {
            releaseGrant = resolve;
          });
          return {
            status: 200,
            async json() {
              return {
                embedUrl: STALE_EMBED,
                entitlement: 'site_bundle_year1',
                showWatermark: false,
                siteBundleExpiresAt: new Date(Date.now() + 365 * 864e5).toISOString(),
              };
            },
          };
        }
        if (u.includes('/billing/partner/')) {
          return {
            status: 200,
            async json() {
              return { editorUrl: 'https://isolated.local/app/instafidget-editor.html' };
            },
          };
        }
        return realFetch(url, opts);
      };

      const srv = startServer({ port: 0 });
      await new Promise((r) => srv.once('listening', r));
      const base = `http://127.0.0.1:${srv.address().port}`;

      try {
        const user = registry.getOrCreateUserByEmail('ig-race@example.com');
        const site = registry.createSite({
          userId: user.id,
          templateId: 'product-menu',
          templateVersion: 1,
          slug: 'ig-disc-race',
          platform: 'web',
        });
        registry.saveVersion(site.id, {
          business: { name: 'IG Race' },
          instagram: { handle: 'x', url: 'https://instagram.com/x' },
        });
        const cookie = 'hb_session=' + auth.signSession(user.id);

        // Seed a connected state first (serial), then start a SECOND in-flight grant.
        global.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/billing/partner/site-bundle-grant')) {
            return {
              status: 200,
              async json() {
                return {
                  embedUrl: 'https://isolated.local/social-feed/connected-seed',
                  entitlement: 'site_bundle_year1',
                  showWatermark: false,
                };
              },
            };
          }
          return realFetch(url, opts);
        };
        const seedGrant = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(seedGrant.status, 200, 'seed grant ok');
        let versions = registry.listVersions(site.id);
        let latest = versions[versions.length - 1];
        let cfg = registry.getVersionConfig(site.id, latest.versionId);
        assert.strictEqual(
          cfg.instagram.embedUrl,
          'https://isolated.local/social-feed/connected-seed',
          'seed connected'
        );

        // Arm delayed partner grant for the concurrent race.
        releaseGrant = null;
        grantPartnerSeen = null;
        const partnerHit = new Promise((resolve) => {
          grantPartnerSeen = resolve;
        });
        global.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/billing/partner/site-bundle-grant')) {
            await new Promise((resolve) => {
              releaseGrant = resolve;
              if (grantPartnerSeen) grantPartnerSeen();
            });
            return {
              status: 200,
              async json() {
                return {
                  embedUrl: STALE_EMBED,
                  entitlement: 'site_bundle_year1',
                  showWatermark: false,
                };
              },
            };
          }
          return realFetch(url, opts);
        };

        const grant2Promise = fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ acceptedTerms: true }),
        });

        await partnerHit;
        // Partner request is held; disconnect must win before release.
        assert.ok(typeof releaseGrant === 'function', 'grant held pending on partner');

        const disc = await fetch(`${base}/api/sites/${site.id}/social-feed/disconnect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({}),
        });
        assert.strictEqual(disc.status, 200, 'disconnect during in-flight grant');
        const discBody = await disc.json();
        assert.strictEqual(discBody.disconnected, true);

        versions = registry.listVersions(site.id);
        latest = versions[versions.length - 1];
        cfg = registry.getVersionConfig(site.id, latest.versionId);
        assert.strictEqual(
          String((cfg.instagram && cfg.instagram.embedUrl) || ''),
          '',
          'cleared while grant still pending'
        );

        releaseGrant();
        const grant2 = await grant2Promise;
        assert.strictEqual(grant2.status, 200, 'stale grant still HTTP-completes');
        const grant2Body = await grant2.json();
        assert.ok(
          !grant2Body.embedUrl || grant2Body.stale === true || grant2Body.disconnected === true,
          'stale grant must not advertise a live embedUrl without stale/disconnected markers'
        );
        assert.notStrictEqual(
          grant2Body.embedUrl,
          STALE_EMBED,
          'stale partner embedUrl must not be returned as authoritative'
        );

        versions = registry.listVersions(site.id);
        latest = versions[versions.length - 1];
        cfg = registry.getVersionConfig(site.id, latest.versionId);
        assert.strictEqual(
          String((cfg.instagram && cfg.instagram.embedUrl) || ''),
          '',
          'latest persisted config remains disconnected after stale grant resolves'
        );
        assert.ok(
          !String((cfg.instagram && cfg.instagram.embedUrl) || '').includes('stale-after-disconnect'),
          'public feed slot stays hidden (empty embedUrl)'
        );

        // Fresh connect after disconnect still works (generation advanced, new grant OK).
        global.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/billing/partner/site-bundle-grant')) {
            return {
              status: 200,
              async json() {
                return {
                  embedUrl: 'https://isolated.local/social-feed/fresh-reconnect',
                  entitlement: 'site_bundle_year1',
                  showWatermark: false,
                };
              },
            };
          }
          return realFetch(url, opts);
        };
        const fresh = await fetch(`${base}/api/sites/${site.id}/social-feed/grant`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ acceptedTerms: true }),
        });
        assert.strictEqual(fresh.status, 200, 'fresh grant after disconnect ok');
        const freshBody = await fresh.json();
        assert.strictEqual(
          freshBody.embedUrl,
          'https://isolated.local/social-feed/fresh-reconnect'
        );
        versions = registry.listVersions(site.id);
        latest = versions[versions.length - 1];
        cfg = registry.getVersionConfig(site.id, latest.versionId);
        assert.strictEqual(
          cfg.instagram.embedUrl,
          'https://isolated.local/social-feed/fresh-reconnect',
          'new post-disconnect grant may persist'
        );
      } finally {
        global.fetch = realFetch;
        delete process.env.SITEBUILDER_PARTNER_SECRET;
        srv.close();
      }
    }
  );

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
