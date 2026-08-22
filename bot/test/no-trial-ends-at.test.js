'use strict';
/**
 * bot/test/no-trial-ends-at.test.js — S26 registry/session must not persist trialEndsAt.
 *
 * Pay-before-publish: new site records and empty Telegram sessions must not
 * carry a trial clock (trialEndsAt / reminded). server/flow must not pass the field.
 *
 * Run: node bot/test/no-trial-ends-at.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-trial-ends-at-'));
process.env.DATA_DIR = tmpDir;

const registry = require('../registry.js');

const registryPath = path.join(__dirname, '..', 'registry.js');
const serverPath = path.join(__dirname, '..', 'server.js');
const flowPath = path.join(__dirname, '..', 'flow.js');
const registrySrc = fs.readFileSync(registryPath, 'utf8');
const serverSrc = fs.readFileSync(serverPath, 'utf8');
const flowSrc = fs.readFileSync(flowPath, 'utf8');

let failed = false;
function check(name, fn) {
    try {
        fn();
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

check('createSite does not accept trialEndsAt in its parameter list', () => {
    // Function signature must not name trialEndsAt
    const m = registrySrc.match(/function\s+createSite\s*\(\s*\{([^}]*)\}/);
    assert.ok(m, 'createSite destructuring signature not found');
    assert.ok(
        !/\btrialEndsAt\b/.test(m[1]),
        'createSite must not accept trialEndsAt parameter'
    );
});

check('createSite source does not assign trialEndsAt or reminded on new sites', () => {
    // Locate createSite body roughly (until next top-level function)
    const start = registrySrc.indexOf('function createSite');
    assert.ok(start >= 0, 'createSite not found');
    const nextFn = registrySrc.indexOf('\nfunction ', start + 1);
    const body = registrySrc.slice(start, nextFn > 0 ? nextFn : undefined);
    assert.ok(!/\btrialEndsAt\b/.test(body), 'createSite body must not reference trialEndsAt');
    assert.ok(!/\breminded\b/.test(body), 'createSite body must not reference reminded');
});

check('createSite runtime record has neither trialEndsAt nor reminded', () => {
    const user = registry.getOrCreateUserByEmail(`s26-${crypto.randomUUID()}@example.com`);
    const site = registry.createSite({
        userId: user.id,
        templateId: 'product-menu',
        templateVersion: 1,
        slug: 's26-' + crypto.randomBytes(3).toString('hex'),
        platform: 'web',
        // If callers still pass these, they must be ignored / not persisted
        trialEndsAt: new Date().toISOString(),
        reminded: true,
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(site, 'trialEndsAt'), 'site must not have trialEndsAt key');
    assert.ok(!Object.prototype.hasOwnProperty.call(site, 'reminded'), 'site must not have reminded key');
    const again = registry.getSite(site.id);
    assert.ok(!Object.prototype.hasOwnProperty.call(again, 'trialEndsAt'), 'persisted site must not have trialEndsAt');
    assert.ok(!Object.prototype.hasOwnProperty.call(again, 'reminded'), 'persisted site must not have reminded');
});

check('server.js createSite call must not pass trialEndsAt', () => {
    assert.ok(
        !/createSite\s*\(\s*\{[^}]*\btrialEndsAt\b/s.test(serverSrc),
        'server.js must not pass trialEndsAt into createSite'
    );
    // Also no standalone trialEndsAt property near publish create path
    assert.ok(
        !/\btrialEndsAt\s*:/.test(serverSrc),
        'server.js must not assign trialEndsAt'
    );
});

check('flow.js empty session must not include trialEndsAt', () => {
    assert.ok(
        !/trialEndsAt\s*:/.test(flowSrc),
        'flow.js must not set trialEndsAt on session or createSite'
    );
});

check('flow.js comments must not say trial publish', () => {
    assert.ok(
        !/trial\s+publish/i.test(flowSrc),
        'flow.js must not comment "trial publish"'
    );
});

check('flow resetSession empty session has no trialEndsAt key', () => {
    // Isolate flow DATA_DIR already set; require after env
    const flow = require('../flow.js');
    const chatId = 9260001;
    const session = flow.resetSession(chatId);
    assert.ok(
        !Object.prototype.hasOwnProperty.call(session, 'trialEndsAt'),
        'empty session must not have trialEndsAt'
    );
    flow.sessions.delete(chatId);
});

if (failed) {
    console.error('\nno-trial-ends-at: FAILED');
    process.exit(1);
}
console.log('\nno-trial-ends-at: OK');
process.exit(0);
