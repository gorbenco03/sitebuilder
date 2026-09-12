'use strict';
/**
 * bot/test/suite10-instagram-teaser-never-published.test.js
 *
 * S111-adjacent guard for the new Instagram "teaser" section: two parallel
 * agents are adding an example-photos-grid section that must render ONLY in
 * the builder preview (editMode:true), when the customer has not connected
 * Instagram. See the doc comment on build.js's normalizeInstagramForPublic()
 * and bot/test/s53-no-factory-placeholders.test.js for the existing policy
 * this extends: a live customer site must never show invented/example
 * content presented as that business's own feed. A teaser leaking onto the
 * PUBLISHED site (build.js's renderHtml() with no opts / editMode:false —
 * the same path bot/site-export.js's buildStaticSiteTree() and
 * bot/webpublish.js use) would be exactly that: fabricated Instagram posts
 * on a real business's real site.
 *
 * Markup contract under test (from the task brief):
 *   <section class="hb-ig-teaser" data-hb-ig-teaser aria-label="Instagram — exemplu">
 *     <p class="hb-ig-teaser__badge">Exemplu — așa va arăta pe site</p>
 *     <ul class="hb-ig-teaser__grid"> …6 <li><img></li> tiles… </ul>
 *     <div class="hb-ig-teaser__veil" hidden> … <button data-hb-ig-connect>…</button> </div>
 *   </section>
 *
 * WHAT THIS FILE CHECKS, for all five templates x every preset in each
 * template's presets.json:
 *
 *   1. renderHtml() WITHOUT editMode (the public/published path) contains
 *      none of: the `hb-ig-teaser` class, the `data-hb-ig-teaser` marker,
 *      the `data-hb-ig-connect` button marker, or any of that preset's
 *      candidate example-tile image filenames (see two sources below).
 *   2. That same public render is BYTE-IDENTICAL to a frozen baseline
 *      snapshot captured before either agent's work landed (see "BASELINE
 *      PROVENANCE" below) — so even a change that doesn't add any of the
 *      literal markers above (e.g. a stray whitespace/class change to the
 *      public path made while wiring the editMode-only branch) still fails
 *      loudly instead of slipping through.
 *
 * CANDIDATE TILE FILENAMES — two independent sources, because at the time
 * this file was written neither agent's change had landed in this worktree
 * (verified: `grep -r hb-ig-teaser` across this worktree AND every sibling
 * agent worktree under .claude/worktrees/ found nothing — see the run
 * report for the exact commands). So "none of the example tile filenames"
 * is enforced two ways, one active today and one that activates once the
 * feature lands:
 *
 *   a) STATIC, active today: each template's images/ directory already
 *      contains pre-positioned "<preset-prefix>-ig1..ig6[-Nw].{jpg,webp}"
 *      files for product-menu, portfolio and local-service (e.g.
 *      templates/product-menu/images/cn-ig1.jpg for the casa-nord preset) —
 *      confirmed NOT referenced anywhere in any template.html or
 *      presets.json today, i.e. orphaned asset prep sitting ahead of the
 *      markup wiring. Exactly matching "6 <li><img></li> tiles" from the
 *      task brief's contract, these are the overwhelmingly likely source
 *      for the example tiles. Their prefix is derived per preset from that
 *      preset's own `images/<prefix>-hero...` reference (not hardcoded), so
 *      this needs no maintenance if a preset's photo set changes.
 *   b) DYNAMIC, activates once the feature lands: this file ALSO renders
 *      every preset WITH editMode:true (the builder-preview path), looks
 *      for a `data-hb-ig-teaser` section in that output, and — if found —
 *      extracts every `<img src="...">` filename inside it. Those filenames
 *      are asserted absent from the SAME preset's public render. Because
 *      this is derived from whatever the real implementation actually ships
 *      (any naming convention, any count), it needs no update when the
 *      other agents' work lands, and it is what makes this file keep
 *      meaning after that point rather than only guarding today's orphaned
 *      assets.
 *
 * BASELINE PROVENANCE (item 2 above):
 *   Captured 2026-09-12 at commit 7cc77419ed04ebc6d96acce60b590f58bb357af8
 *   (this worktree's HEAD == main at the time of writing — verified with
 *   `git log --oneline -1` on both — i.e. strictly BEFORE either
 *   Instagram-teaser agent's commits exist anywhere). Generation: for every
 *   template x every preset in presets.json, call build.js's renderHtml()
 *   with the preset's config and NO opts (so editMode is false — the public
 *   path), and save the raw HTML verbatim under
 *   bot/test/fixtures/suite10-baseline/<template>/<presetId>.html, with
 *   bot/test/fixtures/suite10-baseline/manifest.json recording the source
 *   commit. A plain `git show <commit>:templates/X/template.html` re-render
 *   at test time was deliberately NOT used: once the teaser lands and is
 *   merged to main, "main" itself will carry the feature, so asking git for
 *   "main" at test-run time would silently stop being a pre-feature
 *   baseline. A frozen snapshot survives that.
 *   To regenerate: run `node scripts/regen-suite10-baseline.js` (dry run —
 *   prints a diff, writes nothing) and, ONLY once every reported change is
 *   confirmed unrelated to the Instagram teaser, `node
 *   scripts/regen-suite10-baseline.js --write`. That script refuses to write
 *   (even with --write) if any newly-rendered preset contains a teaser
 *   marker — see bot/test/fixtures/suite10-baseline/README.md, which also
 *   spells out when a refresh is legitimate and when it is NOT (a diff
 *   caused by the teaser reaching the public render is this guard working,
 *   not a stale fixture — regenerating in that case would defeat the guard,
 *   not fix it).
 *
 * "PROVE THE GUARD IS NOT VACUOUS": an absence assertion that has never
 * been made to fail is not known to be checking anything. The last test
 * below constructs a byte-for-byte copy of one real preset's clean public
 * render, splices a realistic teaser section matching the markup contract
 * into it (including a `data-hb-ig-connect` button and an
 * `images/cn-ig1.jpg`-style tile), runs this file's own leak-detector
 * against BOTH the clean original and the mutated copy, and asserts the
 * detector is silent on the former and throws on the latter — i.e. RED on
 * the mutated copy, GREEN on the real render. This is not exercised as a
 * side effect; it is the point of the file.
 *
 * Run: node --test bot/test/suite10-instagram-teaser-never-published.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { renderHtml } = require(path.join(ROOT, 'build.js'));

const TEMPLATES = ['product-menu', 'portfolio', 'local-service', 'professionals', 'desserdirina'];
const BASELINE_DIR = path.join(__dirname, 'fixtures', 'suite10-baseline');

const MARKERS = ['hb-ig-teaser', 'data-hb-ig-teaser', 'data-hb-ig-connect'];

function readTemplate(tpl) {
    return fs.readFileSync(path.join(ROOT, 'templates', tpl, 'template.html'), 'utf8');
}
function readPresets(tpl) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', tpl, 'presets.json'), 'utf8')).presets;
}

/** Every images/<name> basename referenced anywhere in a preset's config (for prefix derivation). */
function imageRefsInConfig(config) {
    const s = JSON.stringify(config);
    const out = new Set();
    for (const m of s.matchAll(/images\/([a-zA-Z0-9_.-]+)/g)) out.add(m[1]);
    return [...out];
}

