'use strict';
/**
 * Flow 4 regressions: trial success returns through the real editor route and
 * HTML download persists the in-memory draft before requesting the attachment.
 *
 * Run: node bot/test/flow4-return-editor-current-html.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BASE_SHA = 'a74d49299fdd73c26068bbdf2fd0b0ee312c31e7';
const appSrc = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');

function extractFunction(src, name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  assert.ok(start, `${name} remains extractable`);
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < src.length && depth > 0) {
    const char = src[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return src.slice(start.index, index);
}

async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name, '-', error.message);
    process.exitCode = 1;
  }
}

(async () => {
  await check('causal RED archive: accepted base had neither repair', () => {
    const base = execFileSync('git', ['-C', ROOT, 'show', `${BASE_SHA}:builder/app.js`], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.ok(!/function returnToEditor/.test(base), 'base must lack explicit editor return');
    const download = extractFunction(base, 'downloadDraftHtml');
    assert.ok(!/\/api\/draft/.test(download), 'base HTML download must omit current-draft persistence');
  });

  await check('Înapoi la editor executes #edit route so the canvas receives real HTML', async () => {
    const returnToEditor = extractFunction(appSrc, 'returnToEditor');
    const iframe = { srcdoc: '', dataset: { previewReady: 'true' } };
    const routeCalls = [];
    const sandbox = {
      draft: { templateId: 'professionals', config: { business: { name: 'Cabinet Curent' } } },
      currentSiteId: 'site-paid',
      closeModal() {},
      ensureDraftBoundToPaidSite: async () => true,
      handleRoute: async (hash) => {
        routeCalls.push(hash);
        iframe.dataset.previewReady = 'false';
        iframe.srcdoc = '<!doctype html><h1>Cabinet Curent</h1>';
      },
      history: { replaceState() {} },
      window: { location: { pathname: '/app/', search: '', hash: '#dashboard' } },
    };
    vm.runInNewContext(`${returnToEditor}; this.run = returnToEditor;`, sandbox);
    await sandbox.run();
    assert.deepStrictEqual(routeCalls, ['#edit'], 'must execute the editor route, not only assign hash');
    assert.ok(iframe.srcdoc.includes('Cabinet Curent'), 'route repopulates the canvas with site content');
    assert.strictEqual(iframe.dataset.previewReady, 'false', 'a new canvas starts loading rather than keeping stale ready=true');
  });

  await check('Descarcă HTML saves the current browser draft before fetching HTML', async () => {
    const downloadDraftHtml = extractFunction(appSrc, 'downloadDraftHtml');
    const calls = [];
    const currentConfig = {
      business: { name: 'Cabinet Nesalvat' },
      appointment: { bookingUrl: '' },
    };
    const button = { disabled: false };
    const anchor = { style: {}, click() { calls.push({ type: 'click' }); } };
    const sandbox = {
      currentUser: { email: 'test@example.test' },
      currentSiteId: 'site-paid',
      currentSitePaid: true,
      currentSiteSlug: 'cabinet-vechi',
      publishedSiteId: 'site-paid',
      draft: { templateId: 'professionals', config: currentConfig },
      $: () => button,
      apiPost: async (url, body) => {
        calls.push({ type: 'post', url, body: JSON.parse(JSON.stringify(body)) });
        return { site: { id: 'site-paid', paid: true, slug: 'cabinet-vechi' } };
      },
      fetch: async (url, options) => {
        calls.push({ type: 'fetch', url, options });
        return {
          ok: true,
          headers: { get: () => 'attachment; filename="cabinet.html"' },
          blob: async () => ({ html: '<h1>Cabinet Nesalvat</h1>' }),
        };
      },
      saveDraft() {},
      showToast() {},
      URL: { createObjectURL: () => 'blob:export', revokeObjectURL() {} },
      document: {
        createElement: () => anchor,
        body: { appendChild() {}, removeChild() {} },
      },
      setTimeout: (fn) => fn(),
      encodeURIComponent,
      decodeURIComponent,
    };
    vm.runInNewContext(`${downloadDraftHtml}; this.run = downloadDraftHtml;`, sandbox);
    await sandbox.run();
    assert.strictEqual(calls[0].type, 'post', 'current draft must be persisted first');
    assert.strictEqual(calls[0].url, '/api/draft');
    assert.strictEqual(calls[0].body.config.business.name, 'Cabinet Nesalvat');
    assert.strictEqual(calls[0].body.config.appointment.bookingUrl, '');
    assert.strictEqual(calls[1].type, 'fetch', 'HTML attachment is fetched only after save');
    assert.ok(calls[1].url.includes('/api/export-html?siteId=site-paid'));
    assert.strictEqual(button.disabled, false, 'download button is restored');
  });

  if (!process.exitCode) console.log('\nflow4-return-editor-current-html.test.js: all passed');
})();
