'use strict';
/**
 * bot/test/telegram-command-menu-no-publish.test.js — S41 leftover Telegram
 * client command menu must not promise Telegram publishes or deletes a live site.
 *
 * PRODUCT: Telegram is draft-intake only. Payment and first public publish
 * happen in the browser builder. COMMAND_MENU descriptions shown via
 * setMyCommands must not advertise /retry as "publicarea" or /sterge as
 * deleting a "site publicat".
 *
 * Run: node bot/test/telegram-command-menu-no-publish.test.js
 * Exits non-zero on failed assertion.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const botSrcPath = path.join(__dirname, '..', 'bot.js');
const botSrc = fs.readFileSync(botSrcPath, 'utf8');

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

function foldRo(s) {
    return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

/**
 * Evaluate the COMMAND_MENU array literal from bot.js without starting the bot.
 */
function extractCommandMenu(src) {
    const m = src.match(/const\s+COMMAND_MENU\s*=\s*(\[[\s\S]*?\]);/);
    assert.ok(m, 'COMMAND_MENU array must exist in bot.js');
    const menu = vm.runInNewContext(m[1], Object.create(null), {
        timeout: 1000,
    });
    assert.ok(Array.isArray(menu), 'COMMAND_MENU must be an array');
    return menu;
}

function menuEntry(menu, command) {
    const entry = menu.find((e) => e && e.command === command);
    assert.ok(entry, 'COMMAND_MENU must include command: ' + command);
    assert.ok(
        typeof entry.description === 'string' && entry.description.length > 0,
        command + ' must have a non-empty description'
    );
    return entry;
}

check('COMMAND_MENU still registers retry and sterge', () => {
    const menu = extractCommandMenu(botSrc);
    const cmds = menu.map((e) => e.command);
    assert.ok(cmds.includes('retry'), 'menu must still list retry');
    assert.ok(cmds.includes('sterge'), 'menu must still list sterge');
    assert.ok(cmds.includes('start'), 'menu must still list start');
});

check('/retry menu description must not promise Telegram publishes', () => {
    const entry = menuEntry(extractCommandMenu(botSrc), 'retry');
    const folded = foldRo(entry.description);
    // Explicit card bans: publicarea / publicare / publica (and diacritic forms)
    assert.ok(
        !/\bpublicarea\b/.test(folded),
        '/retry must not say publicarea, got: ' + entry.description
    );
    assert.ok(
        !/\bpublicare\b/.test(folded),
        '/retry must not say publicare, got: ' + entry.description
    );
    assert.ok(
        !/\bpublica\b/.test(folded),
        '/retry must not say publica, got: ' + entry.description
    );
    // Broader: any public* stem promises Telegram publish of the live site
    assert.ok(
        !/public/.test(folded),
        '/retry description must not contain public*, got: ' + entry.description
    );
});

check('/sterge menu description must not imply deleting a live published site', () => {
    const entry = menuEntry(extractCommandMenu(botSrc), 'sterge');
    const folded = foldRo(entry.description);
    assert.ok(
        !/site\s+publicat/.test(folded),
        '/sterge must not say site publicat, got: ' + entry.description
    );
    assert.ok(
        !/site\s+public/.test(folded),
        '/sterge must not say site public*, got: ' + entry.description
    );
    assert.ok(
        !/\blive\b/.test(folded),
        '/sterge must not say live site, got: ' + entry.description
    );
    // Positive: may describe deleting the user's draft/data (GDPR)
    assert.ok(
        /date|draft|datele|gdpr|sesiune|datele\s+tale/.test(folded),
        '/sterge may describe deleting draft/data; got: ' + entry.description
    );
});

check('COMMAND_MENU must not introduce DESSERD / desserdina / trial / keep-site', () => {
    const menu = extractCommandMenu(botSrc);
    const blob = menu.map((e) => String(e.description || '')).join('\n');
    assert.ok(!/\bDESSERD\b/i.test(blob), 'must not contain DESSERD');
    assert.ok(!/desserdina/i.test(blob), 'must not contain desserdina');
    assert.ok(!/\btrial\b/i.test(blob), 'must not introduce trial copy');
    assert.ok(!/keep-site|keep site/i.test(blob), 'must not introduce keep-site copy');
});

check('bot.js still wires setMyCommands(COMMAND_MENU) only (no new TG checkout/deploy in menu block)', () => {
    assert.ok(
        /setMyCommands\s*\(\s*COMMAND_MENU\s*\)/.test(botSrc),
        'setMyCommands(COMMAND_MENU) must remain'
    );
    // COMMAND_MENU definitions must not call createCheckout/deploy helpers
    const m = botSrc.match(/const\s+COMMAND_MENU\s*=\s*\[[\s\S]*?\];/);
    assert.ok(m, 'COMMAND_MENU block');
    assert.ok(!/\bcreateCheckout\s*\(/.test(m[0]), 'menu block must not call createCheckout');
    assert.ok(
        !/\b_publishAndFinish\s*\(/.test(m[0]) &&
            !/\bdeployBuiltSite\s*\(/.test(m[0]),
        'menu block must not deploy'
    );
});

if (failed) {
    console.error('\ntelegram-command-menu-no-publish.test.js: FAILED');
    process.exit(1);
}
console.log('\ntelegram-command-menu-no-publish.test.js: all passed');
process.exit(0);
