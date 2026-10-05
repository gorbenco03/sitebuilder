'use strict';
/**
 * builder/add-section.js
 *
 * T-1A (PLAN-UX-2026-09-27 §5.2 — "Bibliotecă minimă de secțiuni opționale").
 * The "Adaugă o secțiune" catalog: a modal listing whichever of the current
 * template's optional blocks (templates/<id>/schema.json pageSections[]
 * entries carrying `addable: true`, plus `description` and `seed` — the
 * contract shared with the parallel schema tasks) are not on the page yet.
 *
 * Loaded as its own <script> (builder/index.html, after app.js) — a classic
 * (non-module) script sharing app.js's global scope, same pattern as
 * builder/onboarding.js and builder/publish-checklist.js. It calls app.js's
 * own helpers directly ($(...), escHtml(), openModal()/closeModal(),
 * showToast(), stateBlockHTML()) rather than reimplementing any of them, and
 * app.js's own new, minimal data hooks for this feature —
 * getAddableSectionDefs(schema) and hidookAddSection(schema, id) — rather
 * than touching draft.config directly. Everything about "the section is now
 * a normal section" (reorder, hide, undo) is the SAME pre-existing page-
 * sections machinery (builder/app.js §14b) hidookAddSection() plugs into;
 * this file owns only the catalog UI on top of it.
 *
 * The modal itself (#modal-add-section, builder/index.html) follows the
 * shared modal contract (bot/test/suite4-modal-contract.test.js) — its
 * backdrop-click/Escape/focus-trap are already generic in app.js (it
 * enumerates `.modal-overlay[role="dialog"]` from the live DOM), so this
 * file only wires its own trigger buttons and its one .modal-close.
 */

/** One catalog card's markup for an addable section def
 * ({id, label, description, seed}, from schema.pageSections). `description`
 * is optional in the shared contract — a def missing it just renders with
 * no second line, rather than an empty paragraph. */
function addSectionCardHtml(def) {
  const label = def.label || def.id;
  return '<div class="add-section-card">'
    + '<div class="add-section-card__body">'
    + '<p class="add-section-card__label">' + escHtml(label) + '</p>'
    + (def.description ? '<p class="add-section-card__desc">' + escHtml(def.description) + '</p>' : '')
    + '</div>'
    + '<button type="button" class="btn-primary add-section-card__btn" data-add-section-id="' + escHtml(def.id) + '">Adaugă</button>'
    + '</div>';
}

/** Re-renders #add-section-modal-body from the CURRENT draft state — called
 * every time the modal opens, never cached, so a section added in one visit
 * is correctly absent from the list the next time the modal opens without a
 * page reload. */
function renderAddSectionModal(schema) {
  const body = $('add-section-modal-body');
  if (!body) return;
  const defs = (typeof getAddableSectionDefs === 'function') ? getAddableSectionDefs(schema) : [];

  if (!defs.length) {
    // U-08 empty-state pattern (app.js's stateBlockHTML) — friendly Romanian
    // copy, not a bare "nothing here". Falls back to a plain paragraph only
    // if stateBlockHTML somehow isn't loaded (defensive, should not happen).
    body.innerHTML = (typeof stateBlockHTML === 'function')
      ? stateBlockHTML({
          icon: 'tray',
          title: 'Nimic de adăugat',
          desc: 'Toate secțiunile disponibile pentru acest design sunt deja pe pagină.',
        })
      : '<p>Toate secțiunile disponibile pentru acest design sunt deja pe pagină.</p>';
    return;
  }

  body.innerHTML = defs.map(addSectionCardHtml).join('');
  body.querySelectorAll('[data-add-section-id]').forEach((btn) => {
    btn.addEventListener('click', () => onAddSectionCardClick(schema, btn.getAttribute('data-add-section-id'), btn));
  });
}

/** A catalog card's own "Adaugă" click: applies the seed, shows the
 * section, records one undo step and scrolls the preview to it (all inside
 * hidookAddSection() — app.js §14b/§14c), then closes the modal and toasts
 * in Romanian. On failure (stale id — e.g. two tabs adding the same section
 * at once) the modal stays open with an error toast instead of silently
 * doing nothing, and the button is re-enabled so the customer isn't stuck. */
