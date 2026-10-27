'use strict';
/**
 * prototype/blocks/editor.js — block editor prototype (vanilla, no deps).
 *
 * Canvas = same-origin iframe; block HTML from blocks.js is rendered into it
 * and decorated with editor-only chrome (labels, toolbar, "+" buttons).
 * Text edits happen in place (contenteditable on [data-f]); images are
 * swapped by clicking them; everything else lives in the inspector.
 * State persists to localStorage; undo/redo keeps JSON snapshots.
 */

const { BLOCKS, THEMES, makeBlock, defaultPage, themeCss, renderBlock, renderPage, esc } = window.SB;
const STORE = 'sb-proto-page-v1';
const $ = (id) => document.getElementById(id);

let page = load();
let selId = null;
let history = [JSON.stringify(page)];
let hIndex = 0;
let insertAt = null;
let libCat = null;
let pendingImage = null;
let textTimer = null;

/* ---------- state helpers ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* fall through */ }
  return defaultPage();
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(page));
    $('saved').textContent = 'Salvat';
  } catch (_) {
    $('saved').textContent = 'Nu s-a putut salva (poze prea mari)';
  }
}

function commit() {
  const snap = JSON.stringify(page);
  if (snap === history[hIndex]) return;
  history = history.slice(0, hIndex + 1);
  history.push(snap);
  if (history.length > 100) history.shift();
  hIndex = history.length - 1;
  save();
  syncUndo();
}

function restore(i) {
  hIndex = i;
  page = JSON.parse(history[hIndex]);
  if (selId && !findBlock(selId)) selId = null;
  save();
  renderAll();
}

function syncUndo() {
  $('undo').disabled = hIndex <= 0;
  $('redo').disabled = hIndex >= history.length - 1;
}

function findBlock(id) { return page.blocks.find((b) => b.id === id); }
function indexOf(id) { return page.blocks.findIndex((b) => b.id === id); }
function footerIndex() { const i = page.blocks.findIndex((b) => BLOCKS[b.type].locked); return i < 0 ? page.blocks.length : i; }

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

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
`;

const frame = $('canvas');
let doc = null;

function initFrame() {
  frame.srcdoc = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="theme"></style><style>${EDITOR_CSS}</style></head><body><main id="root"></main></body></html>`;
  frame.addEventListener('load', () => {
    doc = frame.contentDocument;
    bindFrame();
    renderAll();
  }, { once: true });
}

function renderTheme() {
  if (doc) doc.getElementById('theme').textContent = themeCss(page.theme);
}

function decorate(el, b) {
  const def = BLOCKS[b.type];
  const label = doc.createElement('div');
  label.className = 'ed-label';
  label.textContent = def.label + ' · ' + def.variants[b.variant];
  el.appendChild(label);
  if (b.id === selId) {
    el.classList.add('is-sel');
    const tools = doc.createElement('div');
    tools.className = 'ed-tools';
    const variants = Object.keys(def.variants);
    tools.innerHTML =
      (variants.length > 1 ? `<button type="button" data-act="variant" title="Schimbă aspectul">Aspect ↻</button>` : '') +
      (def.locked ? '' : `<button type="button" data-act="up" title="Mută sus">↑</button><button type="button" data-act="down" title="Mută jos">↓</button><button type="button" data-act="dup" title="Duplică">Duplică</button><button type="button" data-act="del" class="ed-del" title="Șterge">Șterge</button>`);
    el.appendChild(tools);
  }
  if (!def.locked) {
    const add = doc.createElement('div');
    add.className = 'ed-add';
    add.innerHTML = '<button type="button" data-act="add">+ Adaugă bloc aici</button>';
    el.appendChild(add);
  }
}

function renderCanvas() {
  if (!doc) return;
  renderTheme();
  const root = doc.getElementById('root');
  root.innerHTML = page.blocks.map(renderBlock).join('');
  root.querySelectorAll('.blk').forEach((el) => decorate(el, findBlock(el.dataset.id)));
}

