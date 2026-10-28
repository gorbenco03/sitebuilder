'use strict';
/**
 * Flow 2 Romanian unhappy-path regression oracle.
 *
 * Form editor removed 2026-10-28: the Salon Detalii photo-chooser proof, the
 * publish-failure copy check (doActualPublish) and the draft HTML/ZIP export
 * toasts (downloadDraftHtml / downloadDraftZip) were dropped with the editor.
 * The export-failure proof now targets the dashboard's downloadSiteZip().
 *
 * STALE ORACLE RECONCILE (S-legacy G1, 2026-09-05):
 * HTML export 401 toast evolved from "Intră în cont ca să descarci ciorna ca HTML."
 * to shipped "Intră în cont ca să descarci HTML-ul." (ZIP still uses Autentifică-te…).
 * Oracle expected the older ciorna wording — copy drift, not a product EN leak.
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
const copyRoSrc = read('builder/copy-ro.js');
const failures = [];

// PLAN-UX-2026-09-27 §5.8 (T-3): app.js now sources its Romanian toasts/
// fallbacks from the RO catalog (builder/copy-ro.js) instead of repeating
// the literal string at each call site — read the catalog's own value
// wherever this file used to assert against a literal in appSrc.
function copyRoValue(key) {
  const sandbox = {};
  vm.runInNewContext(copyRoSrc + '\nthis.RO = RO;', sandbox);
  assert.ok(Object.prototype.hasOwnProperty.call(sandbox.RO, key), `RO.${key} must exist in builder/copy-ro.js`);
  return sandbox.RO[key];
}

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
const downloadSiteZip = extractFunction(appSrc, 'downloadSiteZip');
const wireAuthForm = extractFunction(appSrc, 'wireAuthForm');
const safeServerMessage = extractFunction(appSrc, 'safeServerMessage');
const unpaidRomanian = 'Ai deja un site neplătit. Plătește-l sau șterge-l înainte să creezi altul.';

// PLAN-UX-2026-09-27 §4/§5.8 (U-09): the fromServer+status gate that used to
// be reimplemented inline at each call site now lives once, in
// safeServerMessage(). Call sites route through it instead of repeating the
// gate; the gate itself is checked directly below.
check('safeServerMessage gates a server message on fromServer AND a 4xx status', () => {
  // Showing `e.message` is allowed only behind BOTH guards: the message came
  // from our server (`fromServer`), and the status is a 4xx — a deliberate
  // refusal written for the owner. A 5xx carries an internal failure's text
  // ("boom", a stack, an English driver error) and must not be shown, and
  // neither must a raw browser fetch/network failure.
  assert.match(safeServerMessage, /fromServer/, 'must gate a shown server message on fromServer');
  assert.match(safeServerMessage, /status\s*[<>=]/, 'must also gate it on the status code (4xx only, never 5xx)');
});

check('auth email network failure copy', () => {
  // This check originally banned showing err.message at all. Audit finding #6
  // then asked for the opposite -- the server sends a specific reason and the
  // UI was masking it behind one generic string. Both are right, about
  // different errors, so the contract is now: show the reason the SERVER
  // chose, fall back to Romanian for anything else -- via the shared
  // safeServerMessage() gate, not an inline err.fromServer check.
  //
  // The distinction is not cosmetic. apiPost() only reaches its throw when the
  // server actually responded; a fetch() rejection (offline, DNS, connection
  // refused) produces a raw browser TypeError whose message is English
  // technical text. Displaying that verbatim is the regression this guards.
  assert.ok(
    wireAuthForm.includes('safeServerMessage(err, RO.IG_LINK_SEND_FAILED)'),
    'auth email failure still routes through the shared RO fallback'
  );
  assert.strictEqual(
    copyRoValue('IG_LINK_SEND_FAILED'),
    'Nu am putut trimite linkul. Încearcă din nou.',
    'auth email failure still keeps the Romanian fallback text'
  );
  assert.ok(
    /safeServerMessage\s*\(\s*err\s*,/.test(wireAuthForm),
    'auth error must route through the shared safeServerMessage gate, not an inline err.message fallback'
  );
  assert.ok(
    !/errorDiv\.textContent\s*=\s*\(?\s*(?:err|e)\s*&&\s*(?:err|e)\.message\s*\)?\s*\|\|/.test(wireAuthForm),
    'auth error cannot fall back through an ungated exception message'
  );
  assert.ok(!wireAuthForm.includes('Something went wrong. Try again.'), 'auth error cannot retain the English fallback');
});

check('apiPost marks server-chosen errors so the UI can tell them apart', () => {
  const apiPost = extractFunction(appSrc, 'apiPost');
  assert.ok(/fromServer:\s*true/.test(apiPost), 'apiPost must flag errors that carry a server message');
  assert.ok(
    /if \(!r\.ok\)[\s\S]*?fromServer:\s*true/.test(apiPost),
    'the flag must be set on the non-ok branch, where a server body exists'
  );
});

check('invalid payment copy', () => {
  assert.ok(
    completeTestCheckout.includes("showToast(RO.INVALID_PAYMENT_SESSION, 'error')"),
    'invalid test-payment hash toast is Romanian'
  );
  assert.strictEqual(
    copyRoValue('INVALID_PAYMENT_SESSION'),
    'Sesiune de plată invalidă.',
    'invalid test-payment hash toast text is unchanged'
  );
  assert.ok(!completeTestCheckout.includes('Invalid payment session.'), 'invalid test-payment hash cannot toast English');
  assert.ok(serverSrc.includes("error: 'Sesiune de plată invalidă.'"), 'invalid test-payment API response is Romanian');
  assert.ok(!serverSrc.includes("error: 'Invalid payment session.'"), 'invalid test-payment API path cannot expose English');
});

check('logout copy', () => {
  assert.ok(appSrc.includes("showToast(RO.LOGGED_OUT, '', 3000)"), 'logout success toast is Romanian');
  assert.ok(!appSrc.includes("showToast('Signed out.'"), 'logout success path cannot toast English');
  assert.strictEqual(copyRoValue('LOGGED_OUT'), 'Te-ai deconectat.', 'logout success toast text is unchanged');
});

check('second unpaid site copy', () => {
  assert.ok(serverSrc.includes(`error: '${unpaidRomanian}'`), 'second-unpaid-site API response is Romanian');
  assert.ok(
    !serverSrc.includes('You already have an unpaid site. Pay for it or delete it before creating another.'),
    'second-unpaid-site API path cannot expose the raw English error'
  );
});

async function runExportFailure(response) {
  const toasts = [];
  const button = { disabled: false };
  const sandbox = {
    fetch: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
    setBtnLoading: (btn, loading) => { btn.disabled = !!loading; },
    showToast: (...args) => toasts.push(args),
  };
  // Load the RO catalog the way the real page does (copy-ro.js before app.js);
  // strip its 'use strict' so the spliced script is not made strict.
  const copyRoBody = copyRoSrc.replace(/^'use strict';\s*\n?/, '');
  vm.runInNewContext(`${copyRoBody}\n${downloadSiteZip}\nthis.download = downloadSiteZip;`, sandbox);
  await sandbox.download('site-test', button);
  assert.strictEqual(button.disabled, false, 'ZIP button is restored after a failed download');
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
    await runExportFailure(backendFailure),
    'Nu am putut descărca ZIP-ul.',
    'ZIP export cannot toast a raw backend error'
  );
  assert.strictEqual(
    await runExportFailure(new Error('Network failed')),
    'Nu am putut descărca ZIP-ul.',
    'ZIP export cannot toast a raw exception message'
  );
  assert.strictEqual(
    await runExportFailure({ ...backendFailure, status: 401 }),
    'Autentifică-te ca să descarci ZIP-ul.',
    'ZIP export keeps its Romanian sign-in guidance'
  );
  assert.strictEqual(
    await runExportFailure({ ...backendFailure, status: 402 }),
    'Activează trialul de 14 zile sau abonamentul ca să descarci ZIP-ul.',
    'ZIP export keeps its Romanian trial-required guidance'
  );
}

proveExportErrorsStayRomanian()
  .catch((error) => {
    failures.push(error.message);
  })
  .then(() => {
    if (failures.length) {
      console.error(failures.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('PASS Romanian unhappy paths and ZIP export errors');
  });