function onAddSectionCardClick(schema, id, btn) {
  if (btn) btn.disabled = true;
  presetSeedFromOwnData(schema, id);
  const def = (typeof hidookAddSection === 'function') ? hidookAddSection(schema, id) : null;
  if (!def) {
    if (btn) btn.disabled = false;
    showToast('Nu am putut adăuga secțiunea — reîncearcă.', 'error');
    return;
  }
  closeModal('modal-add-section');
  showToast('Secțiunea „' + (def.label || def.id) + '” a fost adăugată.', 'success');
}

/** `seedFrom` ({ "<target path>": "<source path>" }, schema.pageSections[])
 * starts a seeded field from the owner's own data instead of the fixed
 * sample — today "Unde ne găsești" takes contact.address, so an added
 * section never shows another city. Runs only for a still-pending section
 * and only into a field that is empty; hidookAddSection() fills the rest. */
function presetSeedFromOwnData(schema, id) {
  if (typeof getAddableSectionDefs !== 'function' || typeof getPath !== 'function' || typeof setPath !== 'function') return;
  if (!draft || !draft.config) return;
  const def = getAddableSectionDefs(schema).find((d) => d && d.id === id);
  if (!def || !def.seedFrom || typeof def.seedFrom !== 'object') return;
  Object.keys(def.seedFrom).forEach((target) => {
    const own = getPath(draft.config, def.seedFrom[target]);
    const cur = getPath(draft.config, target);
    if (typeof own === 'string' && own.trim() !== '' && (cur === undefined || cur === null || cur === '')) {
      setPath(draft.config, target, own.trim());
    }
  });
}

/** Walks the leaves of a schema seed in data-hb-edit path form
 * ("faq.items.0.q"), calling fn(path, value) for each string leaf. */
function walkSeedLeaves(node, prefix, fn) {
  if (typeof node === 'string') { if (prefix) fn(prefix, node); return; }
  if (Array.isArray(node)) { node.forEach((v, i) => walkSeedLeaves(v, prefix ? prefix + '.' + i : String(i), fn)); return; }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => walkSeedLeaves(node[k], prefix ? prefix + '.' + k : k, fn));
  }
}

/** data-hb-edit paths of content a customer added through "Adaugă o
 * secțiune" that is STILL the starter sample (seed value, or the demo value
 * of its seedFrom source) — computeDemoTextPaths() appends these, so the
 * canvas tint and the publish checklist count them like template sample
 * text. Only sections that are currently on the page count; headings are
 * generic structure and never flagged. */
function seededSectionDemoPaths(schema, config, preset) {
  const out = [];
  if (!schema || !Array.isArray(schema.pageSections) || !config || !Array.isArray(config.sections)) return out;
  schema.pageSections.forEach((def) => {
    if (!def || def.addable !== true || !def.seed || typeof def.seed !== 'object') return;
    const entry = config.sections.find((e) => e && e.id === def.id);
    if (!entry || entry.removed === true || entry.pending === true) return;
    const from = (def.seedFrom && typeof def.seedFrom === 'object') ? def.seedFrom : {};
    walkSeedLeaves(def.seed, '', (path, seedVal) => {
      if (/title$/i.test(path.split('.').pop())) return;
      const cur = getPath(config, path);
      const demoFrom = (from[path] && preset) ? getPath(preset, from[path]) : undefined;
      if (isSameDemoString(cur, seedVal) || isSameDemoString(cur, demoFrom)) out.push(path);
    });
  });
  return out;
}

/** Entry point — the trigger buttons below both call this directly
 * (openModal() itself records document.activeElement as the opener, so
 * whichever of the two real buttons was actually clicked is what focus
 * returns to on close). No-ops (no-op, no toast) if no template is loaded
 * yet — the trigger buttons only exist inside the editor, so this should be
 * unreachable in practice. */
function hidookOpenAddSectionModal() {
  const schema = (typeof currentTemplate !== 'undefined' && currentTemplate && currentTemplate.data && currentTemplate.data.schema) || null;
  if (!schema) return;
  renderAddSectionModal(schema);
  openModal('modal-add-section');
}

(function wireAddSectionTriggers() {
  const railBtn = $('btn-open-add-section');
  if (railBtn) railBtn.addEventListener('click', hidookOpenAddSectionModal);
  const closeBtn = $('btn-close-add-section');
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal('modal-add-section'));
})();
