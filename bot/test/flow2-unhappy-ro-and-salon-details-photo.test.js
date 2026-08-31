'use strict';
/**
 * Flow 2 Romanian unhappy-path and Salon Detalii photo regression oracle.
 *
 * Run: node bot/test/flow2-unhappy-ro-and-salon-details-photo.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appSrc = read('builder/app.js');
const serverSrc = read('bot/server.js');
const failures = [];

function check(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

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

const completeTestCheckout = extractFunction(appSrc, 'completeTestCheckout');
const downloadDraftHtml = extractFunction(appSrc, 'downloadDraftHtml');
const downloadDraftZip = extractFunction(appSrc, 'downloadDraftZip');
const doActualPublish = extractFunction(appSrc, 'doActualPublish');
const wireAuthForm = extractFunction(appSrc, 'wireAuthForm');
const unpaidRomanian = 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul.';

check('auth email network failure copy', () => {
  assert.ok(
    wireAuthForm.includes("errorDiv.textContent = 'Nu am putut trimite linkul. Încearcă din nou.'"),
    'auth email failure uses the fixed Romanian fallback'
  );
  assert.ok(!/errorDiv\.textContent\s*=\s*(?:err|e)\.message/.test(wireAuthForm), 'auth error cannot expose an exception message');
  assert.ok(!wireAuthForm.includes('Something went wrong. Try again.'), 'auth error cannot retain the English fallback');
});

check('publish network failure copy', () => {
  assert.ok(
    doActualPublish.includes("showToast('Publicarea a eșuat. Încearcă din nou.', 'error', 5000)"),
    'publish failure uses the fixed Romanian fallback'
  );
  assert.ok(!/showToast\(\s*(?:err|e)\.message/.test(doActualPublish), 'publish failure cannot expose an exception message');
});

check('invalid payment copy', () => {
  assert.ok(
    completeTestCheckout.includes("showToast('Sesiune de plată invalidă.', 'error')"),
    'invalid test-payment hash toast is Romanian'
  );
  assert.ok(!completeTestCheckout.includes('Invalid payment session.'), 'invalid test-payment hash cannot toast English');
  assert.ok(serverSrc.includes("error: 'Sesiune de plată invalidă.'"), 'invalid test-payment API response is Romanian');
  assert.ok(!serverSrc.includes("error: 'Invalid payment session.'"), 'invalid test-payment API path cannot expose English');
});

check('logout copy', () => {
  assert.ok(appSrc.includes("showToast('Te-ai deconectat.', '', 3000)"), 'logout success toast is Romanian');
  assert.ok(!appSrc.includes("showToast('Signed out.'"), 'logout success path cannot toast English');
});

check('second unpaid site copy', () => {
  assert.ok(serverSrc.includes(`error: '${unpaidRomanian}'`), 'second-unpaid-site API response is Romanian');
  assert.ok(
    !serverSrc.includes('You already have an unpaid site. Pay for it or delete it before creating another.'),
    'second-unpaid-site API path cannot expose the raw English error'
  );
});

async function runExportFailure(downloadFunction, response) {
  const toasts = [];
  const button = { disabled: false };
  const sandbox = {
    currentSiteId: null,
    $: () => button,
    fetch: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
    showToast: (...args) => toasts.push(args),
  };
  const functionName = downloadFunction.match(/function\s+(\w+)/)[1];
  vm.runInNewContext(`${downloadFunction}\nthis.download = ${functionName};`, sandbox);
  await sandbox.download();
  assert.strictEqual(button.disabled, false, 'export button is restored after a failed download');
  assert.strictEqual(toasts.length, 1, 'failed export shows exactly one toast');
  return toasts[0][0];
}

async function proveExportErrorsStayRomanian() {
  const backendFailure = {
    ok: false,
    status: 500,
    json: async () => ({ error: 'Export failed' }),
  };
  assert.strictEqual(
    await runExportFailure(downloadDraftHtml, backendFailure),
    'Nu am putut descărca HTML-ul.',
    'HTML export cannot toast a raw backend error'
  );
  assert.strictEqual(
    await runExportFailure(downloadDraftHtml, new Error('Network failed')),
    'Nu am putut descărca HTML-ul.',
    'HTML export cannot toast a raw exception message'
  );
  assert.strictEqual(
    await runExportFailure(downloadDraftZip, backendFailure),
    'Nu am putut descărca ZIP-ul.',
    'ZIP export cannot toast a raw backend error'
  );
  assert.strictEqual(
    await runExportFailure(downloadDraftZip, new Error('Network failed')),
    'Nu am putut descărca ZIP-ul.',
    'ZIP export cannot toast a raw exception message'
  );
  assert.strictEqual(
    await runExportFailure(downloadDraftHtml, { ...backendFailure, status: 401 }),
    'Intră în cont ca să descarci ciorna ca HTML.',
    'HTML export keeps its Romanian sign-in guidance'
  );
  assert.strictEqual(
    await runExportFailure(downloadDraftZip, { ...backendFailure, status: 401 }),
    'Autentifică-te ca să descarci ZIP-ul.',
    'ZIP export keeps its Romanian sign-in guidance'
  );
}

const initImageFileInput = extractFunction(appSrc, 'initImageFileInput');
const openImagePickerForPath = extractFunction(appSrc, 'openImagePickerForPath');
const composeHeroBackground = extractFunction(appSrc, 'composeHeroBackground');

class SharedFileInput {
  constructor() {
    this.files = [{ name: 'salon.jpg', type: 'image/jpeg' }];
    this._value = 'salon.jpg';
    this.listeners = [];
  }
  get value() { return this._value; }
  set value(next) {
    this._value = next;
    if (next === '') this.files = [];
  }
  addEventListener(type, listener, options) {
    this.listeners.push({ type, listener, capture: options === true || !!(options && options.capture) });
  }
  removeEventListener(type, listener, options) {
    const capture = options === true || !!(options && options.capture);
    this.listeners = this.listeners.filter((entry) => (
      entry.type !== type || entry.listener !== listener || entry.capture !== capture
    ));
  }
  click() {}
  async choose() {
    const ordered = this.listeners
      .filter((entry) => entry.type === 'change')
      .sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const entry of ordered) await entry.listener();
  }
}

async function proveDetailsPhotoSurvivesSharedChooser() {
  const input = new SharedFileInput();
  const status = { value: '' };
  let appliedBackground = '#1a1a1a';
  const sandbox = {
    pendingImagePath: null,
    $: (id) => id === 'img-file-input' ? input : null,
    applySelectedImageFile: async () => {},
    FileReader: class {
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,U0FMT04=';
        this.onload();
      }
    },
  };
  vm.runInNewContext(
    `${composeHeroBackground}\n${initImageFileInput}\n${openImagePickerForPath}\n` +
      'this.initImageFileInput = initImageFileInput; this.openImagePickerForPath = openImagePickerForPath;',
    sandbox
  );

  sandbox.initImageFileInput();
  sandbox.openImagePickerForPath('hero.background', (image) => {
    status.value = image ? 'Poză adăugată' : '';
    appliedBackground = sandbox.composeHeroBackground({ color: '#1a1a1a', image });
  });
  await input.choose();

  assert.strictEqual(status.value, 'Poză adăugată', 'Detalii reports that the chosen Salon photo was added');
  assert.match(appliedBackground, /url\(['"]data:image\/jpeg;base64,U0FMT04=['"]\)/, 'hero background keeps the chosen image URL');
  assert.notStrictEqual(appliedBackground, '#1a1a1a', 'chosen Salon photo cannot collapse to a black color-only hero');
}

Promise.all([
  proveDetailsPhotoSurvivesSharedChooser(),
  proveExportErrorsStayRomanian(),
])
  .catch((error) => {
    failures.push(error.message);
  })
  .then(() => {
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('PASS Romanian unhappy paths and Salon Detalii photo chooser');
  });
