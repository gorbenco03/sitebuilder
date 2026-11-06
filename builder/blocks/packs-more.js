'use strict';
/**
 * builder/blocks/packs-more.js — more starter packs, plus "De la zero".
 *
 * Loaded after packs.js; adds to window.SB_PACKS (in Node: call the export with the packs). A pack only lists content
 * for the blocks its pages use: any other block a customer adds later falls
 * back to the neutral placeholder content of the blank pack, never to
 * another business's text.
 */

(function (root) {
const T = '@tpl/';

function addMore(P) {
const im = (dir, n) => `${T}${n.startsWith('nov05-') ? 'blocks' : dir}/images/${n}.jpg`;
const many = (dir, names) => names.map((n) => im(dir, n));

/** Neutral placeholder photo for the blank site. */
const PH = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900' viewBox='0 0 1200 900'><rect width='1200' height='900' fill='#e6e6e2'/><g fill='none' stroke='#a9a9a3' stroke-width='14' stroke-linejoin='round'><rect x='470' y='330' width='260' height='200' rx='18'/><path d='M470 480l70-70 60 60 40-40 90 90'/><circle cx='650' cy='385' r='18'/></g><text x='600' y='600' text-anchor='middle' font-family='Helvetica, Arial, sans-serif' font-size='34' fill='#8d8d87'>Poza ta aici</text></svg>`);

P.gol = {
  label: 'De la zero', desc: 'O pagină goală, completezi tu tot', blank: true,
  theme: { palette: 'alb', fonts: 'modern', radius: 8 },
  images: [],
  header: { brand: 'Numele afacerii', cta: 'Contactează-ne' },
  footer: { brand: 'Numele afacerii', text: 'Adresă · telefon · email' },
  content: {
    hero: { eyebrow: 'Ce faci, unde', title: 'Titlul principal al site-ului', text: 'O propoziție sau două despre ce oferi și pentru cine.', cta: 'Butonul principal', cta2: 'Al doilea buton', image: PH },
    about: { title: 'Despre noi', text: 'Povestește pe scurt cine ești, de când lucrezi și ce te face diferit.', image: PH },
    menu: { title: 'Prețuri', note: 'O notă scurtă despre prețuri.', items: [
      { name: 'Primul serviciu sau produs', desc: 'Detalii scurte', price: '0 lei', image: PH },
      { name: 'Al doilea serviciu sau produs', desc: 'Detalii scurte', price: '0 lei', image: PH },
      { name: 'Al treilea serviciu sau produs', desc: 'Detalii scurte', price: '0 lei', image: PH },
    ] },
    gallery: { title: 'Galerie', items: [PH, PH, PH, PH, PH, PH].map((image) => ({ image })) },
    reviews: { title: 'Ce spun clienții', items: [
      { quote: 'Scrie aici o recenzie reală de la un client.', author: 'Numele clientului' },
      { quote: 'A doua recenzie.', author: 'Numele clientului' },
      { quote: 'A treia recenzie.', author: 'Numele clientului' },
    ] },
    hours: { title: 'Program și adresă', address: 'Strada, numărul, orașul', phone: 'Telefon', hours: [{ day: 'Luni – Vineri', time: '9:00 – 18:00' }, { day: 'Sâmbătă – Duminică', time: 'închis' }], image: PH },
    cta: { title: 'Un îndemn scurt pentru clienți', text: 'Spune-le ce să facă mai departe.', cta: 'Butonul' },
    faq: { title: 'Întrebări frecvente', items: [{ q: 'Prima întrebare?', a: 'Răspunsul.' }, { q: 'A doua întrebare?', a: 'Răspunsul.' }] },
    text: { eyebrow: 'Text mic', title: 'Titlul secțiunii', text: 'Scrie aici textul. Dă click pe orice text de pe pagină ca să-l schimbi.' },
    columns: { title: 'Titlul secțiunii', intro: 'O introducere scurtă.', cols: [
      { image: PH, title: 'Prima coloană', text: 'Un text scurt.', cta: 'Link' },
      { image: PH, title: 'A doua coloană', text: 'Un text scurt.', cta: 'Link' },
      { image: PH, title: 'A treia coloană', text: 'Un text scurt.', cta: 'Link' },
    ] },
    team: { title: 'Echipa', people: [{ image: PH, name: 'Nume Prenume', role: 'Rol' }, { image: PH, name: 'Nume Prenume', role: 'Rol' }, { image: PH, name: 'Nume Prenume', role: 'Rol' }] },
    booking: { title: 'Programează-te online', text: 'Vezi serviciile și programul de mai jos.', services: [{ name: 'Primul serviciu', min: '30' }, { name: 'Al doilea serviciu', min: '60' }], week: [{ on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }], phone: 'Telefon' },
    form: { title: 'Scrie-ne', text: 'Îți răspundem cât de repede putem.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Mesaj', cta: 'Trimite', address: 'Adresă', phone: 'Telefon', email: 'email@exemplu.ro' },
    instagram: { title: 'Pe Instagram', handle: '@contul.tau', cta: 'Urmărește-ne', images: [PH, PH, PH, PH, PH, PH] },
  },
  pages: [
    { name: 'Acasă', blocks: [] },
  ],
};

P.gol.actions = { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'about' }, columns: { 'cols.0.cta': 'contact', 'cols.1.cta': 'contact', 'cols.2.cta': 'contact' }, cta: { cta: 'contact' } };

// One editable opening/brunch schedule, shared by all starter pages (F10).
const cafeOpening = 'Luni – Vineri 08:00 – 22:00; Sâmbătă – Duminică 09:00 – 23:00';
const cafeBrunch = 'Brunch: Luni – Vineri 08:00 – 15:00; Sâmbătă – Duminică 09:00 – 15:00';
P.cafenea = {
  label: 'Cafenea și brunch', desc: 'Cafenele, bistrouri, brunch',
  theme: { palette: 'verde', fonts: 'modern', radius: 2 },
  images: many('product-menu', ['tv-a1', 'tv-hero', 'tv-ig5', 'tv-m3', 'tv-m1', 'tv-m2', 'tv-ig3']),
  header: { brand: 'Bistro Tei', cta: 'Rezervă o masă' },
  footer: { brand: 'Bistro Tei', text: 'Date de exemplu · Strada Memorandumului 4, Cluj-Napoca · 07xx xxx xxx' },
  actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'menu' }, cta: { cta: 'contact' } },
  content: {
    hero: { eyebrow: 'Cafenea & brunch · Cluj-Napoca · exemplu', title: 'Dimineți care nu se grăbesc.', text: `O cafea, un mic dejun, o masă la umbră. Program de exemplu: ${cafeOpening}. ${cafeBrunch}.`, cta: 'Rezervă o masă', cta2: 'Vezi meniul', image: im('product-menu', 'tv-a1') },
    about: { title: 'La o masă lângă fereastră', text: 'Terasa și interiorul ilustrează două feluri de a sta la cafea. Fotografii de exemplu, nu o prezentare documentată a aceluiași local; înlocuiește-le cu locul tău.', image: im('product-menu', 'tv-hero') },
    columns: { title: 'Cafea și ceva bun alături', intro: 'Două idei de început. Selecție și fotografii ilustrative; meniul complet este separat.', cols: [
      { image: im('product-menu', 'tv-ig5'), title: 'Cafea și foietaj', text: 'O pauză scurtă la o masă afară. Confirmă selecția și prețurile din meniul zilei.', cta: 'Meniul complet' },
      { image: im('product-menu', 'tv-m3'), title: 'Micul dejun pe îndelete', text: `Ouă, pâine și cafea. ${cafeBrunch}.`, cta: 'Vezi selecția de brunch' },
    ] },
    menu: { title: 'Cafea, brunch și prânz', note: `Prețuri de exemplu. ${cafeOpening}. ${cafeBrunch}. Cere lista de ingrediente și alergeni.`, items: [
      { name: 'Espresso', desc: 'Cafea scurtă', price: '12 lei', image: '' },
      { name: 'Cappuccino', desc: 'Espresso și lapte; întreabă de alternative', price: '16 lei', image: '' },
      { name: 'Mic dejun cu ouă', desc: 'Ouă, pâine și unt', price: '29 lei', image: im('product-menu', 'tv-m3') },
      { name: 'Salată de sezon', desc: 'Frunze, legume și semințe', price: '34 lei', image: im('product-menu', 'tv-m1') },
      { name: 'Paste cu roșii', desc: 'Roșii și verdețuri', price: '38 lei', image: im('product-menu', 'tv-m2') },
      { name: 'Platou de brânzeturi', desc: 'Brânzeturi, fructe și biscuiți sărați', price: '46 lei', image: im('product-menu', 'tv-ig3') },
    ] },
    hours: { title: 'Program de exemplu · cafea și brunch', address: 'Adresă de exemplu · Strada Memorandumului 4, Cluj-Napoca', phone: '07xx xxx xxx', hours: [
      { day: 'Luni – Vineri', time: '08:00 – 22:00' }, { day: 'Sâmbătă – Duminică', time: '09:00 – 23:00' },
      { day: 'Brunch · Luni – Vineri', time: '08:00 – 15:00' }, { day: 'Brunch · Sâmbătă – Duminică', time: '09:00 – 15:00' },
    ], image: im('product-menu', 'tv-hero') },
    cta: { title: 'O masă pentru dimineața voastră', text: 'Spune-ne ziua, ora și numărul de persoane. Așteaptă confirmarea localului.', cta: 'Rezervă o masă' },
    text: { eyebrow: 'Meniul complet · exemplu editabil', title: 'De la prima cafea la prânz.', text: `${cafeOpening}. ${cafeBrunch}. Înlocuiește selecția și programul cu oferta localului tău.` },
    instagram: { title: 'Pe Instagram', handle: '@bistrotei', cta: 'Urmărește-ne', images: [] },
    form: { title: 'Cere o masă', text: 'Cererea nu confirmă rezervarea. Programul de mai sus este un exemplu editabil.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ziua, ora și numărul de persoane', cta: 'Trimite cererea', address: 'Adresă de exemplu · Strada Memorandumului 4, Cluj-Napoca', phone: '07xx xxx xxx', email: '' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['hours', 'columns'], ['columns', 'images'], ['instagram', 'strip'], ['cta', 'band']] },
    { name: 'Meniu', blocks: [['text', 'split'], ['menu', 'list']] },
    { name: 'Contact', blocks: [['hours', 'photo'], ['form', 'info']] },
  ],
};

