'use strict';
/**
 * bot/test/suite11-contact-chips-editable.test.js
 *
 * PLAN-FEEDBACK-2026-09-13, Suite B (points 2, 6, 8, 10): four owner
 * screenshots, one root cause each for two different rows.
 *
 *   - local-service ("Cere o ofertă gratuită"): the address row
 *     "București și împrejurimi" could not be clicked into.
 *   - portfolio ("Programează o vizită"): the address chip
 *     "Strada Icoanei 18 / București 020451" could not be clicked into.
 *   - professionals (Contact): the address row
 *     "Strada Academiei 12, etajul 4 / București 010014" could not be
 *     clicked into.
 *   - desserdirina ("Comandă acum"): neither the address row NOR the
 *     "WhatsApp" row could be clicked into.
 *
 * Root causes (see build.js and templates/*\/template.html):
 *
 *   1. The address always rendered via the RAW sink `{{& contact.address}}`
 *      (needed so a multi-line address can carry real <br> line breaks).
 *      replaceTokens()'s `if (raw) { … }` branch returned early for every
 *      raw sink, before ever reaching the "wrap in <span data-hb-edit>"
 *      logic that every plain `{{token}}` gets in edit mode — so the
 *      address span never became a target you could click into on ANY of
 *      the five templates (product-menu has the exact same raw sink and is
 *      exercised here too, even though the owner did not screenshot it).
 *
 *   2. desserdirina's own contact section hardcoded the English word
 *      "WhatsApp" as a literal string (`<span>WhatsApp</span>`) — not a
 *      token at all — while every other template already rendered
 *      `{{labels.whatsapp}}` there. There was nothing to click into because
 *      there was no field.
 *
 * The fix:
 *   - build.js: the `contact.address` raw sink now wraps its sanitized
 *     value in the same `<span data-hb-edit="contact.address"
 *     data-hb-kind="text">` shape every other editable field gets, gated
 *     exactly like the generic path (editMode + text context only — the
 *     published/export render path is untouched, still returns the bare
 *     sanitized string). A `data-hb-multiline="br"` marker tells
 *     builder/edit-overlay.js this field's line breaks are real <br>
 *     elements, not a plain-text '\n' — see its setupTextFields() doc
 *     comment for the read/write contract that keeps this consistent with
 *     sanitizeAddress()'s "escape everything, then un-escape only <br>"
 *     rule (bot/flow.js's formatAddressHtml, frozen/Telegram, stores
 *     addresses the exact same way already).
 *   - templates/desserdirina/template.html: the hardcoded "WhatsApp" text
 *     is now `{{labels.whatsapp}}`, matching the other four templates
 *     (which already had this token — despite the owner report, local-
 *     service/portfolio/professionals/product-menu's own WhatsApp rows
 *     were already correctly wired; only desserdirina's was hardcoded. See
 *     the "already worked" assertions below.).
 *   - build.js's normalizeConfigForRender() defaults labels.whatsapp to
 *     "WhatsApp" when a config never set it (same pattern as the existing
 *     labels.menuLang default) — so a config saved before this field
 *     existed still publishes the same word it always did.
 *
 * UPDATE 2026-10-28: the form editor (and with it the in-canvas contenteditable
 * overlay these two bugs were about) was removed. What survives is the half
 * that reaches customers: for each of the four reported templates, a config
 * published through the real API pipeline (/api/publish + test checkout)
 * renders on the live /live/<slug>/ page:
 *   1. a two-line address as `line 1<br>line 2` with a real <br>;
 *   2. `<script>…</script>` typed into the address as inert, escaped text,
 *      never a live tag;
 *   3. a custom WhatsApp label (labels.whatsapp) in the contact row;
 * plus the static guard that desserdirina's template no longer hardcodes the
 * English "WhatsApp" literal.
 *
 * Run: node --test bot/test/suite11-contact-chips-editable.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

const ROOT = path.resolve(__dirname, '../..');

// Four templates from the owner's screenshots.
const TEMPLATES = ['local-service', 'portfolio', 'professionals', 'desserdirina'];

let H;

test.before(async () => {
  H = await startHarness('suite11-contact');
});

test.after(async () => {
  if (H) await H.close();
});

async function publishedHtml(templateId, mutate) {
  const { liveUrl } = await H.publish(templateId, publishConfig(templateId, mutate), { label: templateId });
  const res = await fetch(liveUrl);
  assert.equal(res.status, 200, templateId + ': live page must answer 200');
  return res.text();
}

for (const templateId of TEMPLATES) {
  test(`[${templateId}] contact.address: multi-line survives publish with a real <br>, <script> stays inert`, async () => {
    // A real two-line address, stored the way the editor stored it.
    let html = await publishedHtml(templateId, (cfg) => {
      cfg.contact.address = 'Strada Nouă 25<br>Cluj-Napoca 400000';
    });
    assert.match(
      html,
      /Strada Nouă 25<br>Cluj-Napoca 400000/,
      templateId + ': published HTML must render the same two lines with a real <br>'
    );

    // <script> typed into the field must never become a live tag.
    html = await publishedHtml(templateId, (cfg) => {
      cfg.contact.address = '<script>window.__hbXss = true;</script>';
    });
    assert.ok(
      !/<script>window\.__hbXss/.test(html),
      templateId + ': typed <script> must never render as a live tag in published HTML'
    );
    assert.ok(
      html.includes('&lt;script&gt;window.__hbXss'),
      templateId + ': typed <script> must render as inert, escaped text'
    );
  });

  test(`[${templateId}] labels.whatsapp: a custom label is published`, async () => {
    const html = await publishedHtml(templateId, (cfg) => {
      cfg.labels = cfg.labels || {};
      cfg.labels.whatsapp = 'Scrie-ne pe WhatsApp';
    });
    assert.match(html, /Scrie-ne pe WhatsApp/, templateId + ': published HTML must show the new WhatsApp label');
  });
}

// desserdirina-specific regression guard: the WhatsApp row used to be a
// hardcoded English literal, never a token. Prove the template markup no
// longer ships that literal at all.
test('[desserdirina] the WhatsApp row is no longer a hardcoded literal in the template source', () => {
  const tplHtml = fs.readFileSync(path.join(ROOT, 'templates', 'desserdirina', 'template.html'), 'utf8');
  assert.ok(
    !/<span>WhatsApp<\/span>/.test(tplHtml),
    'desserdirina: the contact-section WhatsApp row must not be a hardcoded literal any more'
  );
  assert.match(
    tplHtml,
    /<span class="contact-icon whatsapp" aria-hidden="true"><\/span>\s*<span>\{\{labels\.whatsapp\}\}<\/span>/,
    'desserdirina: the WhatsApp row must render {{labels.whatsapp}}'
  );
});