/** Derive this preset's photo-set prefix from its own `<prefix>-hero...` reference, if any. */
function derivePrefix(config) {
    for (const ref of imageRefsInConfig(config)) {
        const m = /^([a-z0-9]+)-hero/i.exec(ref);
        if (m) return m[1];
    }
    return null;
}

/** Source (a): pre-positioned "<prefix>-ig<1-6>[-Nw].{jpg,webp,png}" files already on disk. */
function staticCandidateTileFiles(tpl, prefix) {
    if (!prefix) return [];
    const dir = path.join(ROOT, 'templates', tpl, 'images');
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-ig[1-6](?:-\\d+w)?\\.(?:jpe?g|png|webp)$', 'i');
    return names.filter((n) => re.test(n));
}

/** Source (b): filenames inside a real `data-hb-ig-teaser` section, if the editMode render has one. */
function dynamicCandidateTileFiles(editModeHtml) {
    const sectionMatch = /<section\b[^>]*\bdata-hb-ig-teaser\b[^>]*>[\s\S]*?<\/section>/i.exec(editModeHtml);
    if (!sectionMatch) return [];
    const out = new Set();
    for (const m of sectionMatch[0].matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        out.add(path.basename(m[1]));
    }
    return [...out];
}

/**
 * The guard itself: throws with a descriptive message on the first leak
 * found in `publicHtml`. Exported in spirit (kept local, but exercised
 * directly by the "prove the guard" test below) so the "does this actually
 * detect anything" proof runs the EXACT same code path production teardown
 * uses, not a re-implementation of it.
 */
function assertNoTeaserLeak(publicHtml, candidateTileFiles, label, baselineHtml) {
    for (const marker of MARKERS) {
        assert.ok(!publicHtml.includes(marker), `${label}: public render leaks marker "${marker}"`);
    }
    for (const file of candidateTileFiles) {
        // A tile filename is only evidence of a leak when the PUBLIC page did not
        // already carry that photo for its own reasons. desserdirina's teaser
        // borrows real gallery photos (cupcakes-1.jpg and friends), and those
        // legitimately appear on the published page — flagging them would be the
        // guard crying wolf, and a gate that cries wolf gets muted, which is worse
        // than not having it. When a baseline is available, a filename present in
        // the frozen pre-teaser render is exempt; a filename that was NOT there
        // before and is there now is exactly the leak this looks for.
        if (baselineHtml && baselineHtml.includes(file)) continue;
        assert.ok(!publicHtml.includes(file), `${label}: public render leaks example tile filename "${file}"`);
    }
}

