'use strict';
/**
 * bot/test/audit-builder-chrome.test.js — oracle for the 4 findings in
 * 04-QA-Evidence/Audit-2026-09-06-2225ca7 (lenses a11y + static-renderer-export +
 * template-portfolio), all located in builder/app.js:
 *
 *   A11Y-01 [high] no modal traps focus: Tab/Shift+Tab leak from the open dialog
 *                  into the editor topbar hidden behind the overlay.
 *   A11Y-02 [high] #modal-instagram does not close on Escape (hardcoded array
 *                  in the global keydown handler was missing 'modal-instagram').
 *   F4      [high] renaming the business corrupts seo.jsonLd: the cascade did a
 *                  raw string.split(oldName).join(newName) over serialized JSON,
 *                  so a new name carrying a quote/backslash produces invalid JSON
 *                  and the site's <script type="application/ld+json"> ships empty.
 *   PORT-04 [high] renaming the business does not touch team.title, so the
 *                  Portfolio preset's static "Echipa Atelier Ivoire" survives a
 *                  rename and contradicts the new brand on the live site.
 *
 * Source-level extraction + vm execution (same pattern as
 * bot/test/flow4-ig-disconnect-stay.test.js) so this runs without a browser.
 * A real-browser Playwright proof lives alongside this fix's evidence in
 * 04-QA-Evidence/Audit-Fixes-2026-09-06/builder-chrome/.
 *
 * Run: node bot/test/audit-builder-chrome.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder', 'app.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Brace-matching function extractor (module scope, not nested-in-another-fn). */