P.mireasa = {
  label: 'Coafură și machiaj de mireasă', desc: 'Make-up artist, coafuri de eveniment',
  theme: { palette: 'ivoriu', fonts: 'editorial', radius: 0 },
  images: many('portfolio', ['sf-ext2', 'sf-ext3', 'sf-mua1', 'nov05-bridal-waves-detail', 'nov05-bridal-waves-accessory', 'nov05-bridal-bun-detail', 'nov05-bridal-bun-accessory', 'nov05-bridal-natural-detail', 'nov05-bridal-natural-eye']),
  header: { brand: 'Studio Forma', cta: 'Verifică data' },
  footer: { brand: 'Studio Forma', text: 'Zonă de exemplu · București și deplasări în țară · 07xx xxx xxx' },
  actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'gallery' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'menu', 'cols.2.cta': 'contact' }, cta: { cta: 'contact' } },
  content: {
    hero: { eyebrow: '01 · Ondulații lejere · look ilustrativ', title: 'Coafură și machiaj, în ritmul zilei tale.', text: 'Păr prins parțial, ondulații și un accesoriu discret. Trei look-uri de inspirație, nu lucrări ale acestui studio.', cta: 'Verifică data', cta2: 'Vezi detaliile', image: im('portfolio', 'sf-ext2') },
    gallery: { title: '01 · Ondulații lejere — detalii din același cadru', items: ['nov05-bridal-waves-detail', 'nov05-bridal-waves-accessory'].map(n => ({ image: im('portfolio', n) })) },
    about: { title: 'Persoana din spatele look-ului tău', text: 'Prezentare de exemplu. Adaugă numele, specializarea și portretul real al profesionistului, cu acordul persoanei. Înlocuiește numele Studio Forma cu numele afacerii tale.', image: '' },
    menu: { title: 'Probă, coafură, machiaj', note: 'Pachete și prețuri de exemplu. Deplasarea, retușurile și condițiile de rezervare se confirmă separat.', items: [
      { name: 'Machiaj de mireasă', desc: 'Probă și machiaj în ziua nunții, în acest exemplu', price: '650 lei', image: '' },
      { name: 'Coafură de mireasă', desc: 'Probă și coafură în ziua nunții, în acest exemplu', price: '600 lei', image: '' },
      { name: 'Pachet complet', desc: 'Coafură și machiaj; programul și retușurile se stabilesc împreună', price: '1.150 lei', image: '' },
      { name: 'Machiaj pentru invitate', desc: 'Serviciu separat, fără probă inclusă în acest exemplu', price: '250 lei', image: '' },
    ] },
    columns: { title: 'De la probă la ziua nunții', intro: 'Parcurs de exemplu, de adaptat serviciilor tale.', cols: [
      { title: 'Proba', text: 'Discutăm rochia, accesoriile și look-ul dorit. Testăm împreună ce vrei să păstrezi.', cta: 'Vezi pachetele' },
      { title: 'Ziua nunții', text: 'Stabilim locul, ora la care trebuie să fii gata și ordinea pregătirilor.', cta: 'Condițiile pachetelor' },
      { title: 'Verifică data', text: 'Trimite data și localitatea. Cererea nu este o rezervare până la confirmare.', cta: 'Verifică data' },
    ] },
    cta: { title: 'Cum arată ziua voastră?', text: 'Spune-ne data, localitatea și serviciul dorit. Disponibilitatea se confirmă direct cu profesionistul.', cta: 'Verifică data' },
    faq: { title: 'Înainte să rezervi', items: [
      { q: 'Ce este inclus în probă?', a: 'Lista de mai sus este un exemplu. Confirmă durata probei, serviciile și eventualele retușuri în oferta reală.' },
      { q: 'Se poate lucra la locație?', a: 'Discută localitatea, transportul și condițiile spațiului înainte de confirmarea rezervării.' },
    ] },
    text: { eyebrow: 'Pachete · exemple editabile', title: 'Alegem look-ul, apoi planificăm ziua.', text: 'Fotografiile sunt inspirație. Nu promit un rezultat identic sau o durată de rezistență; serviciul potrivit se discută la probă.' },
    form: { title: 'Verifică data', text: 'O cerere, nu o rezervare confirmată. Datele studio-ului sunt exemple de înlocuit.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Data, localitatea și serviciul dorit', cta: 'Trimite cererea', address: 'Zonă de exemplu · București', phone: '07xx xxx xxx', email: 'salut@studioforma.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [
      ['hero', 'full'], ['gallery', 'grid'],
      ['gallery', 'mosaic', { data: { title: '02 · Coc cu accesoriu — look ilustrativ și detalii din același cadru', items: ['sf-ext3', 'nov05-bridal-bun-detail', 'nov05-bridal-bun-accessory'].map(n => ({ image: im('portfolio', n) })) } }],
      ['gallery', 'mosaic', { data: { title: '03 · Machiaj luminos — look ilustrativ și detalii din același cadru', items: ['sf-mua1', 'nov05-bridal-natural-detail', 'nov05-bridal-natural-eye'].map(n => ({ image: im('portfolio', n) })) } }],
      ['cta', 'band'],
    ] },
    { name: 'Pachete', blocks: [['text', 'split'], ['menu', 'list'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'statement'], ['columns', 'numbers']] },
    { name: 'Rezervă', blocks: [['form', 'info']] },
  ],
};

