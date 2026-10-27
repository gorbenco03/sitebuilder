'use strict';
/**
 * prototype/blocks/editor.js — block editor prototype (vanilla, no deps).
 *
 * Site = { pack, theme, header, footer, pages: [{ id, name, slug, blocks }], current }.
 * Header and footer are shared by every page; each page owns its blocks.
 * Canvas = same-origin iframe rendered at a real device width and scaled to
 * fit; editor chrome inside it is counter-scaled. Text is edited in place
 * (contenteditable, with bold/italic/links on a selection); everything else
 * lives in the inspector. State persists to localStorage; undo/redo keeps
 * JSON snapshots.
 */

const { BLOCKS, THEMES, SIZE_STEPS, makeBlock, makePage, defaultSite, slugify, themeCss, renderBlock, pageBlocks, siteCtx, elementCss, renderPage, rich, esc, newId } = window.SB;
const PACKS = window.SB_PACKS;
const STORE = 'sb-proto-site-v2';
const $ = (id) => document.getElementById(id);

let site = load();
let selId = null;
let history = [JSON.stringify(site)];
let hIndex = 0;
let insertAt = null;
let libCat = 'Toate';
let pendingImage = null;
let textTimer = null;
let editing = null;      // { el, id, path, rich }
let savedRange = null;   // selection kept while the link field has focus
let dragBlockId = null;  // block being moved on the canvas
let dragNew = null;      // { type, variant } dragged in from the Adaugă panel
let dropLine = null;
let renamingPage = null;

/* ---------- state ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 2 && s.pages && s.pages.length) return s;
    }
  } catch (_) { /* fall through */ }
  return defaultSite('restaurant');
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(site));
    $('saved').textContent = 'Salvat';
  } catch (_) {
    $('saved').textContent = 'Nu s-a putut salva (poze prea mari)';
  }
}

function commit() {
  const snap = JSON.stringify(site);
  if (snap === history[hIndex]) return;
  history = history.slice(0, hIndex + 1);
  history.push(snap);
  if (history.length > 120) history.shift();
  hIndex = history.length - 1;
  save();
  syncUndo();
}

function restore(i) {
  hIndex = i;
  site = JSON.parse(history[hIndex]);
  if (!curPage()) site.current = site.pages[0].id;
  if (selId && !findBlock(selId)) selId = null;
  save();
  renderAll();
}

function syncUndo() {
  $('undo').disabled = hIndex <= 0;
  $('redo').disabled = hIndex >= history.length - 1;
}

function curPage() { return site.pages.find((p) => p.id === site.current); }
function findBlock(id) {
  if (site.header.id === id) return site.header;
  if (site.footer.id === id) return site.footer;
  for (const p of site.pages) { const b = p.blocks.find((x) => x.id === id); if (b) return b; }
  return null;
}
function isShared(id) { return site.header.id === id || site.footer.id === id; }
function indexOf(id) { return curPage().blocks.findIndex((b) => b.id === id); }

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}
function hasMarkup(v) { return /<[a-z]/i.test(String(v || '')); }
function plain(v) { const d = document.createElement('div'); d.innerHTML = String(v || ''); return d.textContent; }

/* ---------- canvas ---------- */

const EDITOR_CSS = `
.blk{position:relative}
.blk:hover{outline:2px solid rgba(36,56,214,.35);outline-offset:-2px}
.blk.is-sel{outline:2px solid #2438d6;outline-offset:-2px}
[data-f]{border-radius:3px}
[data-f]:hover{box-shadow:0 0 0 1px rgba(36,56,214,.55)}
[data-f][contenteditable="true"]{outline:2px solid #2438d6;outline-offset:3px;cursor:text;box-shadow:none}
[data-img]{cursor:pointer}
[data-img]:hover{filter:brightness(.88)}
.b-nav__links a{cursor:pointer}
.ed-label{position:absolute;top:0;left:0;z-index:40;display:none;background:#2438d6;color:#fff;font:600 12px/1 -apple-system,Helvetica,Arial,sans-serif;padding:6px 9px;border-radius:0 0 6px 0}
.blk:hover>.ed-label,.blk.is-sel>.ed-label{display:block}
.ed-tools{position:absolute;top:10px;right:10px;z-index:41;display:flex;gap:4px;background:#fff;border-radius:10px;padding:4px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.ed-tools button{font:600 13px -apple-system,Helvetica,Arial,sans-serif;color:#15171c;background:#fff;border:0;border-radius:7px;min-width:34px;height:34px;padding:0 9px;cursor:pointer}
.ed-tools button:hover{background:#eef1ff}
.ed-tools .ed-del{color:#b42318}
.ed-add{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%);z-index:42;opacity:0;transition:opacity .15s}
.blk:hover>.ed-add,.blk.is-sel>.ed-add{opacity:1}
.ed-add button{font:600 13px -apple-system,Helvetica,Arial,sans-serif;background:#2438d6;color:#fff;border:0;border-radius:999px;height:34px;padding:0 14px;box-shadow:0 4px 14px rgba(36,56,214,.45);cursor:pointer}
.b-attr{user-select:none}
.ed-label,.ed-tools,.ed-add,.ed-tt{zoom:var(--ed-z,1)}
.ed-drag{cursor:grab}
body.is-editing .ed-tools{display:none}
.ed-drop{position:absolute;left:0;right:0;height:4px;background:#2438d6;z-index:60;pointer-events:none;box-shadow:0 0 0 3px rgba(36,56,214,.25)}
.blk.is-dragging{opacity:.35}
.ed-tt{position:absolute;z-index:70;display:flex;flex-wrap:wrap;align-items:center;gap:2px;background:#15171c;color:#fff;border-radius:10px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:600 12px -apple-system,Helvetica,Arial,sans-serif;max-width:600px}
.ed-tt button{background:transparent;color:#fff;border:0;border-radius:6px;min-width:30px;height:30px;padding:0 7px;cursor:pointer;font:inherit;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.ed-tt button:hover,.ed-tt button[aria-pressed="true"]{background:#2e323b}
.ed-tt .sep{width:1px;height:20px;background:#3a3f4a;margin:0 3px}
.ed-tt .dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.ed-tt .hint{opacity:.7;font-weight:500;padding:0 6px}
.ed-tt input{font:500 13px -apple-system,Helvetica,Arial,sans-serif;width:220px;height:30px;border-radius:6px;border:0;padding:0 8px}
@media(max-width:720px){html .blk[data-hidem]{display:block!important;opacity:.4}}
`;

