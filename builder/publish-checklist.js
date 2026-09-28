'use strict';
/**
 * builder/publish-checklist.js
 *
 * PLAN-UX-2026-09-27 §5.5 (Checklist de publicare, vizibil pe dashboard) +
 * §5.7 (marcarea textului de exemplu). A short, ADVISORY checklist — it
 * never blocks publishing (openPublishModal()'s own separate hard
 * required-fields gate in builder/app.js is unchanged) — shown in two
 * places: the publish modal's first step, and under each unpublished
 * draft's own card on the dashboard.
 *
 * Loaded as its own <script> (builder/index.html, after app.js) on purpose,
 * so this task never edits the wide stretches of app.js other tasks touch
 * the same day. It is still a classic (non-module) script sharing app.js's
 * global scope, so it calls app.js's own schema/completion helpers directly
 * — isFieldGenuinelyMade(), computeDemoTextPaths(), getAllSchemaFields(),
 * goToChecklistField(), loadSiteForEdit() — rather than re-implementing any
 * of them. That is the plan's own risk note for §5.5: the dashboard
 * checklist must read the exact same calculation the topbar pill already
 * uses, never a second source of truth. app.js's three completion functions
 * now take optional (config, tplData) overrides for exactly this reason —
 * see their doc comments there.
 */

// The one field key per checklist item, spelled identically in every one of
// the five shipped templates' schema.json (checked directly, not assumed —
// business.name / contact.phone / contact.whatsapp / hero.background /
// footer.address all carry `"identity": true` in product-menu, local-service,
// portfolio, professionals and desserdirina). A template that ever drops one
// of these simply loses that one checklist row (pcField() below returns
// null) instead of breaking the rest.
const PUBLISH_CHECKLIST_KEYS = {
  name:  'business.name',
  phone: ['contact.phone', 'contact.whatsapp'],
  photo: 'hero.background',
  legal: 'footer.address',
};

function pcField(schema, key) {
  return getAllSchemaFields(schema).find((f) => f.key === key) || null;
}

/**
 * Build the checklist for one (schema, config, tplData) triple. Called with
 * the active draft's own state for the publish modal, and with a dashboard
 * card's own fetched (schema, config, tplData) for a site that is NOT open
 * in the editor — same shape either way, so both surfaces always agree.
 * Returns null when there is nothing to compute from (template not loaded).
 */