P.renovari = {
  label: 'Renovări interioare', desc: 'Băi, bucătării, amenajări',
  theme: { palette: 'beton', fonts: 'modern', radius: 0 },
  images: many('local-service', ['pr-ig2', 'pr-baie1', 'pr-buc1', 'nov05-bathroom-detail', 'nov05-bathroom-shower', 'nov05-kitchen-detail', 'nov05-kitchen-light']),
  header: { brand: 'Renovări Popescu', cta: 'Cere o ofertă' },
  footer: { brand: 'Renovări Popescu', text: 'Zonă de exemplu · București și Ilfov · 07xx xxx xxx' },
  actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'gallery' }, columns: { 'cols.0.cta': 'contact', 'cols.1.cta': 'contact', 'cols.2.cta': 'contact', 'cols.3.cta': 'contact' }, cta: { cta: 'contact' } },
  content: {
    hero: { eyebrow: 'Renovări interioare · București și Ilfov · exemplu', title: 'Un spațiu întreg. Atenție la fiecare detaliu.', text: 'Băi și bucătării, de la evaluare la finisaj. Fotografiile sunt exemple de amenajare, nu lucrări ale echipei.', cta: 'Cere o ofertă', cta2: 'Vezi exemplele', image: im('local-service', 'pr-ig2') },
    gallery: { title: '01 · Baie cu finisaje gri — exemplu și detalii din același cadru', items: ['pr-baie1', 'nov05-bathroom-detail', 'nov05-bathroom-shower'].map(n => ({ image: im('local-service', n) })) },
    text: { eyebrow: '01 · Baie · context ilustrativ', title: 'Suprafețe, lumină, rosturi.', text: 'Lavoar dublu, oglinzi rotunde și zonă de duș. Fotografie ilustrativă, nu o lucrare a echipei.' },
    about: { title: 'Cine preia lucrarea', text: 'Prezentare de exemplu. Adaugă numele echipei, zona de lucru, specializările și condițiile reale ale serviciilor. Înlocuiește numele Renovări Popescu cu numele afacerii tale.', image: '' },
    menu: { title: 'Ce evaluăm înainte de ofertă', note: 'Servicii de exemplu. Costul depinde de starea spațiului, lucrările și materialele agreate.', items: [
      { name: 'Baie', desc: 'Instalații, suport, placări și obiecte sanitare — stabilim ce este necesar', price: 'după evaluare', image: '' },
      { name: 'Bucătărie', desc: 'Instalații, finisaje și pregătirea montajului de mobilier', price: 'după evaluare', image: '' },
      { name: 'Finisaje interioare', desc: 'Pereți, pardoseli și detalii de îmbinare', price: 'după evaluare', image: '' },
    ] },
    columns: { title: 'De la spațiul tău la oferta scrisă', intro: 'Pași de exemplu. Calendarul și condițiile se confirmă pentru fiecare lucrare.', cols: [
      { title: 'Descrii spațiul', text: 'Localitatea, tipul camerei și ce vrei schimbat. Fotografiile ajută la prima discuție.', cta: 'Descrie lucrarea' },
      { title: 'Evaluăm', text: 'Stabilim ce trebuie verificat la fața locului și ce măsurători sunt necesare.', cta: 'Cere evaluarea' },
      { title: 'Agreăm oferta', text: 'Lucrări incluse, materiale, costuri și termen, toate confirmate în scris.', cta: 'Cere o ofertă' },
      { title: 'Verificăm predarea', text: 'Lista lucrărilor și condițiile de recepție se stabilesc înainte de începere.', cta: 'Discută condițiile' },
    ] },
    cta: { title: 'Ce vrei să schimbi în spațiul tău?', text: 'Localitatea și câteva detalii despre lucrare sunt primul pas, nu o ofertă sau un termen confirmat.', cta: 'Cere o ofertă' },
    faq: { title: 'Înainte să înceapă lucrarea', items: [
      { q: 'Cât durează și cât costă?', a: 'Costul și durata se stabilesc după evaluarea spațiului. Cere lucrările incluse, materialele și termenul aplicabil înainte de începere.' },
      { q: 'Cine cumpără materialele?', a: 'Agreați în ofertă materialele, responsabilitatea achiziției și cum se aprobă eventualele schimbări.' },
      { q: 'Există garanție?', a: 'Cere condițiile de garanție în scris, pentru lucrările și materialele din oferta ta.' },
    ] },
    form: { title: 'Cere o ofertă', text: 'Descrie spațiul și zona. Echipa confirmă separat evaluarea și disponibilitatea.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Localitatea, spațiul și ce vrei să renovezi', cta: 'Trimite cererea', address: 'Zonă de exemplu · București și Ilfov', phone: '07xx xxx xxx', email: 'oferte@renovaripopescu.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [
      ['hero', 'split'], ['gallery', 'mosaic'], ['text', 'split'],
      ['gallery', 'mosaic', { data: { title: '02 · Bucătărie cu insulă — exemplu și detalii din același cadru', items: ['pr-buc1', 'nov05-kitchen-detail', 'nov05-kitchen-light'].map(n => ({ image: im('local-service', n) })) } }],
      ['text', 'split', { data: { eyebrow: '02 · Bucătărie · context ilustrativ', title: 'O insulă, două zone de lucru.', text: 'Fronturi închise la culoare, blat deschis și corpuri suspendate de iluminat. Fotografie ilustrativă, nu un proiect al echipei.' } }],
      ['cta', 'band'],
    ] },
    { name: 'Servicii', blocks: [['menu', 'list'], ['columns', 'numbers'], ['faq', 'list']] },
    { name: 'Cere ofertă', blocks: [['form', 'info'], ['about', 'statement']] },
  ],
};