const frame = $('canvas');
let doc = null;

function initFrame() {
  frame.srcdoc = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="theme"></style><style>${EDITOR_CSS}</style></head><body><main id="root"></main></body></html>`;
  frame.addEventListener('load', () => {
    doc = frame.contentDocument;
    bindFrame();
    renderAll();
    fitFrame();
  }, { once: true });
}

function renderTheme() { if (doc) doc.getElementById('theme').textContent = themeCss(site.theme); }

function decorate(el, b) {
  const def = BLOCKS[b.type];
  const shared = isShared(b.id);
  const label = doc.createElement('div');
  label.className = 'ed-label';
  label.textContent = def.label + ' · ' + def.variants[b.variant] + (shared ? ' · pe toate paginile' : '');
  el.appendChild(label);
  if (b.id === selId) {
    el.classList.add('is-sel');
    const tools = doc.createElement('div');
    tools.className = 'ed-tools';
    const many = Object.keys(def.variants).length > 1;
    tools.innerHTML =
      (shared ? '' : `<button type="button" class="ed-drag" draggable="true" title="Trage ca să muți blocul">⠿ Trage</button>`) +
      (many ? `<button type="button" data-act="variant" title="Schimbă aspectul">Aspect ↻</button>` : '') +
      (shared ? '' : `<button type="button" data-act="up" title="Mută sus">↑</button><button type="button" data-act="down" title="Mută jos">↓</button><button type="button" data-act="dup" title="Duplică (Cmd+D)">Duplică</button><button type="button" data-act="del" class="ed-del" title="Șterge (Delete)">Șterge</button>`);
    if (tools.innerHTML) el.appendChild(tools);
  }
  if (b.id !== site.footer.id) {
    const add = doc.createElement('div');
    add.className = 'ed-add';
    add.innerHTML = '<button type="button" data-act="add">+ Adaugă bloc aici</button>';
    el.appendChild(add);
  }
}

function renderCanvas() {
  if (!doc) return;
  renderTheme();
  const ctx = siteCtx(site, site.current);
  const root = doc.getElementById('root');
  editing = null;
  doc.body.classList.remove('is-editing');
  doc.querySelectorAll('.ed-tt, .ed-drop').forEach((x) => x.remove());
  root.innerHTML = pageBlocks(site, site.current).map((b) => renderBlock(b, ctx)).join('');
  root.querySelectorAll('.blk').forEach((el) => decorate(el, findBlock(el.dataset.id)));
}

function rerenderBlock(id) {
  if (!doc) return;
  const b = findBlock(id);
  const old = doc.querySelector(`.blk[data-id="${id}"]`);
  if (!b || !old) return renderCanvas();
  const tmp = doc.createElement('div');
  tmp.innerHTML = renderBlock(b, siteCtx(site, site.current));
  const el = tmp.firstElementChild;
  old.replaceWith(el);
  decorate(el, b);
}

function scrollToBlock(id) {
  const el = doc && doc.querySelector(`.blk[data-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function isTyping(target) {
  const a = target && (target.ownerDocument || document).activeElement;
  return !!(a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName)));
}

function bindFrame() {
  doc.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ed-tt') && !e.target.closest('input')) e.preventDefault();
  });

  doc.addEventListener('click', (e) => {
    if (e.target.closest('.ed-tt')) return textToolAction(e);
    const pageLink = e.target.closest('[data-page]');
    if (pageLink) { e.preventDefault(); switchPage(pageLink.dataset.page); return; }
    const a = e.target.closest('a');
    if (a) e.preventDefault();
    if (a && editing && editing.el.contains(a) && editing.el !== a) return;
    const blk = e.target.closest('.blk');
    if (!blk) return;
    const id = blk.dataset.id;

    const act = e.target.closest('[data-act]');
    if (act) { e.preventDefault(); return blockAction(id, act.dataset.act); }

    const im = e.target.closest('[data-img]');
    if (im) { select(id); openPicker({ id, path: im.dataset.img }); return; }

    const f = e.target.closest('[data-f]');
    if (selId !== id) select(id, { keepCanvas: !!f });
    if (f) startEdit(f, id);
  });

  doc.addEventListener('input', (e) => {
    if (e.target.closest('.ed-tt')) return;
    const f = e.target.closest('[data-f]');
    const blk = e.target.closest('.blk');
    if (!f || !blk) return;
    const b = findBlock(blk.dataset.id);
    setPath(b.data, f.dataset.f, f.hasAttribute('data-rich') ? rich(f.innerHTML) : f.textContent);
    $('saved').textContent = 'Se salvează…';
    clearTimeout(textTimer);
    textTimer = setTimeout(() => { commit(); syncInspectorValues(); }, 500);
    placeTextTools();
  });

  doc.addEventListener('paste', (e) => {
    if (!editing) return;
    e.preventDefault();
    doc.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
  });

  doc.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('.ed-tt input')) {
      if (e.key === 'Enter') { e.preventDefault(); applyLink(e.target.value); }
      if (e.key === 'Escape') { e.preventDefault(); showTextTools(); if (editing) editing.el.focus(); }
      return;
    }
    const f = e.target.closest && e.target.closest('[data-f]');
    if (f && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.blur(); }
    if (f && e.key === 'Escape') f.blur();
    shortcuts(e);
  });

  doc.addEventListener('focusout', (e) => {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f) return;
    const to = e.relatedTarget;
    if (to && to.closest && to.closest('.ed-tt')) return;
    endEdit();
  });

  doc.addEventListener('selectionchange', () => { if (editing) markSelectionTools(); });
  doc.addEventListener('toggle', (e) => { if (e.target.matches('details')) e.target.open = true; }, true);

  doc.addEventListener('dragstart', (e) => {
    const h = e.target.closest && e.target.closest('.ed-drag');
    if (!h) return;
    const blk = h.closest('.blk');
    dragBlockId = blk.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragBlockId);
    try { e.dataTransfer.setDragImage(blk, 40, 20); } catch (_) { /* optional */ }
    setTimeout(() => blk.classList.add('is-dragging'), 0);
  });
  doc.addEventListener('dragover', (e) => {
    if (!dragBlockId && !dragNew) return;
    const blk = e.target.closest && e.target.closest('.blk');
    if (!blk) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragNew ? 'copy' : 'move';
    const r = blk.getBoundingClientRect();
    let after = e.clientY > r.top + r.height / 2;
    if (blk.dataset.id === site.header.id) after = true;
    if (blk.dataset.id === site.footer.id) after = false;
    if (!dropLine) { dropLine = doc.createElement('div'); dropLine.className = 'ed-drop'; doc.body.appendChild(dropLine); }
    dropLine.style.top = (doc.defaultView.scrollY + (after ? r.bottom : r.top) - 2) + 'px';
    dropLine.dataset.target = blk.dataset.id;
    dropLine.dataset.after = after ? '1' : '';
  });
  doc.addEventListener('drop', (e) => {
    if ((!dragBlockId && !dragNew) || !dropLine) return;
    e.preventDefault();
    const t = dropLine.dataset.target;
    const after = !!dropLine.dataset.after;
    const blocks = curPage().blocks;
    let to = t === site.header.id ? 0 : t === site.footer.id ? blocks.length : indexOf(t) + (after ? 1 : 0);
    if (dragNew) {
      const nb = dragNew;
      clearDrag();
      insertBlock(nb.type, nb.variant, to);
      return;
    }
    const from = indexOf(dragBlockId);
    if (to > from) to -= 1;
    clearDrag();
    if (to !== from && from >= 0) move(from, to);
  });
  doc.addEventListener('dragend', clearDrag);
}

