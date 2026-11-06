'use strict';
// Approved recovery exceptions are field-specific; all other accepted pack data stays locked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const plain = x => JSON.parse(JSON.stringify(x));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const neutralBooking = 'Vezi serviciile și programul de mai jos.';
const copies = [
  ['mireasa', 'hero.text', 'Păr prins parțial, ondulații și un accesoriu discret. Trei look-uri de inspirație, nu lucrări atribuite acestui studio; detaliile sunt decupate din aceleași imagini.', 'Păr prins parțial, ondulații și un accesoriu discret. Trei look-uri de inspirație, nu lucrări ale acestui studio.'],
  ['mireasa', 'about.text', 'Studio Forma este un nume de exemplu. Adaugă aici numele, specializarea și portretul real al profesionistului, cu acord. Nu atribuim acestor fotografii o experiență sau o echipă inventată.', 'Prezentare de exemplu. Adaugă numele, specializarea și portretul real al profesionistului, cu acordul persoanei. Înlocuiește numele Studio Forma cu numele afacerii tale.'],
  ['renovari', 'text.text', 'În acest cadru: lavoar dublu, oglinzi rotunde și zonă de duș. Detaliile sunt decupaje din aceeași imagine, nu etape ale unei renovări. Pentru un proiect real, completează localitatea, lucrarea executată și datele documentate.', 'Lavoar dublu, oglinzi rotunde și zonă de duș. Fotografie ilustrativă, nu o lucrare a echipei.'],
  ['renovari', 'about.text', 'Completează numele echipei, zona, specializările și condițiile reale de lucru. Renovări Popescu este un nume de exemplu, fără istoric, garanții sau termene inventate.', 'Prezentare de exemplu. Adaugă numele echipei, zona de lucru, specializările și condițiile reale ale serviciilor. Înlocuiește numele Renovări Popescu cu numele afacerii tale.'],
  ['renovari', 'faq.items.2.a', 'Cere condițiile reale de garanție în scris. Acest design nu stabilește o garanție pentru o echipă.', 'Cere condițiile de garanție în scris, pentru lucrările și materialele din oferta ta.'],
  ['renovari', 'faq.items.0.a', 'Nu se poate stabili dintr-o fotografie de exemplu. Cere evaluarea, lucrările incluse și termenul aplicabil spațiului tău.', 'Costul și durata se stabilesc după evaluarea spațiului. Cere lucrările incluse, materialele și termenul aplicabil înainte de începere.'],
  ['cosmetica', 'about.text', 'Adaugă numele persoanei care efectuează tratamentele și pregătirea sa reală. Fotografia ilustrează un spațiu de îngrijire; nu prezentăm persoane din fotografii drept echipa cabinetului.', 'Prezentare de exemplu. Adaugă numele persoanei care efectuează tratamentele și pregătirea sa reală. Fotografiile sunt ilustrative, nu prezintă echipa cabinetului.'],
  ['salon', 'text.text', 'Prezintă aici stilistele reale și serviciile fiecăreia. Numele, calificările și fotografiile se adaugă cu acordul persoanelor; nu am inventat o echipă pentru acest design.', 'Exemplu de prezentare a echipei. Adaugă numele, serviciile și fotografiile persoanelor care lucrează în salon, cu acordul lor.'],
  ['profesionisti', 'faq.items.1.a', 'Cere condițiile și onorariul aplicabil înainte de consultație. Acest design nu stabilește tarife pentru un cabinet real.', 'Cere condițiile și onorariul aplicabil înainte de consultație. Tarifele se confirmă direct cu cabinetul.'],
  ['profesionisti', 'text.text', 'Prezintă problema și documentele existente. Cabinetul confirmă dacă o poate prelua și în ce condiții; rezultatul unui dosar nu poate fi garantat de un șablon.', 'Prezintă problema și documentele existente. Cabinetul confirmă dacă o poate prelua și în ce condiții. Niciun rezultat nu este garantat.'],
  ['renovari', 'hero.text', 'Băi și bucătării, de la evaluare la finisaj. Fotografiile sunt exemple de amenajare, nu lucrări atribuite echipei. Nu inventăm suprafețe, durate sau transformări înainte/după.', 'Băi și bucătării, de la evaluare la finisaj. Fotografiile sunt exemple de amenajare, nu lucrări ale echipei.'],
  ['consultanta', 'about.text', 'Andreea Vlad este un nume de exemplu. Înlocuiește-l cu numele tău și adaugă experiența relevantă, verificabilă. Un portret autentic poate fi adăugat aici; nu folosim un portret de salon pentru a inventa o identitate.', 'Prezentare de exemplu. Adaugă numele consultantului, experiența relevantă și un portret autentic, cu acordul persoanei.'],
  ['consultanta', 'text.text', 'Un blocaj punctual poate începe cu o sesiune. Pentru o schimbare de mod de lucru, stabilim un ritm și un scop clar. Nu există un rezultat garantat de acest design.', 'Un blocaj punctual poate începe cu o sesiune. Pentru o schimbare de mod de lucru, stabilim un ritm și un scop clar. Rezultatele depind de situație și de aplicarea pașilor agreați.'],
  ['contabilitate', 'about.title', 'Un contact responsabil, nu un portret împrumutat.', 'Persoana ta de contact'],
  ['contabilitate', 'about.text', 'Completează persoana de contact și calificările reale ale biroului. Cifra Bună este un nume de exemplu; nu îi atribuim clienți, certificări sau o echipă fictivă.', 'Prezentare de exemplu. Adaugă persoana de contact și calificările verificabile ale biroului. Înlocuiește numele Cifra Bună cu numele afacerii tale.'],
];
const oldIntros = {
  salon: 'Alegi serviciul, ziua și ora. Primești confirmarea pe email.',
  profesionisti: 'Alegi tipul consultației, ziua și ora. Îți confirmăm pe email.',
  gol: 'Alegi serviciul, ziua și ora. Primești confirmarea pe email.',
  cosmetica: 'Alegi tratamentul, ziua și ora. Primești confirmarea pe email.',
  consultanta: 'Alegi ziua și ora. Îți trimit linkul de apel pe email.',
};
function assertBooking(actual, before) {
  assert.deepEqual(plain(actual), { ...plain(before), text: neutralBooking });
}
function expectedPacks() {
  const dir = path.join(root, '04-QA-Evidence/Implementation-2026-11-05/integrated-recovery-QA/original-control/builder/blocks');
  const hashes = ['d0222f627c26685f6f797ea842d4169296c635bd0a49f8d2905cab982023b5d5', '5c138a03ecad6af848bd1d8880e74afb4a6c4eba7d56ff81fa33cc844dc6d652'];
  const c = { module: { exports: {} } };
  const sources = ['packs.js', 'packs-more.js'].map((name, i) => {
    const s = fs.readFileSync(path.join(dir, name), 'utf8'); assert.equal(sha(s), hashes[i]); return s;
  });
  vm.runInNewContext(sources[0], c); const packs = c.module.exports;
  vm.runInNewContext(sources[1], c); c.module.exports(packs);
  const expected = plain(packs);
  for (const [id, field, before, after] of copies) {
    const keys = field.split('.'); const last = keys.pop();
    const obj = keys.reduce((o, k) => o[k], expected[id].content);
    assert.equal(obj[last], before, id + '/' + field); obj[last] = after;
  }
  assert.equal(expected.renovari.pages[0].blocks[4][2].data.text, 'Fronturi închise la culoare, blat deschis și corpuri suspendate de iluminat. Cadru ilustrativ, nu proiect documentat al echipei. Nu atribuim acestei imagini o durată, o suprafață sau o adresă fictivă.');
  expected.renovari.pages[0].blocks[4][2].data.text = 'Fronturi închise la culoare, blat deschis și corpuri suspendate de iluminat. Fotografie ilustrativă, nu un proiect al echipei.';
  for (const [id, old] of Object.entries(oldIntros)) {
    assert.equal(expected[id].content.booking.text, old); expected[id].content.booking.text = neutralBooking;
  }
  assert.deepEqual(expected.gol.pages, [{ name: 'Acasă', blocks: [['hero', 'centered'], ['text', 'left']] }]);
  expected.gol.pages = [{ name: 'Acasă', blocks: [] }];
  return expected;
}
function assertPacks(actual) { assert.deepEqual(plain(actual), expectedPacks()); }
function undoFirst5Copy(source) {
  for (const [id, , before, after] of copies.filter(([id]) => ['salon', 'profesionisti'].includes(id))) {
    assert.equal(source.split(after).length - 1, 1, id + ' exact approved copy'); source = source.replace(after, before);
  }
  // Exact named booking lines only, never a global text-property exclusion.
  for (const [title, old] of [['Programează-te online', oldIntros.salon], ['Programează o consultație', oldIntros.profesionisti]]) {
    const after = `booking: { title: '${title}', text: '${neutralBooking}'`;
    assert.equal(source.split(after).length - 1, 1); source = source.replace(after, `booking: { title: '${title}', text: '${old}'`);
  }
  return source;
}
function assertFirst5Source(source) {
  const restored = undoFirst5Copy(source).replace(/^    actions: .*\n/gm, '').replace(/cta: 'Trimite o cerere'/g, "cta: 'Comandă pe WhatsApp'")
    .replace(/^(      form: \{ title: '(?:O masă pentru voi|O întrebare înainte de consultație|Povestește-ne despre ocazie)'.*)lPhone: 'Telefon'/gm, "$1lPhone: 'Telefon sau email'");
  assert.equal(sha(restored), 'b32f2109df1217127cb2ae56c12cd2109847578cb34b451904c19eb86af79ef9');
}
const disclosure = 'Conectezi contul Instagram prin Instafidget, iar postările apar pe site. Serviciul este inclus 12 luni; apoi treci la Instafidget Free, cu filigran.';
function assertLandingCopy(index) {
  assert.doesNotMatch(index, /\bWidgetul\b|partner feed \(iframe\)/i);
  const section = index.match(/<section class="gift-section" aria-labelledby="gift-title">[\s\S]*?<\/section>/g);
  assert.equal(section?.length, 1, 'exact Ce primești feature section');
  const card = `<div class="gift-card">\n          <h3>Instagram pe site</h3>\n          <p>${disclosure}</p>\n        </div>`;
  assert.equal(section[0].split(card).length - 1, 1, 'C02 only in Instagram feature');
  const remainder = index.replace(card, '').replace(/href="[^"]*"/gi, 'href=""');
  assert.doesNotMatch(remainder, /Instafidget/i, 'partner naming remains forbidden elsewhere');
}
module.exports = { assertBooking, assertPacks, expectedPacks, assertFirst5Source, assertLandingCopy, neutralBooking, disclosure };
