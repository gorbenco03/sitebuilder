'use strict';
/**
 * Flow 2 regression oracle for connected Instafidget copy and language UI.
 *
 * Run: node bot/test/flow2-instafidget-language.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractFunction(src, name) {
  const start = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  if (!start) return '';
  let index = start.index + start[0].length;
  let depth = 1;
  while (index < src.length && depth > 0) {
    const char = src[index++];
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return src.slice(start.index, index);
}

function schemaField(schema, key) {
  for (const section of schema.sections || []) {
    const field = (section.fields || []).find((candidate) => candidate.key === key);
    if (field) return field;
  }
  return null;
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    failed++;
    console.error('FAIL', name, '-', error.message);
  }
}

const appSrc = read('builder/app.js');
const indexHtml = read('builder/index.html');

check('Instafidget modal lead follows disconnected and connected state', () => {
  assert.match(indexHtml, /id=["']ig-state-lead["']/, 'state lead has no stable target');
  const connectedUrl = extractFunction(appSrc, 'connectedInstagramEmbedUrl');
  const syncPanels = extractFunction(appSrc, 'syncInstagramModalPanels');
  assert.ok(connectedUrl, 'connectedInstagramEmbedUrl exists');
  assert.ok(syncPanels, 'syncInstagramModalPanels exists');
  assert.match(syncPanels, /ig-state-lead/, 'modal sync does not update the lead');

  const elements = Object.fromEntries(
    ['ig-auth-panel', 'ig-connect-panel', 'ig-connected-panel', 'modal-instagram-title', 'ig-state-lead']
      .map((id) => [id, { style: {}, textContent: '' }])
  );
  const sandbox = {
    $: (id) => elements[id] || null,
    currentUser: { email: 'client@exemplu.ro' },
    draft: { config: { instagram: { embedUrl: '' } } },
  };
  vm.runInNewContext(`${connectedUrl}; ${syncPanels}; this.sync = syncInstagramModalPanels;`, sandbox);

  sandbox.sync();
  assert.strictEqual(elements['modal-instagram-title'].textContent, 'Adaugă Instagram');
  assert.match(elements['ig-state-lead'].textContent, /Conectează Instagram/);
  assert.match(elements['ig-state-lead'].textContent, /înainte să începi trialul/);

  sandbox.draft.config.instagram.embedUrl = 'https://instafidget.test/embed/feed';
  sandbox.sync();
  assert.strictEqual(elements['modal-instagram-title'].textContent, 'Instagram conectat');
  assert.doesNotMatch(elements['ig-state-lead'].textContent, /conectează|înainte să începi trialul/i);
  assert.match(elements['ig-state-lead'].textContent, /feed-ul/i);
  assert.strictEqual(elements['ig-connected-panel'].style.display, '');

  const partnerNote = indexHtml.match(/id=["']ig-partner-note["'][^>]*>([\s\S]*?)<\/p>/i);
  assert.ok(partnerNote, 'partner note remains visible in the modal');
  assert.match(partnerNote[1], /12 luni/);
  assert.match(partnerNote[1], /Instafidget Free \(filigran\)/);
});

check('all five Detalii schemas display Română while storing ro', () => {
  const registry = JSON.parse(read('templates/registry.json')).templates || [];
  assert.strictEqual(registry.length, 5, 'launch catalog contains five systems');
  for (const entry of registry) {
    const schema = JSON.parse(read(`templates/${entry.id}/schema.json`));
    const language = schemaField(schema, 'business.lang');
    assert.ok(language, `${entry.id}: business.lang field exists`);
    assert.strictEqual(language.label, 'Limba site-ului', `${entry.id}: customer-facing label`);
    assert.strictEqual(language.type, 'select', `${entry.id}: language is not a choice control`);
    assert.deepStrictEqual(
      language.options,
      [{ value: 'ro', label: 'Română' }],
      `${entry.id}: displayed choice must be Română and stored value ro`
    );
    assert.strictEqual(language.required, true, `${entry.id}: language remains required`);

    const presets = JSON.parse(read(`templates/${entry.id}/presets.json`)).presets || [];
    assert.ok(presets.length > 0, `${entry.id}: has presets`);
    for (const preset of presets) {
      assert.strictEqual(preset.config.business.lang, 'ro', `${entry.id}/${preset.id || preset.name}: BCP-47 value`);
    }
    assert.match(read(`templates/${entry.id}/template.html`), /<html\b[^>]*lang=["']\{\{business\.lang\}\}["']/i);
  }
});

check('Detalii select renders the Romanian label without changing the stored tag', () => {
  const buildDrawerField = extractFunction(appSrc, 'buildDrawerField');
  assert.ok(buildDrawerField, 'buildDrawerField exists');

  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handler) { this.listeners[name] = handler; }
  }

  const language = schemaField(JSON.parse(read('templates/professionals/schema.json')), 'business.lang');
  const sandbox = {
    document: { createElement: (tag) => new FakeElement(tag) },
    draft: { config: { business: { lang: 'ro' } } },
    isHiddenDrawerField: () => false,
    escHtml: (value) => String(value),
    getPath: (object, key) => key.split('.').reduce((value, part) => value && value[part], object),
    setPath() {},
    deriveWaHref() {},
    scheduleRerender() {},
    cascadeBusinessNameIdentity() {},
    saveDraft() {},
    updateChecklist() {},
    sendSetToIframe() {},
    syncDrawerField() {},
    drawerSaveTimer: null,
    clearTimeout() {},
    setTimeout: () => 1,
  };
  vm.runInNewContext(`${buildDrawerField}; this.build = buildDrawerField;`, sandbox);
  const rendered = sandbox.build(language);
  const control = rendered.children.find((child) => child.tagName === 'SELECT');
  assert.ok(control, 'Limba site-ului is not rendered as a select');
  assert.strictEqual(control.value, 'ro', 'stored BCP-47 tag is not preserved');
  const option = control.children.find((child) => child.tagName === 'OPTION' && child.value === 'ro');
  assert.ok(option, 'stored ro option is missing');
  assert.strictEqual(option.textContent, 'Română', 'customer sees a raw language code');
});

if (failed) {
  console.error(`\nflow2-instafidget-language.test.js: ${failed} failure(s)`);
  process.exit(1);
}
console.log('\nflow2-instafidget-language.test.js: all checks passed');