function clearDrag() {
  dragBlockId = null;
  dragNew = null;
  if (dropLine) { dropLine.remove(); dropLine = null; }
  if (doc) doc.querySelectorAll('.is-dragging').forEach((x) => x.classList.remove('is-dragging'));
}

/* ---------- text editing ---------- */

function startEdit(el, id) {
  if (el.getAttribute('contenteditable') === 'true') return;
  if (editing && editing.el !== el) endEdit();
  el.setAttribute('contenteditable', 'true');
  editing = { el, id, path: el.dataset.f, rich: el.hasAttribute('data-rich') };
  doc.body.classList.add('is-editing');
  el.focus();
  const sel = doc.getSelection();
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  showTextTools();
}

function endEdit() {
  if (!editing) return;
  editing.el.removeAttribute('contenteditable');
  editing = null;
  savedRange = null;
  doc.body.classList.remove('is-editing');
  const tt = doc.querySelector('.ed-tt');
  if (tt) tt.remove();
  clearTimeout(textTimer);
  commit();
  syncInspectorValues();
}

function hasSelection() {
  if (!editing) return false;
  const sel = doc.getSelection();
  return sel.rangeCount > 0 && !sel.isCollapsed && editing.el.contains(sel.getRangeAt(0).commonAncestorContainer);
}

const ICON = {
  left: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M2 8h8M2 12h10"/></svg>',
  center: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M4 8h8M3 12h10"/></svg>',
  right: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4h12M6 8h8M4 12h10"/></svg>',
};

function elStyle(create) {
  const b = findBlock(editing.id);
  b.el = b.el || {};
  if (create && !b.el[editing.path]) b.el[editing.path] = {};
  return b.el[editing.path] || {};
}

function showTextTools() {
  const old = doc.querySelector('.ed-tt');
  if (old) old.remove();
  if (!editing) return;
  const s = elStyle(false);
  const isButton = editing.el.tagName === 'A';
  const tt = doc.createElement('div');
  tt.className = 'ed-tt';
  tt.innerHTML =
    `<button type="button" data-tt="align" data-v="left" aria-pressed="${s.align === 'left'}" title="Aliniere stânga">${ICON.left}</button>` +
    `<button type="button" data-tt="align" data-v="center" aria-pressed="${s.align === 'center'}" title="Centrat">${ICON.center}</button>` +
    `<button type="button" data-tt="align" data-v="right" aria-pressed="${s.align === 'right'}" title="Aliniere dreapta">${ICON.right}</button>` +
    `<span class="sep"></span>` +
    `<button type="button" data-tt="size" data-v="-1" title="Text mai mic">A−</button>` +
    `<button type="button" data-tt="size" data-v="1" title="Text mai mare">A+</button>` +
    `<span class="sep"></span>` +
    `<button type="button" data-tt="bold" data-whole="${s.bold === true}" title="Îngroșat — pe cuvintele selectate sau pe tot textul"><b>B</b></button>` +
    `<button type="button" data-tt="italic" data-whole="${!!s.italic}" title="Cursiv — pe cuvintele selectate sau pe tot textul"><i>I</i></button>` +
    (editing.rich || isButton ? `<button type="button" data-tt="link" title="${isButton ? 'Unde duce butonul' : 'Pune un link pe textul selectat'}">Link</button>` : '') +
    `<span class="sep"></span>` +
    `<button type="button" data-tt="color" data-v="accent" aria-pressed="${s.color === 'accent'}" title="Culoarea de accent"><span class="dot" style="background:var(--accent)"></span>Accent</button>` +
    `<button type="button" data-tt="color" data-v="muted" aria-pressed="${s.color === 'muted'}" title="Mai estompat"><span class="dot" style="background:#888"></span>Estompat</button>` +
    `<span class="sep"></span>` +
    `<button type="button" data-tt="hide" title="Ascunde elementul (îl readuci din panoul din dreapta)">Ascunde</button>` +
    `<button type="button" data-tt="reset" title="Revino la stilul designului">↺</button>`;
  doc.body.appendChild(tt);
  markSelectionTools();
  placeTextTools();
}

/** B / I show as pressed for the whole element, or for the selection when there is one. */
function markSelectionTools() {
  const tt = doc.querySelector('.ed-tt');
  if (!tt || !editing) return;
  const sel = hasSelection();
  tt.querySelectorAll('[data-tt="bold"],[data-tt="italic"]').forEach((b) => {
    const on = sel ? doc.queryCommandState(b.dataset.tt) : b.dataset.whole === 'true';
    b.setAttribute('aria-pressed', String(on));
  });
}