function computePublishChecklist(schema, config, tplData) {
  if (!schema || !config) return null;
  const items = [];

  const nameField = pcField(schema, PUBLISH_CHECKLIST_KEYS.name);
  if (nameField) {
    items.push({
      id: 'name',
      label: 'Numele afacerii',
      done: isFieldGenuinelyMade(nameField, config, tplData),
      key: nameField.key,
    });
  }

  const phoneFields = PUBLISH_CHECKLIST_KEYS.phone.map((k) => pcField(schema, k)).filter(Boolean);
  if (phoneFields.length > 0) {
    items.push({
      id: 'phone',
      label: 'Telefon / WhatsApp',
      done: phoneFields.some((f) => isFieldGenuinelyMade(f, config, tplData)),
      key: phoneFields[0].key,
    });
  }

  const photoField = pcField(schema, PUBLISH_CHECKLIST_KEYS.photo);
  if (photoField) {
    items.push({
      id: 'photo',
      label: 'Poza principală (hero) — nu poza demo din șablon',
      done: isFieldGenuinelyMade(photoField, config, tplData),
      key: photoField.key,
    });
  }

  // §5.7: the count itself IS the checklist row here — not a single
  // done/not-done field. computeDemoTextPaths() is the exact same walk
  // edit-overlay.js's amber "text de exemplu" highlight is painted from.
  const demoPaths = computeDemoTextPaths(schema, config, tplData);
  items.push({
    id: 'demoText',
    label: demoPaths.length === 0
      ? 'Text de exemplu — niciun bloc rămas'
      : demoPaths.length + (demoPaths.length === 1 ? ' bloc cu text de exemplu' : ' blocuri cu text de exemplu'),
    done: demoPaths.length === 0,
    key: demoPaths[0] || null, // a data-hb-edit PATH, not a schema field key — see resolvePublishChecklistItem()
  });

  const legalField = pcField(schema, PUBLISH_CHECKLIST_KEYS.legal);
  if (legalField) {
    items.push({
      id: 'legal',
      label: 'Adresă / date de contact în subsol',
      done: isFieldGenuinelyMade(legalField, config, tplData),
      key: legalField.key,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Publish modal (step 1) — reads the active draft, same globals app.js's own
// checklist pill reads (currentTemplate, draft.config).
// ---------------------------------------------------------------------------

function renderPublishModalChecklist() {
  const box = $('publish-checklist');
  const list = $('publish-checklist-list');
  if (!box || !list) return;

  const schema = currentTemplate && currentTemplate.data && currentTemplate.data.schema;
  const items = (schema && draft.config) ? computePublishChecklist(schema, draft.config, currentTemplate.data) : null;
  if (!items || items.length === 0) {
    box.hidden = true;
    return;
  }

  list.innerHTML = '';
  items.forEach((item) => list.appendChild(buildPublishChecklistRow(item, resolvePublishChecklistItem)));
  box.hidden = false;
}

/** One <li> — shared markup builder for the modal's list; the dashboard
 * card uses its own, much smaller, single-line summary instead (see
 * renderDashboardCardChecklist() below) rather than this per-item list. */
function buildPublishChecklistRow(item, onFix) {
  const li = document.createElement('li');
  li.className = 'publish-checklist-item' + (item.done ? ' is-done' : ' is-pending');

  const icon = document.createElement('span');
  icon.className = 'publish-checklist-icon';
  icon.setAttribute('aria-hidden', 'true');
  li.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'publish-checklist-label';
  label.textContent = item.label;
  li.appendChild(label);

  if (!item.done && item.key) {
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'btn-ghost btn-sm publish-checklist-fix';
    fixBtn.textContent = 'Rezolvă';
    fixBtn.setAttribute('aria-label', 'Rezolvă: ' + item.label);
    fixBtn.addEventListener('click', () => onFix(item));
    li.appendChild(fixBtn);
  }

  return li;
}

/** Close the publish modal and land exactly where `item` can be fixed.
 * name/phone/photo/legal carry a real schema field key — goToChecklistField()
 * (app.js) is reused as-is, the same click target the topbar "what's
 * missing" menu already uses. demoText's own `key` is instead a
 * data-hb-edit canvas PATH (computeDemoTextPaths()'s own output), so it
 * goes straight to the canvas via sendFocusFieldToIframe() the same way
 * goToChecklistField()'s own non-drawer branch does. */
function resolvePublishChecklistItem(item) {
  if (!item || !item.key) return;
  closeModal('modal-publish');

  if (item.id === 'demoText') {
    if (drawerOpen) closeDrawer();
    sendFocusFieldToIframe(item.key);
    return;
  }

  const schema = currentTemplate && currentTemplate.data && currentTemplate.data.schema;
  const field = schema ? pcField(schema, item.key) : null;
  if (field) goToChecklistField(field);
}

// ---------------------------------------------------------------------------
// Dashboard card — an unpublished draft's own checklist count. The site row
// from GET /api/sites carries no config (only the version store does), so
// this fetches the one site's latest config the same way "Editează" already
// does (GET /api/sites/:id) — best-effort, never blocks or breaks the card.
// ---------------------------------------------------------------------------

/** `info` is the card's own .site-card-info column (buildSiteCard(), app.js)
 * — the checklist line lands there, right under the hosting/dunning lines
 * already appended to it. Caller already checked this is an unpublished
 * draft card (badgeClass === 'status-draft'); this only re-checks it has
 * enough to fetch from. */
function attachDashboardCardChecklist(info, site) {
  if (!info || !site || !site.id || !site.templateId) return;

  const holder = document.createElement('div');
  holder.className = 'site-card-checklist';
  holder.setAttribute('aria-live', 'polite');
  info.appendChild(holder);

  Promise.all([
    ensureTemplateLoaded(site.templateId).catch(() => null),
    apiGet('/api/sites/' + encodeURIComponent(site.id)).catch(() => null),
  ]).then(([tplData, data]) => {
    if (!tplData || !tplData.schema || !data || !data.config) {
      holder.remove(); // best-effort only — an empty draft slot with nothing saved yet, or a fetch error
      return;
    }
    const items = computePublishChecklist(tplData.schema, data.config, tplData);
    if (!items || items.length === 0) { holder.remove(); return; }
    renderDashboardCardChecklist(holder, site, items);
  }).catch(() => holder.remove());
}

function renderDashboardCardChecklist(holder, site, items) {
  holder.innerHTML = '';
  const done = items.filter((it) => it.done).length;
  const total = items.length;

  const count = document.createElement('span');
  count.className = 'site-card-checklist-count';
  count.textContent = done === total
    ? 'Pregătit de publicat (' + total + '/' + total + ')'
    : done + '/' + total + ' pregătit de publicare';
  holder.appendChild(count);

  const firstMissing = items.find((it) => !it.done && it.key);
  if (firstMissing) {
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'btn-ghost btn-sm site-card-checklist-fix';
    fixBtn.textContent = 'Rezolvă';
    fixBtn.setAttribute('aria-label', 'Rezolvă: ' + firstMissing.label);
    fixBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // loadSiteForEdit()'s focusFieldKey only drives openDrawer() (app.js),
      // which falls back to the drawer's first field when the key has no
      // drawer row of its own (a canvas-only field, or demoText's own
      // data-hb-edit path) — never a dead click, always lands the owner
      // inside THIS site's editor.
      loadSiteForEdit(site.id, firstMissing.key);
    });
    holder.appendChild(fixBtn);
  }
}
