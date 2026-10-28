'use strict';
/**
 * bot/test/suite11-team-member-photo.test.js — PLAN-FEEDBACK-2026-09-13
 * Suite D (owner report, portfolio/salon, punct 4).
 *
 * Owner report: adding a new specialist to the team — name and description
 * work, but the photo does not: the new card shows a broken-image icon with
 * alt text "Nume și prenume" and a "Înlocuiește fotografia" tooltip that
 * leads nowhere. The "Poze" panel also never lists the team section at all.
 *
 * VERIFIED CAUSE: templates/portfolio/schema.json's `team.members` itemShape
 * declared `photo` as a plain `"text"` leaf, not an image. Three separate
 * consequences, all from that one line:
 *
 *   1. build.js's M1 fix (isEditorItemField, see its own doc comment) forces
 *      open ANY empty itemShape leaf's `@if` guard in the editor so there is
 *      something to click — correct for a text field, but for `photo` it
 *      meant literally emitting `<img src="">`, which paints as a browser's
 *      broken-image glyph.
 *   2. That same empty `src` can never round-trip through the src→path
 *      reverse lookup (builder/app.js's buildImgMap()/resolveImgPath()) every
 *      OTHER photo control in the app relies on to know which config path a
 *      click should write to — so the "Înlocuiește fotografia" button that
 *      setupImages() (builder/edit-overlay.js) generically attaches to every
 *      `<img>` had a real click handler, but no path to act on. Confirmed by
 *      reading onImageChangeRequest()/applySelectedImageFile(): with no
 *      resolvable path, a chosen file has nowhere in config to land.
 *   3. findPhotoPaths() (builder/app.js) only recognised `"type":"photos"`
 *      array fields and their itemShape-nested equivalent — never a single
 *      per-item scalar image leaf — so "Poze" had no section for the team at
 *      all, for existing members with a real photo or new ones without.
 *
 * FIX:
 *   - schema.json: `team.members` itemShape declares `photo` as `"image"`
 *     (the same type string top-level single-image fields like `logo` use),
 *     not `"text"`.
 *   - build.js: annotateEditableImageTag() stamps a direct
 *     `data-hb-edit-img="<fullPath>"` on any `<img>` whose `src` is a bare
 *     itemShape token inside an `@each` item, in edit mode — schema-blind
 *     (it doesn't care whether schema.json calls the field "image" or
 *     "text"), so builder/edit-overlay.js never has to infer a path from
 *     `src`/`alt` content again. When the resolved value is empty, the
 *     `src` attribute itself is omitted (never emitted as `src=""`) — no
 *     request the browser can fail, so no broken-image glyph; the
 *     template's own sizing CSS (targets the `<img>`, e.g.
 *     `aspect-ratio`/`width`) still reserves a real photo's footprint.
 *   - builder/edit-overlay.js: setupImages() reads `data-hb-edit-img` first
 *     (falling back to the old src-based resolution when absent, unchanged
 *     for every other image), and marks a resolved-but-empty slot with a
 *     neutral placeholder fill (`.hb-photo-empty`) plus an
 *     always-visible (not hover-only) replace button — nothing else on an
 *     empty card would otherwise hint it's clickable.
 *   - builder/app.js: findPhotoPaths()/resolveSchemaPhotoPath() recognise an
 *     itemShape leaf declared `"image"` and surface one path per EXISTING
 *     list item (`team.members.<i>.photo`, included even while still
 *     empty — same reasoning Suite 2 already established for `"photos"`
 *     arrays); buildGalleryModal() renders each via buildSingleImageSection
 *     (the same control hero.background/logo use) instead of the
 *     photos-array gallery UI; humanizePhotoPathLabel() labels each as
 *     "<section label> — <member name>" (e.g. "Echipă — Maria Ionescu"),
 *     the section label read from schema.pageSections, never hardcoded.
 *
 * PUBLISHED SITE (no photo): `@if photo` was already false → the whole
 * `.pf-person__pic` block (and its `<img>`) is omitted, same as every other
 * optional itemShape field on this template (role/bio) when empty — no new
 * "initials/monogram" placeholder was introduced, since no shipped template
 * has that convention anywhere today and inventing one here would be a new,
 * inconsistent visual language for a single field. A member who already HAS
 * a photo (existing customer drafts) is completely unaffected: the field
 * name/shape/storage did not change, only its schema type annotation.
 *
 * RED (pre-fix): a freshly-added team member's `<img>` has `src=""` (broken
 * glyph) and no `data-hb-edit-img`/resolvable path; "Poze" has no
 * `team.members.*` section at all, for old or new members.
 *
 * GREEN (post-fix): the new member's `<img>` has no `src` attribute, carries
 * `data-hb-edit-img="team.members.<n>.photo"`, and renders a same-size
 * neutral placeholder; clicking its replace control and picking a file lands
 * a real photo in `draft.config` and the live preview; "Poze" lists a
 * section per team member, addressable by `data-photo-path`; the published
 * render for a member without a photo contains no `<img` with an empty src.
 *
 * UPDATE 2026-10-28: the form editor (placeholder slot, "Înlocuiește fotografia"
 * control, the "Poze" modal, +Adaugă) was removed, so the browser tests of those
 * editor surfaces are gone. What stays is the published-output guarantee: a team
 * member without a photo renders no broken <img> and no picture block, and an
 * existing member's stored photo is untouched — checked on the real
 * /api/publish -> /live/<slug>/ output.
 *
 * Run: node --experimental-sqlite --test bot/test/suite11-team-member-photo.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startHarness, publishConfig } = require('./lib/old-template-live.js');

test('portfolio: published render for a team member without a photo has no broken <img>', async () => {
  const H = await startHarness('hidook-s11-team-photo');
  try {
    const { liveUrl } = await H.publish('portfolio', publishConfig('portfolio', (cfg) => {
      cfg.team = cfg.team || {};
      cfg.team.title = cfg.team.title || 'Echipa';
      cfg.team.members = [
        { name: 'Cu poză', role: 'Rol', bio: 'Bio', photo: 'images/existing-team-photo.jpg' },
        { name: 'Fără poză', role: '', bio: '', photo: '' },
      ];
    }));
    const res = await fetch(liveUrl);
    assert.equal(res.status, 200);
    const publishedHtml = await res.text();

    // The member WITH a photo must keep displaying it unmodified — no
    // migration that loses an existing customer's stored photo URL.
    assert.ok(publishedHtml.includes('images/existing-team-photo.jpg'), 'an existing team member\'s stored photo must still render unchanged on publish');

    // No <img> anywhere with an empty src on the published page.
    const brokenImgs = publishedHtml.match(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi) || [];
    assert.equal(brokenImgs.length, 0, 'published HTML must contain no <img> with an empty src, got: ' + JSON.stringify(brokenImgs));

    // The decision for a member without a photo is to omit the picture block
    // entirely (consistent with how this same template already hides other
    // empty optional itemShape fields — role/bio — rather than inventing a new
    // initials/monogram convention no shipped template uses anywhere today).
    const noPhotoIdx = publishedHtml.indexOf('Fără poză');
    assert.ok(noPhotoIdx > -1, 'the photo-less member\'s own name must still render');
    const surrounding = publishedHtml.slice(Math.max(0, noPhotoIdx - 400), noPhotoIdx);
    assert.ok(!/pf-person__pic/.test(surrounding), 'a member without a photo must render no picture container at all on publish');
  } finally {
    await H.close();
  }
});
