#!/usr/bin/env node
/**
 * S70 professionals — headless capture for QA evidence.
 * Renders preset HTML, serves it, screenshots desktop/mobile + appointment block.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '04-QA-Evidence', 'S70-professionals');
fs.mkdirSync(OUT, { recursive: true });

const { renderHtml } = require(path.join(ROOT, 'build.js'));
const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'template.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'script.js'), 'utf8');
const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'professionals', 'presets.json'), 'utf8')).presets;
const cfg = JSON.parse(JSON.stringify(presets[0].config));
cfg.business.name = 'Cabinet Marin · S70 Evidence';

let html = renderHtml(tpl, cfg);
// Inline assets for single-file evidence (replace stylesheet/script links)
html = html.replace(
    /<link rel="stylesheet" href="styles\.css">/,
    `<style>\n${css}\n</style>`
);
html = html.replace(
    /<script src="script\.js"><\/script>/,
    `<script>\n${js}\n<\/script>`
);
const htmlPath = path.join(OUT, 'professionals-cabinet-marin.html');
fs.writeFileSync(htmlPath, html, 'utf8');

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html' || req.url.startsWith('/?')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
    }
    res.writeHead(404);
    res.end('not found');
});

function listen() {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

async function launchBrowser() {
    const candidates = [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    let executablePath = process.env.S70_CHROME_PATH || candidates.find((p) => fs.existsSync(p));

    try {
        const pw = require('playwright');
        const browser = await pw.chromium.launch({
            headless: true,
            executablePath: executablePath || undefined,
        });
        return { browser, kind: 'playwright' };
    } catch (_) { /* fall through */ }

    try {
        const pw = require('playwright-core');
        if (!executablePath) throw new Error('no chrome');
        const browser = await pw.chromium.launch({ headless: true, executablePath });
        return { browser, kind: 'playwright-core' };
    } catch (_) { /* fall through */ }

    try {
        const puppeteer = require('puppeteer-core');
        if (!executablePath) throw new Error('no chrome');
        const browser = await puppeteer.launch({ headless: true, executablePath });
        return { browser, kind: 'puppeteer-core' };
    } catch (e) {
        throw new Error('No headless browser available: ' + e.message);
    }
}

async function capture() {
    const port = await listen();
    const url = `http://127.0.0.1:${port}/`;
    console.log('serving', url);

    const { browser, kind } = await launchBrowser();
    console.log('browser', kind);
    const metrics = { kind, url, shots: [] };

    try {
        if (kind.startsWith('playwright')) {
            const page = await browser.newPage();
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(400);
            const desk = path.join(OUT, 'professionals-desktop-1440.png');
            await page.screenshot({ path: desk, fullPage: true });
            metrics.shots.push({ file: 'professionals-desktop-1440.png', w: 1440 });

            const appt = page.locator('#appointment');
            if (await appt.count()) {
                await appt.scrollIntoViewIfNeeded();
                await page.waitForTimeout(200);
                await appt.screenshot({ path: path.join(OUT, 'appointment-section-desktop.png') });
                metrics.shots.push({ file: 'appointment-section-desktop.png', region: '#appointment' });
            }

            // Fill appointment form to show request state (preview/local)
            const name = page.locator('#pr-name');
            if (await name.count()) {
                await name.fill('Ana Evidence');
                await page.locator('#pr-email').fill('ana-s70@example.com');
                // ensure slots exist
                await page.waitForTimeout(200);
                await page.locator('#pr-appt-submit').click();
                await page.waitForTimeout(300);
                const done = page.locator('#pr-appt-done');
                if (await done.isVisible()) {
                    await done.screenshot({ path: path.join(OUT, 'appointment-request-success.png') });
                    metrics.shots.push({ file: 'appointment-request-success.png', note: 'local preview request state' });
                    const body = await page.locator('#pr-appt-done-body').innerText().catch(() => '');
                    metrics.requestStateText = body;
                }
            }

            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(OUT, 'professionals-mobile-390.png'), fullPage: true });
            metrics.shots.push({ file: 'professionals-mobile-390.png', w: 390 });

            // Sanity DOM checks
            metrics.dom = await page.evaluate(() => ({
                name: document.querySelector('h1') && document.querySelector('h1').textContent,
                hasAppt: !!document.querySelector('[data-pr-appt]'),
                hasServices: !!document.querySelector('#services'),
                noCalendly: !/calendly/i.test(document.body.innerHTML),
            }));
        } else {
            const page = await browser.newPage();
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            await page.screenshot({ path: path.join(OUT, 'professionals-desktop-1440.png'), fullPage: true });
            metrics.shots.push({ file: 'professionals-desktop-1440.png', w: 1440 });
            await page.setViewport({ width: 390, height: 844 });
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            await page.screenshot({ path: path.join(OUT, 'professionals-mobile-390.png'), fullPage: true });
            metrics.shots.push({ file: 'professionals-mobile-390.png', w: 390 });
            metrics.dom = await page.evaluate(() => ({
                name: document.querySelector('h1') && document.querySelector('h1').textContent,
                hasAppt: !!document.querySelector('[data-pr-appt]'),
            }));
        }
    } finally {
        await browser.close().catch(() => {});
        server.close();
    }

    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
    console.log('wrote evidence to', OUT);
}

capture().catch((e) => {
    console.error(e);
    process.exit(1);
});
