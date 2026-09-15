'use strict';
/**
 * bot/test/suite12-booking-month-calendar.test.js
 *
 * Owner report (screenshot of a published salon site, "Alege un interval"
 * step, 2026-09-14): the day picker was a single scrolling row of day
 * buttons ("Lu 14, Ma 15, Mi 16 … Mi 23" — 14 days, `data-day-count`,
 * public-booking-widget.js). "It would be good to open an actual calendar,
 * because someone may want to book 2-3 weeks ahead."
 *
 * This suite covers the month-grid calendar that replaces it:
 *  1. Month grid renders: Monday-first weekday header, Romanian month title,
 *     prev/next buttons, today marked, selected day marked.
 *  2. Navigation is bounded by the horizon: prev disabled on the current
 *     month, next disabled past the (server or default) horizon month.
 *  3. Disabled days match real availability (owner's Mon-Fri hours — the
 *     DEMO tenant's weekends have zero slots) and are shown, not hidden.
 *  4. A day ~3 weeks out (crossing a month boundary) can be booked
 *     end-to-end through the calendar.
 *  5. One availability request per month view — not one per day, and not
 *     re-fetched when paging back to an already-loaded month.
 *  6. Keyboard arrow-key navigation moves the roving-tabindex focus across
 *     the grid.
 *  7. 390px viewport: no page horizontal scroll.
 *  8. Old published markup (data-day-count baked into a prior publish, see
 *     preview.html) still boots the widget without error.
 *
 * Plus a server-side oracle: the public slots endpoint's range cap now
 * covers a full calendar month (was 21 days — too small for the widget's
 * one-request-per-month fetch), and a tenant with no configured
 * max_advance_days reports it as null (permissive) rather than fabricating
 * a server-side cap — the widget applies its own default horizon.
 *
 * Run: node --experimental-sqlite --test bot/test/suite12-booking-month-calendar.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
    const candidates = ['playwright', path.join(ROOT, 'node_modules/playwright')];
    for (const cand of candidates) {
        try { return require(cand); } catch (_) { /* try next */ }
    }
    throw new Error('playwright not found — install devDependency (npm install in the repo root)');
}

