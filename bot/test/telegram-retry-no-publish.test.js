'use strict';
/**
 * bot/test/telegram-retry-no-publish.test.js — S42 leftover Telegram
 * /retry must not deploy a live site; paid-guard copy must not promise
 * Telegram finalizes publish via /retry.
 *
 * PRODUCT: Telegram is draft-intake only. Payment and first public publish
 * happen in the browser builder (/app/). handleRetry must not call
 * webpublish.publishSite / deployBuiltSite / _deployWithRetry. Registry
 * needs-retry and session paid-needs-retry/deploy paths must steer to the
 * Hidook builder. /anuleaza and /sterge paid guards must not say
 * "finalizez publicarea" via /retry.
 *
 * Run: node bot/test/telegram-retry-no-publish.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-retry-s42-'));
process.env.DATA_DIR = tmpDir;
process.env.PUBLIC_URL = 'http://127.0.0.1:9878';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.REVOLUT_API_KEY;
delete process.env.REVOLUT_SECRET_KEY;
delete process.env.PAYMENT_PROVIDER;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'test-secret-telegram-retry-s42';

const flowSrcPath = path.join(__dirname, '..', 'flow.js');
const flowSrc = fs.readFileSync(flowSrcPath, 'utf8');
const flow = require('../flow.js');
const registry = require('../registry');
const webpublish = require('../webpublish');

let failed = false;
function check(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            return r.then(
                () => console.log('PASS', name),
                (e) => {
                    failed = true;
                    console.error('FAIL', name, '-', e.message);
                }
            );
        }
        console.log('PASS', name);
    } catch (e) {
        failed = true;
        console.error('FAIL', name, '-', e.message);
    }
}

function foldRo(s) {
    return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/** Extract named function body until next top-level function / module.exports. */
function extractFnSrc(src, name) {
    const re = new RegExp(
        '(?:async\\s+)?function\\s+' + name + '\\s*\\('
    );
    const m = src.match(re);
    if (!m) return null;
    const rest = src.slice(m.index);
    const end = rest.search(/\n(?:async\s+)?function\s+\w+|\nmodule\.exports/);
    return end > 0 ? rest.slice(0, end) : rest.slice(0, 6000);
}

// ── Static source contracts ───────────────────────────────────────────────

check('handleRetry exists and covers paid-needs-retry / deploy / needs-retry', () => {
    const body = extractFnSrc(flowSrc, 'handleRetry');
    assert.ok(body, 'handleRetry must exist in flow.js');
    assert.ok(
        /paid-needs-retry|deploy/.test(body),
        'handleRetry must still handle paid-needs-retry/deploy leftover sessions'
    );
});