function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const start = re.exec(src);
  if (!start) return '';
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < src.length && depth > 0) {
    const ch = src[index++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(start.index, index);
}

const appSrc = headRead('builder/app.js');

// ─── A11Y-01: modal focus trap ────────────────────────────────────────────

check('A11Y-01 source: getFocusableEls + trapModalTab exist', () => {
  const getFocusable = extractFunction(appSrc, 'getFocusableEls');
  const trap = extractFunction(appSrc, 'trapModalTab');
  assert.ok(getFocusable, 'getFocusableEls must exist');
  assert.ok(trap, 'trapModalTab must exist');
  assert.ok(/key\s*!==\s*['"]Tab['"]/.test(trap), 'trap gates on Tab key');
  assert.ok(/shiftKey/.test(trap), 'trap distinguishes Shift+Tab');
});

check('A11Y-01 source: openModal wires the trap, closeModal restores opener focus', () => {
  const openModalSrc = extractFunction(appSrc, 'openModal');
  const closeModalSrc = extractFunction(appSrc, 'closeModal');
  assert.ok(openModalSrc, 'openModal must exist');
  assert.ok(closeModalSrc, 'closeModal must exist');
  assert.ok(
    /addEventListener\s*\(\s*['"]keydown['"]/.test(openModalSrc),
    'openModal must attach a keydown trap handler to the modal container'
  );
  assert.ok(
    /activeElement/.test(openModalSrc),
    'openModal must remember the element that had focus before opening (the "opener")'
  );
  assert.ok(
    /\.focus\s*\(\s*\)/.test(closeModalSrc),
    'closeModal must return focus somewhere (to the opener) on close'
  );
});

check('A11Y-01 behavioral: Tab cycles 15x inside a 3-control modal without escaping', () => {
  const getFocusableSrc = extractFunction(appSrc, 'getFocusableEls');
  const trapSrc = extractFunction(appSrc, 'trapModalTab');
  assert.ok(getFocusableSrc && trapSrc, 'both functions extracted');

  const sandbox = { document: { activeElement: null } };
  vm.createContext(sandbox);
  vm.runInContext(
    [getFocusableSrc, trapSrc, 'this.trapModalTab = trapModalTab;'].join('\n'),
    sandbox
  );

  function makeEl(label) {
    return {
      label,
      offsetWidth: 10,
      offsetHeight: 10,
      getClientRects: () => [{}],
      focus() { sandbox.document.activeElement = this; },
    };
  }
  const els = [makeEl('close'), makeEl('input-slug'), makeEl('btn-publish-continue')];
  const container = {
    querySelectorAll: () => els,
    contains: (el) => els.indexOf(el) !== -1,
  };

  sandbox.document.activeElement = els[0];
  const seenOutsideContainer = [];
  for (let i = 0; i < 15; i++) {
    let prevented = false;
    const e = { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } };
    sandbox.trapModalTab(e, container);
    if (!prevented) {
      // Simulate the browser's own default Tab advance (trap only intervenes at
      // the boundary — this mirrors what a real DOM would do in between).
      const idx = els.indexOf(sandbox.document.activeElement);
      sandbox.document.activeElement = els[Math.min(idx + 1, els.length - 1)];
    }
    if (!container.contains(sandbox.document.activeElement)) {
      seenOutsideContainer.push({ press: i, el: sandbox.document.activeElement });
    }
  }
  assert.strictEqual(
    seenOutsideContainer.length,
    0,
    'focus left the dialog container at least once during 15 Tab presses: ' +
      JSON.stringify(seenOutsideContainer)
  );

  // Shift+Tab from the first control must wrap to the last, not escape backward.
  sandbox.document.activeElement = els[0];
  let prevented = false;
  sandbox.trapModalTab(
    { key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } },
    container
  );
  assert.ok(prevented, 'Shift+Tab on the first control must be intercepted');
  assert.strictEqual(sandbox.document.activeElement, els[els.length - 1], 'wraps to last control');
});

// ─── A11Y-02: Escape must close #modal-instagram too ──────────────────────

check('A11Y-02: the Escape handler closes whatever modal is open, by shape not by name', () => {
  const idx = appSrc.indexOf("e.key === 'Escape'");
  assert.ok(idx !== -1, 'global Escape handler exists');
  const windowSrc = appSrc.slice(idx, idx + 600);
  // This originally demanded that 'modal-instagram' be present in a hardcoded
  // id array. The array WAS the defect: it silently omitted whichever modal
  // shipped last, and by the time Suite 4 measured it, Domeniu, Facturi and
  // Șterge — the delete-a-site confirmation among them — had all been added
  // without anyone remembering to update it. The array is gone; the handler
  // scans the DOM for an open .modal-overlay, so a tenth modal inherits the
  // behaviour without a decision. Asserting the shape, not the roll call.
  assert.ok(
    !/\[\s*['"]modal-[a-z-]+['"]\s*,/.test(windowSrc),
    'the Escape handler must not carry a hardcoded modal id list again'
  );
  assert.ok(
    /modal-overlay/.test(windowSrc),
    'the Escape handler must find open modals by their .modal-overlay class'
  );
  // The behavioural proof — every modal, real browser, Esc + backdrop + focus
  // trap + 44px close button — is bot/test/suite4-modal-contract.test.js.
});

// ─── F4 + PORT-04: cascadeBusinessNameIdentity ────────────────────────────

const getPathSrc = extractFunction(appSrc, 'getPath');
const setPathSrc = extractFunction(appSrc, 'setPath');
const cascadeSrc = extractFunction(appSrc, 'cascadeBusinessNameIdentity');

function runCascade(config, oldName, newName) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    [getPathSrc, setPathSrc, cascadeSrc, 'this.cascadeBusinessNameIdentity = cascadeBusinessNameIdentity;'].join('\n'),
    sandbox
  );
  sandbox.cascadeBusinessNameIdentity(config, oldName, newName);
  return config;
}

check('F4: renaming to a name with a quote and a backslash keeps seo.jsonLd valid JSON', () => {
  assert.ok(getPathSrc && setPathSrc && cascadeSrc, 'deps extracted');
  const oldName = 'Desserdirina';
  const newName = 'O "Steaua\\Nordului" SRL'; // hostile: literal " and \
  const config = {
    business: { name: oldName },
    seo: {
      jsonLd: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: oldName,
        url: 'https://exemplu.ro',
      }),
    },
  };

  runCascade(config, oldName, newName);

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(config.seo.jsonLd);
  }, 'seo.jsonLd must remain valid JSON after a hostile rename');
  assert.strictEqual(parsed.name, newName, 'jsonLd.name must equal the new (unescaped) business name');
});

check('F4: seo.jsonLd that is already invalid JSON is left untouched, not further broken', () => {
  const config = { seo: { jsonLd: '{not valid json, contains Desserdirina' } };
  const before = config.seo.jsonLd;
  runCascade(config, 'Desserdirina', 'Nume Nou "Cu Ghilimele"');
  assert.strictEqual(config.seo.jsonLd, before, 'invalid JSON must be left exactly as-is');
});

check('PORT-04: renaming propagates into team.title (Portfolio preset identity)', () => {
  const oldName = 'Atelier Ivoire';
  const newName = 'Șt. Țăndărică & Fiii';
  const config = {
    business: { name: oldName },
    team: { title: 'Echipa Atelier Ivoire' },
  };

  runCascade(config, oldName, newName);

  assert.strictEqual(
    config.team.title,
    'Echipa ' + newName,
    'team.title must carry the new business name forward, like footer already does via {{business.name}}'
  );
  assert.ok(
    config.team.title.indexOf(oldName) === -1,
    'team.title must not still contain the old business name after a rename'
  );
});

if (failed) {
  console.error('\naudit-builder-chrome.test.js: FAILED (' + failed + ')');
  process.exit(1);
}
console.log('\naudit-builder-chrome.test.js: all checks passed');