P.catering = {
  label: 'Catering și evenimente', desc: 'Catering, evenimente private',
  theme: { palette: 'vin', fonts: 'clasic', radius: 0 },
  images: [...many('product-menu', ['cn-r2', 'tv-ig3', 'cn-d2', 'cn-d3']), im('desserdirina', 'catering-1')],
  header: { brand: 'Masa Lungă', cta: 'Cere o ofertă' },
  footer: { brand: 'Masa Lungă', text: 'Zonă de exemplu · Catering în București și Ilfov · 07xx xxx xxx' },
  actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'contact', 'cols.2.cta': 'contact' }, cta: { cta: 'contact' } },
  content: {
    hero: { eyebrow: 'Mese și evenimente · design de exemplu', title: 'Mai întâi, oamenii din jurul mesei.', text: 'O aniversare, o întâlnire de echipă, o petrecere acasă. Pornim de la ocazie și loc, apoi alegem ce punem pe masă. Fotografiile ilustrează o atmosferă, nu evenimente realizate de această afacere.', cta: 'Cere o ofertă', cta2: 'Vezi meniurile', image: im('product-menu', 'cn-r2') },
    columns: { title: 'Ce fel de masă pregătim?', intro: 'Trei ocazii, cu nevoi diferite. Exemple de ofertă, nu evenimente documentate.', cols: [
      { title: 'Aniversări și botezuri', text: 'Meniu de masă sau bufet, discutat după loc și preferințe.', cta: 'Idei de meniu' },
      { title: 'Întâlniri de echipă', text: 'Coffee break, prânz sau cină. Stabilim intervalul și modul de servire.', cta: 'Descrie evenimentul' },
      { title: 'Oaspeți acasă', text: 'Platouri pentru masă, cu livrarea și ridicarea discutate separat.', cta: 'Cere o ofertă' },
    ] },
    about: { title: 'De aproape, pe masă', text: 'Exemplu de platou cu brânzeturi, fructe și biscuiți sărați. Fotografia arată selecția, nu o dimensiune sau un număr garantat de porții.', image: im('product-menu', 'tv-ig3') },
    text: { eyebrow: 'Logistica evenimentului · exemplu', title: 'Locul, invitații, servirea.', text: 'Pentru ofertă: data, adresa, numărul estimat de invitați și intervalul. Zona de exemplu este București și Ilfov. Livrarea, personalul, vesela, montajul și strângerea se confirmă separat; nu sunt implicit incluse în prețul meniului.' },
    menu: { title: 'Meniuri de pornire', note: 'Exemple de preț pe persoană, pentru minimum 20 de invitați în acest model. Ingredientele, alergenii, porțiile și costurile logistice se confirmă în oferta reală.', items: [
      { name: 'Platou rece', desc: 'Brânzeturi, fructe și biscuiți sărați', price: '65 lei/pers.', image: im('product-menu', 'tv-ig3') },
      { name: 'Meniu de seară', desc: 'Antreu, fel principal și desert; selecție stabilită împreună', price: '140 lei/pers.', image: im('product-menu', 'cn-d2') },
      { name: 'Masă dulce', desc: 'Prăjituri și eclere; cantitatea se stabilește în ofertă', price: '35 lei/pers.', image: im('desserdirina', 'catering-1') },
    ] },
    faq: { title: 'Separat de meniu', items: [
      { q: 'Sunt incluse livrarea și servirea?', a: 'Nu presupune că sunt incluse. Cere explicit costurile pentru transport, personal, veselă, montaj și strângere.' },
      { q: 'Cum discutăm ingredientele și alergenii?', a: 'Cere lista pentru preparatele alese și comunică cerințele înainte de confirmare. O fotografie nu garantează potrivirea pentru o alergie.' },
    ] },
    cta: { title: 'Spune-ne ce sărbătoriți.', text: 'Data, locul și numărul de invitați sunt punctul de plecare. Oferta și disponibilitatea se confirmă înainte de rezervare.', cta: 'Cere o ofertă' },
    form: { title: 'O ofertă pentru evenimentul tău', text: 'Cererea nu confirmă evenimentul. Datele afacerii și condițiile de mai jos sunt exemple de înlocuit.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ocazia, data, locul, invitații și serviciile dorite', cta: 'Trimite cererea', address: 'Zonă de exemplu · București și Ilfov', phone: '07xx xxx xxx', email: 'evenimente@masalunga.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'full'], ['columns', 'plain'], ['about', 'side'], ['text', 'split'], ['cta', 'band']] },
    { name: 'Meniuri', blocks: [['menu', 'cards'], ['faq', 'list']] },
    { name: 'Cere ofertă', blocks: [['text', 'split'], ['form', 'info']] },
  ],
};