function placeTextTools() {
  const tt = doc && doc.querySelector('.ed-tt');
  if (!tt || !editing) return;
  const z = parseFloat(doc.documentElement.style.getPropertyValue('--ed-z')) || 1;
  const r = editing.el.getBoundingClientRect();
  const tr = tt.getBoundingClientRect();
  const sy = doc.defaultView.scrollY;
  const w = doc.documentElement.clientWidth;
  let top = r.top + sy - tr.height - 10 * z;
  if (r.top - tr.height - 10 * z < 0) top = r.bottom + sy + 10 * z;
  const left = Math.max(8, Math.min(r.left, w - tr.width - 8));
  tt.style.top = (top / z) + 'px';
  tt.style.left = (left / z) + 'px';
}

function refreshBlockCss(b) {
  const el = doc.querySelector(`.blk[data-id="${b.id}"]`);
  if (!el) return;
  let st = el.querySelector(':scope > style');
  if (!st) { st = doc.createElement('style'); el.prepend(st); }
  st.textContent = elementCss(b);
}

function saveRich() {
  const b = findBlock(editing.id);
  setPath(b.data, editing.path, rich(editing.el.innerHTML));
}

function textToolAction(e) {
  const btnEl = e.target.closest('button');
  if (!btnEl || !editing) return;
  const b = findBlock(editing.id);
  const kind = btnEl.dataset.tt;

  if ((kind === 'bold' || kind === 'italic') && editing.rich && hasSelection()) {
    doc.execCommand(kind);
    saveRich();
    commit();
    markSelectionTools();
    return;
  }
  if (kind === 'link') {
    const isButton = editing.el.tagName === 'A';
    if (!isButton && !hasSelection()) {
      btnEl.outerHTML = '<span class="hint">Selectează întâi cuvintele pe care pui linkul</span>';
      return;
    }
    if (!isButton) savedRange = doc.getSelection().getRangeAt(0).cloneRange();
    const current = isButton ? (elStyle(false).href || '') : '';
    btnEl.outerHTML = `<input type="url" placeholder="https://…, tel:… sau #contact" value="${esc(current)}">`;
    doc.querySelector('.ed-tt input').focus();
    placeTextTools();
    return;
  }

  const s = elStyle(true);
  if (kind === 'align') s.align = s.align === btnEl.dataset.v ? undefined : btnEl.dataset.v;
  if (kind === 'bold') s.bold = s.bold === true ? false : true;
  if (kind === 'italic') s.italic = !s.italic;
  if (kind === 'color') s.color = s.color === btnEl.dataset.v ? undefined : btnEl.dataset.v;
  if (kind === 'size') {
    const cur = parseFloat(doc.defaultView.getComputedStyle(editing.el).fontSize);
    const dir = Number(btnEl.dataset.v);
    const next = dir > 0 ? SIZE_STEPS.find((x) => x > cur + 0.5) : [...SIZE_STEPS].reverse().find((x) => x < cur - 0.5);
    if (next) s.size = next;
  }
  if (kind === 'reset') { const href = s.href; b.el[editing.path] = href ? { href } : {}; }
  if (kind === 'hide') {
    s.hidden = true;
    refreshBlockCss(b);
    endEdit();
    renderInspector();
    return;
  }
  refreshBlockCss(b);
  commit();
  showTextTools();
  editing.el.focus();
}

function applyLink(value) {
  if (!editing) return;
  const url = value.trim();
  if (editing.el.tagName === 'A') {
    const s = elStyle(true);
    s.href = url || undefined;
    editing.el.setAttribute('href', s.href || '#');
  } else if (savedRange) {
    editing.el.focus();
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    doc.execCommand(url ? 'createLink' : 'unlink', false, url || undefined);
    savedRange = null;
    saveRich();
  }
  commit();
  showTextTools();
  editing.el.focus();
}

/* ---------- blocks ---------- */

function select(id, opts = {}) {
  selId = id;
  renderList();
  renderInspector();
  if (!opts.keepCanvas) { renderCanvas(); return; }
  doc.querySelectorAll('.blk').forEach((el) => {
    el.classList.remove('is-sel');
    el.querySelectorAll(':scope > .ed-tools').forEach((x) => x.remove());
  });
  const el = doc.querySelector(`.blk[data-id="${id}"]`);
  if (el) {
    el.querySelectorAll(':scope > .ed-label, :scope > .ed-add').forEach((x) => x.remove());
    decorate(el, findBlock(id));
  }
}

function deselect() {
  selId = null;
  renderList();
  renderInspector();
  renderCanvas();
}

function blockAction(id, act) {
  const b = findBlock(id);
  if (!b) return;
  if (act === 'add') { openLibrary(id === site.header.id ? 0 : indexOf(id) + 1); return; }
  if (act === 'variant') {
    const vs = Object.keys(BLOCKS[b.type].variants);
    b.variant = vs[(vs.indexOf(b.variant) + 1) % vs.length];
    commit(); renderList(); renderInspector(); rerenderBlock(id);
    return;
  }
  if (isShared(id)) return;
  const blocks = curPage().blocks;
  const i = indexOf(id);
  if (act === 'up' && i > 0) { move(i, i - 1); return; }
  if (act === 'down' && i < blocks.length - 1) { move(i, i + 1); return; }
  if (act === 'dup') {
    const copy = JSON.parse(JSON.stringify(b));
    copy.id = newId();
    blocks.splice(i + 1, 0, copy);
    selId = copy.id;
    commit(); renderAll(); scrollToBlock(copy.id);
    return;
  }
  if (act === 'del') {
    blocks.splice(i, 1);
    selId = null;
    commit(); renderAll();
  }
}

function move(from, to) {
  const blocks = curPage().blocks;
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b);
  commit(); renderAll(); scrollToBlock(b.id);
}

function insertBlock(type, variant, at) {
  const b = makeBlock(type, variant, site.pack);
  curPage().blocks.splice(at, 0, b);
  selId = b.id;
  commit(); renderAll();
  setTimeout(() => scrollToBlock(b.id), 60);
}

/* ---------- pages ---------- */

function switchPage(pageId) {
  if (!site.pages.find((p) => p.id === pageId) || pageId === site.current) return;
  site.current = pageId;
  selId = null;
  save();
  renderAll();
  if (doc) doc.defaultView.scrollTo(0, 0);
}

