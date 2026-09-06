'use strict';
/**
 * /sterge GDPR deletion must remove every owned isolated live site from disk.
 *
 * Run: node --test bot/test/sterge-unpublish.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-sterge-unpublish-'));
process.env.DATA_DIR = dataDir;
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.SERVER_SECRET = 'sterge-unpublish-test-secret';

const flow = require('../flow.js');
const registry = require('../registry.js');
const webpublish = require('../webpublish.js');

function publishedDir(slug) {
    return path.join(dataDir, 'published', slug);
}

async function publishOwnedSite(userId, slug) {
    const site = registry.createSite({
        userId,
        templateId: 'product-menu',
        templateVersion: 1,
        slug,
        platform: 'telegram',
    });
    registry.updateSite(site.id, { paid: true });

    const siteDir = path.join(dataDir, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), `<h1>${slug}</h1>`);

    const result = await webpublish.publishSite({
        site: registry.getSite(site.id),
        config: {},
        images: [],
        siteDirAlreadyBuilt: true,
    });
    assert.equal(result.url, `/live/${slug}/`);
    assert.ok(fs.existsSync(path.join(publishedDir(slug), 'index.html')), `${slug} must be live before /sterge`);
    return site;
}

test('/sterge removes every owned isolated live site and deletes its registry entries', async (t) => {
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    const chatId = 725991;
    const user = registry.getOrCreateUserByTelegram(chatId, { username: 'sterge_test' });
    const first = await publishOwnedSite(user.id, 'sterge-live-first');
    const second = await publishOwnedSite(user.id, 'sterge-live-second');
    const replies = [];

    await flow.handleSterge({
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, username: 'sterge_test' },
        reply: async (message) => { replies.push(String(message)); },
    });

    for (const site of [first, second]) {
        const updated = registry.getSite(site.id);
        assert.equal(updated.status, 'deleted', `${site.slug} registry entry must be deleted`);
        assert.equal(updated.url, null, `${site.slug} must no longer have a public URL`);
        assert.equal(fs.existsSync(publishedDir(site.slug)), false, `${site.slug} must no longer be served from disk`);
    }
    assert.equal(replies.length, 1, '/sterge must confirm once after deletion');
});
