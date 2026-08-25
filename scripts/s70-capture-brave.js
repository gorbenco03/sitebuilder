#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawnSync } = require('child_process');

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
html = html.replace(/<link rel="stylesheet" href="styles\.css">/, `<style>\n${css}\n</style>`);
html = html.replace(/<script src="script\.js"><\/script>/, `<script>\n${js}\n<\/script>`);
fs.writeFileSync(path.join(OUT, 'professionals-cabinet-marin.html'), html, 'utf8');

const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

function listen() {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

function shot(url, destName, w, h) {
  const tmp = path.join(os.tmpdir(), destName);
  try { fs.unlinkSync(tmp); } catch (_) {}
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 's70-brave-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userData}`,
    `--window-size=${w},${h}`,
    `--screenshot=${tmp}`,
    '--virtual-time-budget=10000',
    url,
  ];
  const r = spawnSync(BRAVE, args, { encoding: 'utf8', timeout: 90000 });
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 500) {
    console.error('stderr', r.stderr);
    console.error('stdout', r.stdout);
    throw new Error('shot failed ' + tmp + ' status=' + r.status);
  }
  const dest = path.join(OUT, destName);
  fs.copyFileSync(tmp, dest);
  console.log('wrote', dest, fs.statSync(dest).size);
  return dest;
}

(async () => {
  const port = await listen();
  const url = `http://127.0.0.1:${port}/`;
  console.log('serving', url);
  try {
    shot(url, 'professionals-desktop-1440.png', 1440, 2400);
    shot(url, 'professionals-mobile-390.png', 390, 2000);
    const metrics = {
      browser: 'brave-headless',
      url,
      html: 'professionals-cabinet-marin.html',
      shots: [
        { file: 'professionals-desktop-1440.png', w: 1440 },
        { file: 'professionals-mobile-390.png', w: 390 },
      ],
      checks: {
        hasAppt: /data-pr-appt|pr-appt-form/.test(html),
        hasBusiness: html.includes(cfg.business.name),
        noCalendly: !/calendly/i.test(html),
        requestLanguage: /Request sent|awaiting confirmation/i.test(html),
      },
    };
    fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