function renderPages() {
  $('page-list').innerHTML = site.pages.map((p, i) => {
    if (renamingPage === p.id) return `<li class="is-cur"><input id="rename-input" value="${esc(p.name)}" aria-label="Numele paginii"></li>`;
    return `<li data-page="${p.id}" class="${p.id === site.current ? 'is-cur' : ''}"><span class="pname">${esc(p.name)}</span><span class="pactions"><button type="button" data-rename="${p.id}" title="Redenumește">✎</button>${i === 0 ? '' : `<button type="button" data-delpage="${p.id}" title="Șterge pagina">×</button>`}</span></li>`;
  }).join('');
  $('cur-page-name').textContent = '„' + curPage().name + '”';
  const inp = $('rename-input');
  if (inp) { inp.focus(); inp.select(); }
}

function finishRename(value) {
  const p = site.pages.find((x) => x.id === renamingPage);
  renamingPage = null;
  if (p && value.trim()) { p.name = value.trim(); p.slug = slugify(p.name); commit(); }
  renderPages();
  renderCanvas();
}

$('page-list').addEventListener('click', (e) => {
  const r = e.target.closest('[data-rename]');
  if (r) { renamingPage = r.dataset.rename; renderPages(); return; }
  const d = e.target.closest('[data-delpage]');
  if (d) {
    const p = site.pages.find((x) => x.id === d.dataset.delpage);
    if (!confirm(`Ștergi pagina „${p.name}” și tot ce e pe ea?`)) return;
    site.pages = site.pages.filter((x) => x.id !== p.id);
    if (site.current === p.id) site.current = site.pages[0].id;
    selId = null;
    commit(); renderAll();
    return;
  }
  const li = e.target.closest('[data-page]');
  if (li) switchPage(li.dataset.page);
});
$('page-list').addEventListener('dblclick', (e) => { const li = e.target.closest('[data-page]'); if (li) { renamingPage = li.dataset.page; renderPages(); } });
$('page-list').addEventListener('keydown', (e) => {
  if (e.target.id !== 'rename-input') return;
  if (e.key === 'Enter') finishRename(e.target.value);
  if (e.key === 'Escape') { renamingPage = null; renderPages(); }
});
$('page-list').addEventListener('focusout', (e) => { if (e.target.id === 'rename-input' && renamingPage) finishRename(e.target.value); });
$('add-page').addEventListener('click', () => {
  const p = makePage('Pagină nouă', [['text', 'center']], site.pack);
  site.pages.push(p);
  site.current = p.id;
  renamingPage = p.id;
  selId = null;
  commit(); renderAll();
});

/* ---------- left list ---------- */

function listItem(b, pinned) {
  const def = BLOCKS[b.type];
  return `<li data-id="${b.id}" class="${b.id === selId ? 'is-sel' : ''}${pinned ? ' locked' : ''}" draggable="${pinned ? 'false' : 'true'}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="lbl">${esc(def.label)}<br><span class="var">${esc(def.variants[b.variant])}${pinned ? ' · pe toate paginile' : ''}</span></span></li>`;
}

function renderList() {
  $('block-list').innerHTML = listItem(site.header, true) + curPage().blocks.map((b) => listItem(b, false)).join('') + listItem(site.footer, true);
}