function rerenderBlock(id) {
  if (!doc) return;
  const b = findBlock(id);
  const old = doc.querySelector(`.blk[data-id="${id}"]`);
  if (!b || !old) return renderCanvas();
  const tmp = doc.createElement('div');
  tmp.innerHTML = renderBlock(b);
  const el = tmp.firstElementChild;
  old.replaceWith(el);
  decorate(el, b);
}

function scrollToBlock(id) {
  const el = doc && doc.querySelector(`.blk[data-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindFrame() {
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) e.preventDefault();
    const blk = e.target.closest('.blk');
    if (!blk) return;
    const id = blk.dataset.id;

    const act = e.target.closest('[data-act]');
    if (act) { e.preventDefault(); return blockAction(id, act.dataset.act); }

    const im = e.target.closest('[data-img]');
    if (im) { select(id); pendingImage = { id, path: im.dataset.img }; $('file').click(); return; }

    const f = e.target.closest('[data-f]');
    if (selId !== id) select(id, { keepCanvas: !!f });
    if (f) startEdit(f, id);
  });

  doc.addEventListener('input', (e) => {
    const f = e.target.closest('[data-f]');
    const blk = e.target.closest('.blk');
    if (!f || !blk) return;
    const b = findBlock(blk.dataset.id);
    setPath(b.data, f.dataset.f, f.textContent);
    $('saved').textContent = 'Se salvează…';
    clearTimeout(textTimer);
    textTimer = setTimeout(() => { commit(); syncInspectorValues(); }, 500);
  });

  doc.addEventListener('keydown', (e) => {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (f && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.blur(); }
    if (f && e.key === 'Escape') f.blur();
    shortcuts(e);
  });

  doc.addEventListener('focusout', (e) => {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (f) { f.removeAttribute('contenteditable'); clearTimeout(textTimer); commit(); syncInspectorValues(); }
  });

  doc.addEventListener('toggle', (e) => { if (e.target.matches('details')) e.target.open = true; }, true);
}

function startEdit(el, id) {
  if (el.getAttribute('contenteditable') === 'true') return;
  el.setAttribute('contenteditable', 'true');
  el.focus();
  const sel = doc.getSelection();
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ---------- block actions ---------- */

function select(id, opts = {}) {
  selId = id;
  renderList();
  renderInspector();
  if (!opts.keepCanvas) renderCanvas();
  else {
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
}

function deselect() {
  selId = null;
  renderList();
  renderInspector();
  renderCanvas();
}

function blockAction(id, act) {
  const i = indexOf(id);
  const b = page.blocks[i];
  if (act === 'add') { openLibrary(i + 1); return; }
  if (act === 'variant') {
    const vs = Object.keys(BLOCKS[b.type].variants);
    b.variant = vs[(vs.indexOf(b.variant) + 1) % vs.length];
    commit(); renderList(); renderInspector(); rerenderBlock(id);
    return;
  }
  if (act === 'up' && i > 0) { move(i, i - 1); return; }
  if (act === 'down' && i < footerIndex() - 1) { move(i, i + 1); return; }
  if (act === 'dup') {
    const copy = JSON.parse(JSON.stringify(b));
    copy.id = 'b' + Math.random().toString(36).slice(2, 9);
    page.blocks.splice(i + 1, 0, copy);
    selId = copy.id;
    commit(); renderAll(); scrollToBlock(copy.id);
    return;
  }
  if (act === 'del') {
    page.blocks.splice(i, 1);
    selId = null;
    commit(); renderAll();
  }
}

function move(from, to) {
  const [b] = page.blocks.splice(from, 1);
  page.blocks.splice(to, 0, b);
  commit(); renderAll(); scrollToBlock(b.id);
}

/* ---------- left list ---------- */

function renderList() {
  const ol = $('block-list');
  ol.innerHTML = page.blocks.map((b) => {
    const def = BLOCKS[b.type];
    return `<li data-id="${b.id}" class="${b.id === selId ? 'is-sel' : ''}${def.locked ? ' locked' : ''}" draggable="${def.locked ? 'false' : 'true'}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="lbl">${esc(def.label)}<br><span class="var">${esc(def.variants[b.variant])}</span></span></li>`;
  }).join('');
}

