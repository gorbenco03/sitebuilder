'use strict';
const assert = require('node:assert/strict');
function section(source, start, end) {
  const a = source.indexOf(start), b = end === null ? source.length : source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'nonempty unique preservation region ' + start);
  assert.equal(source.indexOf(start, a + start.length), -1, 'unique start ' + start);
  return source.slice(a, b);
}
const notice = ", {\n    label: 'Pagini juridice incomplete — doar pentru validare în dezvoltare. Înainte de utilizarea comercială, proprietarul trebuie să furnizeze și să aprobe identitatea legală (denumire, CUI/VAT, sediu), operatorul/procesatorii, retenția, subprocesorii, jurisdicția și textul final. Câmpurile PLACEHOLDER rămân de completat.',\n  }";
function assertRecognitionPreserved(source, before) {
  const regions = [
    ['const STORE', 'const EDITOR_CSS'],
    ['function pubStep(name)', 'function closePublish()'],
    ['/**\n * Magic-link sign-in', "$('pub-auth').addEventListener"],
    ['/* ---------- starter-aware identity ---------- */', null],
  ];
  for (const [a, b] of regions) assert.equal(section(source, a, b), section(before, a, b), a);
  // Reverse only the six literal PC01 layout hunks, then the earlier B01 declaration.
  let canvas = section(source, 'const EDITOR_CSS', '/* ---------- inspector ---------- */');
  const layout = [
    [
      `.ed-label{position:absolute;top:0;left:0;z-index:40;display:none;background:#2438d6;color:#fff;font:600 12px/1 -apple-system,Helvetica,Arial,sans-serif;padding:6px 9px;border-radius:0 0 6px 0}
.blk:hover>.ed-label,.blk.is-sel>.ed-label{display:block}
.ed-tools{position:absolute;top:10px;right:10px;max-width:calc(100% / var(--ed-z,1) - 20px);box-sizing:border-box;flex-wrap:wrap;justify-content:flex-end;z-index:41;display:flex;gap:4px;background:#fff;border-radius:10px;padding:4px;box-shadow:0 6px 24px rgba(0,0,0,.25)}`,
      `.ed-chrome{position:absolute;top:0;left:0;width:100%;z-index:43;display:none;pointer-events:none}
.blk:hover>.ed-chrome,.blk.is-sel>.ed-chrome{display:grid;gap:6px}
.blk.is-sel>.ed-chrome{z-index:44}
.ed-label{justify-self:start;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;background:#2438d6;color:#fff;font:600 12px/1.35 -apple-system,Helvetica,Arial,sans-serif;padding:6px 9px;border-radius:0 0 6px 0;pointer-events:auto}
.ed-tools{justify-self:end;max-width:100%;box-sizing:border-box;flex-wrap:wrap;justify-content:flex-end;display:flex;gap:4px;background:#fff;border-radius:10px;padding:4px;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:auto}`,
    ],
    [
      `.ed-label,.ed-tools,.ed-add,.ed-tt{zoom:var(--ed-z,1)}`,
      `.ed-chrome,.ed-add,.ed-tt{zoom:var(--ed-z,1)}
.ed-chrome>.ed-add{position:static;justify-self:center;transform:none;opacity:1;pointer-events:auto;zoom:1}`,
    ],
    [
      `  const shared = isShared(b.id);
  const label = doc.createElement('div');
  label.className = 'ed-label';
  label.textContent = def.label + ' · ' + def.variants[b.variant] + (shared ? ' · pe toate paginile' : '');
  el.appendChild(label);`,
      `  const shared = isShared(b.id);
  const chrome = doc.createElement('div');
  chrome.className = 'ed-chrome';
  const label = doc.createElement('div');
  label.className = 'ed-label';
  label.textContent = def.label + ' · ' + def.variants[b.variant] + (shared ? ' · pe toate paginile' : '');
  chrome.appendChild(label);
  el.appendChild(chrome);`,
    ],
    [
      `    if (tools.innerHTML) el.appendChild(tools);`,
      `    if (tools.innerHTML) chrome.appendChild(tools);`,
    ],
    [
      `    add.innerHTML = '<button type="button" data-act="add">+ Adaugă bloc aici</button>';
    el.appendChild(add);`,
      `    add.innerHTML = '<button type="button" data-act="add">+ Adaugă bloc aici</button>';
    if (b.id === selId) chrome.appendChild(add);
    else el.appendChild(add);`,
    ],
    [
      `    el.querySelectorAll(':scope > .ed-tools').forEach((x) => x.remove());
  });
  const el = doc.querySelector(\`.blk[data-id="\${id}"]\`);
  if (el) {
    el.querySelectorAll(':scope > .ed-label, :scope > .ed-add').forEach((x) => x.remove());`,
      `    el.querySelectorAll(':scope > .ed-chrome > .ed-tools').forEach((x) => x.remove());
  });
  const el = doc.querySelector(\`.blk[data-id="\${id}"]\`);
  if (el) {
    el.querySelectorAll(':scope > .ed-chrome, :scope > .ed-add').forEach((x) => x.remove());`,
    ],
  ];
  const wrapping = 'max-width:calc(100% / var(--ed-z,1) - 20px);box-sizing:border-box;flex-wrap:wrap;justify-content:flex-end;';
  const original = section(before, 'const EDITOR_CSS', '/* ---------- inspector ---------- */');
  const b01 = original.replace('right:10px;z-index:41;', 'right:10px;' + wrapping + 'z-index:41;');
  if (canvas !== b01) {
    for (const [old, approved] of layout) {
      assert.equal(b01.split(old).length - 1, 1, 'unique exact PC01 input fragment');
      assert.equal(canvas.split(approved).length - 1, 1, 'unique exact PC01 output fragment');
      canvas = canvas.replace(approved, old);
    }
  }
  assert.equal(canvas.split(wrapping).length - 1, 1);
  assert.equal(canvas.replace(wrapping, ''), original);
  const checklist = section(source, 'function renderChecklist()', '/* ---------- starter-aware identity ---------- */');
  assert.equal(checklist.split(notice).length - 1, 1, 'only exact approved F11 notice');
  assert.equal(checklist.replace(notice, ''), section(before, 'function renderChecklist()', '/* ---------- starter-aware identity ---------- */'));
}
module.exports = { section, assertRecognitionPreserved };
