// Shared audit harness: boots an ISOLATED Hidook server (test pay, isolated deploy,
// temp DATA_DIR, no real keys) and gives a deterministic screenshot+log helper.
// Usage from an ESM script:
//   import { bootServer, makeEvidence } from '<scratchpad>/audit-harness.mjs';
//   const { base, close } = await bootServer();
//   const ev = makeEvidence('<evidenceDir>', 'my-lens');
//   await ev.shot(page, 'open-catalog', { action: 'goto /app/' });
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a3a347f1a5502f4b2';
const require = createRequire(import.meta.url);
export const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

export async function bootServer(opts = {}) {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hb-audit-'));
  process.env.SERVER_SECRET = 'audit-' + crypto.randomBytes(12).toString('hex');
  for (const k of ['PUBLIC_URL','HIDOOK_FAKE_DEPLOY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','VERCEL_TOKEN','NETLIFY_TOKEN','CLOUDFLARE_API_TOKEN','TELEGRAM_BOT_TOKEN','RESEND_API_KEY']) delete process.env[k];
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { server, base, dataDir: process.env.DATA_DIR, close: () => new Promise(r => server.close(r)) };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export function makeEvidence(dir, lens) {
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'oracle-log.json');
  const log = { lens, startedAt: new Date().toISOString(), entries: [], defects: [], notes: [] };
  const write = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
  write();
  return {
    dir, log,
    async shot(page, step, extra = {}) {
      const i = log.entries.length;
      const file = String(i + 1).padStart(2, '0') + '-' + slug(step) + '.png';
      const p = path.join(dir, file);
      await page.screenshot({ path: p, fullPage: !!extra.fullPage });
      const e = { index: i, step, action: extra.action || 'screenshot-after-action', selector: extra.selector || null,
        screenshot: file, sha256: sha(p), timestamp: new Date().toISOString(), url: page.url(),
        contentCheck: { ok: extra.ok !== false, detail: extra.detail || 'captured' } };
      log.entries.push(e); write(); console.log('STEP', file, step); return e;
    },
    defect(severity, title, detail, screenshot) {
      const d = { severity, title, detail, screenshot: screenshot || log.entries.at(-1)?.screenshot || null, timestamp: new Date().toISOString() };
      log.defects.push(d); write(); console.log('DEFECT', severity, title); return d;
    },
    note(text) { log.notes.push(text); write(); },
    finish() { log.finishedAt = new Date().toISOString(); write(); return logPath; },
  };
}

export async function newBrowser(viewport = { width: 1440, height: 1000 }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const consoleErrors = [];
  const failedRequests = [];
  context.on('page', (pg) => {
    pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ url: pg.url(), text: m.text() }); });
    pg.on('pageerror', (err) => consoleErrors.push({ url: pg.url(), text: 'pageerror: ' + err.message }));
    pg.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ status: r.status(), url: r.url() }); });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  return { browser, context, page, consoleErrors, failedRequests, close: () => browser.close() };
}