test('suite10: Instagram teaser never appears in the published (no-editMode) render — 5 templates x every preset', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'manifest.json'), 'utf8'));
    const failures = [];

    for (const tpl of TEMPLATES) {
        const templateHtml = readTemplate(tpl);
        const presets = readPresets(tpl);
        const baselineEntries = manifest.templates[tpl] || [];

        for (const preset of presets) {
            const label = `${tpl}/${preset.id}`;
            const publicHtml = renderHtml(templateHtml, preset.config); // no opts => editMode false, the public path
            const editModeHtml = renderHtml(templateHtml, preset.config, { editMode: true });

            const prefix = derivePrefix(preset.config);
            const candidates = new Set([
                ...staticCandidateTileFiles(tpl, prefix),
                ...dynamicCandidateTileFiles(editModeHtml),
            ]);

            // Read the baseline BEFORE the leak check: the check needs it to tell a
            // real leak from a photo the public page already carried on its own.
            const baselineEntry = baselineEntries.find((b) => b.id === preset.id);
            const baselineHtmlOrNull = baselineEntry
                ? fs.readFileSync(path.join(BASELINE_DIR, baselineEntry.file), 'utf8')
                : null;

            try {
                assertNoTeaserLeak(publicHtml, [...candidates], label, baselineHtmlOrNull);
            } catch (e) {
                failures.push(e.message);
            }

            // Byte-identical to the frozen pre-feature baseline.
            if (!baselineEntry) {
                failures.push(
                    `${label}: no baseline fixture recorded for this preset (new preset added since baseline ` +
                    `capture). If this preset is new and unrelated to the Instagram teaser, run ` +
                    `\`node scripts/regen-suite10-baseline.js\` (dry run), read the diff, then re-run with ` +
                    `--write. Read bot/test/fixtures/suite10-baseline/README.md FIRST if there is any chance ` +
                    `this is teaser-related.`
                );
                continue;
            }
            const baselineHtml = baselineHtmlOrNull;
            if (publicHtml !== baselineHtml) {
                failures.push(
                    `${label}: public render is NOT byte-identical to the pre-teaser baseline ` +
                    `(baseline ${baselineHtml.length}B, current ${publicHtml.length}B, commit ${manifest.generatedAtCommit}). ` +
                    `If — and ONLY if — this is an intentional, Instagram-teaser-UNRELATED change (a copy fix, a ` +
                    `new photo, a markup tweak): run \`node scripts/regen-suite10-baseline.js\` to see the full diff, ` +
                    `then \`node scripts/regen-suite10-baseline.js --write\` to refresh the fixture. ` +
                    `If this diff could instead be the Instagram teaser (or its example tiles / connect button) ` +
                    `reaching the PUBLIC render: STOP — that is this guard doing its job, not a stale fixture, and ` +
                    `regenerating would silence the exact bug this test exists to catch. Read ` +
                    `bot/test/fixtures/suite10-baseline/README.md ("When NOT to refresh") before running anything.`
                );
            }
        }
    }

    assert.deepEqual(failures, [], 'Instagram teaser leaked onto (or otherwise changed) the published render:\n' + failures.join('\n'));
});

test('suite10: guard is not vacuous — proven RED on an injected teaser, GREEN on the real render', () => {
    const tpl = 'product-menu';
    const templateHtml = readTemplate(tpl);
    const presets = readPresets(tpl);
    const casaNord = presets.find((p) => p.id === 'casa-nord');
    assert.ok(casaNord, 'fixture preset casa-nord must exist for this proof');

    const cleanPublicHtml = renderHtml(templateHtml, casaNord.config);

    // Splice a realistic teaser — matching the task's markup contract,
    // including the connect-button marker and an existing local image path
    // — right before </body>, exactly the kind of leak this guard exists to
    // catch (an editMode-only section that accidentally ships unconditioned
    // into the public template).
    const injectedTeaser = [
        '<section class="hb-ig-teaser" data-hb-ig-teaser aria-label="Instagram — exemplu">',
        '  <p class="hb-ig-teaser__badge">Exemplu — așa va arăta pe site</p>',
        '  <ul class="hb-ig-teaser__grid">',
        '    <li><img src="images/cn-ig1.jpg" alt=""></li>',
        '  </ul>',
        '  <div class="hb-ig-teaser__veil" hidden>',
        '    <button data-hb-ig-connect>Conectează Instagram</button>',
        '  </div>',
        '</section>',
    ].join('\n');
    assert.ok(cleanPublicHtml.includes('</body>'), 'fixture render must have a </body> to splice before');
    const leakedPublicHtml = cleanPublicHtml.replace('</body>', injectedTeaser + '\n</body>');

    // RED: the mutated copy must fail.
    assert.throws(
        () => assertNoTeaserLeak(leakedPublicHtml, ['cn-ig1.jpg'], 'proof/leaked'),
        /leaks (marker|example tile filename)/,
        'guard did not go RED on an injected teaser — it would not have caught a real leak either'
    );

    // GREEN: the real, unmutated render must pass the identical check.
    assert.doesNotThrow(
        () => assertNoTeaserLeak(cleanPublicHtml, ['cn-ig1.jpg'], 'proof/clean'),
        'guard produced a false positive on the real, clean public render'
    );
});
