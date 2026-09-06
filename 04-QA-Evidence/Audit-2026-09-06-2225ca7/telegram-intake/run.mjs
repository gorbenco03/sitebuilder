// Telegram intake -> builder draft parity check.
// Runs the REAL flow.js wizard handlers (handleStart/handleText/handlePhoto/handleGata)
// against an isolated server, exactly as bot.js would, then opens the resulting
// magic-link in a real browser against the builder to see what actually renders.
import { bootServer, makeEvidence, newBrowser } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const EVDIR = '/Users/Work/Desktop/sitebuilder/04-QA-Evidence/Audit-2026-09-06-2225ca7/telegram-intake';
const ev = makeEvidence(EVDIR, 'telegram-intake');

const srv = await bootServer();
console.log('server up at', srv.base, 'DATA_DIR=', srv.dataDir);

// Same process => same require cache => this IS the flow.js server.js is using.
const flow = require('/Users/Work/Desktop/sitebuilder/bot/flow.js');

// Stub the Telegram file-download network call so handlePhoto's real code path runs
// end-to-end without a real bot token / network access.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('https://api.telegram.org/file/')) {
    // 1x1 px JPEG
    const tinyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=', 'base64');
    return { ok: true, arrayBuffer: async () => tinyJpeg.buffer.slice(tinyJpeg.byteOffset, tinyJpeg.byteOffset + tinyJpeg.byteLength) };
  }
  return realFetch(url, opts);
};

const chatId = 555000111;
const replies = [];
const fakeCtx = {
  chat: { id: chatId, type: 'private' },
  from: { id: chatId, username: 'auditor_ro', first_name: 'Auditor' },
  message: {},
  match: '',
  reply: async (text) => { replies.push(text); console.log('BOT>', text.slice(0, 200).replace(/\n/g, ' \\n ')); return {}; },
  replyWithChatAction: async () => {},
  getFile: async () => ({ file_path: 'photos/fake.jpg', file_size: 2048 }),
};

await flow.handleStart(fakeCtx);
fakeCtx.message = { text: 'Salon Frumusete Ana' };      // name
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'Tuns, coafat, manichiura, epilare' }; // offer
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'Suntem un salon mic in centrul orasului, cu personal cu experienta.' }; // about
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'roz si auriu' };              // colors
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'skip' };                      // instagram
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'skip' };                      // facebook
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'skip' };                      // whatsapp
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'skip' };                      // address
await flow.handleText(fakeCtx);
fakeCtx.message = { text: 'skip' };                      // logo -> skip
await flow.handleText(fakeCtx);
// gallery: 1 real photo via the stubbed downloader
await flow.handlePhoto(fakeCtx);
await flow.handleGata(fakeCtx);

const finalReply = replies[replies.length - 1] || '';
const m = finalReply.match(/https?:\/\/\S+|\/auth\/verify\?token=\S+/);
console.log('\nExtracted builder link candidate:', m && m[0]);
if (!m) { ev.defect('critical', 'Telegram intake nu a produs niciun link către builder', 'Ultimul reply: ' + finalReply); ev.finish(); process.exit(1); }

let link = m[0].replace(/\)+$/, '');
if (link.startsWith('/')) link = srv.base + link;

const b = await newBrowser({ width: 1440, height: 1000 });
await b.page.goto(link, { waitUntil: 'networkidle' });
await ev.shot(b.page, 'after-magic-link-open-builder', { action: 'goto ' + link, detail: 'Deschidere link din reply-ul Telegram (finishTelegramIntake)' });

console.log('\nLanded on URL:', b.page.url());
const bodyText = await b.page.evaluate(() => document.body.innerText.slice(0, 2000));
console.log('\n--- page text (first 2000 chars) ---\n', bodyText);

// Try to see the drawer / template name + whether the salon-relevant fields (menu?) exist
const templateNameEl = await b.page.$('#editor-template-name');
if (templateNameEl) {
  const tn = await templateNameEl.innerText();
  console.log('\n#editor-template-name =', tn);
}

await ev.shot(b.page, 'editor-state-full', { action: 'screenshot full editor', fullPage: true });

// Check the iframe preview content for a "menu" (food menu) block — should be ABSENT
// since Telegram never collects one, yet template-menu is the always-default template.
const iframe = await b.page.$('#preview-iframe');
if (iframe) {
  const frame = await iframe.contentFrame();
  if (frame) {
    const hasMenuBlock = await frame.$('#pm-menu-block');
    const menuVisible = hasMenuBlock ? await hasMenuBlock.isVisible().catch(() => false) : false;
    console.log('\n#pm-menu-block present in preview iframe:', !!hasMenuBlock, ' visible:', menuVisible);
    const previewText = await frame.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '(no frame text)');
    console.log('\n--- iframe preview text (first 1500 chars) ---\n', previewText);
  }
}

ev.note('chatId=' + chatId + ' link=' + link);
ev.note('console errors: ' + JSON.stringify(b.consoleErrors));
ev.note('failed requests: ' + JSON.stringify(b.failedRequests));
ev.finish();
await b.close();
await srv.close();
console.log('\nDONE');