let dragId = null;
$('block-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  select(li.dataset.id);
  scrollToBlock(li.dataset.id);
});
$('block-list').addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  dragId = li.dataset.id;
  li.classList.add('is-drag');
  e.dataTransfer.effectAllowed = 'move';
});
$('block-list').addEventListener('dragover', (e) => {
  const li = e.target.closest('li');
  if (!li || !dragId) return;
  e.preventDefault();
  $('block-list').querySelectorAll('li').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const r = li.getBoundingClientRect();
  li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
$('block-list').addEventListener('drop', (e) => {
  const li = e.target.closest('li');
  if (!li || !dragId) return;
  e.preventDefault();
  const from = indexOf(dragId);
  let to = indexOf(li.dataset.id) + (li.classList.contains('drop-after') ? 1 : 0);
  if (to > from) to -= 1;
  to = Math.min(to, footerIndex() - (from < footerIndex() ? 1 : 0));
  if (to !== from) move(from, to);
});
$('block-list').addEventListener('dragend', () => {
  dragId = null;
  renderList();
});

/* ---------- inspector ---------- */

function renderInspector() {
  const box = $('inspector');
  const b = selId && findBlock(selId);
  if (!b) { box.hidden = true; return; }
  box.hidden = false;
  const def = BLOCKS[b.type];
  $('insp-title').textContent = def.label;
  const variants = Object.entries(def.variants);
  let html = '';
  if (variants.length > 1) {
    html += `<div class="grp"><h3>Aspect</h3><div class="pills">${variants.map(([k, l]) => `<button type="button" data-variant="${k}" aria-pressed="${k === b.variant}">${esc(l)}</button>`).join('')}</div></div>`;
  }
  html += `<div class="grp"><h3>Fundal</h3><div class="pills">${[['auto', 'Ca tema'], ['light', 'Deschis'], ['dark', 'Închis'], ['accent', 'Accent']].map(([k, l]) => `<button type="button" data-bg="${k}" aria-pressed="${k === b.bg}">${l}</button>`).join('')}</div></div>`;
  html += `<div class="grp"><h3>Conținut</h3><div style="display:flex;flex-direction:column;gap:12px">${def.fields.map((f) => fieldHtml(b, f, f.key)).join('')}</div></div>`;
  if (!def.locked) {
    html += `<div class="grp"><h3>Bloc</h3><div class="row-actions"><button type="button" data-act="up">Mută sus</button><button type="button" data-act="down">Mută jos</button><button type="button" data-act="dup">Duplică</button><button type="button" data-act="del" class="danger">Șterge</button></div></div>`;
  } else {
    html += `<p class="hint">Subsolul rămâne ultimul. Linia „Build by hidook.tech powered by hidook.agency” nu se poate edita.</p>`;
  }
  $('insp-body').innerHTML = html;
}

function fieldHtml(b, f, path) {
  const v = getPath(b.data, path);
  if (f.type === 'text') return `<label class="fld">${esc(f.label)}<input data-path="${path}" value="${esc(v)}"></label>`;
  if (f.type === 'textarea') return `<label class="fld">${esc(f.label)}<textarea data-path="${path}">${esc(v)}</textarea></label>`;
  if (f.type === 'image') return `<div class="fld">${esc(f.label)}<div class="imgfld"><img src="${esc(v)}" alt=""><button type="button" data-imgpath="${path}">Schimbă poza</button></div></div>`;
  if (f.type === 'list') {
    const items = v.map((it, i) => `<div class="list-item"><div class="list-item__head"><span>${i + 1}</span><span><button type="button" data-listmove="${path}" data-i="${i}" data-dir="-1" title="Mută sus">↑</button><button type="button" data-listmove="${path}" data-i="${i}" data-dir="1" title="Mută jos">↓</button><button type="button" data-listdel="${path}" data-i="${i}" title="Șterge">×</button></span></div>${f.item.map((sf) => fieldHtml(b, sf, `${path}.${i}.${sf.key}`)).join('')}</div>`).join('');
    return `<div class="fld">${esc(f.label)}<div style="display:flex;flex-direction:column;gap:8px">${items}<button type="button" class="list-add" data-listadd="${path}">+ Adaugă</button></div></div>`;
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
  $('insp-body').querySelectorAll('[data-path]').forEach((el) => {
    if (el === document.activeElement) return;
    el.value = getPath(b.data, el.dataset.path);
  });
}

$('insp-body').addEventListener('input', (e) => {
  const el = e.target.closest('[data-path]');
  const b = findBlock(selId);
  if (!el || !b) return;
  setPath(b.data, el.dataset.path, el.value);
  rerenderBlock(b.id);
  $('saved').textContent = 'Se salvează…';
  clearTimeout(textTimer);
  textTimer = setTimeout(commit, 500);
});

$('insp-body').addEventListener('click', (e) => {
  const b = findBlock(selId);
  if (!b) return;
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.variant) { b.variant = t.dataset.variant; commit(); renderList(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.bg) { b.bg = t.dataset.bg; commit(); renderInspector(); rerenderBlock(b.id); return; }
  if (t.dataset.act) { blockAction(b.id, t.dataset.act); return; }
  if (t.dataset.imgpath) { pendingImage = { id: b.id, path: t.dataset.imgpath }; $('file').click(); return; }
  if (t.dataset.listadd) {
    const f = fieldDef(b, t.dataset.listadd);
    getPath(b.data, t.dataset.listadd).push(JSON.parse(JSON.stringify(f.newItem)));
    commit(); renderInspector(); rerenderBlock(b.id); return;
  }
  if (t.dataset.listdel) {
    const list = getPath(b.data, t.dataset.listdel);
    if (list.length <= 1) return;
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

$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  $('file').value = '';
  if (!file || !pendingImage) return;
  const target = pendingImage;
  pendingImage = null;
  const reader = new FileReader();
  reader.onload = () => {
    const im = new Image();
    im.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k);
      c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      const b = findBlock(target.id);
      if (!b) return;
      setPath(b.data, target.path, c.toDataURL('image/jpeg', 0.82));
      commit(); renderInspector(); rerenderBlock(b.id);
    };
    im.src = reader.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- library ---------- */

function openLibrary(at) {
  insertAt = at == null ? footerIndex() : Math.min(at, footerIndex());
  const cats = [...new Set(Object.values(BLOCKS).filter((d) => !d.locked).map((d) => d.category))];
  libCat = libCat && cats.includes(libCat) ? libCat : cats[0];
  $('lib-cats').innerHTML = ['Toate', ...cats].map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === libCat}">${esc(c)}</button>`).join('');
  renderLibGrid();
  $('library').hidden = false;
}

function renderLibGrid() {
  $('lib-cats').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === libCat)));
  const cards = [];
  Object.entries(BLOCKS).forEach(([type, def]) => {
    if (def.locked || (libCat !== 'Toate' && def.category !== libCat)) return;
    Object.entries(def.variants).forEach(([v, label]) => {
      const html = renderPage({ theme: page.theme, blocks: [makeBlock(type, v)] }).replace(/"/g, '&quot;');
      cards.push(`<button type="button" class="lib__card" data-type="${type}" data-v="${v}"><div class="lib__thumb"><iframe tabindex="-1" loading="lazy" srcdoc="${html}"></iframe></div><div class="lib__meta"><b>${esc(def.label)}</b><span>${esc(label)}</span></div></button>`);
    });
  });
  $('lib-grid').innerHTML = cards.join('');
}

$('lib-cats').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cat]');
  if (!c) return;
  libCat = c.dataset.cat;
  renderLibGrid();
});
$('lib-grid').addEventListener('click', (e) => {
  const card = e.target.closest('.lib__card');
  if (!card) return;
  const b = makeBlock(card.dataset.type, card.dataset.v);
  page.blocks.splice(insertAt, 0, b);
  selId = b.id;
  $('library').hidden = true;
  commit(); renderAll();
  setTimeout(() => scrollToBlock(b.id), 50);
});
$('lib-close').addEventListener('click', () => { $('library').hidden = true; });
$('library').addEventListener('click', (e) => { if (e.target === $('library')) $('library').hidden = true; });
$('add-block').addEventListener('click', () => openLibrary(null));

