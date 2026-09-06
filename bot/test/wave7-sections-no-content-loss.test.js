'use strict';
/**
 * bot/test/wave7-sections-no-content-loss.test.js
 *
 * Section reordering rewrites the whole span between the first and last
 * top-level <section>. Anything living BETWEEN two sections that is not itself
 * a section -- a divider, a decorative strip, a stray script -- sits inside
 * that span and would be replaced by the reordered blocks, disappearing from
 * the customer's live site with no error and no log.
 *
 * No shipped template has such content today. That is precisely why this is
 * checked rather than assumed: the failure would arrive later, on the first
 * owner who reorders after someone adds a divider, and nothing in the symptom
 * would point back at reorderSections().
 *
 * The contract: refuse the reorder and warn, rather than silently drop markup.
 * A section list that declines to reorder is a visible disappointment; markup
 * vanishing from a paid site is not.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-no-content-loss.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');
const TPL = 'professionals';

function preset() {
    const p = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, TPL, 'presets.json'), 'utf8'));
    return JSON.parse(JSON.stringify(p.presets[0].config));
}

function templateHtml() {
    return fs.readFileSync(path.join(TEMPLATES_DIR, TPL, 'template.html'), 'utf8');
}

/** The section ids this template renders, in document order. */
function renderedSectionIds(html) {
    return [...html.matchAll(/<section\b[^>]*\bid="([a-zA-Z0-9_-]+)"[^>]*>/g)].map((m) => m[1]);
}

test('reordering works on the template as it ships', () => {
    const cfg = preset();
    const ids = renderedSectionIds(renderHtml(templateHtml(), cfg));
    assert.ok(ids.length >= 3, 'fixture needs at least three sections; got ' + ids.join(','));

    // Move the last section to the front.
    cfg.sections = [{ id: ids[ids.length - 1] }, ...ids.slice(0, -1).map((id) => ({ id }))];
    const after = renderedSectionIds(renderHtml(templateHtml(), cfg));
    assert.strictEqual(after[0], ids[ids.length - 1], 'the moved section must render first');
    assert.strictEqual(after.length, ids.length, 'no section may be lost by a reorder');
});

test('a divider between two sections is never silently deleted', () => {
    const cfg = preset();
    const base = templateHtml();
    const ids = renderedSectionIds(renderHtml(base, cfg));

    // Inject content between the first two sections, the way a future design
    // change plausibly would.
    const marker = '<hr class="pr-divider" data-test-divider>';

    // The divider has to land between two sections that reorderSections()
    // actually addresses -- i.e. two that carry an id -- or the fixture proves
    // nothing. Anything before the first addressed section sits outside the
    // rewritten span and would survive for the wrong reason.
    const idOpens = [...base.matchAll(/<section\b[^>]*\bid="[a-zA-Z0-9_-]+"[^>]*>/g)];
    assert.ok(idOpens.length >= 2, 'template must ship at least two id-carrying sections');
    const secondOpen = idOpens[1].index;
    const withDivider = base.slice(0, secondOpen) + marker + '\n        ' + base.slice(secondOpen);

    const before = renderHtml(withDivider, cfg);
    assert.ok(before.includes(marker), 'fixture must actually inject the divider');

    cfg.sections = [{ id: ids[ids.length - 1] }, ...ids.slice(0, -1).map((id) => ({ id }))];
    const after = renderHtml(withDivider, cfg);

    assert.ok(after.includes(marker),
        'the divider was deleted by the reorder -- content between sections must never be dropped');
    // Having refused, the order must be left exactly as authored rather than
    // half-applied.
    assert.deepStrictEqual(renderedSectionIds(after), renderedSectionIds(before),
        'a refused reorder must leave the document untouched, not partially rewritten');
});

test('no shipped template currently has content between its top-level sections', () => {
    // If this ever fails, section reordering has quietly stopped working for
    // that template -- the guard above would be declining every reorder.
    for (const tpl of fs.readdirSync(TEMPLATES_DIR)) {
        const file = path.join(TEMPLATES_DIR, tpl, 'template.html');
        const presets = path.join(TEMPLATES_DIR, tpl, 'presets.json');
        if (!fs.existsSync(file) || !fs.existsSync(presets)) continue;
        const cfg = JSON.parse(fs.readFileSync(presets, 'utf8')).presets[0].config;
        const html = renderHtml(fs.readFileSync(file, 'utf8'), cfg);

        const opens = [...html.matchAll(/<section\b[^>]*\bid="[a-zA-Z0-9_-]+"[^>]*>/g)];
        if (opens.length < 2) continue;

        for (let i = 1; i < opens.length; i++) {
            const prevClose = html.lastIndexOf('</section>', opens[i].index);
            if (prevClose === -1) continue;
            const gap = html.slice(prevClose + '</section>'.length, opens[i].index);
            assert.strictEqual(gap.trim(), '',
                tpl + ': content between top-level sections would block reordering -- ' +
                JSON.stringify(gap.trim().slice(0, 80)));
        }
    }
});
