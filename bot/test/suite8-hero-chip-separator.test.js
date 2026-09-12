'use strict';
/**
 * bot/test/suite8-hero-chip-separator.test.js
 *
 * The hero chips must not run into each other on the PUBLISHED site.
 *
 * professionals' hero shows "Online și la cabinet · Română, engleză și
 * spaniolă". Removing the duplicate credibility band (m6) also moved that
 * " · " out of the markup and into a CSS `::before`, so that clearing one
 * chip in the live editor would not leave an orphan dot. The CSS rule is
 * scoped to `[data-hb-edit]` — attributes that exist only inside the
 * builder's preview. A published page has none of them, so the rule never
 * matched there and the two chips rendered as
 * "Online și la cabinetRomână, engleză și spaniolă".
 *
 * The oracle that covered m6 asserted the orphan dot was gone. It was. It
 * did not assert the dot was still there when it should be, and it measured
 * the editor rather than the page a customer sees — which is how a visible
 * defect shipped behind a green test.
 *
 * Both mechanisms are needed: static markup inside the languages guard for
 * the published page, the CSS rule for the editor's live-clear. This checks
 * the published one, on rendered output, for every combination of the two
 * fields.
 *
 * Run: node --experimental-sqlite --test bot/test/suite8-hero-chip-separator.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TPL = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
const PRESETS = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')
).presets;

function heroMeta(modes, languages, preset) {
    const cfg = JSON.parse(JSON.stringify(preset.config));
    cfg.business.modes = modes;
    cfg.business.languages = languages;
    const html = renderHtml(TPL, cfg);
    const m = /<p class="pr-hero__meta">([\s\S]*?)<\/p>/.exec(html);
    if (!m) return null;
    // The separator is a .pr-hero__sep span (so the editor can hide it when a
    // chip is cleared live), so compare the TEXT a visitor reads, not markup.
    return m[1].replace(/<[^>]+>/g, '');
}

test('published hero chips are separated, and the separator never appears alone', () => {
    for (const preset of PRESETS) {
        const both = heroMeta('Online și la cabinet', 'Română, engleză', preset);
        assert.ok(both, preset.id + ': the hero meta paragraph must render when both chips are set');
        assert.match(both, /Online și la cabinet\s+·\s+Română, engleză/,
            preset.id + ': two chips must be separated, not concatenated — got ' + JSON.stringify(both));

        const modesOnly = heroMeta('Online și la cabinet', '', preset);
        assert.ok(modesOnly, preset.id + ': the paragraph must still render with only modes set');
        assert.doesNotMatch(modesOnly, /·/,
            preset.id + ': a lone chip must not trail a separator — got ' + JSON.stringify(modesOnly));

        // Clearing modes hides the whole line, which is the template's own
        // long-standing guard (`@if business.modes`) and not this fix's doing.
        // Asserted so a later change to that guard is a deliberate decision
        // rather than a surprise.
        assert.equal(heroMeta('', 'Română, engleză', preset), null,
            preset.id + ': clearing modes hides the meta line — change this only on purpose');
    }
});

test('every shipped preset renders its own chips separated', () => {
    for (const preset of PRESETS) {
        const cfg = preset.config;
        if (!cfg.business || !cfg.business.modes || !cfg.business.languages) continue;
        const html = renderHtml(TPL, cfg);
        const m = /<p class="pr-hero__meta">([\s\S]*?)<\/p>/.exec(html);
        assert.ok(m, preset.id + ': hero meta missing');
        const text = m[1].replace(/<[^>]+>/g, '');
        assert.ok(text.includes('·'),
            preset.id + ': shipped preset renders its chips with no separator — ' + JSON.stringify(text));
    }
});
