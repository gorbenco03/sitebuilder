'use strict';
/**
 * bot/test/wave8-icon-scheme-allowlist.test.js
 *
 * The raw `{{& icon}}` sink has now been "fixed" three times:
 *
 *   1. A blocklist for javascript:/data:/vbscript:. Missed tab/CR/LF inside the
 *      scheme word, because a browser strips those before parsing.
 *   2. A blocklist that also decoded NUMERIC character references. Missed NAMED
 *      ones, so `javascript&colon;alert(1)` and `jav&Tab;ascript:` still ran.
 *   3. This one: an allowlist.
 *
 * Each blocklist closed the variants somebody had thought of, which is why the
 * finding kept being reported closed and kept being exploitable. The allowlist
 * inverts the default: a scheme this product does not serve is refused whether
 * or not anyone anticipated its spelling.
 *
 * These checks therefore assert the PROPERTY (unknown schemes are refused),
 * not a list of known payloads — a test that only enumerates today's bypasses
 * repeats the same mistake as the code it guards.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-icon-scheme-allowlist.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TPL = '<div>{{& icon}}</div>';
const render = (icon) => renderHtml(TPL, { icon });

/** The href actually present in the rendered output. */
function hrefOf(html) {
    const m = /href="([^"]*)"/.exec(html);
    return m ? m[1] : null;
}

test('every known bypass of the previous two fixes is refused', () => {
    const payloads = {
        'plain javascript:': 'javascript:alert(1)',
        'literal tab in scheme': 'jav\tascript:alert(1)',
        'literal newline in scheme': 'jav\nascript:alert(1)',
        'decimal entity': '&#106;avascript:alert(1)',
        'hex entity': '&#x6a;avascript:alert(1)',
        'named colon entity': 'javascript&colon;alert(1)',
        'named Tab entity': 'jav&Tab;ascript:alert(1)',
        'named NewLine entity': 'jav&NewLine;ascript:alert(1)',
        'mixed case': 'JaVaScRiPt:alert(1)',
        'leading control char': 'javascript:alert(1)',
        'data uri': 'data:text/html,<script>alert(1)</script>',
        'vbscript': 'VBScript:msgbox(1)',
    };
    for (const [name, url] of Object.entries(payloads)) {
        const out = render(`<svg><a href="${url}">x</a></svg>`);
        assert.strictEqual(hrefOf(out), '#', name + ' must be neutralised, got: ' + hrefOf(out));
    }
});

test('an unknown scheme nobody enumerated is refused by default', () => {
    // The point of the allowlist. None of these are on any blocklist anywhere,
    // and none of them should reach a visitor's browser from a template icon.
    for (const url of ['chrome://settings', 'file:///etc/passwd', 'blob:https://x/y',
                       'intent://scan/#Intent;end', 'jar:http://x!/y', 'wyzzy:doSomething']) {
        const out = render(`<svg><a href="${url}">x</a></svg>`);
        assert.strictEqual(hrefOf(out), '#', url + ' must be refused by default');
    }
});

test('the URLs a real icon actually uses still work', () => {
    // A sanitizer that breaks legitimate content gets switched off, so this
    // half matters as much as the half above.
    const allowed = [
        'https://exemplu.ro/pagina',
        'http://exemplu.ro',
        'mailto:contact@exemplu.ro',
        'tel:+40721000000',
        'cookies.html',
        '/live/afacerea-mea/',
        '#servicii',
        '?filtru=toate',
        'imagini/logo.svg',
    ];
    for (const url of allowed) {
        const out = render(`<svg><a href="${url}">x</a></svg>`);
        assert.strictEqual(hrefOf(out), url, url + ' is legitimate and must survive untouched');
    }
});

test('a colon inside a path is not mistaken for a scheme', () => {
    // "foo/bar:baz" has a colon but no scheme: the slash comes first. Treating
    // it as a scheme would break real relative links.
    const out = render('<svg><a href="imagini/a:b.svg">x</a></svg>');
    assert.strictEqual(hrefOf(out), 'imagini/a:b.svg');
});

test('script and event-handler stripping still applies alongside the URL check', () => {
    const withScript = render('<svg><script>alert(1)</script><a href="https://ok.ro">x</a></svg>');
    assert.ok(!withScript.includes('<script'), 'script blocks must still be removed');
    assert.strictEqual(hrefOf(withScript), 'https://ok.ro', 'the safe href alongside must survive');

    const withHandler = render('<svg><a href="https://ok.ro" onclick="alert(1)">x</a></svg>');
    assert.ok(!/\bonclick\s*=/.test(withHandler), 'event handlers must still be neutralised');
});
