'use strict';
/**
 * bot/test/waveB-sections-panel-reachable.test.js
 *
 * "A feature is not done until a customer can reach it" (AGENTS.md).
 *
 * The page-sections feature had a complete engine, a complete drawer panel,
 * and a complete schema contract — and shipped reachable on one template out
 * of five, because the other four had no ids on their sections and no
 * pageSections in their schema. Every layer was green. Nothing tested the
 * thing an owner actually does: open a design, open Detalii, and look for the
 * control.
 *
 * wave7-sections-builder-e2e drives the whole flow, including publish, but
 * only on professionals. This is the cheap, wide counterpart: for every
 * template, the panel exists, is populated from that template's own schema,
 * speaks Romanian, and offers keyboard-operable buttons rather than a drag
 * gesture. It is deliberately about reach, not behaviour — the reordering
 * itself is proven by wave7-sections-e2e-all-templates on the rendered DOM.
 *
 * T-1A/T-1B/T-1C (PLAN-UX §5.2) added `addable: true` page sections (FAQ /
 * Program / Unde ne găsești). By design (builder/app.js's
 * visiblePageSectionEntries()/pageSectionSeedEntry()), an addable section
 * starts `pending` and is deliberately EXCLUDED from this ordinary row list
 * — it must only be reachable through the "Adaugă o secțiune" catalog until
 * a customer adds it (see bot/test/audit27-t-1a-add-section.test.js). So the
 * row count this file checks against the schema excludes addable entries;
 * it separately checks that the catalog button/entries exist for them, which
 * is the addable sections' own reachability path.
 *
 * Run: node --experimental-sqlite --test bot/test/waveB-sections-panel-reachable.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const TEMPLATES_DIR = path.join(ROOT, 'templates');

function templates() {
    return fs.readdirSync(TEMPLATES_DIR).filter((t) =>
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'presets.json')) &&
        fs.existsSync(path.join(TEMPLATES_DIR, t, 'template.html')));
}

test('the page-sections panel is reachable and populated on every template', async () => {
    process.env.HIDOOK_TEST_PAY = '1';
    process.env.HIDOOK_ISOLATED_DEPLOY = '1';
    process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'secpanel-'));
    process.env.SERVER_SECRET = 'secpanel-' + crypto.randomBytes(8).toString('hex');
    delete process.env.PUBLIC_URL;

    const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
    const server = startServer({ port: 0 });
    await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;

    const browser = await chromium.launch({ headless: true });
    const failures = [];
    try {
        for (const tpl of templates()) {
            const schema = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, tpl, 'schema.json'), 'utf8'));
            const allSections = schema.pageSections || [];
            const addableSections = allSections.filter((s) => s && s.addable === true);
            // Addable sections start pending/hidden by design (T-1A) — only the
            // ordinary, already-visible sections are expected as panel rows.
            const expected = allSections.filter((s) => !(s && s.addable === true)).map((s) => s.id);
            assert.ok(
                allSections.length > 0,
                `${tpl}: schema has no pageSections — the panel cannot be reachable for this template`
            );

            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            page.setDefaultTimeout(25000);
            await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
            await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
            await page.locator(`.template-card[data-template-id="${tpl}"] .btn-start-tpl`).click();
            await page.waitForURL(/#edit$/);
            await page.locator('#preview-iframe').waitFor({ state: 'visible' });
            await page.waitForTimeout(1200);
            if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
                await page.locator('#btn-open-drawer').click().catch(() => {});
            }
            await page.waitForTimeout(600);

            const seen = await page.evaluate(() => {
                const list = document.querySelector('.hb-sections-list');
                if (!list) return { missing: true };
                return {
                    rows: [...list.children].map((row) => ({
                        text: (row.innerText || '').replace(/\s+/g, ' ').trim(),
                        buttons: [...row.querySelectorAll('button')].map((b) =>
                            (b.getAttribute('aria-label') || b.textContent || '').trim()),
                        // Anything draggable-only would be unreachable by keyboard.
                        controls: row.querySelectorAll('button, [role="button"]').length,
                    })),
                };
            });
            // Addable sections (T-1A) are reachable only through the catalog,
            // not as ordinary rows — check that path explicitly here.
            let catalog = { opened: false, cardTexts: [] };
            if (addableSections.length > 0) {
                const addBtn = page.locator('#btn-add-section-panel');
                if (await addBtn.isVisible().catch(() => false)) {
                    await addBtn.click().catch(() => {});
                    const modal = page.locator('#modal-add-section');
                    if (await modal.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
                        catalog.opened = true;
                        catalog.cardTexts = await page.locator('.add-section-card').allInnerTexts().catch(() => []);
                    }
                }
            }
            await page.close();

            if (addableSections.length > 0) {
                if (!catalog.opened) {
                    failures.push(`${tpl}: ${addableSections.length} addable section(s) declared but "Adaugă o secțiune" catalog did not open — an owner cannot reach them`);
                } else if (catalog.cardTexts.length !== addableSections.length) {
                    failures.push(
                        `${tpl}: catalog shows ${catalog.cardTexts.length} card(s), schema declares ${addableSections.length} addable section(s)`
                    );
                }
            }

            if (seen.missing) {
                failures.push(`${tpl}: no .hb-sections-list in the details drawer — an owner cannot reach the feature`);
                continue;
            }
            if (seen.rows.length !== expected.length) {
                failures.push(
                    `${tpl}: panel shows ${seen.rows.length} rows, schema declares ${expected.length} ` +
                    `page sections — the panel and the contract disagree`
                );
            }
            for (const row of seen.rows) {
                if (!row.controls) {
                    failures.push(`${tpl}: row "${row.text.slice(0, 40)}" has no button — drag-only is not keyboard-operable`);
                }
                if (!/[ăâîșțĂÂÎȘȚ]/.test(row.text) && !/Obligatorie|Elimină|Mută/.test(row.text)) {
                    failures.push(`${tpl}: row "${row.text.slice(0, 40)}" does not read as Romanian product copy`);
                }
            }
        }
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    }
    assert.deepStrictEqual(failures, [], 'page-sections panel unreachable or inconsistent:\n' + failures.join('\n'));
});