check('handleRetry must not call publishSite / deployBuiltSite / _deployWithRetry', () => {
    const body = extractFnSrc(flowSrc, 'handleRetry');
    assert.ok(body, 'handleRetry must exist');
    assert.ok(
        !/\bwebpublish\.publishSite\s*\(/.test(body) &&
            !/\bpublishSite\s*\(/.test(body),
        'handleRetry must not call webpublish.publishSite'
    );
    assert.ok(
        !/\bdeployBuiltSite\s*\(/.test(body),
        'handleRetry must not call deployBuiltSite'
    );
    assert.ok(
        !/\b_deployWithRetry\s*\(/.test(body),
        'handleRetry must not call _deployWithRetry'
    );
});

check('handleRetry source must not claim Telegram published a live site', () => {
    const body = extractFnSrc(flowSrc, 'handleRetry');
    assert.ok(body, 'handleRetry must exist');
    const folded = foldRo(body);
    assert.ok(
        !/reiau\s+publicarea/.test(folded),
        'handleRetry must not say Reiau publicarea'
    );
    assert.ok(
        !/site\s+publicat/.test(folded),
        'handleRetry must not say Site publicat'
    );
    assert.ok(
        !/publicarea\s+a\s+esuat/.test(folded) &&
            !/publicarea\s+a\s+eșuat/.test(folded),
        'handleRetry must not claim publish failed (implies TG deploy attempt)'
    );
    // Positive: steer to builder /app/ or magic-link path helpers
    assert.ok(
        /builder|\/app\/|_steerSessionToBuilder|_publishAndFinish|_builderUrl/i.test(
            body
        ),
        'handleRetry should steer to builder / _publishAndFinish / _steerSessionToBuilder'
    );
});

check('handleAnuleaza paid-guard must not say /retry finalizes live publish', () => {
    const body = extractFnSrc(flowSrc, 'handleAnuleaza');
    assert.ok(body, 'handleAnuleaza must exist');
    const folded = foldRo(body);
    assert.ok(
        !/finalizez\s+publicarea/.test(folded),
        'handleAnuleaza must not say finalizez publicarea, got snippet with /retry'
    );
    assert.ok(
        !/reiau\s+publicarea/.test(folded),
        'handleAnuleaza must not say Reiau publicarea'
    );
    assert.ok(
        !/site\s+publicat/.test(folded),
        'handleAnuleaza must not say Site publicat'
    );
    // Still guards paid deploy / paid-needs-retry
    assert.ok(
        /paid-needs-retry|deploy/.test(body),
        'paid-order guard must remain'
    );
});

check('handleSterge paid-guard must not say /retry finalizes live publish', () => {
    const body = extractFnSrc(flowSrc, 'handleSterge');
    assert.ok(body, 'handleSterge must exist');
    const folded = foldRo(body);
    assert.ok(
        !/finalizez\s+publicarea/.test(folded),
        'handleSterge must not say finalizez publicarea'
    );
    assert.ok(
        !/reiau\s+publicarea/.test(folded),
        'handleSterge must not say Reiau publicarea'
    );
    assert.ok(
        !/site\s+publicat/.test(folded),
        'handleSterge must not say Site publicat'
    );
    assert.ok(
        /paid-needs-retry|deploy/.test(body),
        'paid-order guard must remain'
    );
});

check('owned handlers must not introduce DESSERD / desserdina / trial / keep-site', () => {
    const blob = [
        extractFnSrc(flowSrc, 'handleRetry'),
        extractFnSrc(flowSrc, 'handleAnuleaza'),
        extractFnSrc(flowSrc, 'handleSterge'),
    ]
        .filter(Boolean)
        .join('\n');
    assert.ok(!/\bDESSERD\b/i.test(blob), 'must not contain DESSERD');
    assert.ok(!/desserdina/i.test(blob), 'must not contain desserdina');
    assert.ok(!/\btrial\b/i.test(blob), 'must not introduce trial copy');
    assert.ok(!/keep-site|keep site/i.test(blob), 'must not introduce keep-site copy');
});

check('handleRetry must not open a new Telegram checkout path', () => {
    const body = extractFnSrc(flowSrc, 'handleRetry');
    assert.ok(body, 'handleRetry must exist');
    assert.ok(
        !/\bcreateCheckout\s*\(/.test(body) && !/\b_initiatePayment\s*\(/.test(body),
        'handleRetry must not call createCheckout / _initiatePayment'
    );
});

// ── Runtime ───────────────────────────────────────────────────────────────

async function runtimeChecks() {
    await check('runtime registry needs-retry does not call publishSite; steers to builder', async () => {
        const chatId = 942001;
        const replies = [];
        const user = registry.getOrCreateUserByTelegram(chatId, {
            username: 's42_retry',
            firstName: 'Ana',
        });
        const site = registry.createSite({
            userId: user.id,
            templateId: 'local-service',
            templateVersion: 1,
            slug: 's42-needs-retry-' + chatId,
            platform: 'telegram',
        });
        registry.updateSite(site.id, { status: 'needs-retry', paid: true });

        let publishCalls = 0;
        const origPublish = webpublish.publishSite;
        webpublish.publishSite = async (args) => {
            publishCalls += 1;
            return { url: 'https://evil.example/should-not-deploy' };
        };

        // Fresh session (not paid-needs-retry) so registry branch is hit
        flow.sessions.delete(chatId);
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId, username: 's42_retry', first_name: 'Ana' },
            reply: async (text) => {
                replies.push(String(text));
            },
        };

        try {
            await flow.handleRetry(ctx);
        } finally {
            webpublish.publishSite = origPublish;
        }

        assert.strictEqual(
            publishCalls,
            0,
            'handleRetry must not call webpublish.publishSite for needs-retry'
        );
        assert.ok(replies.length >= 1, 'handleRetry must reply');
        const joined = replies.join('\n');
        const folded = foldRo(joined);
        assert.ok(
            !/reiau\s+publicarea/.test(folded),
            'runtime must not say Reiau publicarea: ' + joined
        );
        assert.ok(
            !/site\s+publicat/.test(folded),
            'runtime must not say Site publicat: ' + joined
        );
        assert.ok(
            /builder|editor|hidook|\/app\//i.test(joined),
            'runtime needs-retry must steer to builder /app/: ' + joined
        );
        // Site must not have been flipped to live by Telegram retry
        const updated = registry.getSite(site.id) || registry.listSites(user.id).find((s) => s.id === site.id);
        if (updated) {
            assert.notStrictEqual(
                updated.status,
                'live',
                'needs-retry site must not become live via Telegram /retry'
            );
        }
        flow.sessions.delete(chatId);
    });

    await check('runtime paid-needs-retry session steers without publishSite', async () => {
        const chatId = 942002;
        const replies = [];
        let publishCalls = 0;
        const origPublish = webpublish.publishSite;
        webpublish.publishSite = async () => {
            publishCalls += 1;
            return { url: 'https://evil.example/nope' };
        };

        flow.sessions.set(chatId, {
            phase: 'paid-needs-retry',
            stripeSessionId: 'cs_s42_retry',
            data: { name: 'S42 Retry Cafe' },
            published: false,
            _publishing: false,
        });
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId, username: 's42_pnr', first_name: 'Ana' },
            reply: async (text) => {
                replies.push(String(text));
            },
        };
        try {
            await flow.handleRetry(ctx);
        } finally {
            webpublish.publishSite = origPublish;
        }

        assert.strictEqual(publishCalls, 0, 'paid-needs-retry must not call publishSite');
        assert.ok(replies.length >= 1, 'must reply');
        const joined = replies.join('\n');
        const folded = foldRo(joined);
        assert.ok(
            !/site\s+publicat/.test(folded) && !/reiau\s+publicarea/.test(folded),
            'must not claim TG publish: ' + joined
        );
        assert.ok(
            /builder|editor|hidook|\/app\//i.test(joined),
            'must steer to builder: ' + joined
        );
        flow.sessions.delete(chatId);
    });

    await check('runtime /anuleaza paid-guard does not promise finalizez publicarea via /retry', async () => {
        const chatId = 942003;
        const replies = [];
        flow.sessions.set(chatId, {
            phase: 'deploy',
            data: { name: 'S42 Guard' },
        });
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId },
            reply: async (text) => {
                replies.push(String(text));
            },
        };
        await flow.handleAnuleaza(ctx);
        assert.ok(replies.length >= 1, 'must reply on paid guard');
        const folded = foldRo(replies.join('\n'));
        assert.ok(
            !/finalizez\s+publicarea/.test(folded),
            'anuleaza must not say finalizez publicarea: ' + replies.join('\n')
        );
        assert.ok(
            !/reiau\s+publicarea/.test(folded),
            'anuleaza must not say Reiau publicarea'
        );
        // Session still present (guard refused cancel)
        assert.ok(flow.sessions.get(chatId), 'paid deploy session must not be wiped');
        flow.sessions.delete(chatId);
    });

    await check('runtime /sterge paid-guard does not promise finalizez publicarea via /retry', async () => {
        const chatId = 942004;
        const replies = [];
        flow.sessions.set(chatId, {
            phase: 'paid-needs-retry',
            data: { name: 'S42 Sterge' },
        });
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId },
            reply: async (text) => {
                replies.push(String(text));
            },
        };
        await flow.handleSterge(ctx);
        assert.ok(replies.length >= 1, 'must reply on paid guard');
        const folded = foldRo(replies.join('\n'));
        assert.ok(
            !/finalizez\s+publicarea/.test(folded),
            'sterge must not say finalizez publicarea: ' + replies.join('\n')
        );
        assert.ok(
            !/reiau\s+publicarea/.test(folded),
            'sterge must not say Reiau publicarea'
        );
        assert.ok(flow.sessions.get(chatId), 'paid session must not be deleted by guard');
        flow.sessions.delete(chatId);
    });
}

(async () => {
    await runtimeChecks();
    if (failed) {
        console.error('\ntelegram-retry-no-publish.test.js: FAILED');
        process.exit(1);
    }
    console.log('\ntelegram-retry-no-publish.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
