import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/telegram-intake';
const ev = makeEvidence(EVDIR, 'telegram-intake-part2');

const srv = await bootServer();
const flow = require('/Users/Work/Desktop/sitebuilder/bot/flow.js');

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('https://api.telegram.org/file/')) {
    const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=', 'base64');
    return { ok: true, arrayBuffer: async () => tinyJpeg.buffer.slice(tinyJpeg.byteOffset, tinyJpeg.byteOffset + tinyJpeg.byteLength) };
  }
  return realFetch(url, opts);
};

const chatId = 555000222;
const replies = [];
const fakeCtx = {
  chat: { id: chatId, type: 'private' }, from: { id: chatId, username: 'auditor_ro2', first_name: 'Auditor' },
  message: {}, match: '',
  reply: async (text) => { replies.push(text); return {}; },
  replyWithChatAction: async () => {},
  getFile: async () => ({ file_path: 'photos/fake.jpg', file_size: 2048 }),
};
await flow.handleStart(fakeCtx);
for (const t of ['Salon Frumusete Ana', 'Tuns, coafat, manichiura', 'Salon mic, personal experimentat.', 'roz si auriu', 'skip', 'skip', 'skip', 'skip', 'skip']) {
  fakeCtx.message = { text: t };
  await flow.handleText(fakeCtx);
}
await flow.handlePhoto(fakeCtx);
await flow.handleGata(fakeCtx);
const finalReply = replies[replies.length - 1] || '';
const m = finalReply.match(/\/auth\/verify\?token=\S+/);
let link = srv.base + m[0];

const b = await newBrowser({ width: 1440, height: 1000 });
await b.page.goto(link, { waitUntil: 'networkidle' });
await b.page.waitForSelector('.site-card-actions button.btn-ghost', { timeout: 10000 }).catch(() => {});
await ev.shot(b.page, 'dashboard-loaded', { action: 'goto magic link' });
await b.page.click('.site-card-actions button.btn-ghost');
await b.page.waitForTimeout(1500);
await ev.shot(b.page, 'editor-opened', { action: 'click Editeaza', fullPage: false });
console.log('URL after edit click:', b.page.url());
const tn = await b.page.$eval('#editor-template-name', el => el.innerText).catch(() => '(missing)');
console.log('editor-template-name:', tn);

const iframe = await b.page.$('#preview-iframe');
if (iframe) {
  const frame = await iframe.contentFrame();
  if (frame) {
    await frame.waitForSelector('body', { timeout: 5000 }).catch(() => {});
    const hasMenuBlock = await frame.$('#pm-menu-block');
    console.log('#pm-menu-block present:', !!hasMenuBlock);
    const bizName = await frame.$eval('[data-hb-edit="business.name"]', el => el.innerText).catch(() => '(not found)');
    console.log('business.name in preview:', bizName);
    const heroText = await frame.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '(none)');
    console.log('--- preview text ---\n', heroText);
  }
}
await ev.shot(b.page, 'editor-full-page', { fullPage: true, action: 'full page after open' });
ev.note('link=' + link);
ev.finish();
await b.close();
await srv.close();
console.log('DONE2');
