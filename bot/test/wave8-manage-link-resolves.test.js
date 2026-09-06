'use strict';
/**
 * bot/test/wave8-manage-link-resolves.test.js
 *
 * Every cancel/reschedule email sent to a visitor carries a manage link. That
 * link used to be built only from CALENDAR_PUBLIC_BASE_URL / PUBLIC_BASE_URL,
 * neither of which is set anywhere in this repo -- not the Dockerfile, not
 * railway.json, not CI, not the deploy runbook -- while the rest of the
 * application configures itself from PUBLIC_URL.
 *
 * So a deployment set up exactly as documented fell through to the loopback
 * default and mailed every visitor a link to http://127.0.0.1:0, a port that
 * cannot be connected to. The reschedule feature itself worked perfectly when
 * driven with a token in hand, which is how it was tested; the path an actual
 * visitor takes was dead.
 *
 * This is the failure mode worth guarding: nothing errors, the email sends,
 * and the business only notices when someone who meant to cancel silently does
 * not turn up.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-manage-link-resolves.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function freshEmailModule(env) {
    for (const k of ['CALENDAR_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL', 'PUBLIC_URL']) delete process.env[k];
    Object.assign(process.env, env);
    const p = require.resolve('../calendar-native/email/index.js');
    delete require.cache[p];
    return require(p);
}

test('the manage link uses PUBLIC_URL when no calendar-specific base is set', () => {
    const email = freshEmailModule({ PUBLIC_URL: 'https://afacerea-mea.hidook.com' });
    const url = email.buildManageUrl('tok_abc');
    assert.ok(url.startsWith('https://afacerea-mea.hidook.com/'),
        'a deployment configured only with PUBLIC_URL must still produce a reachable link, got ' + url);
    assert.ok(!url.includes('127.0.0.1'), 'the loopback default must not be used when PUBLIC_URL exists');
    assert.match(url, /token=tok_abc/, 'the token must survive into the link');
});

test('a calendar-specific base still wins, and a trailing slash does not double up', () => {
    const email = freshEmailModule({
        CALENDAR_PUBLIC_BASE_URL: 'https://rezervari.exemplu.ro/',
        PUBLIC_URL: 'https://altceva.hidook.com',
    });
    const url = email.buildManageUrl('t');
    assert.ok(url.startsWith('https://rezervari.exemplu.ro/calendar-native/manage'),
        'the calendar-specific base must take precedence, got ' + url);
    assert.ok(!url.includes('//calendar-native'), 'a trailing slash must not produce a doubled path separator');
});

test('an unconfigured deployment is loud about it rather than mailing a dead link quietly', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bot', 'calendar-native', 'email', 'index.js'), 'utf8');
    const start = src.indexOf('function manageBaseUrl(');
    assert.notStrictEqual(start, -1, 'manageBaseUrl must exist');
    const body = src.slice(start, src.indexOf('\n}', start));

    assert.match(body, /PUBLIC_URL/, 'PUBLIC_URL must be among the candidates');
    assert.match(body, /log\(/, 'falling back to loopback must be logged, not silent');
    assert.match(body, /'error'/, 'it must be logged at error level -- a dead link in a customer inbox is invisible otherwise');

    // The loopback default may remain for local development, but it must be
    // the last resort rather than the second option.
    const loopbackAt = body.indexOf('127.0.0.1');
    const publicUrlAt = body.indexOf('PUBLIC_URL');
    assert.ok(publicUrlAt < loopbackAt, 'PUBLIC_URL must be consulted before falling back to loopback');
});

test('the token is URL-encoded, so a link cannot be truncated by the token itself', () => {
    const email = freshEmailModule({ PUBLIC_URL: 'https://x.hidook.com' });
    const url = email.buildManageUrl('a b&c=d#e');
    assert.ok(!/[ &#]/.test(url.split('token=')[1]), 'token must be percent-encoded, got ' + url);
});
