// Independent adversarial re-verification of TG-03:
// "/sterge does not remove published files of a paid+live site; the /live/<slug>/
//  URL keeps serving it despite the bot confirming full deletion."
//
// Strategy (stronger than the original repro): boot the REAL HTTP server via the
// shared audit harness, actually HTTP-GET the live URL before and after calling
// flow.handleSterge(), instead of only checking fs.existsSync.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bootServer } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';

const srv = await bootServer();
const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder';
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const flow = require(path.join(ROOT, 'bot', 'flow.js'));

const chatId = 555987654;
const slug = 'verify-live-site';

const tgUser = registry.getOrCreateUserByTelegram(chatId, { username: 'verifybot', firstName: 'Verify' });
const site = registry.createSite({
  userId: tgUser.id,
  templateId: 'product-menu',
  templateVersion: null,
  slug,
  platform: 'telegram',
});

// Mirror what webpublish.publishSite would have produced for a paid, live site
// published later from the browser builder (same registry row, platform untouched).
registry.updateSite(site.id, {
  ownerChatId: String(chatId),
  businessName: 'Verify Live SRL',
  status: 'live',
  paid: true,
  url: `/live/${slug}/`,
});

const publishedDir = path.join(srv.dataDir, 'published', slug);
fs.mkdirSync(publishedDir, { recursive: true });
const marker = 'VERIFY-LIVE-SITE-MARKER-' + Date.now();
fs.writeFileSync(path.join(publishedDir, 'index.html'), `<html><body>${marker}</body></html>`);

// --- BEFORE /sterge: confirm the live URL actually serves the site over real HTTP ---
const beforeRes = await fetch(srv.base + `/live/${slug}/`);
const beforeBody = await beforeRes.text();
console.log('BEFORE /sterge: GET /live/%s/ -> %d, marker present = %s', slug, beforeRes.status, beforeBody.includes(marker));
console.log('BEFORE registry status =', registry.getSite(site.id).status, 'paid =', registry.getSite(site.id).paid);

// No lingering in-memory Telegram session (fresh process) — this is the realistic
// case per the finding: finishTelegramIntake already dropped the session, and the
// site was later paid+published from the browser, so flow.js's paid-order guard
// (phase === 'deploy' / 'paid-needs-retry') never trips for this site.
const replies = [];
const fakeCtx = {
  chat: { id: chatId },
  from: { username: 'verifybot', first_name: 'Verify' },
  reply: async (text) => { replies.push(text); return {}; },
};

await flow.handleSterge(fakeCtx);
console.log('\nBot reply:\n---\n' + replies.join('\n---\n') + '\n---\n');

const after = registry.getSite(site.id);
console.log('AFTER registry status =', after.status, 'url =', after.url, 'paid =', after.paid);
console.log('AFTER published/index.html exists on disk =', fs.existsSync(path.join(publishedDir, 'index.html')));

// --- AFTER /sterge: does the live URL STILL serve the deleted site over real HTTP? ---
const afterRes = await fetch(srv.base + `/live/${slug}/`);
const afterBody = await afterRes.text();
console.log('AFTER /sterge: GET /live/%s/ -> %d, marker STILL present = %s', slug, afterRes.status, afterBody.includes(marker));

const defectConfirmed = afterRes.status === 200 && afterBody.includes(marker) && after.status === 'deleted';
console.log('\n' + (defectConfirmed
  ? '>>> CONFIRMED: registry says status=deleted, bot confirmed full deletion, but the live URL still returns 200 with the original site content.'
  : '>>> NOT CONFIRMED with this repro.'));

fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'verify-output.txt'),
  [
    `BEFORE GET /live/${slug}/ -> ${beforeRes.status}, marker present = ${beforeBody.includes(marker)}`,
    `BEFORE registry status = ${registry.getSite(site.id) ? 'n/a (already mutated above)' : ''}`,
    `bot replies: ${JSON.stringify(replies)}`,
    `AFTER registry status = ${after.status}, url = ${after.url}, paid = ${after.paid}`,
    `AFTER published/index.html exists on disk = ${fs.existsSync(path.join(publishedDir, 'index.html'))}`,
    `AFTER GET /live/${slug}/ -> ${afterRes.status}, marker STILL present = ${afterBody.includes(marker)}`,
    `defectConfirmed = ${defectConfirmed}`,
  ].join('\n')
);

await srv.close();
process.exit(defectConfirmed ? 0 : 1);