/* ---------- theme panel ---------- */

function renderThemePanel() {
  $('palettes').innerHTML = Object.entries(THEMES.palettes).map(([k, p]) => `<button type="button" class="swatch" data-pal="${k}" aria-pressed="${k === page.theme.palette}"><span class="dots"><span style="background:${p.bg}"></span><span style="background:${p.paper}"></span><span style="background:${p.accent}"></span></span>${esc(p.label)}</button>`).join('');
  $('fonts').innerHTML = Object.entries(THEMES.fonts).map(([k, f]) => `<button type="button" class="choice" data-font="${k}" aria-pressed="${k === page.theme.fonts}"><b style="font-family:${esc(f.display)}">Casa Nord</b><span>${esc(f.label)}</span></button>`).join('');
  $('radius').value = page.theme.radius;
  $('radius-val').textContent = page.theme.radius + ' px';
}

$('palettes').addEventListener('click', (e) => {
  const s = e.target.closest('[data-pal]');
  if (!s) return;
  page.theme.palette = s.dataset.pal;
  commit(); renderThemePanel(); renderTheme();
});
$('fonts').addEventListener('click', (e) => {
  const s = e.target.closest('[data-font]');
  if (!s) return;
  page.theme.fonts = s.dataset.font;
  commit(); renderThemePanel(); renderTheme();
});
$('radius').addEventListener('input', () => {
  page.theme.radius = Number($('radius').value);
  $('radius-val').textContent = page.theme.radius + ' px';
  renderTheme();
  clearTimeout(textTimer);
  textTimer = setTimeout(commit, 400);
});

