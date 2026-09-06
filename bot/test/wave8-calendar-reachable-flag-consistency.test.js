'use strict';
/**
 * bot/test/wave8-calendar-reachable-flag-consistency.test.js
 *
 * Wave 8 — the native booking calendar exists (engine, owner API, public API,
 * tenant isolation all previously proven) but a paying customer had no way to
 * turn it on: appointment.nativeBooking sits in templates/professionals/
 * schema.json as a type:"text" field, but the builder's generic drawer field
 * loop only auto-renders phone/url/color/background + a short partial-key
 * list (see builder/app.js#isDrawerField), and the field is never
 * interpolated as visible text in the template, so there was also no
 * inline-editable spot for it in the preview. Nothing in builder/ ever wrote
 * this key.
 *
 * This oracle does NOT drive a browser (see wave8-calendar-reachable-e2e for
 * that) — it is a fast, read-only regression lock on a narrower but easy-to-
 * silently-break property: the NEW builder toggle (buildNativeBookingPanel /
 * isNativeBookingOn in builder/app.js) must agree, value-for-value, with the
 * server-side publish-time truthiness check (isNativeBookingEnabled in
 * bot/calendar-native/cutover.js) that decides whether the cutover actually
 * runs. If the two ever drift, a toggle could show "Activ" in the editor
 * while publish silently keeps the legacy form (or vice versa).
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-calendar-reachable-flag-consistency.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS = path.join(ROOT, 'builder/app.js');
const CUTOVER_JS = path.join(ROOT, 'bot/calendar-native/cutover.js');

function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return src.slice(m.index, i);
}

test('builder appointment.nativeBooking toggle exists and stays in sync with publish-time cutover truthiness', () => {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');

  // 1. The toggle must actually exist — this is the whole point of Wave 8.
  assert.match(appSrc, /function buildNativeBookingPanel/, 'builder/app.js must define buildNativeBookingPanel');
  assert.match(appSrc, /buildNativeBookingPanel\(body, schema\)/, 'buildDrawer() must call buildNativeBookingPanel');
  assert.match(
    appSrc,
    /setPath\(draft\.config, 'appointment\.nativeBooking', on \? '' : 'da'\)/,
    'the toggle must write appointment.nativeBooking straight into draft.config'
  );
  assert.match(appSrc, /\bsaveDraft\(\)/, 'sanity: saveDraft must still exist as the single persistence choke point');

  // The toggle handler must run through saveDraft() (undo/redo + autosave
  // choke point), not some ad-hoc localStorage write.
  const panelSrc = extractFunction(appSrc, 'buildNativeBookingPanel');
  assert.ok(panelSrc, 'could not extract buildNativeBookingPanel source');
  assert.match(panelSrc, /saveDraft\(\)/, 'the toggle must call saveDraft(), not bypass it');

  // 2. Offered only where the template actually supports it (schema-gated).
  assert.match(
    panelSrc,
    /getAllSchemaFields\(schema\)\.some\(f => f && f\.key === 'appointment\.nativeBooking'\)/,
    'the panel must check the CURRENT template schema for the field before rendering anything'
  );

  // 3. Value-for-value agreement with the server truthiness check.
  const clientFnSrc = extractFunction(appSrc, 'isNativeBookingOn');
  assert.ok(clientFnSrc, 'builder/app.js must define isNativeBookingOn');
  // eslint-disable-next-line no-new-func
  const isNativeBookingOn = new Function(`${clientFnSrc}\nreturn isNativeBookingOn;`)();

  const cutover = require(CUTOVER_JS);
  const isNativeBookingEnabled = cutover.isNativeBookingEnabled;
  assert.equal(typeof isNativeBookingEnabled, 'function', 'cutover.js must still export isNativeBookingEnabled');

  const samples = [
    'da', 'Da', 'DA ', ' da', 'yes', 'YES', 'true', 'True', '1', 'on', 'y', 'enabled',
    'nu', 'Nu', 'nu ', 'no', 'NO', 'false', 'False', '0', 'off', 'n',
    '', '   ', null, undefined, true, false, 1, 0,
    'maybe', 'DAA', 'nuu', // near-miss junk must land the same way on both sides
  ];
  for (const s of samples) {
    const client = isNativeBookingOn(s);
    const server = isNativeBookingEnabled(s);
    assert.equal(
      client,
      server,
      `isNativeBookingOn(${JSON.stringify(s)}) = ${client} but isNativeBookingEnabled(${JSON.stringify(s)}) = ${server} — client/server truthiness disagree`
    );
  }

  console.log('PASS wave8-calendar-reachable-flag-consistency: toggle exists, schema-gated, saveDraft()-backed, and agrees with cutover.js on every sampled value');
});
