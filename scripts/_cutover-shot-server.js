'use strict';
/**
 * Seed + serve for Calendar-Cutover QA screenshots.
 * Run: node --experimental-sqlite scripts/_cutover-shot-server.js
 */
if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawn } = require('child_process');
    const child = spawn(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit', env: process.env }
    );
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code == null ? 1 : code);
    });
    return;
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8799);
const tmp = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cal-cutover-shot-'));
process.env.DATA_DIR = tmp;
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'cal-cutover-shot-secret';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.HIDOOK_FAKE_DEPLOY;

const { renderHtml } = require('../build.js');
const { openCalendarDb } = require('../bot/calendar-native/db');
const engine = require('../bot/calendar-native/engine');
const cutover = require('../bot/calendar-native/cutover');
const publicApi = require('../bot/calendar-native/public-api');
const { zonedWallTimeToUtcMs, toIsoUtc } = require('../bot/calendar-native/time');
const { createHandler } = require('../bot/server.js');

publicApi.resetDbHandle();
const db = openCalendarDb({ dataDir: tmp });

const site = { userId: 'cust_cutover_shot', id: 'site_cutover_shot' };
const preset = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'templates/professionals/presets.json'), 'utf8')
).presets[0].config;
const tpl = fs.readFileSync(path.join(ROOT, 'templates/professionals/template.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'templates/professionals/styles.css'), 'utf8');

// Legacy default HTML (native off)
const legacyHtml = renderHtml(tpl, preset).replace(
    'href="styles.css"',
    'href="/cutover-shot/styles.css"'
);

// Native opted-in HTML
const nativeCfg = JSON.parse(JSON.stringify(preset));
nativeCfg.appointment.nativeBooking = 'da';
const prepared = cutover.preparePublishCutover({ config: nativeCfg, site, db });
let nativeHtml = renderHtml(tpl, prepared.config);
nativeHtml = nativeHtml
    .replace('href="styles.css"', 'href="/cutover-shot/styles.css"')
    .replace(
        'href="/calendar-native/widget/public-booking-widget.css"',
        'href="/calendar-native/widget/public-booking-widget.css"'
    )
    .replace(
        'src="/calendar-native/widget/public-booking-widget.js"',
        'src="/calendar-native/widget/public-booking-widget.js"'
    );

// Seed a confirmed booking + manage token for manage UI shots
const services = engine.listServices(db, site.userId, site.id, { activeOnly: true });
const nowMs = Date.UTC(2026, 0, 1);
const startUtc = toIsoUtc(zonedWallTimeToUtcMs(2030, 1, 7, 10, 0, 'Europe/Bucharest'));
const booked = engine.createBooking(db, site.userId, site.id, {
    serviceId: services[0].id,
    startUtc,
    visitorName: 'Maria Popescu',
    visitorEmail: 'maria.cutover@example.com',
    nowMs,
});

const meta = {
    port: PORT,
    dataDir: tmp,
    manageToken: booked.manageToken,
    bookingStatus: booked.status,
    customerId: site.userId,
    siteId: site.id,
    serviceId: services[0].id,
};
fs.mkdirSync(path.join(tmp, 'cutover-shot'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'legacy.html'), legacyHtml);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'native.html'), nativeHtml);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'styles.css'), css);
fs.writeFileSync(path.join(tmp, 'cutover-shot', 'meta.json'), JSON.stringify(meta, null, 2));

const baseHandler = createHandler({});
const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname.startsWith('/cutover-shot/')) {
        const rel = u.pathname.slice('/cutover-shot/'.length) || 'legacy.html';
        if (rel.includes('..')) {
            res.writeHead(403);
            return res.end('forbidden');
        }
        const file = path.join(tmp, 'cutover-shot', rel);
        if (!fs.existsSync(file)) {
            res.writeHead(404);
            return res.end('not found');
        }
        const ext = path.extname(file);
        const type =
            ext === '.css' ? 'text/css; charset=utf-8' :
            ext === '.js' ? 'application/javascript; charset=utf-8' :
            ext === '.json' ? 'application/json; charset=utf-8' :
            'text/html; charset=utf-8';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(file));
    }
    return baseHandler(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({ ready: true, ...meta }));
});