let listDragId = null;
$('block-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  select(li.dataset.id);
  scrollToBlock(li.dataset.id);
});
$('block-list').addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  listDragId = li.dataset.id;
  li.classList.add('is-drag');
  e.dataTransfer.effectAllowed = 'move';
});
$('block-list').addEventListener('dragover', (e) => {
  const li = e.target.closest('li');
  if (!li || !listDragId || li.classList.contains('locked')) return;
  e.preventDefault();
  $('block-list').querySelectorAll('li').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const r = li.getBoundingClientRect();
  li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
$('block-list').addEventListener('drop', (e) => {
  const li = e.target.closest('li');
  if (!li || !listDragId || li.classList.contains('locked')) return;
  e.preventDefault();
  const from = indexOf(listDragId);
  let to = indexOf(li.dataset.id) + (li.classList.contains('drop-after') ? 1 : 0);
  if (to > from) to -= 1;
  if (to !== from) move(from, to);
});
$('block-list').addEventListener('dragend', () => { listDragId = null; renderList(); });

/* ---------- inspector ---------- */

function renderInspector() {
  const box = $('inspector');
  const b = selId && findBlock(selId);
  if (!b) { box.hidden = true; fitFrame(); return; }
  box.hidden = false;
  const def = BLOCKS[b.type];
  const shared = isShared(b.id);
  $('insp-title').textContent = def.label;
  const variants = Object.entries(def.variants);
  let html = '';
  if (shared) html += `<p class="note">Apare pe toate paginile. Ce schimbi aici se vede peste tot. Linkurile din meniu sunt chiar paginile site-ului.</p>`;
  if (variants.length > 1) html += `<div class="grp"><h3>Aspect</h3><div class="pills">${variants.map(([k, l]) => `<button type="button" data-variant="${k}" aria-pressed="${k === b.variant}">${esc(l)}</button>`).join('')}</div></div>`;
  html += `<div class="grp"><h3>Fundal</h3><div class="pills">${[['auto', 'Ca tema'], ['light', 'Deschis'], ['dark', 'Închis'], ['accent', 'Accent']].map(([k, l]) => `<button type="button" data-bg="${k}" aria-pressed="${k === b.bg}">${l}</button>`).join('')}</div></div>`;
  if (!shared) {
    html += `<div class="grp"><h3>Spațiere</h3><div class="pills">${[['compact', 'Compact'], ['normal', 'Normal'], ['airy', 'Aerisit']].map(([k, l]) => `<button type="button" data-pad="${k}" aria-pressed="${k === (b.pad || 'normal')}">${l}</button>`).join('')}</div></div>`;
    html += `<div class="grp"><h3>Aliniere</h3><div class="pills">${[['auto', 'Ca designul'], ['center', 'Totul centrat']].map(([k, l]) => `<button type="button" data-align="${k}" aria-pressed="${k === (b.align || 'auto')}">${l}</button>`).join('')}</div></div>`;
    html += `<div class="grp"><label class="check"><input type="checkbox" data-hidem ${b.hideMobile ? 'checked' : ''}> Ascunde pe telefon</label></div>`;
  }
  const visFields = def.fields.filter((f) => f.type === 'text' || f.type === 'textarea');
  if (visFields.length) html += `<div class="grp"><h3>Elemente afișate</h3><div class="checks">${visFields.map((f) => `<label class="check"><input type="checkbox" data-vis="${f.key}" ${(b.el && b.el[f.key] && b.el[f.key].hidden) ? '' : 'checked'}> ${esc(f.label)}</label>`).join('')}</div></div>`;
  if (def.fields.length) html += `<div class="grp"><h3>Conținut</h3><div style="display:flex;flex-direction:column;gap:12px">${def.fields.map((f) => fieldHtml(b, f, f.key)).join('')}</div></div>`;
  if (!shared) html += `<div class="grp"><h3>Bloc</h3><div class="row-actions"><button type="button" data-act="up">Mută sus</button><button type="button" data-act="down">Mută jos</button><button type="button" data-act="dup">Duplică</button><button type="button" data-act="del" class="danger">Șterge</button></div></div>`;
  if (b.type === 'footer') html += `<p class="hint">Linia „Build by hidook.tech powered by hidook.agency” nu se poate edita.</p>`;
  $('insp-body').innerHTML = html;
  fitFrame();
}

function fieldHtml(b, f, path) {
  const v = getPath(b.data, path);
  if (f.type === 'text' || f.type === 'textarea') {
    if (hasMarkup(v)) return `<div class="fld">${esc(f.label)}<div class="richnote">${esc(plain(v))}<small>Are cuvinte îngroșate sau linkuri. Editează-l direct pe pagină.</small></div></div>`;
    if (f.type === 'text') return `<label class="fld">${esc(f.label)}<input data-path="${path}" value="${esc(v)}"></label>`;
    return `<label class="fld">${esc(f.label)}<textarea data-path="${path}">${esc(v)}</textarea></label>`;
  }
  if (f.type === 'image') return `<div class="fld">${esc(f.label)}<div class="imgfld"><img src="${esc(v)}" alt=""><button type="button" data-imgpath="${path}">Schimbă poza</button></div></div>`;
  if (f.type === 'list') {
    const items = v.map((it, i) => `<div class="list-item"><div class="list-item__head"><span>${i + 1}</span><span><button type="button" data-listmove="${path}" data-i="${i}" data-dir="-1" title="Mută sus">↑</button><button type="button" data-listmove="${path}" data-i="${i}" data-dir="1" title="Mută jos">↓</button><button type="button" data-listdel="${path}" data-i="${i}" title="Șterge">×</button></span></div>${f.item.map((sf) => fieldHtml(b, sf, `${path}.${i}.${sf.key}`)).join('')}</div>`).join('');
    return `<div class="fld">${esc(f.label)}<div style="display:flex;flex-direction:column;gap:8px">${items}${f.max && v.length >= f.max ? '' : `<button type="button" class="list-add" data-listadd="${path}">+ Adaugă</button>`}</div></div>`;
  }
  return '';
}

function fieldDef(b, path) {
  const parts = path.split('.');
  let f = BLOCKS[b.type].fields.find((x) => x.key === parts[0]);
  if (parts.length > 2) f = f.item.find((x) => x.key === parts[2]);
  return f;
}

function syncInspectorValues() {
  const b = selId && findBlock(selId);
  if (!b) return;
  let stale = false;
  $('insp-body').querySelectorAll('[data-path]').forEach((el) => {
    if (el === document.activeElement) return;
    const v = getPath(b.data, el.dataset.path);
    if (hasMarkup(v)) stale = true; else el.value = v;
  });
  if (stale) renderInspector();
  $('site-name').textContent = site.header.data.brand;
}

$('insp-body').addEventListener('input', (e) => {
  const el = e.target.closest('[data-path]');
  const b = findBlock(selId);
  if (!el || !b) return;
  setPath(b.data, el.dataset.path, el.value);
  rerenderBlock(b.id);
  $('saved').textContent = 'Se salvează…';
  clearTimeout(textTimer);
  textTimer = setTimeout(() => { commit(); $('site-name').textContent = site.header.data.brand; }, 500);
});

$('insp-body').addEventListener('change', (e) => {
  const b = findBlock(selId);
  if (!b) return;
  if (e.target.matches('[data-hidem]')) { b.hideMobile = e.target.checked; commit(); rerenderBlock(b.id); return; }
  if (e.target.matches('[data-vis]')) {
    const k = e.target.dataset.vis;
    b.el = b.el || {};
    b.el[k] = b.el[k] || {};
    b.el[k].hidden = !e.target.checked;
    commit(); rerenderBlock(b.id);
  }
});

$('insp-body').addEventListener('click', (e) => {
  const b = findBlock(selId);
  if (!b) return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.variant) { b.variant = t.dataset.variant; commit(); renderList(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.bg) { b.bg = t.dataset.bg; commit(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.pad) { b.pad = t.dataset.pad; commit(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.align) { b.align = t.dataset.align; commit(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.act) { blockAction(b.id, t.dataset.act); return; }
  if (t.dataset.imgpath) { openPicker({ id: b.id, path: t.dataset.imgpath }); return; }
  if (t.dataset.listadd) {
    const f = fieldDef(b, t.dataset.listadd);
    const list = getPath(b.data, t.dataset.listadd);
    if (f.max && list.length >= f.max) return;
    list.push(JSON.parse(JSON.stringify(f.newItem)));
    commit(); renderInspector(); rerenderBlock(b.id); return;
  }
  if (t.dataset.listdel) {
    const list = getPath(b.data, t.dataset.listdel);
    if (list.length <= (fieldDef(b, t.dataset.listdel).min || 1)) return;
    list.splice(Number(t.dataset.i), 1);
    commit(); renderInspector(); rerenderBlock(b.id); return;
  }
  if (t.dataset.listmove) {
    const list = getPath(b.data, t.dataset.listmove);
    const i = Number(t.dataset.i);
    const j = i + Number(t.dataset.dir);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit(); renderInspector(); rerenderBlock(b.id);
  }
});

$('insp-close').addEventListener('click', deselect);

/* ---------- images ---------- */

function openPicker(target) {
  pendingImage = target;
  const b = findBlock(target.id);
  const cur = b && getPath(b.data, target.path);
  const all = [...new Set([...PACKS[site.pack].images, ...Object.values(PACKS).flatMap((x) => x.images)])];
  $('picker-grid').innerHTML = all.map((src) => `<button type="button" class="pick${src === cur ? ' is-cur' : ''}" data-src="${esc(src)}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('');
  $('picker').hidden = false;
}

function setImage(src) {
  const target = pendingImage;
  pendingImage = null;
  $('picker').hidden = true;
  const b = target && findBlock(target.id);
  if (!b) return;
  setPath(b.data, target.path, src);
  commit(); renderInspector(); rerenderBlock(b.id);
}

$('picker-grid').addEventListener('click', (e) => { const p = e.target.closest('[data-src]'); if (p) setImage(p.dataset.src); });
$('picker-upload').addEventListener('click', () => $('file').click());
$('picker-close').addEventListener('click', () => { $('picker').hidden = true; pendingImage = null; });
$('picker').addEventListener('click', (e) => { if (e.target === $('picker')) { $('picker').hidden = true; pendingImage = null; } });

$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  $('file').value = '';
  if (!file || !pendingImage) return;
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k);
      c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      setImage(c.toDataURL('image/jpeg', 0.82));
    };
    im.src = reader.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- block previews: library + Adaugă panel ---------- */

function previewDoc(type, variant) {
  const b = makeBlock(type, variant, site.pack);
  const ctx = { pages: site.pages.map((p) => ({ id: p.id, name: p.name, slug: p.slug })), current: site.current };
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${esc(location.href)}"><style>${themeCss(site.theme)}</style></head><body>${renderBlock(b, ctx)}</body></html>`.replace(/"/g, '&quot;');
}

function addableBlocks() {
  const out = [];
  Object.entries(BLOCKS).forEach(([type, def]) => {
    if (def.shared) return;
    Object.entries(def.variants).forEach(([v, label]) => out.push({ type, v, def, label }));
  });
  return out;
}

function renderAddPanel() {
  const groups = {};
  addableBlocks().forEach((x) => { (groups[x.def.category] = groups[x.def.category] || []).push(x); });
  $('add-list').innerHTML = Object.entries(groups).map(([cat, items]) => `<h3>${esc(cat)}</h3><div class="addgrid">${items.map((x) => `<button type="button" class="addcard" draggable="true" data-type="${x.type}" data-v="${x.v}" title="${esc(x.def.label)} · ${esc(x.label)}"><span class="addcard__thumb"><iframe tabindex="-1" loading="lazy" srcdoc="${previewDoc(x.type, x.v)}"></iframe></span><span class="addcard__lbl">${esc(x.def.label)}<small>${esc(x.label)}</small></span></button>`).join('')}</div>`).join('');
}

$('add-list').addEventListener('dragstart', (e) => {
  const c = e.target.closest('.addcard');
  if (!c) return;
  dragNew = { type: c.dataset.type, variant: c.dataset.v };
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', c.dataset.type);
});
$('add-list').addEventListener('dragend', () => { setTimeout(clearDrag, 0); });
$('add-list').addEventListener('click', (e) => {
  const c = e.target.closest('.addcard');
  if (c) insertBlock(c.dataset.type, c.dataset.v, curPage().blocks.length);
});

function openLibrary(at) {
  insertAt = at == null ? curPage().blocks.length : at;
  const cats = [...new Set(addableBlocks().map((x) => x.def.category))];
  if (!['Toate', ...cats].includes(libCat)) libCat = 'Toate';
  $('lib-cats').innerHTML = ['Toate', ...cats].map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === libCat}">${esc(c)}</button>`).join('');
  renderLibGrid();
  $('library').hidden = false;
}

function renderLibGrid() {
  $('lib-cats').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === libCat)));
  $('lib-grid').innerHTML = addableBlocks().filter((x) => libCat === 'Toate' || x.def.category === libCat)
    .map((x) => `<button type="button" class="lib__card" data-type="${x.type}" data-v="${x.v}"><div class="lib__thumb"><iframe tabindex="-1" loading="lazy" srcdoc="${previewDoc(x.type, x.v)}"></iframe></div><div class="lib__meta"><b>${esc(x.def.label)}</b><span>${esc(x.label)}</span></div></button>`).join('');
}

$('lib-cats').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) { libCat = c.dataset.cat; renderLibGrid(); } });
$('lib-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.lib__card');
  if (!card) return;
  $('library').hidden = true;
  insertBlock(card.dataset.type, card.dataset.v, insertAt);
});
$('lib-close').addEventListener('click', () => { $('library').hidden = true; });
$('library').addEventListener('click', (e) => { if (e.target === $('library')) $('library').hidden = true; });
$('add-block').addEventListener('click', () => openLibrary(null));