function showTab(which) {
  $('tab-page').setAttribute('aria-selected', String(which === 'page'));
  $('tab-theme').setAttribute('aria-selected', String(which === 'theme'));
  $('panel-page').hidden = which !== 'page';
  $('panel-theme').hidden = which !== 'theme';
}
$('tab-page').addEventListener('click', () => showTab('page'));
$('tab-theme').addEventListener('click', () => showTab('theme'));

/* ---------- top bar ---------- */

$('undo').addEventListener('click', () => { if (hIndex > 0) restore(hIndex - 1); });
$('redo').addEventListener('click', () => { if (hIndex < history.length - 1) restore(hIndex + 1); });
$('dev-desktop').addEventListener('click', () => setDevice(false));
$('dev-mobile').addEventListener('click', () => setDevice(true));
function setDevice(mobile) {
  $('frame-wrap').classList.toggle('is-mobile', mobile);
  $('dev-desktop').setAttribute('aria-pressed', String(!mobile));
  $('dev-mobile').setAttribute('aria-pressed', String(mobile));
}
$('preview').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([renderPage(page, location.href)], { type: 'text/html' }));
  window.open(url, '_blank');
});
$('reset').addEventListener('click', () => {
  if (!confirm('Revii la pagina de pornire? Modificările tale se pierd.')) return;
  page = defaultPage();
  selId = null;
  commit(); renderAll();
});

function shortcuts(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    const active = (e.target.ownerDocument || document).activeElement;
    if (active && (active.isContentEditable || /INPUT|TEXTAREA/.test(active.tagName))) return;
    e.preventDefault();
    if (e.shiftKey) $('redo').click(); else $('undo').click();
  }
  if (e.key === 'Escape' && !$('library').hidden) $('library').hidden = true;
}
document.addEventListener('keydown', shortcuts);

/* ---------- boot ---------- */

function renderAll() {
  renderList();
  renderInspector();
  renderThemePanel();
  renderCanvas();
  syncUndo();
}

initFrame();
