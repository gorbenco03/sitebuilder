'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');

function runBuild(root) {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, ['scripts/build-builder.js'], { cwd: root });
        let output = '';
        proc.stdout.on('data', b => { output += b; });
        proc.stderr.on('data', b => { output += b; });
        proc.once('error', reject);
        proc.once('exit', (code, signal) => resolve({ code, signal, output }));
    });
}
function hashes(dir, prefix = '') {
    const result = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = path.join(prefix, entry.name);
        if (entry.isDirectory()) Object.assign(result, hashes(path.join(dir, entry.name), rel));
        else result[rel] = createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name))).digest('hex');
    }
    return result;
}
test('concurrent actual browser builds publish complete identical files without deleting cached previews', { timeout: 60_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-publication-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'builder'));
    fs.copyFileSync(path.join(ROOT, 'scripts/build-builder.js'), path.join(root, 'scripts/build-builder.js'));
    for (const name of ['templates', 'bot', 'build.js']) fs.symlinkSync(path.join(ROOT, name), path.join(root, name));
    for (const name of ['blocks', 'edit-overlay.js']) fs.symlinkSync(path.join(ROOT, 'builder', name), path.join(root, 'builder', name));
    const first = await runBuild(root);
    assert.equal(first.code, 0, first.output);
    const generated = path.join(root, 'builder/generated');
    const expected = hashes(generated);
    const oldPreview = path.join(generated, 'previews/previous-content-version/photo.webp');
    fs.mkdirSync(path.dirname(oldPreview), { recursive: true });
    fs.writeFileSync(oldPreview, 'previous cached version');
    const readErrors = [];
    const observer = setInterval(() => {
        for (const [name, hash] of Object.entries(expected)) {
            try {
                const actual = createHash('sha256').update(fs.readFileSync(path.join(generated, name))).digest('hex');
                if (actual !== hash) readErrors.push('partial or changed: ' + name);
            } catch (e) { readErrors.push(name + ': ' + e.code); }
        }
    }, 5);
    let builds;
    try {
        builds = await Promise.all(Array.from({ length: 8 }, () => runBuild(root)));
    } finally { clearInterval(observer); }
    assert.deepEqual(builds.map(b => b.code), Array(8).fill(0), JSON.stringify(builds));
    assert.deepEqual(readErrors, [], 'readers must never observe a missing or partially written generated artifact');
    assert.equal(fs.readFileSync(oldPreview, 'utf8'), 'previous cached version');
    const after = hashes(generated);
    for (const [name, hash] of Object.entries(expected)) assert.equal(after[name], hash, name);
    assert.equal(Object.keys(after).some(n => n.endsWith('.tmp')), false, 'successful publishers leave no temporary files');
});

test('owned test-server teardown completes even with an unfinished active HTTP request', { timeout: 5000 }, async () => {
    const { closeTestServer } = require('./helpers/nov06-browser-lifecycle.js');
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const socket = net.connect(server.address().port, '127.0.0.1');
    try {
        await new Promise(r => socket.once('connect', r));
        socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
        await new Promise(r => setImmediate(r));
        await closeTestServer(server);
        assert.equal(server.listening, false);
    } finally { socket.destroy(); server.closeAllConnections(); server.close(); }
});

test('carousel state wait observes delayed native smooth scroll and debounced endpoint buttons', { timeout: 15_000 }, async () => {
    const { loadPlaywright } = require('./wave10-portfolio-helpers.js');
    const { observeCarousel, waitForCarouselStep } = require('./helpers/nov06-gallery-state.js');
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(`<div class="collage-deck" style="width:200px;overflow:auto;scroll-behavior:smooth"><div style="width:400px;height:30px">Photos</div></div>
<button class="collage-nav--prev" disabled>Anterior</button><button class="collage-nav--next">Următor</button>`);
        await page.evaluate(() => {
            const deck = document.querySelector('.collage-deck');
            const prev = document.querySelector('.collage-nav--prev');
            const next = document.querySelector('.collage-nav--next');
            let timer;
            deck.addEventListener('scroll', () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    prev.disabled = deck.scrollLeft <= 1;
                    next.disabled = deck.scrollLeft >= deck.scrollWidth - deck.clientWidth - 1;
                }, 50);
            });
            // Delay activation beyond the old fixed400/500ms sleeps, not geometry.
            next.onclick = () => setTimeout(() => deck.scrollBy({ left: 200, behavior: 'smooth' }), 650);
            prev.onclick = () => setTimeout(() => deck.scrollBy({ left: -200, behavior: 'smooth' }), 650);
        });
        const forward = await observeCarousel(page);
        await page.locator('.collage-nav--next').click();
        await waitForCarouselStep(page, forward, 1);
        assert.equal(await page.locator('.collage-nav--next').isDisabled(), true);
        assert.equal(await page.locator('.collage-nav--prev').isDisabled(), false);
        const reverse = await observeCarousel(page);
        await page.locator('.collage-nav--prev').click();
        await waitForCarouselStep(page, reverse, -1);
        assert.equal(await page.locator('.collage-nav--prev').isDisabled(), true);
        assert.equal(await page.locator('.collage-nav--next').isDisabled(), false);
    } finally { await browser.close(); }
});
