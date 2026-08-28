'use strict';
/**
 * bot/test/wave12-instafidget-note.test.js — Wave 12 Instafidget partner position note.
 *
 * VISION boundary: Site Builder keeps a neutral social-feed slot. Public Instagram
 * appears only when Instafidget is connected (S111). Stranger opening Add Instagram
 * must see a short partner note: Instafidget is a partner product (not Hidook),
 * year-1 included free, then Instafidget Free with watermark.
 *
 * Causal contracts:
 *   1. builder/index.html #modal-instagram contains id="ig-partner-note" whose text
 *      includes all of:
 *        - Instagram feed is provided by Instafidget, a partner product
 *        - Included free for 12 months
 *        - then Instafidget Free (watermark)
 *   2. Note must not claim Hidook Site Builder operates Instagram, bills Instafidget,
 *      or talks to Meta.
 *   3. S111 hide-when-disconnected remains: build.js still omits public Instagram
 *      when partner embed is not connected.
 *   4. OWNER-STRIPE-TRIAL.md contains heading Instafidget (partner) and the same
 *      three facts. Never print secrets.
 *
 * Run: node bot/test/wave12-instafidget-note.test.js
 * Exits non-zero on failure.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PARENT_SHA = '037f2f130b22280be76017ba441e5aeb0a88d5d3';

// Product UI is Romanian; OWNER docs may still use English phrasing.
const PHRASE_PARTNER_RO =
  'Feed-ul Instagram este oferit de Instafidget, un produs partener';
const PHRASE_FREE_RO = 'Inclus gratuit 12 luni';
const PHRASE_WATERMARK_RO = 'apoi Instafidget Free (watermark)';
const PHRASE_PARTNER_EN =
  'Instagram feed is provided by Instafidget, a partner product';
const PHRASE_FREE_EN = 'Included free for 12 months';
const PHRASE_WATERMARK_EN = 'then Instafidget Free (watermark)';
function hasPartnerFacts(text) {
  const t = String(text || '');
  const partner = t.includes(PHRASE_PARTNER_RO) || t.includes(PHRASE_PARTNER_EN) ||
    /Instafidget,\s*(un\s+)?produs partener|Instafidget,\s*a partner product/i.test(t);
  const free = t.includes(PHRASE_FREE_RO) || t.includes(PHRASE_FREE_EN) ||
    /Inclus gratuit 12 luni|Included free for 12 months/i.test(t);
  const mark = t.includes(PHRASE_WATERMARK_RO) || t.includes(PHRASE_WATERMARK_EN) ||
    /Instafidget Free\s*\(watermark\)/i.test(t);
  return partner && free && mark;
}

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

function parentBlob(rel) {
  return execFileSync('git', ['-C', ROOT, 'show', `${PARENT_SHA}:${rel}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function headRead(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function extractModal(html) {
  const m = html.match(
    /id=["']modal-instagram["'][\s\S]*?(?=<div id=["']toast["']|<!-- ===== TOAST|<\/body>)/i
  );
  assert.ok(m, 'Add Instagram modal (#modal-instagram) must exist');
  return m[0];
}

function extractPartnerNote(html) {
  const modal = extractModal(html);
  const m =
    modal.match(/id=["']ig-partner-note["'][^>]*>([\s\S]*?)<\/p>/i) ||
    modal.match(/id=["']ig-partner-note["'][^>]*>([\s\S]*?)<\/div>/i);
  assert.ok(m, '#ig-partner-note must exist inside #modal-instagram');
  // Strip tags for text checks
  const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { raw: m[0], text };
}

function assertPartnerFacts(text, label) {
  assert.ok(
    hasPartnerFacts(text),
    `${label}: must state Instafidget partner + 12 months free + Free watermark (RO or EN)`
  );
}

function assertNoteDoesNotOverclaim(text, label) {
  // Partner note must not claim Hidook operates Instagram, bills Instafidget, or talks to Meta.
  const bad = [
    /Hidook\s+Site\s+Builder\s+(operates|runs|hosts|provides)\s+Instagram/i,
    /Hidook\s+(operates|runs|hosts)\s+Instagram/i,
    /bills?\s+Instafidget/i,
    /Hidook\s+.{0,40}bill.{0,40}Instafidget/i,
    /Instafidget\s+.{0,40}billed\s+by\s+Hidook/i,
    /talks?\s+to\s+Meta/i,
    /Meta\s+API/i,
    /we\s+talk\s+to\s+Meta/i,
  ];
  for (const re of bad) {
    assert.ok(!re.test(text), `${label}: partner note overclaims (${re})`);
  }
}

// ── Causal RED on parent Wave 11 (037f2f1) ───────────────────────────────
check(`parent ${PARENT_SHA.slice(0, 7)} Add Instagram modal has no ig-partner-note`, () => {
  const html = parentBlob('builder/index.html');
  const modal = extractModal(html);
  assert.ok(
    !/id=["']ig-partner-note["']/.test(modal),
    'parent must not yet ship #ig-partner-note'
  );
  assert.ok(
    !modal.includes(PHRASE_PARTNER_EN) && !modal.includes(PHRASE_PARTNER_RO),
    'parent modal must not yet state partner product phrase'
  );
});

check(`parent ${PARENT_SHA.slice(0, 7)} OWNER-STRIPE-TRIAL.md has no Instafidget (partner) heading`, () => {
  const md = parentBlob('OWNER-STRIPE-TRIAL.md');
  assert.ok(
    !/#{1,3}\s*Instafidget\s*\(partner\)/i.test(md),
    'parent OWNER doc must not yet have Instafidget (partner) heading'
  );
  assert.ok(
    !md.includes(PHRASE_PARTNER_EN) && !/Included free for 12 months/i.test(md),
    'parent OWNER doc must not yet state year-1 free + Free watermark facts'
  );
});

// ── HEAD GREEN: builder partner note ─────────────────────────────────────
check('HEAD builder/index.html #modal-instagram has #ig-partner-note with three partner facts', () => {
  const html = headRead('builder/index.html');
  const { text } = extractPartnerNote(html);
  assertPartnerFacts(text, 'ig-partner-note');
  assertNoteDoesNotOverclaim(text, 'ig-partner-note');
});

check('HEAD Add Instagram modal keeps Connect flow and Instafidget Terms/Privacy links', () => {
  const html = headRead('builder/index.html');
  const modal = extractModal(html);
  assert.ok(/id=["']btn-ig-connect["']/.test(modal), 'Connect Instagram button');
  assert.ok(/id=["']ig-terms-check["']/.test(modal), 'terms checkbox');
  assert.ok(
    /instafidget\.hidook\.agency\/terms/i.test(modal),
    'Instafidget Terms link'
  );
  assert.ok(
    /instafidget\.hidook\.agency\/privacy/i.test(modal),
    'Instafidget Privacy link'
  );
  assert.ok(
    /Connect Instagram|Conectează Instagram/i.test(modal),
    'Connect Instagram label'
  );
});

// ── HEAD GREEN: S111 hide-when-disconnected unchanged ────────────────────
check('HEAD build.js still omits public Instagram when partner embed is not connected (S111)', () => {
  const src = headRead('build.js');
  assert.ok(
    /function\s+isConnectedSocialFeedEmbed\s*\(/.test(src),
    'isConnectedSocialFeedEmbed present'
  );
  assert.ok(
    /function\s+normalizeInstagramForPublic\s*\(/.test(src),
    'normalizeInstagramForPublic present'
  );
  assert.ok(
    /Not connected:\s*omit the whole public Instagram block/i.test(src) ||
      (/omit the whole public Instagram block/i.test(src) &&
        /embedUrl\s*=\s*['"]{2}/.test(src)),
    'not-connected path still clears public Instagram'
  );
  // Call site still normalizes before public render
  assert.ok(
    /normalizeInstagramForPublic\s*\(\s*cfg\s*\)/.test(src),
    'normalizeInstagramForPublic still called on render cfg'
  );
  // Direct instagram.com still rejected as embed
  assert.ok(
    /instagram\.com/.test(src) && /return false/.test(src),
    'direct instagram.com embed still rejected'
  );
});

// ── HEAD GREEN: owner runbook ────────────────────────────────────────────
check('HEAD OWNER-STRIPE-TRIAL.md has Instafidget (partner) with three facts; no secrets', () => {
  const md = headRead('OWNER-STRIPE-TRIAL.md');
  assert.ok(
    /##\s+Instafidget\s*\(partner\)/i.test(md),
    'heading ## Instafidget (partner)'
  );
  // Same three facts (allow slight prose wrapping around the required phrases)
  assert.ok(
    /partner product/i.test(md) && /Instafidget/i.test(md),
    'states Instafidget is a partner product'
  );
  assert.ok(
    /Included free for 12 months|free for 12 months|12 months.*free/i.test(md),
    'states 12 months free'
  );
  assert.ok(
    /Instafidget Free\s*\(watermark\)|Free\s*\(watermark\)/i.test(md),
    'states then Free with watermark'
  );
  // Prefer exact phrases when present in body under the heading
  const section = md.split(/##\s+Instafidget\s*\(partner\)/i)[1] || '';
  const sectionBody = section.split(/\n##\s+/)[0] || section;
  assert.ok(sectionBody.trim().length > 20, 'partner section has body');
  assert.ok(
    /partner product/i.test(sectionBody),
    'section body: partner product'
  );
  assert.ok(
    /12 months/i.test(sectionBody) && /free/i.test(sectionBody),
    'section body: 12 months free'
  );
  assert.ok(
    /watermark/i.test(sectionBody) && /Free/i.test(sectionBody),
    'section body: Free watermark'
  );
  assert.ok(
    !/sk_live_[a-zA-Z0-9]{8,}|sk_test_[a-zA-Z0-9]{8,}|whsec_[a-zA-Z0-9]{8,}/.test(md),
    'no secrets printed'
  );
});

check('PRICE_CENTS stays 9900', () => {
  const pricing = require('../pricing.js');
  assert.strictEqual(pricing.PRICE_CENTS, 9900);
});

process.exit(failed ? 1 : 0);