P.cosmetica = {
  label: 'Cosmetică și estetică', desc: 'Cabinete de cosmetică, îngrijire',
  theme: { palette: 'menta', fonts: 'modern', radius: 4 },
  images: many('portfolio', ['iv-hero', 'iv-mani3', 'sf-mua1']),
  header: { brand: 'Clinica Lumi', cta: 'Programează-te' },
  footer: { brand: 'Clinica Lumi', text: 'Date de exemplu · Bulevardul Unirii 22, București · 07xx xxx xxx' },
  actions: { nav: { cta: 'booking' }, hero: { cta: 'booking', cta2: 'menu' }, cta: { cta: 'booking' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'contact' } },
  content: {
    hero: { eyebrow: 'Îngrijire cosmetică · București · design de exemplu', title: 'Timp pentru îngrijire. Loc pentru întrebări.', text: 'Începem cu o discuție despre rutina și preferințele tale. Tratamentele, tarifele și consultația sunt exemple editabile, nu recomandări medicale.', cta: 'Programează-te', cta2: 'Vezi tratamentele', image: im('portfolio', 'iv-hero') },
    about: { title: 'Cine te primește în cabinet', text: 'Prezentare de exemplu. Adaugă numele persoanei care efectuează tratamentele și pregătirea sa reală. Fotografiile sunt ilustrative, nu prezintă echipa cabinetului.', image: '' },
    menu: { title: 'Tratament, timp, preț', note: 'Selecție și prețuri de exemplu. Confirmă serviciul și persoana care îl efectuează înainte de rezervare.', items: [
      { name: 'Curățare facială', desc: '60 de minute · discutăm rutina de îngrijire înainte de începere', price: '220 lei', image: '' },
      { name: 'Hidratare intensă', desc: '45 de minute · protocolul și produsele se confirmă la consultație', price: '260 lei', image: '' },
      { name: 'Manichiură spa', desc: '60 de minute · îngrijire și finisaj pentru unghii', price: '120 lei', image: im('portfolio', 'iv-mani3') },
      { name: 'Machiaj de zi', desc: '40 de minute · alegem intensitatea și paleta', price: '180 lei', image: im('portfolio', 'sf-mua1') },
    ] },
    columns: { title: 'Înainte să alegi tratamentul', intro: 'Un parcurs de consultație, nu o promisiune de rezultat.', cols: [
      { title: 'Ce îți dorești', text: 'Descrie rutina, preferințele și ce vrei să clarifici. Durata este trecută separat pentru fiecare serviciu.', cta: 'Vezi duratele' },
      { title: 'Ce trebuie discutat', text: 'Cere informațiile despre produsele folosite și condițiile serviciului. Pentru întrebări medicale, adresează-te unui medic.', cta: 'Întreabă cabinetul' },
    ] },
    hours: { title: 'Program de exemplu', address: 'Adresă de exemplu · Bulevardul Unirii 22, București', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '10:00 – 20:00' }, { day: 'Sâmbătă', time: '10:00 – 16:00' }, { day: 'Duminică', time: 'închis' }], image: im('portfolio', 'iv-hero') },
    cta: { title: 'Alege timpul potrivit pentru tine.', text: 'Calendarul și serviciile sunt exemple de completat pentru cabinetul tău.', cta: 'Programează-te' },
    text: { eyebrow: 'Tratamente · exemple', title: 'Întâi discuția. Apoi alegerea.', text: 'Serviciul, durata și tariful se citesc împreună. Nu promitem rezultate de tratament și nu înlocuim un consult medical.' },
    booking: { title: 'Programează-te online', text: 'Vezi serviciile și programul de mai jos.', services: [
      { name: 'Curățare facială', min: '60' }, { name: 'Hidratare intensă', min: '45' }, { name: 'Manichiură spa', min: '60' }, { name: 'Machiaj de zi', min: '40' },
    ], week: [{ on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '16:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
    form: { title: 'O întrebare înainte de rezervare', text: 'Întreabă despre serviciu și condiții. Nu trimite date medicale prin acest formular.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce tratament te interesează?', cta: 'Trimite întrebarea', address: 'Adresă de exemplu · Bulevardul Unirii 22, București', phone: '07xx xxx xxx', email: 'programari@clinicalumi.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['menu', 'list'], ['columns', 'plain'], ['about', 'statement'], ['cta', 'boxed']] },
    { name: 'Tratamente', blocks: [['text', 'split'], ['menu', 'list']] },
    { name: 'Contact', blocks: [['booking', 'split'], ['hours', 'photo'], ['form', 'simple']] },
  ],
};

P.consultanta = {
  label: 'Consultanță și coaching', desc: 'Consultanți, coach, traineri',
  theme: { palette: 'salvie', fonts: 'editorial', radius: 0 },
  images: [],
  header: { brand: 'Andreea Vlad', cta: 'Programează un apel' },
  footer: { brand: 'Andreea Vlad · Consultanță', text: 'Date de exemplu · Online și în Cluj-Napoca · 07xx xxx xxx' },
  actions: { nav: { cta: 'booking' }, hero: { cta: 'booking', cta2: 'about' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'menu', 'cols.2.cta': 'booking' }, cta: { cta: 'booking' } },
  content: {
    hero: { eyebrow: 'Consultanță pentru firme mici · design de exemplu', title: 'Când toate deciziile ajung tot la tine.', text: 'Sarcini fără responsabil, priorități schimbate și ședințe fără următorul pas? Începem cu o singură problemă din săptămâna ta.', cta: 'Programează un apel', cta2: 'Despre colaborare', image: '' },
    about: { title: 'Consultantul cu care vei lucra', text: 'Prezentare de exemplu. Adaugă numele consultantului, experiența relevantă și un portret autentic, cu acordul persoanei.', image: '' },
    menu: { title: 'Forme de colaborare', note: 'Ofertă și tarife de exemplu. Scopul și livrabilele se stabilesc după primul apel.', items: [
      { name: 'Sesiune de diagnostic', desc: '2 ore · o problemă, observații și o listă de priorități', price: '900 lei', image: '' },
      { name: 'Program de lucru', desc: 'Întâlniri săptămânale · plan de acțiune și revizuirea pașilor', price: 'la cerere', image: '' },
      { name: 'Atelier pentru echipă', desc: 'O zi · responsabilități, decizii și mod de colaborare', price: 'de la 4.000 lei', image: '' },
    ] },
    columns: { title: 'O problemă. Un plan care poate fi folosit.', intro: 'Metodă de exemplu, fără rezultate sau indicatori de succes inventați.', cols: [
      { title: 'Observăm un blocaj', text: 'Adu un exemplu recent: o decizie amânată, o predare neclară, o sarcină refăcută.', cta: 'Sesiunea de diagnostic' },
      { title: 'Scriem următorii pași', text: 'Clarificăm cine decide, cine lucrează și cum se verifică următorul pas.', cta: 'Forme de colaborare' },
      { title: 'Revenim la ce s-a făcut', text: 'Discutăm ce a fost util și ce trebuie ajustat. Nu promitem un rezultat în 90 de zile.', cta: 'Începe cu un apel' },
    ] },
    cta: { title: 'Cu ce problemă începem?', text: 'Apel inițial de 30 de minute, gratuit în acest exemplu. Condițiile reale se completează înainte de publicare.', cta: 'Programează un apel' },
    faq: { title: 'Înainte să lucrăm împreună', items: [
      { q: 'Ce pregătesc pentru primul apel?', a: 'O problemă concretă și cum afectează echipa. Nu trimite date confidențiale despre clienți sau angajați.' },
      { q: 'Cum se stabilește colaborarea?', a: 'Discutăm obiectivul, livrabilele, ritmul întâlnirilor și prețul înainte să începem.' },
    ] },
    text: { eyebrow: 'Programe · exemple editabile', title: 'Alegem formatul după problemă.', text: 'Un blocaj punctual poate începe cu o sesiune. Pentru o schimbare de mod de lucru, stabilim un ritm și un scop clar. Rezultatele depind de situație și de aplicarea pașilor agreați.' },
    booking: { title: 'Programează un apel', text: 'Vezi serviciile și programul de mai jos.', services: [
      { name: 'Apel de cunoaștere (gratuit)', min: '30' }, { name: 'Sesiune de lucru', min: '90' },
    ], week: [{ on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '14:00' }, { on: false, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
    form: { title: 'O întrebare înainte de apel', text: 'Serviciile și programul calendarului sunt exemple editabile. Confirmă condițiile cu persoana care oferă consultația.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Pe scurt, despre afacerea ta', cta: 'Trimite întrebarea', address: 'Zonă de exemplu · Online și Cluj-Napoca', phone: '07xx xxx xxx', email: 'salut@andreeavlad.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'centered'], ['columns', 'numbers'], ['cta', 'boxed']] },
    { name: 'Programe', blocks: [['text', 'split'], ['menu', 'list'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'statement'], ['booking', 'split'], ['form', 'info']] },
  ],
};

P.contabilitate = {
  label: 'Contabilitate', desc: 'Firme de contabilitate, experți contabili',
  theme: { palette: 'cerneala', fonts: 'modern', radius: 0 },
  images: [],
  header: { brand: 'Cifra Bună', cta: 'Cere o ofertă' },
  footer: { brand: 'Cifra Bună Contabilitate', text: 'Date de exemplu · Strada Doamnei 9, București · 07xx xxx xxx' },
  actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' }, columns: { 'cols.0.cta': 'contact', 'cols.1.cta': 'contact', 'cols.2.cta': 'contact' }, cta: { cta: 'contact' } },
  content: {
    hero: { eyebrow: 'Contabilitate · SRL și PFA · birou de exemplu', title: 'Ce intră în pachetul firmei tale?', text: 'Compară forma de organizare, volumul documentelor și salarizarea. Apoi cerem informațiile necesare unei oferte, nu o promisiune de preț fără context.', cta: 'Cere o ofertă', cta2: 'Compară pachetele', image: '' },
    menu: { title: 'Trei pachete, aceleași repere', note: 'Exemple lunare, fără TVA. Prețul și obligațiile aplicabile se confirmă prin ofertă și contract, după analiza firmei.', items: [
      { name: 'PFA', desc: 'Evidență, declarații aplicabile și discuție lunară · documente și activitate de confirmat · fără salarizare inclusă', price: 'de la 250 lei/lună', image: '' },
      { name: 'SRL fără salariați', desc: 'Evidență, declarații aplicabile și discuție lunară · până la 30 de documente/lună în acest exemplu · fără salarizare inclusă', price: 'de la 450 lei/lună', image: '' },
      { name: 'SRL cu salariați', desc: 'Evidență, declarații aplicabile și discuție lunară · volum de confirmat · salarizare în limita agreată prin ofertă', price: 'de la 750 lei/lună', image: '' },
    ] },
    columns: { title: 'Ce pregătești pentru ofertă', intro: 'O listă de pornire, nu o cerere de a trimite acte sensibile prin formularul public.', cols: [
      { title: 'Firma', text: 'Forma de organizare, activitatea și regimul fiscal cunoscut. Pentru verificare, biroul îți indică documentele și canalul sigur.', cta: 'Discută despre firmă' },
      { title: 'Activitatea lunară', text: 'Numărul aproximativ de facturi, extrase și alte documente. Menționează operațiunile care cer o analiză separată.', cta: 'Descrie volumul' },
      { title: 'Oamenii și preluarea', text: 'Numărul de salariați și data de la care dorești colaborarea. Balanța și dosarul de preluare se cer ulterior, în siguranță.', cta: 'Cere lista pentru preluare' },
    ] },
    about: { title: 'Persoana ta de contact', text: 'Prezentare de exemplu. Adaugă persoana de contact și calificările verificabile ale biroului. Înlocuiește numele Cifra Bună cu numele afacerii tale.', image: '' },
    text: { eyebrow: 'Pachete și documente · exemple editabile', title: 'Aceleași criterii. O ofertă pentru situația ta.', text: 'În fiecare pachet vezi evidența, declarațiile, volumul de documente și salarizarea. Activitățile speciale, termenii și responsabilitățile se agrează separat.' },
    faq: { title: 'Cum începe colaborarea', items: [
      { q: 'Ce este inclus în preț?', a: 'Lista de mai sus este un exemplu. Cere oferta cu volumul inclus, salarizarea, serviciile suplimentare și responsabilitățile fiecărei părți.' },
      { q: 'Cum trimit documentele?', a: 'Biroul îți comunică un canal sigur și calendarul de predare. Nu trimite acte sau date personale prin acest formular public.' },
      { q: 'Cum schimb contabilul?', a: 'Stabilim data preluării, lista documentelor și legătura cu vechiul birou. Pașii reali depind de situația firmei.' },
    ] },
    cta: { title: 'Începem cu forma firmei și volumul.', text: 'Spune-ne dacă ai SRL sau PFA și câți salariați. Contactul responsabil confirmă următorul pas.', cta: 'Cere o ofertă' },
    form: { title: 'Cere o ofertă pentru firma ta', text: 'Date de contact de exemplu. Persoana responsabilă și canalul sigur pentru acte se completează de către birou.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'SRL/PFA, volumul documentelor și numărul de salariați — fără date sensibile', cta: 'Trimite cererea', address: 'Adresă de exemplu · Strada Doamnei 9, București', phone: '07xx xxx xxx', email: 'oferte@cifrabuna.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'centered'], ['menu', 'list'], ['columns', 'plain'], ['cta', 'band']] },
    { name: 'Prețuri', blocks: [['text', 'split'], ['menu', 'list'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'statement'], ['columns', 'numbers']] },
    { name: 'Contact', blocks: [['form', 'info']] },
  ],
};

return P;
}

if (typeof module !== 'undefined' && module.exports) module.exports = addMore;
else addMore(root.SB_PACKS);
})(typeof window !== 'undefined' ? window : globalThis);
