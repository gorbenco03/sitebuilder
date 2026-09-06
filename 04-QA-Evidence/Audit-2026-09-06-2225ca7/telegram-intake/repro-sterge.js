'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated env, mirrors audit-harness.mjs
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-sterge-audit-'));
process.env.SERVER_SECRET = 'audit-' + Math.random().toString(36).slice(2);
for (const k of ['PUBLIC_URL','HIDOOK_FAKE_DEPLOY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET',
  'VERCEL_TOKEN','NETLIFY_TOKEN','CLOUDFLARE_API_TOKEN','TELEGRAM_BOT_TOKEN','RESEND_API_KEY']) delete process.env[k];

const ROOT = '/Users/Work/Desktop/sitebuilder';
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const flow = require(path.join(ROOT, 'bot', 'flow.js'));

(async () => {
  const chatId = 999123456;
  const tgUser = registry.getOrCreateUserByTelegram(chatId, { username: 'auditbot', firstName: 'Audit' });
  const site = registry.createSite({
    userId: tgUser.id,
    templateId: 'product-menu',
    templateVersion: null,
    slug: 'audit-live-site',
    platform: 'telegram',
  });

  // Simulate: user later paid + published this exact draft from the BROWSER builder
  // (platform stays whatever it is; webpublish sets paid/status/url on the same registry row).
  registry.updateSite(site.id, {
    ownerChatId: String(chatId),
    businessName: 'Audit Live SRL',
    status: 'live',
    paid: true,
    url: '/live/audit-live-site/',
  });

  // Simulate the actual isolated-deploy published files webpublish.js would have written.
  const publishedDir = path.join(process.env.DATA_DIR, 'published', 'audit-live-site');
  fs.mkdirSync(publishedDir, { recursive: true });
  fs.writeFileSync(path.join(publishedDir, 'index.html'), '<html><body>Audit Live SRL — site live, platit</body></html>');

  console.log('BEFORE /sterge:');
  console.log('  registry site status =', registry.getSite(site.id).status, ' paid =', registry.getSite(site.id).paid);
  console.log('  published/index.html exists =', fs.existsSync(path.join(publishedDir, 'index.html')));

  // Simulate the in-memory Telegram session already being gone (this is the realistic
  // case: finishTelegramIntake deletes the in-memory session right after intake, and by
  // the time the site is paid+published from the browser, there is no lingering
  // phase==='deploy'/'paid-needs-retry' session left to trip flow.js's paid-order guard).
  let replies = [];
  const fakeCtx = {
    chat: { id: chatId },
    from: { username: 'auditbot', first_name: 'Audit' },
    reply: async (text) => { replies.push(text); return {}; },
  };

  await flow.handleSterge(fakeCtx);

  console.log('\nBot replied:\n---\n' + replies.join('\n---\n') + '\n---');

  const after = registry.getSite(site.id);
  console.log('\nAFTER /sterge:');
  console.log('  registry site status =', after.status, ' url =', after.url, ' paid =', after.paid);
  console.log('  published/index.html STILL exists on disk =', fs.existsSync(path.join(publishedDir, 'index.html')));
  console.log('  published dir path:', publishedDir);

  if (fs.existsSync(path.join(publishedDir, 'index.html'))) {
    console.log('\n>>> CONFIRMED DEFECT: /sterge marks the registry site deleted but leaves the');
    console.log('>>> published static files in place — the live URL would keep serving the site.');
  } else {
    console.log('\n(no defect reproduced — published files were removed)');
  }
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(1); });
