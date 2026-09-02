'use strict';
/**
 * Contract tests for the binding Flow 2 browser oracle.
 *
 * Run: node bot/test/flow2-template-e2e-oracle.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DRIVER = path.join(__dirname, 'flow2-template-e2e.mjs');
const SYSTEMS = [
  'professionals',
  'local-service',
  'portfolio',
  'product-menu',
  'desserdirina',
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

(async () => {
  const oracle = await import(DRIVER);
  assert.deepStrictEqual(Object.keys(oracle.FIXTURES).sort(), SYSTEMS.slice().sort(), 'all five systems have fixtures');
  assert.ok(Array.isArray(oracle.ORACLE_STEPS) && oracle.ORACLE_STEPS.length >= 8, 'full click journey is declared');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow2-binding-contract-'));
  try {
    const entries = oracle.ORACLE_STEPS.map((step, index) => {
      const screenshot = oracle.expectedScreenshotName(index, step.name);
      const bytes = Buffer.from('bound-pixels:' + step.name);
      fs.writeFileSync(path.join(tmp, screenshot), bytes);
      return {
        index,
        step: step.name,
        selector: oracle.expectedSelector(step, 'professionals'),
        action: step.action,
        screenshot,
        screenshotSha256: sha256(bytes),
        timestamp: new Date(1700000000000 + index * 1000).toISOString(),
        contentCheck: { ok: true, detail: 'contract fixture' },
      };
    });

    assert.doesNotThrow(() => oracle.verifyEvidence({ system: 'professionals', entries, evidenceDir: tmp }));

    const wrongName = structuredClone(entries);
    wrongName[1].screenshot = 'after-the-fact.png';
    assert.throws(
      () => oracle.verifyEvidence({ system: 'professionals', entries: wrongName, evidenceDir: tmp }),
      /screenshot filename/i,
      'a deliberately wrong screenshot name must fail'
    );

    const skippedClick = entries.filter((entry) => entry.step !== oracle.ORACLE_STEPS[2].name);
    assert.throws(
      () => oracle.verifyEvidence({ system: 'professionals', entries: skippedClick, evidenceDir: tmp }),
      /step count|step sequence/i,
      'a skipped click must fail'
    );

    const swapped = structuredClone(entries);
    const firstPath = path.join(tmp, swapped[0].screenshot);
    const secondPath = path.join(tmp, swapped[1].screenshot);
    const first = fs.readFileSync(firstPath);
    fs.writeFileSync(firstPath, fs.readFileSync(secondPath));
    fs.writeFileSync(secondPath, first);
    assert.throws(
      () => oracle.verifyEvidence({ system: 'professionals', entries: swapped, evidenceDir: tmp }),
      /digest/i,
      'swapped screenshot bytes must fail the mechanical digest check'
    );

    const source = fs.readFileSync(DRIVER, 'utf8');
    assert.match(source, /HIDOOK_TEST_PAY\s*=\s*['"]1['"]/);
    assert.match(source, /HIDOOK_ISOLATED_DEPLOY\s*=\s*['"]1['"]/);
    assert.match(source, /delete process\.env\.PUBLIC_URL/);
    assert.match(source, /delete process\.env\.HIDOOK_FAKE_DEPLOY/);
    assert.doesNotMatch(source, /STRIPE_(?:SECRET|WEBHOOK).*?=.*?(?:sk_live|whsec_)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('PASS Flow 2 binding oracle rejects renamed, skipped, and swapped evidence');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