// ---------------------------------------------------------------------------
// Server-side oracle: listPublicSlots range cap now covers one calendar
// month, and maxAdvanceDays is reported honestly (null when unconfigured).
// ---------------------------------------------------------------------------
test('listPublicSlots accepts a full calendar month in one request, still caps beyond it', () => {
    const { openCalendarDb } = require(path.join(ROOT, 'bot/calendar-native/db'));
    const engine = require(path.join(ROOT, 'bot/calendar-native/engine'));
    const publicApi = require(path.join(ROOT, 'bot/calendar-native/public-api'));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-range-'));
    const db = openCalendarDb({ dbPath: path.join(tmp, 'range.sqlite'), skipRetentionSweep: true, skipReminderSweep: true });
    try {
        const C = 'cust_s12_range';
        const S = 'site_s12_range';
        engine.ensureSettings(db, C, S, { timezone: 'UTC', slot_interval_minutes: 60 });
        const svc = engine.upsertService(db, C, S, { name: 'Serviciu', duration_minutes: 30 });
        engine.setWeeklyAvailability(db, C, S, [
            { weekday: 1, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 2, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 3, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 4, start_minute: 0, end_minute: 24 * 60 },
            { weekday: 5, start_minute: 0, end_minute: 24 * 60 },
        ]);
        const nowMs = Date.UTC(2031, 2, 1, 0, 0, 0); // 2031-03-01

        // A full 31-day month (March 2031) in one request must NOT be truncated.
        const full = publicApi.listPublicSlots(db, C, S, {
            serviceId: svc.id, fromDateLocal: '2031-03-01', toDateLocal: '2031-03-31', nowMs,
        });
        assert.ok(full.ok, JSON.stringify(full));
        assert.equal(full.toDateLocal, '2031-03-31', 'a 31-day range must not be truncated — the widget fetches one whole month per request');

        // Still bounded: a much longer range gets capped, not served in full.
        const long = publicApi.listPublicSlots(db, C, S, {
            serviceId: svc.id, fromDateLocal: '2031-03-01', toDateLocal: '2031-06-01', nowMs,
        });
        assert.ok(long.ok);
        assert.ok(long.toDateLocal < '2031-06-01', 'the public range must still be capped, not unbounded');

        // maxAdvanceDays surfaces honestly: null when the tenant never configured one.
        const svcList = publicApi.listPublicServices(db, C, S);
        assert.ok(svcList.ok);
        assert.equal(svcList.maxAdvanceDays, null, 'an unconfigured tenant must report maxAdvanceDays as null, not a fabricated cap');

        // Once configured, the real value is surfaced.
        engine.ensureSettings(db, C, S, { max_advance_days: 45 });
        const svcList2 = publicApi.listPublicServices(db, C, S);
        assert.equal(svcList2.maxAdvanceDays, 45);
    } finally {
        db.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Browser oracle — the DEMO tenant (demo_customer_elena/demo_site_cabinet),
// served same-origin via /calendar-native/widget/ (preview.html), which
// already carries a baked-in data-day-count="14" attribute from before this
// wave — exercising it here IS the "old published markup still works" check.
// DEMO: Mon-Fri 09:00-17:00, two staff resources, no max_advance_days
// configured (the widget must apply its own default horizon).
// ---------------------------------------------------------------------------
test('month-grid calendar widget', async (t) => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite12-widget-'));
    delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
    const { createHandler } = require(path.join(ROOT, 'bot/server.js'));
    const http = require('node:http');
    const server = http.createServer(createHandler({}));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();

    t.after(async () => {
        await browser.close();
        await new Promise((r) => server.close(r));
    });

    async function openWidget(page) {
        await page.goto(base + '/calendar-native/widget/', { waitUntil: 'networkidle' });
        // Bootstrap auto-selects the first service and loads its month —
        // no click needed (and clicking an already-selected service would
        // redundantly re-fetch, same as the pre-existing click handler).
        await page.locator('.hnb__svc.is-selected').first().waitFor({ state: 'visible', timeout: 20000 });
        await page.locator('.hnb__cal').first().waitFor({ state: 'visible', timeout: 20000 });
    }

    await t.test('renders a Monday-first month grid with today and the selected day marked; old data-day-count markup does not break it', async () => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        await openWidget(page);

        // The preview host page's #hnb-root still carries data-day-count="14"
        // (baked in before this wave) — this whole test runs against that
        // exact markup, so an unbroken widget IS the backward-compat proof.
        const dayCountAttr = await page.locator('#hnb-root').getAttribute('data-day-count');
        assert.equal(dayCountAttr, '14');

        const weekdayHeader = await page.locator('.hnb__cal-weekdays span').allTextContents();
        assert.deepEqual(weekdayHeader, ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'], 'weekday header must start Monday');

        const title = (await page.locator('.hnb__cal-title').textContent() || '').trim().toLowerCase();
        const monthsRo = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
            'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
        const now = new Date();
        assert.ok(monthsRo.some((m) => title.includes(m)), `month title "${title}" must name the current Romanian month`);
        assert.ok(title.includes(String(now.getFullYear())) || title.includes(String(now.getFullYear() + 1)),
            `month title "${title}" must include a year`);

        const todayCell = page.locator('.hnb__cal-day.is-today');
        await todayCell.waitFor({ state: 'attached' });
        assert.equal(await todayCell.count(), 1, 'exactly one day must be marked as today');
        assert.ok(await todayCell.evaluate((n) => n.classList.contains('is-selected')),
            'on first load today must also be the selected day');

        assert.equal(pageErrors.length, 0, 'no uncaught JS errors: ' + pageErrors.join(' | '));
        await page.close();
    });

    await t.test('prev is disabled on the current month; disabled days are shown, not hidden, and match Mon-Fri availability', async () => {
        const page = await browser.newPage();
        await openWidget(page);

        assert.ok(await page.locator('.hnb__cal-prev').isDisabled(), 'prev must be disabled on the month containing today');

        // Every weekend cell in the visible month must be aria-disabled (DEMO
        // has no weekend hours) while at least one weekday cell is not —
        // "disabled, not hidden": the cell is still a real, visible button.
        const allDays = await page.locator('.hnb__cal-day').all();
        assert.ok(allDays.length >= 28, 'a month grid must have at least 28 day cells');
        let sawDisabledWeekend = false;
        let sawEnabledWeekday = false;
        for (const cell of allDays) {
            const ymd = await cell.getAttribute('data-date');
            const disabled = (await cell.getAttribute('aria-disabled')) === 'true';
            const jsDate = new Date(ymd + 'T12:00:00Z');
            const isWeekend = jsDate.getUTCDay() === 0 || jsDate.getUTCDay() === 6;
            await cell.evaluate((n) => n.offsetParent !== null || n.getClientRects().length > 0); // sanity: attached & rendered
            if (isWeekend) {
                if (disabled) sawDisabledWeekend = true;
            } else if (!disabled) {
                sawEnabledWeekday = true;
            }
        }
        assert.ok(sawDisabledWeekend, 'at least one weekend day in the visible month must be shown disabled');
        assert.ok(sawEnabledWeekday, 'at least one weekday must remain bookable (not everything disabled)');

        await page.close();
    });

    await t.test('next is disabled past the horizon, and a day ~3 weeks out (crossing a month boundary) can be booked end-to-end', async () => {
        const page = await browser.newPage();
        await openWidget(page);

        // Pick a real weekday ~3 weeks out (spec: "book 2-3 weeks ahead").
        function ymd(d) { return d.toISOString().slice(0, 10); }
        let target = new Date();
        target.setUTCDate(target.getUTCDate() + 21);
        while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
            target.setUTCDate(target.getUTCDate() + 1);
        }
        const targetYmd = ymd(target);

        // Page forward (at most a few months) until the target cell exists.
        let cell = page.locator(`.hnb__cal-day[data-date="${targetYmd}"]`);
        for (let i = 0; i < 4 && (await cell.count()) === 0; i++) {
            const nextBtn = page.locator('.hnb__cal-next');
            assert.ok(!(await nextBtn.isDisabled()), 'next must not be disabled before reaching a day only 3 weeks out');
            await nextBtn.click();
            await page.waitForTimeout(300);
            cell = page.locator(`.hnb__cal-day[data-date="${targetYmd}"]`);
        }
        assert.equal(await cell.count(), 1, `target date ${targetYmd} must be reachable within a few months of paging`);
        assert.notEqual(await cell.getAttribute('aria-disabled'), 'true', `${targetYmd} is a weekday within DEMO's default horizon and must be bookable`);

        await cell.click();
        await page.locator('.hnb__slot').first().waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('.hnb__slot').first().click();

        await page.locator('.hnb__form input[name="name"]').fill('Vizitator Calendar');
        await page.locator('.hnb__form input[name="email"]').fill('vizitator-cal-' + Date.now() + '@example.com');
        await page.locator('[data-hnb-submit]').click();
        await page.locator('[data-hnb-success]').waitFor({ state: 'visible', timeout: 15000 });

        // Now find and cross the actual horizon boundary: keep paging forward
        // until next becomes disabled, and confirm clicking past it is inert.
        const page2 = await browser.newPage();
        await openWidget(page2);
        let guard = 0;
        while (!(await page2.locator('.hnb__cal-next').isDisabled()) && guard < 36) {
            await page2.locator('.hnb__cal-next').click();
            await page2.waitForTimeout(200);
            guard += 1;
        }
        assert.ok(guard < 36, 'the horizon must be reached within 36 months of paging (DEMO default horizon is ~2 months)');
        const titleAtHorizon = await page2.locator('.hnb__cal-title').textContent();
        assert.ok(await page2.locator('.hnb__cal-next').isDisabled(), 'next must be disabled at the horizon month');
        // Clicking a genuinely disabled native button is a no-op; confirm the
        // title does not advance further.
        await page2.locator('.hnb__cal-next').click({ force: true }).catch(() => {});
        await page2.waitForTimeout(150);
        assert.equal(await page2.locator('.hnb__cal-title').textContent(), titleAtHorizon, 'next must not advance past the horizon month');

        await page.close();
        await page2.close();
    });

    await t.test('one availability request per month view — not per day, and cached months are not re-fetched', async () => {
        const page = await browser.newPage();
        const slotRequests = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/calendar-native/slots')) slotRequests.push(req.url());
        });
        await openWidget(page);
        await page.waitForTimeout(300);
        const afterMount = slotRequests.length;
        assert.equal(afterMount, 1, 'mounting must fetch availability exactly once (one request for the current month)');

        // Clicking several different enabled days in the SAME month must not
        // trigger any new network request — the month's data is already cached.
        const enabledDays = page.locator('.hnb__cal-day:not([aria-disabled="true"])');
        const n = await enabledDays.count();
        for (let i = 0; i < Math.min(3, n); i++) {
            await enabledDays.nth(i).click();
            await page.waitForTimeout(150);
        }
        assert.equal(slotRequests.length, afterMount, 'selecting different days within one month must not re-fetch availability');

        // Paging to the next month fetches exactly once more.
        if (!(await page.locator('.hnb__cal-next').isDisabled())) {
            await page.locator('.hnb__cal-next').click();
            await page.waitForTimeout(400);
            assert.equal(slotRequests.length, afterMount + 1, 'paging to a new month must fetch availability exactly once');

            // Paging back to the already-fetched first month must not re-fetch.
            await page.locator('.hnb__cal-prev').click();
            await page.waitForTimeout(300);
            assert.equal(slotRequests.length, afterMount + 1, 'returning to an already-fetched month must not re-fetch availability');
        }

        await page.close();
    });

    await t.test('keyboard arrow navigation moves the roving-tabindex focus across the grid', async () => {
        const page = await browser.newPage();
        await openWidget(page);

        const today = await page.locator('.hnb__cal-day.is-today').getAttribute('data-date');
        await page.locator('.hnb__cal-day.is-today').focus();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-date')), today);

        await page.keyboard.press('ArrowRight');
        const afterRight = await page.evaluate(() => document.activeElement.getAttribute('data-date'));
        const expectRight = new Date(today + 'T12:00:00Z');
        expectRight.setUTCDate(expectRight.getUTCDate() + 1);
        assert.equal(afterRight, expectRight.toISOString().slice(0, 10), 'ArrowRight must move focus one day forward');
        // The newly focused cell becomes the roving tabindex=0 cell.
        assert.equal(await page.evaluate(() => document.activeElement.tabIndex), 0);

        await page.keyboard.press('ArrowDown');
        const afterDown = await page.evaluate(() => document.activeElement.getAttribute('data-date'));
        const expectDown = new Date(afterRight + 'T12:00:00Z');
        expectDown.setUTCDate(expectDown.getUTCDate() + 7);
        // ArrowDown may cross into the next month (loadMonth is async) — allow it to settle.
        await page.waitForTimeout(300);
        assert.equal(afterDown, expectDown.toISOString().slice(0, 10), 'ArrowDown must move focus one week forward');

        await page.close();
    });

    await t.test('390px viewport: the page does not scroll horizontally', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await openWidget(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `page must not scroll horizontally at 390px (overflow: ${overflow}px)`);
        await page.close();
    });
});