/* ---------- starter packs ---------- */

function openPacks() {
  const order = Object.entries(PACKS).sort((a, b) => (b[1].blank ? 1 : 0) - (a[1].blank ? 1 : 0));
  $('packs-grid').innerHTML = order.map(([id, p]) => {
    const tmp = defaultSite(id);
    const html = renderPage(tmp, tmp.pages[0].id, location.href).replace(/"/g, '&quot;');
    return `<button type="button" class="lib__card${id === site.pack ? ' is-cur' : ''}" data-pack="${id}"><div class="lib__thumb"><iframe tabindex="-1" loading="lazy" srcdoc="${html}"></iframe></div><div class="lib__meta"><b>${esc(p.label)}</b><span>${esc(p.desc)}${p.blank ? '' : ` · ${p.pages.length} pagini`}</span></div></button>`;
  }).join('');
  $('packs').hidden = false;
}

$('open-packs').addEventListener('click', openPacks);
$('packs-close').addEventListener('click', () => { $('packs').hidden = true; });
$('packs').addEventListener('click', (e) => { if (e.target === $('packs')) $('packs').hidden = true; });
$('packs-grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-pack]');
  if (!c) return;
  if (!confirm(`Pornești de la șablonul „${PACKS[c.dataset.pack].label}”? Site-ul de acum se înlocuiește (poți reveni cu Anulează).`)) return;
  site = defaultSite(c.dataset.pack);
  selId = null;
  $('packs').hidden = true;
  commit(); renderAll();
});

/* ---------- theme panel ---------- */

