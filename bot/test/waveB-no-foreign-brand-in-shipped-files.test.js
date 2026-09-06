'use strict';
/**
 * bot/test/waveB-no-foreign-brand-in-shipped-files.test.js
 *
 * A template's shipped files must not name another template's brand.
 *
 * templates/<id>/styles.css and template.html are copied VERBATIM into every
 * exported site and every published one — comments included. So a note in one
 * stylesheet explaining a fix by pointing at another template puts a foreign
 * brand name into a paying customer's downloaded HTML.
 *
 * This is not hypothetical tidiness. In a single night three separate contracts
 * caught it: s56 and s58 on the opened preview, and wave11-html-export on the
 * downloaded file, each time because of prose written in a code comment. Those
 * oracles police a fixed list of factory words and happened to cover the names
 * involved. This one states the actual rule, so the next comment that reaches
 * for a cross-template comparison is caught for the right reason.
 *
 * The seed business names are the strings that matter: they are what a reader
 * of the exported file would recognise as somebody else's business. CSS class
 * prefixes (.pf-, .ls-, .pm-, .pr-) are fine and often the clearest way to say
 * where a shared pattern lives — this does not touch them.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-no-foreign-brand-in-shipped-files.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

// Files copied verbatim into an exported/published site.
const SHIPPED = ['styles.css', 'template.html'];

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')));
}

function seedBrand(tpl) {
    const presets = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'presets.json'), 'utf8'));
    const cfg = (presets.presets || [])[0];
    const name = cfg && cfg.config && cfg.config.business && cfg.config.business.name;
    return typeof name === 'string' ? name.trim() : null;
}

test('no template ships a file naming another template or its brand', () => {
    const tpls = templates();
    const brands = new Map();
    for (const t of tpls) {
        const b = seedBrand(t);
        assert.ok(b, `${t}: preset has no business.name — cannot derive the brand to protect`);
        brands.set(t, b);
    }

    const violations = [];
    for (const tpl of tpls) {
        for (const file of SHIPPED) {
            const p = path.join(TEMPLATES_DIR, tpl, file);
            if (!fs.existsSync(p)) continue;
            const body = fs.readFileSync(p, 'utf8');
            for (const [other, brand] of brands) {
                if (other === tpl) continue;
                // Brand names only. A template ID like "portfolio" or
                // "professionals" is a generic English word: several
                // stylesheets legitimately point at a sibling by id when
                // documenting a shared pattern, and no customer reading their
                // exported CSS would take "product-menu" for somebody's
                // business. The id is included only when it IS the brand —
                // desserdirina — which is precisely the case that leaked.
                const needles = new Set([brand]);
                if (other.toLowerCase() === brand.toLowerCase()) needles.add(other);
                for (const needle of needles) {
                    if (needle.length < 5) continue; // too short to be unambiguous
                    const at = body.toLowerCase().indexOf(needle.toLowerCase());
                    if (at === -1) continue;
                    const line = body.slice(0, at).split('\n').length;
                    violations.push(
                        `templates/${tpl}/${file}:${line} names "${needle}", which belongs to ` +
                        `templates/${other}. This file is copied verbatim into every export and ` +
                        `publish, so that string reaches a customer's downloaded site.`
                    );
                }
            }
        }
    }
    assert.deepStrictEqual(violations, [], 'foreign brand names in shipped files:\n' + violations.join('\n'));
});
