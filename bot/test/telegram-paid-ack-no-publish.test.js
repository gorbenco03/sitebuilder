'use strict';
/**
 * bot/test/telegram-paid-ack-no-publish.test.js — S40 leftover Telegram
 * start=paid deep-link ack must not promise Telegram publishes the live site.
 *
 * PRODUCT: Telegram is draft-intake only. Payment and first public publish
 * happen in the browser builder (/app/). The leftover handleStart branch for
 * t.me/bot?start=paid (session phase pay/deploy) must not say
 * "public site-ul automat" or otherwise claim Telegram publishes.
 *
 * Run: node bot/test/telegram-paid-ack-no-publish.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-paid-ack-'));
process.env.DATA_DIR = tmpDir;
process.env.PUBLIC_URL = 'http://127.0.0.1:9877';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.REVOLUT_API_KEY;
delete process.env.REVOLUT_SECRET_KEY;
delete process.env.PAYMENT_PROVIDER;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'test-secret-telegram-paid-ack-s40';

const flowSrcPath = path.join(__dirname, '..', 'flow.js');
const flowSrc = fs.readFileSync(flowSrcPath, 'utf8');
const flow = require('../flow.js');

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

/**
 * Extract handleStart body (until next top-level function).
 */
function extractHandleStartSrc(src) {
    const m = src.match(/async function handleStart\s*\(/);
    if (!m) return null;
    const rest = src.slice(m.index);
    const end = rest.search(/\n(?:async\s+)?function\s+\w+|\nmodule\.exports/);
    return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
}

/**
 * Literal start=paid success ack inside handleStart.
 * Outer guard is (payload === 'paid' || payload === 'cancel'); cancel has its own
 * reply; paid is the remaining return ctx.reply before resetSession.
 */
function extractStartPaidAckLiteral(src) {
    const body = extractHandleStartSrc(src);
    assert.ok(body, 'handleStart must exist in flow.js');
    // Prefer the deep-link early block, then paid path after cancel branch.
    const early = body.match(
        /Returning from a checkout deep-link[\s\S]*?const session = resetSession/
    );
    const scope = early ? early[0] : body;
    // After cancel reply, bare return ctx.reply('...') is the paid ack.
    const afterCancel = scope.match(
        /payload\s*===\s*['"]cancel['"][\s\S]*?return\s+ctx\.reply\([\s\S]*?\);\s*\}?\s*return\s+ctx\.reply\(\s*['`]([^'`]*)['`]/
    );
    if (afterCancel) return afterCancel[1];
    // Or explicit if (payload === 'paid') { return ctx.reply('...') }
    const paidIf = scope.match(
        /if\s*\(\s*payload\s*===\s*['"]paid['"]\s*\)\s*\{?\s*return\s+ctx\.reply\(\s*['`]([^'`]*)['`]/
    );
    if (paidIf) return paidIf[1];
    // Fallback: ✅ Mulțumim / checkmark success tone inside early block
    const m = scope.match(/ctx\.reply\(\s*['`](✅[^'`]*)['`]/);
    assert.ok(m, 'handleStart must have a start=paid success ctx.reply literal');
    return m[1];
}

check('handleStart still has leftover start=paid deep-link branch', () => {
    const body = extractHandleStartSrc(flowSrc);
    assert.ok(body, 'handleStart must exist');
    assert.ok(
        /payload\s*===\s*['"]paid['"]/.test(body) &&
            /start=paid|phase === 'pay'|phase === 'deploy'/.test(body),
        'leftover start=paid / pay|deploy guard must remain'
    );
});

check('start=paid ack source must not promise public site-ul automat', () => {
    const ack = extractStartPaidAckLiteral(flowSrc);
    const folded = foldRo(ack);
    assert.ok(
        !/public\s+site-ul\s+automat/.test(folded),
        'must not say public site-ul automat, got: ' + ack
    );
    assert.ok(
        !/publica\s+site-ul\s+automat/.test(folded),
        'must not say publică site-ul automat, got: ' + ack
    );
    assert.ok(
        !/public\s+site-ul/.test(folded) && !/publica\s+site-ul/.test(folded),
        'must not promise public/publică site-ul from Telegram, got: ' + ack
    );
    assert.ok(
        !/publicam\s+(automat\s+)?site/.test(folded),
        'must not promise we publish the site automatically, got: ' + ack
    );
});

check('start=paid ack may steer to Hidook Site Builder draft (edit + pay in /app/)', () => {
    const ack = extractStartPaidAckLiteral(flowSrc);
    const folded = foldRo(ack);
    assert.ok(
        /builder|editor|draft|hidook|\/app\//.test(folded),
        'ack should steer to Hidook builder / draft /app/, got: ' + ack
    );
});

check('start=paid ack must not introduce DESSERD / desserdina / trial / keep-site', () => {
    const ack = extractStartPaidAckLiteral(flowSrc);
    assert.ok(!/\bDESSERD\b/i.test(ack), 'must not contain DESSERD');
    assert.ok(!/desserdina/i.test(ack), 'must not contain desserdina');
    assert.ok(!/\btrial\b/i.test(ack), 'must not introduce trial copy');
    assert.ok(!/keep-site|keep site/i.test(ack), 'must not introduce keep-site copy');
});

check('start=paid ack must not open checkout or deploy from Telegram', () => {
    const body = extractHandleStartSrc(flowSrc);
    // The paid deep-link early-return block only: from payload paid/cancel guard to resetSession
    const early = body.match(
        /Returning from a checkout deep-link[\s\S]*?const session = resetSession/
    );
    const scope = early ? early[0] : body;
    assert.ok(
        !/\bcreateCheckout\s*\(/.test(scope),
        'start=paid branch must not call createCheckout'
    );
    assert.ok(
        !/\b_publishAndFinish\s*\(/.test(scope) &&
            !/\bdeployBuiltSite\s*\(/.test(scope) &&
            !/\b_deployWithRetry\s*\(/.test(scope),
        'start=paid branch must not deploy'
    );
});

async function runtimeChecks() {
    await check('runtime start=paid ack does not promise Telegram publishes', async () => {
        const chatId = 940001;
        const replies = [];
        flow.sessions.set(chatId, {
            phase: 'pay',
            stripeSessionId: 'cs_s40_paid_ack',
            data: { name: 'S40 Cafe' },
        });
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId, username: 's40_user', first_name: 'Ana' },
            match: 'paid',
            reply: async (text) => {
                replies.push(String(text));
            },
        };
        await flow.handleStart(ctx);
        assert.ok(replies.length >= 1, 'handleStart start=paid must reply');
        const joined = replies.join('\n');
        const folded = foldRo(joined);
        assert.ok(
            !/public\s+site-ul\s+automat/.test(folded),
            'runtime must not say public site-ul automat: ' + joined
        );
        assert.ok(
            !/public\s+site-ul/.test(folded) && !/publica\s+site-ul/.test(folded),
            'runtime must not promise public/publică site-ul: ' + joined
        );
        assert.ok(
            /builder|editor|draft|hidook|\/app\//i.test(joined),
            'runtime should steer to builder draft /app/: ' + joined
        );
        // Session should not have been reset into a fresh wizard by the paid branch
        const sess = flow.sessions.get(chatId);
        if (sess) {
            assert.ok(
                sess.phase === 'pay' || sess.phase === 'deploy' || sess.phase === 'done',
                'paid deep-link must not restart wizard mid-pay'
            );
        }
        flow.sessions.delete(chatId);
    });

    await check('runtime start=paid with deploy phase same no-publish contract', async () => {
        const chatId = 940002;
        const replies = [];
        flow.sessions.set(chatId, {
            phase: 'deploy',
            stripeSessionId: 'cs_s40_deploy_ack',
            data: { name: 'S40 Deploy' },
        });
        const ctx = {
            chat: { id: chatId, type: 'private' },
            from: { id: chatId, username: 's40_dep', first_name: 'Ana' },
            match: 'paid',
            reply: async (text) => {
                replies.push(String(text));
            },
        };
        await flow.handleStart(ctx);
        assert.ok(replies.length >= 1, 'must reply on deploy-phase start=paid');
        const folded = foldRo(replies.join('\n'));
        assert.ok(
            !/public\s+site-ul/.test(folded) && !/publica\s+site-ul/.test(folded),
            'deploy-phase start=paid must not promise public site-ul'
        );
        flow.sessions.delete(chatId);
    });
}

(async () => {
    await runtimeChecks();
    if (failed) {
        console.error('\ntelegram-paid-ack-no-publish.test.js: FAILED');
        process.exit(1);
    }
    console.log('\ntelegram-paid-ack-no-publish.test.js: all passed');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