function renderThemePanel() {
  $('palettes').innerHTML = Object.entries(THEMES.palettes).map(([k, p]) => `<button type="button" class="swatch" data-pal="${k}" aria-pressed="${k === site.theme.palette}"><span class="dots"><span style="background:${p.bg}"></span><span style="background:${p.paper}"></span><span style="background:${p.accent}"></span></span>${esc(p.label)}</button>`).join('');
  $('fonts').innerHTML = Object.entries(THEMES.fonts).map(([k, f]) => `<button type="button" class="choice" data-font="${k}" aria-pressed="${k === site.theme.fonts}"><b style="font-family:${esc(f.display)}">${esc(site.header.data.brand)}</b><span>${esc(f.label)}</span></button>`).join('');
  $('radius').value = site.theme.radius;
  $('radius-val').textContent = site.theme.radius + ' px';
}

$('palettes').addEventListener('click', (e) => { const s = e.target.closest('[data-pal]'); if (!s) return; site.theme.palette = s.dataset.pal; commit(); renderThemePanel(); renderTheme(); });
$('fonts').addEventListener('click', (e) => { const s = e.target.closest('[data-font]'); if (!s) return; site.theme.fonts = s.dataset.font; commit(); renderThemePanel(); renderTheme(); });
$('radius').addEventListener('input', () => {
  site.theme.radius = Number($('radius').value);
  $('radius-val').textContent = site.theme.radius + ' px';
  renderTheme();
  clearTimeout(textTimer);
  textTimer = setTimeout(commit, 400);
});

let addPanelBuilt = false;
function showTab(which) {
  ['page', 'add', 'theme'].forEach((k) => {
    $('tab-' + k).setAttribute('aria-selected', String(k === which));
    $('panel-' + k).hidden = k !== which;
  });
  if (which === 'add' && !addPanelBuilt) { renderAddPanel(); addPanelBuilt = true; }
}
$('tab-page').addEventListener('click', () => showTab('page'));
$('tab-add').addEventListener('click', () => showTab('add'));
$('tab-theme').addEventListener('click', () => showTab('theme'));

/* ---------- view + preview ---------- */

$('undo').addEventListener('click', () => { if (hIndex > 0) restore(hIndex - 1); });
$('redo').addEventListener('click', () => { if (hIndex < history.length - 1) restore(hIndex + 1); });
$('dev-desktop').addEventListener('click', () => setDevice(false));
$('dev-mobile').addEventListener('click', () => setDevice(true));

function setDevice(mobile) {
  $('frame-wrap').classList.toggle('is-mobile', mobile);
  $('dev-desktop').setAttribute('aria-pressed', String(!mobile));
  $('dev-mobile').setAttribute('aria-pressed', String(mobile));
  fitFrame();
}

/** Render the page at a real device width and scale it down to fit, like Wix. */
function fitFrame() {
  const wrap = $('frame-wrap');
  const W = wrap.classList.contains('is-mobile') ? 390 : 1280;
  const s = Math.min(1, wrap.clientWidth / W) || 1;
  frame.style.width = W + 'px';
  frame.style.height = (wrap.clientHeight / s) + 'px';
  frame.style.transform = `scale(${s})`;
  if (doc) { doc.documentElement.style.setProperty('--ed-z', String(1 / s)); placeTextTools(); }
}
new ResizeObserver(fitFrame).observe($('frame-wrap'));

let pvPage = null;
function openPreview() {
  if (editing) endEdit();
  pvPage = site.current;
  $('pv').hidden = false;
  renderPreview();
  $('pv-back').focus();
}
function renderPreview() {
  $('pv-pages').innerHTML = site.pages.map((p) => `<button type="button" data-pvpage="${p.id}" aria-pressed="${p.id === pvPage}">${esc(p.name)}</button>`).join('');
  const f = $('pv-frame');
  f.onload = () => {
    f.contentDocument.addEventListener('click', (e) => {
      const l = e.target.closest('[data-page]');
      if (l) { e.preventDefault(); pvPage = l.dataset.page; renderPreview(); return; }
      const a = e.target.closest('a');
      if (a && (a.getAttribute('href') || '#').startsWith('#')) e.preventDefault();
    });
    f.contentDocument.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePreview(); });
  };
  f.srcdoc = renderPage(site, pvPage, location.href);
}
function closePreview() { $('pv').hidden = true; }

$('preview').addEventListener('click', openPreview);
$('pv-back').addEventListener('click', closePreview);
$('pv-pages').addEventListener('click', (e) => { const b = e.target.closest('[data-pvpage]'); if (b) { pvPage = b.dataset.pvpage; renderPreview(); } });
$('pv-desktop').addEventListener('click', () => { $('pv').classList.remove('is-mobile'); $('pv-desktop').setAttribute('aria-pressed', 'true'); $('pv-mobile').setAttribute('aria-pressed', 'false'); });
$('pv-mobile').addEventListener('click', () => { $('pv').classList.add('is-mobile'); $('pv-desktop').setAttribute('aria-pressed', 'false'); $('pv-mobile').setAttribute('aria-pressed', 'true'); });
$('pv-tab').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([renderPage(site, pvPage, location.href)], { type: 'text/html' }));
  window.open(url, '_blank');
});

/* ---------- keyboard ---------- */

function shortcuts(e) {
  const mod = e.metaKey || e.ctrlKey;
  const typing = isTyping(e.target);
  if (e.key === 'Escape') {
    if (!$('pv').hidden) { closePreview(); return; }
    ['library', 'picker', 'packs'].forEach((id) => { $(id).hidden = true; });
    pendingImage = null;
    return;
  }
  if (!$('pv').hidden) return;
  if (selId && !typing && (e.key === 'Delete' || e.key === 'Backspace') && !isShared(selId)) { e.preventDefault(); blockAction(selId, 'del'); return; }
  if (selId && !typing && mod && e.key.toLowerCase() === 'd' && !isShared(selId)) { e.preventDefault(); blockAction(selId, 'dup'); return; }
  if (mod && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) $('redo').click(); else $('undo').click();
  }
}
document.addEventListener('keydown', shortcuts);

/* ---------- boot ---------- */

function renderAll() {
  $('site-name').textContent = site.header.data.brand;
  $('pack-name').textContent = PACKS[site.pack].label;
  renderPages();
  renderList();
  renderInspector();
  renderThemePanel();
  renderCanvas();
  syncUndo();
  addPanelBuilt = false;
  if (!$('panel-add').hidden) { renderAddPanel(); addPanelBuilt = true; }
}

initFrame();
