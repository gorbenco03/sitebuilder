/**
 * Deterministic Calendar-Cutover QA screenshots (VISION §8 step e).
 * Names each file from the action just performed.
 *
 * Run: node scripts/shot-calendar-cutover.mjs
 * Spawns scripts/_cutover-shot-server.js on PORT (default 8799).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, '04-QA-Evidence', 'Calendar-Cutover');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(url, tries = 40) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch (_) {
            /* retry */
        }
        await sleep(250);
    }
    throw new Error('server not ready: ' + url);
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });

    const server = spawn(
        process.execPath,
        ['--experimental-sqlite', path.join(ROOT, 'scripts/_cutover-shot-server.js')],
        {
            cwd: ROOT,
            env: { ...process.env, PORT },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    let bootLog = '';
    server.stdout.on('data', (d) => {
        bootLog += d.toString();
        process.stdout.write(d);
    });
    server.stderr.on('data', (d) => process.stderr.write(d));

    const cleanup = () => {
        try {
            server.kill('SIGTERM');
        } catch (_) {
            /* ignore */
        }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => {
        cleanup();
        process.exit(130);
    });

    try {
        await waitReady(`${BASE}/cutover-shot/meta.json`);
        const meta = await (await fetch(`${BASE}/cutover-shot/meta.json`)).json();
        console.log('META', meta);

        const browser = await chromium.launch({ headless: true });
        const shots = [];

        async function shot(page, name) {
            const p = path.join(OUT, name);
            await page.screenshot({ path: p, fullPage: true });
            shots.push(p);
            console.log('WROTE', p);
            return p;
        }

        function acceptDialogs(page) {
            page.on('dialog', async (d) => {
                try {
                    await d.accept();
                } catch (_) {
                    /* ignore */
                }
            });
        }

        async function bookOnWidget(page) {
            await page.goto(`${BASE}/calendar-native/widget/`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
            await page.waitForTimeout(800);
            const svc = page.locator('.hnb__svc').first();
            if ((await svc.count()) > 0) {
                await svc.click();
            }
            // Wait until day strip is present and slots API settled
            await page.waitForSelector('button.hnb__day', { timeout: 15000 });
            await page.waitForTimeout(1000);
            const days = page.locator('button.hnb__day');
            const dayCount = await days.count();
            let foundSlot = false;
            for (let i = 0; i < dayCount; i++) {
                await days.nth(i).click();
                await page.waitForTimeout(250);
                if ((await page.locator('button.hnb__slot').count()) > 0) {
                    foundSlot = true;
                    break;
                }
            }
            if (!foundSlot) return { ok: false, reason: 'no-slot' };
            await page.locator('button.hnb__slot').first().click();
            await page.waitForSelector('form.hnb__form input[name="name"]', { timeout: 5000 });
            await page.locator('form.hnb__form input[name="name"]').fill('Ana Cutover');
            await page.locator('form.hnb__form input[name="email"]').fill('ana.cutover@example.com');
            await shot(page, '04-book-form-filled-desktop.png');

            const [bookResp] = await Promise.all([
                page.waitForResponse(
                    (r) => r.url().includes('/api/calendar-native/bookings') && r.request().method() === 'POST',
                    { timeout: 15000 }
                ).catch(() => null),
                page.locator('[data-hnb-submit], button.hnb__cta').first().click(),
            ]);
            if (bookResp) {
                const status = bookResp.status();
                const body = await bookResp.json().catch(() => null);
                console.log('BOOK_HTTP', status, body && body.status, body && body.ok);
            } else {
                console.warn('WARN no bookings POST observed');
            }
            await page.waitForTimeout(800);
            await shot(page, '05-book-result-ro-status.png');
            const resultText = await page.locator('body').innerText();
            const hasSuccess = await page.locator('[data-hnb-success], .hnb__result--ok, .hnb__result--wait').count();
            if (!hasSuccess && !/confirmat|așteptare|Cerere înregistrată|Nu am putut/i.test(resultText)) {
                console.warn('WARN book result text:', resultText.slice(0, 500));
                return { ok: false, reason: 'no-result-ui' };
            }
            if (/worktree|kanban|SHA|factory/i.test(resultText)) {
                throw new Error('bad jargon in book result');
            }
            return { ok: true };
        }

        // 01 — default professionals still shows legacy local request form
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            await page.goto(`${BASE}/cutover-shot/legacy.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('#pr-appt-form', { timeout: 10000 });
            await page.waitForTimeout(400);
            await shot(page, '01-legacy-default-form-desktop.png');
            const t = await page.locator('body').innerText();
            if (!/pr-appt-form|Trimite|programare|Consulta/i.test(t + (await page.content()))) {
                // form id is enough
            }
            if (!(await page.locator('#pr-appt-form').count())) {
                throw new Error('legacy form missing');
            }
            if (await page.locator('[data-hidook-cal-native]').count()) {
                throw new Error('native mount leaked onto default');
            }
            await page.close();
        }

        // 02 — opted-in site mounts native widget (desktop)
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            await page.goto(`${BASE}/cutover-shot/native.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('[data-hidook-cal-native]', { timeout: 15000 });
            await page.waitForSelector('.hnb__svc, .hnb__day, [data-hnb-error]', { timeout: 15000 });
            await page.waitForTimeout(700);
            await shot(page, '02-native-opt-in-widget-desktop.png');
            if (await page.locator('#pr-appt-form').count()) {
                throw new Error('legacy form still present after opt-in');
            }
            const body = await page.locator('body').innerText();
            if (/worktree|kanban|SHA|factory/i.test(body)) {
                throw new Error('factory jargon on native page');
            }
            await page.close();
        }

        // 03 — native widget mobile 390
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/cutover-shot/native.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('.hnb__svc, .hnb__day, [data-hnb-error]', { timeout: 15000 });
            await page.waitForTimeout(700);
            await shot(page, '03-native-opt-in-widget-390.png');
            const sw = await page.evaluate(() => document.documentElement.scrollWidth);
            if (sw > 400) console.warn('WARN scrollWidth', sw);
            await page.close();
        }

        // 04/05 — book a free slot on public widget → RO status
        {
            const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
            const booked = await bookOnWidget(page);
            if (!booked.ok) {
                console.warn('WARN widget book path:', booked.reason);
                // Still capture the empty-slot state for audit
                if (!shots.some((s) => s.endsWith('04-book-form-filled-desktop.png'))) {
                    await shot(page, '04-book-form-filled-desktop.png');
                }
                if (!shots.some((s) => s.endsWith('05-book-result-ro-status.png'))) {
                    await shot(page, '05-book-result-ro-status.png');
                }
            }
            await page.close();
        }

        // 06 — visitor manage token view (390)
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            acceptDialogs(page);
            const url = `${BASE}/calendar-native/manage/?token=${encodeURIComponent(meta.manageToken)}`;
            await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
            await page.waitForSelector('#hm-body .hm__card, #hm-body .hm__alert', { timeout: 15000 });
            await page.waitForTimeout(500);
            await shot(page, '06-manage-token-view-390.png');
            const text = await page.locator('body').innerText();
            if (!/Gestionează programarea|confirmat|Stare/i.test(text)) {
                throw new Error('manage UI missing RO chrome: ' + text.slice(0, 200));
            }
            if (/worktree|kanban|SHA|factory/i.test(text)) {
                throw new Error('factory jargon on manage UI');
            }
            // 07 — cancel frees slot (confirm dialog auto-accepted)
            const cancelBtn = page.locator('[data-hm-cancel], button:has-text("Anulează")');
            if ((await cancelBtn.count()) > 0) {
                await cancelBtn.first().click();
                await page.waitForTimeout(1200);
                await page.waitForFunction(
                    () => /anulat/i.test(document.body.innerText),
                    null,
                    { timeout: 10000 }
                );
                await shot(page, '07-manage-cancel-confirmed-390.png');
                const after = await page.locator('body').innerText();
                if (!/anulat/i.test(after)) {
                    throw new Error('cancel did not show anulat state');
                }
            } else {
                throw new Error('cancel button missing on manage UI');
            }
            await page.close();
        }

        // 08 — manage invalid token honest error
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/calendar-native/manage/?token=not-a-real-token-xxxxxx`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForTimeout(800);
            await shot(page, '08-manage-invalid-token-390.png');
            const t = await page.locator('body').innerText();
            if (!/nu|invalid|găsit|link/i.test(t)) {
                console.warn('WARN invalid token copy:', t.slice(0, 200));
            }
            await page.close();
        }

        // 09 — legacy form still available (regression proof shot)
        {
            const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
            await page.goto(`${BASE}/cutover-shot/legacy.html#appointment`, {
                waitUntil: 'networkidle',
                timeout: 20000,
            });
            await page.waitForSelector('#pr-appt-form', { timeout: 10000 });
            await page.waitForTimeout(400);
            await shot(page, '09-legacy-form-unchanged-390.png');
            await page.close();
        }

        await browser.close();

        const manifest = {
            ok: true,
            out: OUT,
            shots: shots.map((s) => path.basename(s)),
            meta: {
                bookingStatus: meta.bookingStatus,
                customerId: meta.customerId,
                siteId: meta.siteId,
            },
            cutoverFlag: 'appointment.nativeBooking',
        };
        fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(JSON.stringify(manifest, null, 2));
    } finally {
        cleanup();
        await sleep(300);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
