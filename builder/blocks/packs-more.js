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
const im = (dir, n) => `${T}${dir}/images/${n}.jpg`;
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
    booking: { title: 'Programează-te online', text: 'Alegi serviciul, ziua și ora. Primești confirmarea pe email.', services: [{ name: 'Primul serviciu', min: '30' }, { name: 'Al doilea serviciu', min: '60' }], week: [{ on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: true, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }], phone: 'Telefon' },
    form: { title: 'Scrie-ne', text: 'Îți răspundem cât de repede putem.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Mesaj', cta: 'Trimite', address: 'Adresă', phone: 'Telefon', email: 'email@exemplu.ro' },
    instagram: { title: 'Pe Instagram', handle: '@contul.tau', cta: 'Urmărește-ne', images: [PH, PH, PH, PH, PH, PH] },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'centered'], ['text', 'left']] },
  ],
};

P.cafenea = {
  label: 'Cafenea și brunch', desc: 'Cafenele, bistrouri, brunch',
  theme: { palette: 'verde', fonts: 'modern', radius: 14 },
  images: many('product-menu', ['tv-hero', 'tv-a1', 'tv-a2', 'tv-a3', 'tv-m1', 'tv-m2', 'tv-m3', 'tv-ig1', 'tv-ig2', 'tv-ig3', 'tv-ig4', 'tv-ig5', 'tv-ig6']),
  header: { brand: 'Bistro Tei', cta: 'Rezervă o masă' },
  footer: { brand: 'Bistro Tei', text: 'Strada Memorandumului 4, Cluj-Napoca · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Bistro · Cluj-Napoca', title: 'Brunch toată ziua, pe terasă la umbră', text: 'Ouă la alegere, pâine de la brutăria din colț, cafea de specialitate. Deschis zilnic de la 8.', cta: 'Rezervă o masă', cta2: 'Vezi meniul', image: im('product-menu', 'tv-hero') },
    about: { title: 'Locul nostru', text: 'Un bistro de cartier cu legume din piața de sâmbătă și pâine coaptă în dimineața aceea. Vino la micul dejun, rămâi la prânz.', image: im('product-menu', 'tv-a2') },
    menu: { title: 'Meniu', note: 'Brunch servit între 8:00 și 15:00.', items: [
      { name: 'Ouă la alegere', desc: 'Pâine de casă, unt, verdeață', price: '29 lei', image: im('product-menu', 'tv-m3') },
      { name: 'Salată de piață', desc: 'Semințe prăjite, brânză de capră', price: '34 lei', image: im('product-menu', 'tv-m1') },
      { name: 'Paste cu roșii', desc: 'Busuioc, parmezan', price: '38 lei', image: im('product-menu', 'tv-m2') },
      { name: 'Platou de brânzeturi', desc: 'Miere locală, nuci', price: '46 lei', image: im('product-menu', 'tv-ig3') },
    ] },
    gallery: { title: 'Din bistro', items: ['tv-a1', 'tv-a3', 'tv-ig1', 'tv-ig2', 'tv-ig5', 'tv-ig6'].map((n) => ({ image: im('product-menu', n) })) },
    reviews: { title: 'Ce spun oaspeții', items: [
      { quote: 'Cel mai bun brunch din oraș, și terasa e o oază.', author: 'Laura M.' },
      { quote: 'Cafeaua e excelentă, iar ouăle Benedict, perfecte.', author: 'Vlad C.' },
      { quote: 'Personal prietenos, mergem în fiecare duminică.', author: 'Ana și Mihai' },
    ] },
    hours: { title: 'Ne găsești aici', address: 'Strada Memorandumului 4, Cluj-Napoca', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '8:00 – 22:00' }, { day: 'Sâmbătă – Duminică', time: '9:00 – 23:00' }], image: im('product-menu', 'tv-a1') },
    cta: { title: 'Rezervă terasa pentru weekend', text: 'Mesele de afară se ocupă repede.', cta: 'Rezervă o masă' },
    text: { eyebrow: 'Meniu', title: 'Simplu, de sezon, făcut aici', text: 'Schimbăm o parte din meniu în fiecare lună, după ce găsim la piață.' },
    columns: { title: 'De ce să vii', intro: 'Trei motive, pe scurt.', cols: [
      { image: im('product-menu', 'tv-a1'), title: 'Terasă la umbră', text: 'Sub tei, liniștită, și cu copii.', cta: 'Rezervă' },
      { image: im('product-menu', 'tv-m3'), title: 'Brunch toată ziua', text: 'Nu trebuie să te trezești devreme.', cta: 'Meniu' },
      { image: im('product-menu', 'tv-ig5'), title: 'Cafea de specialitate', text: 'Boabe prăjite local, la filtru sau espresso.', cta: 'Află mai mult' },
    ] },
    instagram: { title: 'Pe Instagram', handle: '@bistrotei', cta: 'Urmărește-ne', images: many('product-menu', ['tv-ig1', 'tv-ig2', 'tv-ig3', 'tv-ig4', 'tv-ig5', 'tv-ig6']) },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'full'], ['columns', 'images'], ['menu', 'cards'], ['instagram', 'strip'], ['cta', 'band']] },
    { name: 'Meniu', blocks: [['text', 'center'], ['menu', 'list'], ['gallery', 'mosaic']] },
    { name: 'Contact', blocks: [['hours', 'photo'], ['reviews', 'cards']] },
  ],
};

P.mireasa = {
  label: 'Coafură și machiaj de mireasă', desc: 'Make-up artist, coafuri de eveniment',
  theme: { palette: 'ivoriu', fonts: 'editorial', radius: 0 },
  images: many('portfolio', ['sf-ext1', 'sf-ext2', 'sf-ext3', 'sf-ext4', 'sf-mua1', 'sf-mua2', 'sf-mua3', 'sf-hero', 'sf-team-a', 'sf-ig1', 'sf-ig2', 'sf-ig3', 'sf-ig4', 'sf-ig5', 'sf-ig6']),
  header: { brand: 'Studio Forma', cta: 'Verifică data' },
  footer: { brand: 'Studio Forma', text: 'București și deplasări în țară · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Make-up și coafură de mireasă', title: 'Arăți ca tine, doar în cea mai bună zi', text: 'Machiaj care ține de la cununie până la ultimul dans. Venim la tine acasă sau la locație.', cta: 'Verifică data', cta2: 'Vezi portofoliul', image: im('portfolio', 'sf-ext2') },
    about: { title: 'Despre mine', text: 'Lucrez cu mirese din 2014. Fac o probă înainte, ca în ziua nunții să nu existe surprize.', image: im('portfolio', 'sf-team-a') },
    menu: { title: 'Pachete', note: 'Deplasarea în afara Bucureștiului se calculează separat.', items: [
      { name: 'Machiaj de mireasă', desc: 'Cu probă inclusă', price: '650 lei', image: im('portfolio', 'sf-mua1') },
      { name: 'Coafură de mireasă', desc: 'Cu probă inclusă', price: '600 lei', image: im('portfolio', 'sf-ext3') },
      { name: 'Pachet complet', desc: 'Machiaj + coafură + retușuri', price: '1.150 lei', image: im('portfolio', 'sf-ext1') },
      { name: 'Machiaj invitate', desc: 'Pe persoană', price: '250 lei', image: im('portfolio', 'sf-mua2') },
    ] },
    gallery: { title: 'Portofoliu', items: ['sf-ext1', 'sf-ext2', 'sf-ext3', 'sf-mua1', 'sf-mua2', 'sf-mua3'].map((n) => ({ image: im('portfolio', n) })) },
    reviews: { title: 'Mirese fericite', items: [
      { quote: 'Machiajul a rezistat 14 ore și arăta perfect în toate pozele.', author: 'Andreea, iunie' },
      { quote: 'M-a liniștit în dimineața nunții. Asta nu se plătește.', author: 'Bianca, septembrie' },
    ] },
    cta: { title: 'Mai ai liberă data nunții?', text: 'Scrie-ne data și locul. Îți răspundem în aceeași zi.', cta: 'Verifică data' },
    faq: { title: 'Întrebări frecvente', items: [
      { q: 'Cu cât timp înainte rezerv?', a: 'Ideal cu 6–12 luni înainte pentru sezonul de vară.' },
      { q: 'Proba e inclusă?', a: 'Da, la pachetele de mireasă.' },
      { q: 'Vă deplasați în alt oraș?', a: 'Da, în toată țara, cu transportul calculat separat.' },
    ] },
    text: { eyebrow: 'Pachete', title: 'Pentru mireasă și invitate', text: 'Fiecare pachet include o probă înainte de nuntă și retușuri în ziua evenimentului.' },
    form: { title: 'Verifică data', text: 'Spune-ne data și locul nunții.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Data și locul nunții', cta: 'Trimite', address: 'București', phone: '07xx xxx xxx', email: 'salut@studioforma.ro' },
    instagram: { title: 'Pe Instagram', handle: '@studioforma', cta: 'Urmărește-ne', images: many('portfolio', ['sf-ig1', 'sf-ig2', 'sf-ig3', 'sf-ig4', 'sf-ig5', 'sf-ig6']) },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'full'], ['gallery', 'mosaic'], ['reviews', 'single'], ['cta', 'band']] },
    { name: 'Pachete', blocks: [['text', 'center'], ['menu', 'cards'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'side'], ['instagram', 'grid']] },
    { name: 'Rezervă', blocks: [['form', 'info']] },
  ],
};

P.renovari = {
  label: 'Renovări interioare', desc: 'Băi, bucătării, amenajări',
  theme: { palette: 'beton', fonts: 'modern', radius: 2 },
  images: many('local-service', ['pr-hero', 'pr-baie1', 'pr-baie2', 'pr-baie3', 'pr-buc1', 'pr-buc2', 'pr-buc3', 'pr-ext1', 'pr-ext2', 'pr-ig1', 'pr-ig2', 'pr-ig3', 'pr-ig4', 'pr-ig5', 'pr-ig6']),
  header: { brand: 'Renovări Popescu', cta: 'Cere o ofertă' },
  footer: { brand: 'Renovări Popescu', text: 'București și Ilfov · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Renovări · București și Ilfov', title: 'Baia sau bucătăria nouă, gata în trei săptămâni', text: 'Facem tot, de la demolare la ultimul rost. Preț fix în ofertă, fără costuri ascunse.', cta: 'Cere o ofertă', cta2: 'Vezi lucrări', image: im('local-service', 'pr-baie2') },
    about: { title: 'Cine suntem', text: 'O echipă de șase oameni, aceiași de zece ani. Avem instalator, electrician și faianțar proprii, deci nu așteptăm după nimeni.', image: im('local-service', 'pr-ig4') },
    menu: { title: 'Ce facem și cât costă', note: 'Prețuri orientative, pentru lucrări standard.', items: [
      { name: 'Renovare baie completă', desc: 'Până la 6 mp, cu materiale de bază', price: 'de la 18.000 lei', image: im('local-service', 'pr-baie1') },
      { name: 'Bucătărie la cheie', desc: 'Instalații, faianță, montaj mobilier', price: 'de la 24.000 lei', image: im('local-service', 'pr-buc1') },
      { name: 'Gresie și faianță', desc: 'Manoperă pe metru pătrat', price: 'de la 90 lei', image: im('local-service', 'pr-ig2') },
      { name: 'Rigips și zugrăveli', desc: 'Manoperă pe metru pătrat', price: 'de la 45 lei', image: im('local-service', 'pr-ig1') },
    ] },
    gallery: { title: 'Lucrări recente', items: ['pr-baie1', 'pr-baie2', 'pr-baie3', 'pr-buc1', 'pr-buc2', 'pr-buc3'].map((n) => ({ image: im('local-service', n) })) },
    reviews: { title: 'Ce spun clienții', items: [
      { quote: 'Au terminat baia în 16 zile, exact cum au promis.', author: 'Cristian D., Militari' },
      { quote: 'Prețul din ofertă a fost prețul final. Rar.', author: 'Monica P., Pipera' },
      { quote: 'Au lăsat curat în fiecare seară.', author: 'Radu I., Titan' },
    ] },
    cta: { title: 'Vrei o ofertă pentru baie sau bucătărie?', text: 'Venim, măsurăm și îți trimitem oferta în 48 de ore.', cta: 'Cere o ofertă' },
    faq: { title: 'Întrebări frecvente', items: [
      { q: 'Cât durează o baie?', a: 'Între 2 și 3 săptămâni, în funcție de mărime.' },
      { q: 'Cumpărați voi materialele?', a: 'Putem cumpăra noi sau poți alege tu, cu sfatul nostru.' },
      { q: 'Dați garanție?', a: 'Da, 3 ani la manoperă, în scris.' },
    ] },
    text: { eyebrow: 'Servicii', title: 'Renovăm de la zero sau doar ce trebuie', text: 'Băi, bucătării, apartamente întregi. Îți spunem sincer ce merită schimbat și ce nu.' },
    columns: { title: 'Cum lucrăm', intro: 'Patru pași, de la prima vizită la predare.', cols: [
      { image: im('local-service', 'pr-ig3'), title: 'Măsurăm', text: 'Venim gratuit și vedem ce e de făcut.', cta: 'Programează' },
      { image: im('local-service', 'pr-ig5'), title: 'Ofertă fixă', text: 'În 48 de ore, cu tot ce intră în preț.', cta: 'Cere ofertă' },
      { image: im('local-service', 'pr-hero'), title: 'Lucrăm', text: 'Aceeași echipă, de la început la sfârșit.', cta: 'Echipa' },
      { image: im('local-service', 'pr-baie3'), title: 'Predăm', text: 'Curat, cu garanție scrisă.', cta: 'Lucrări' },
    ] },
    form: { title: 'Cere o ofertă', text: 'Spune-ne ce vrei să renovezi. Te sunăm în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce vrei să renovezi?', cta: 'Trimite', address: 'București și Ilfov', phone: '07xx xxx xxx', email: 'oferte@renovaripopescu.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'numbers'], ['gallery', 'grid'], ['reviews', 'cards'], ['cta', 'band']] },
    { name: 'Servicii', blocks: [['text', 'split'], ['menu', 'cards'], ['faq', 'list']] },
    { name: 'Cere ofertă', blocks: [['form', 'info'], ['about', 'side']] },
  ],
};

P.catering = {
  label: 'Catering și evenimente', desc: 'Catering, evenimente private',
  theme: { palette: 'vin', fonts: 'clasic', radius: 12 },
  images: [...many('desserdirina', ['catering-1', 'catering-2']), ...many('product-menu', ['cn-r1', 'cn-r2', 'cn-r3', 'cn-d1', 'cn-d2', 'cn-d3', 'tv-ig3', 'tv-ig6', 'tv-a3'])],
  header: { brand: 'Masa Lungă', cta: 'Cere o ofertă' },
  footer: { brand: 'Masa Lungă', text: 'Catering în București și Ilfov · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Catering · evenimente private', title: 'Mâncare bună pentru 20 sau 200 de invitați', text: 'Botezuri, aniversări, evenimente de firmă. Gătim, aducem, servim și strângem.', cta: 'Cere o ofertă', cta2: 'Vezi meniurile', image: im('product-menu', 'cn-r2') },
    about: { title: 'Despre noi', text: 'Am pornit dintr-un restaurant mic și am rămas cu aceeași idee: mâncare făcută în ziua evenimentului, nu încălzită.', image: im('product-menu', 'tv-ig6') },
    menu: { title: 'Meniuri', note: 'Prețuri pe persoană, minimum 20 de invitați.', items: [
      { name: 'Platouri reci', desc: 'Brânzeturi, mezeluri, legume', price: '65 lei/pers.', image: im('product-menu', 'tv-ig3') },
      { name: 'Meniu de seară', desc: 'Antreu, fel principal, desert', price: '140 lei/pers.', image: im('product-menu', 'cn-d2') },
      { name: 'Bufet de desert', desc: 'Prăjituri mici asortate', price: '35 lei/pers.', image: im('desserdirina', 'catering-2') },
      { name: 'Personal de servire', desc: 'Ospătari pentru eveniment', price: 'la cerere', image: im('product-menu', 'cn-r1') },
    ] },
    gallery: { title: 'De la evenimente', items: [im('desserdirina', 'catering-1'), im('desserdirina', 'catering-2'), im('product-menu', 'cn-r3'), im('product-menu', 'cn-d1'), im('product-menu', 'cn-d3'), im('product-menu', 'tv-ig3')].map((image) => ({ image })) },
    reviews: { title: 'Ce spun clienții', items: [
      { quote: 'La botez, toată lumea a întrebat de unde e mâncarea.', author: 'Familia Stan' },
      { quote: 'Organizare impecabilă la evenimentul de firmă de 150 de oameni.', author: 'Irina, HR' },
    ] },
    cta: { title: 'Ai un eveniment în curând?', text: 'Spune-ne data și numărul de invitați. Îți trimitem meniul și prețul.', cta: 'Cere o ofertă' },
    text: { eyebrow: 'Meniuri', title: 'Gătim în ziua evenimentului', text: 'Fiecare meniu se poate adapta pentru vegetarieni, copii sau alergii.' },
    columns: { title: 'Pentru ce evenimente', intro: 'Câteva dintre cele mai cerute.', cols: [
      { image: im('desserdirina', 'catering-1'), title: 'Botezuri și aniversări', text: 'Meniuri pentru toate vârstele.', cta: 'Meniuri' },
      { image: im('product-menu', 'cn-r2'), title: 'Evenimente de firmă', text: 'De la coffee break la cină festivă.', cta: 'Cere ofertă' },
      { image: im('product-menu', 'tv-ig3'), title: 'Petreceri acasă', text: 'Platouri gata de pus pe masă.', cta: 'Platouri' },
    ] },
    form: { title: 'Cere o ofertă', text: 'Răspundem în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Data, locul și numărul de invitați', cta: 'Trimite', address: 'București și Ilfov', phone: '07xx xxx xxx', email: 'evenimente@masalunga.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'full'], ['columns', 'images'], ['gallery', 'mosaic'], ['reviews', 'single'], ['cta', 'band']] },
    { name: 'Meniuri', blocks: [['text', 'center'], ['menu', 'cards']] },
    { name: 'Cere ofertă', blocks: [['form', 'info'], ['about', 'side']] },
  ],
};

P.cosmetica = {
  label: 'Cosmetică și estetică', desc: 'Cabinete de cosmetică, îngrijire',
  theme: { palette: 'menta', fonts: 'modern', radius: 18 },
  images: [...many('portfolio', ['iv-team-c', 'iv-team-d', 'iv-team-l', 'iv-mani1', 'iv-mani2', 'iv-mani3', 'iv-mani4', 'iv-hero', 'sf-ig2', 'sf-mua1']), ...many('portfolio', ['iv-ig1', 'iv-ig2', 'iv-ig3'])],
  header: { brand: 'Clinica Lumi', cta: 'Programează-te' },
  footer: { brand: 'Clinica Lumi', text: 'Bulevardul Unirii 22, București · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Cosmetică și estetică · București', title: 'Tratamente pentru ten, făcute cu răbdare', text: 'Consultație gratuită la prima vizită. Îți spunem ce ți se potrivește înainte să plătești ceva.', cta: 'Programează-te', cta2: 'Vezi tratamentele', image: im('portfolio', 'iv-team-d') },
    about: { title: 'Despre clinică', text: 'Trei specialiste cu peste 10 ani de experiență, produse profesionale și un cabinet liniștit în centrul orașului.', image: im('portfolio', 'iv-hero') },
    menu: { title: 'Tratamente', note: 'Prima consultație e gratuită.', items: [
      { name: 'Curățare facială', desc: '60 de minute', price: '220 lei', image: im('portfolio', 'iv-team-c') },
      { name: 'Hidratare intensă', desc: '45 de minute', price: '260 lei', image: im('portfolio', 'iv-team-l') },
      { name: 'Manichiură spa', desc: '60 de minute', price: '120 lei', image: im('portfolio', 'iv-mani3') },
      { name: 'Machiaj de zi', desc: '40 de minute', price: '180 lei', image: im('portfolio', 'sf-mua1') },
    ] },
    reviews: { title: 'Ce spun clientele', items: [
      { quote: 'După trei ședințe, tenul arată altfel. Și mi-au explicat tot.', author: 'Corina M.' },
      { quote: 'Cel mai liniștit loc din oraș.', author: 'Mihaela T.' },
      { quote: 'Nu mi-au vândut nimic de care nu aveam nevoie.', author: 'Raluca S.' },
    ] },
    hours: { title: 'Programări', address: 'Bulevardul Unirii 22, București', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '10:00 – 20:00' }, { day: 'Sâmbătă', time: '10:00 – 16:00' }], image: im('portfolio', 'iv-hero') },
    cta: { title: 'Prima consultație e gratuită', text: 'Vino să vorbim despre ten, fără obligații.', cta: 'Programează-te' },
    text: { eyebrow: 'Tratamente', title: 'Alegem împreună ce ți se potrivește', text: 'Fiecare tratament începe cu o discuție și o analiză a tenului.' },
    team: { title: 'Specialistele noastre', people: [
      { image: im('portfolio', 'iv-team-c'), name: 'Carmen', role: 'Cosmetician, 18 ani experiență' },
      { image: im('portfolio', 'iv-team-d'), name: 'Daria', role: 'Specialist îngrijire ten' },
      { image: im('portfolio', 'iv-team-l'), name: 'Lavinia', role: 'Make-up și manichiură' },
    ] },
    booking: { title: 'Programează-te online', text: 'Alegi tratamentul, ziua și ora. Primești confirmarea pe email.', services: [
      { name: 'Curățare facială', min: '60' }, { name: 'Hidratare intensă', min: '45' }, { name: 'Manichiură spa', min: '60' }, { name: 'Machiaj de zi', min: '40' },
    ], week: [{ on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '20:00' }, { on: true, from: '10:00', to: '16:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
    form: { title: 'Ai o întrebare?', text: 'Scrie-ne și îți răspundem în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce tratament te interesează?', cta: 'Trimite', address: 'Bulevardul Unirii 22, București', phone: '07xx xxx xxx', email: 'programari@clinicalumi.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['team', 'round'], ['reviews', 'cards'], ['cta', 'boxed']] },
    { name: 'Tratamente', blocks: [['text', 'center'], ['menu', 'list']] },
    { name: 'Contact', blocks: [['booking', 'split'], ['hours', 'photo'], ['form', 'simple']] },
  ],
};

P.consultanta = {
  label: 'Consultanță și coaching', desc: 'Consultanți, coach, traineri',
  theme: { palette: 'salvie', fonts: 'editorial', radius: 10 },
  images: [im('professionals', 'hero'), ...many('portfolio', ['sf-team-o', 'sf-team-m', 'sf-team-a', 'sf-ig5'])],
  header: { brand: 'Andreea Vlad', cta: 'Programează un apel' },
  footer: { brand: 'Andreea Vlad · Consultanță', text: 'Online și în Cluj-Napoca · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Consultanță pentru firme mici', title: 'Pune ordine în afacerea ta, în 90 de zile', text: 'Lucrez cu antreprenori care au crescut repede și vor procese simple, o echipă care știe ce are de făcut și mai mult timp liber.', cta: 'Programează un apel', cta2: 'Cum lucrez', image: im('portfolio', 'sf-team-o') },
    about: { title: 'Despre mine', text: 'Am condus timp de 12 ani operațiunile unor firme între 10 și 200 de oameni. Acum îi ajut pe alții să evite greșelile pe care le-am făcut eu.', image: im('portfolio', 'sf-team-m') },
    menu: { title: 'Programe', note: 'Primul apel de 30 de minute e gratuit.', items: [
      { name: 'Sesiune de diagnostic', desc: '2 ore, cu raport scris', price: '900 lei', image: im('professionals', 'hero') },
      { name: 'Program de 90 de zile', desc: 'Întâlniri săptămânale', price: '6.500 lei', image: im('portfolio', 'sf-team-o') },
      { name: 'Workshop pentru echipă', desc: 'O zi, la sediul tău', price: 'de la 4.000 lei', image: im('portfolio', 'sf-ig5') },
    ] },
    reviews: { title: 'Ce spun clienții', items: [
      { quote: 'În trei luni am trecut de la haos la o săptămână pe care o pot planifica.', author: 'Tudor R., fondator' },
      { quote: 'Concretă, directă și foarte bine pregătită.', author: 'Simona L., director' },
    ] },
    cta: { title: 'Hai să vedem dacă te pot ajuta', text: 'Primul apel e gratuit și durează 30 de minute.', cta: 'Programează un apel' },
    faq: { title: 'Întrebări frecvente', items: [
      { q: 'Lucrezi doar online?', a: 'Online sau față în față, în Cluj-Napoca.' },
      { q: 'Cu ce fel de firme lucrezi?', a: 'Mai ales cu firme între 5 și 50 de angajați.' },
    ] },
    text: { eyebrow: 'Programe', title: 'Trei feluri în care putem lucra', text: 'Alegem împreună, după primul apel.' },
    columns: { title: 'Cum lucrez', intro: 'Pe scurt, în trei etape.', cols: [
      { image: im('professionals', 'hero'), title: 'Diagnostic', text: 'Vedem unde se pierde timp și bani.', cta: 'Detalii' },
      { image: im('portfolio', 'sf-team-o'), title: 'Plan', text: 'Trei priorități, nu treizeci.', cta: 'Detalii' },
      { image: im('portfolio', 'sf-ig5'), title: 'Implementare', text: 'Întâlniri săptămânale, rezultate măsurabile.', cta: 'Detalii' },
    ] },
    booking: { title: 'Programează un apel', text: 'Alegi ziua și ora. Îți trimit linkul de apel pe email.', services: [
      { name: 'Apel de cunoaștere (gratuit)', min: '30' }, { name: 'Sesiune de lucru', min: '90' },
    ], week: [{ on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '18:00' }, { on: true, from: '10:00', to: '14:00' }, { on: false, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
    form: { title: 'Programează un apel', text: 'Îți trimit un link pe email.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Pe scurt, despre afacerea ta', cta: 'Trimite', address: 'Online și Cluj-Napoca', phone: '07xx xxx xxx', email: 'salut@andreeavlad.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'numbers'], ['reviews', 'single'], ['cta', 'band']] },
    { name: 'Programe', blocks: [['text', 'split'], ['menu', 'list'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'side'], ['booking', 'split'], ['form', 'info']] },
  ],
};

P.contabilitate = {
  label: 'Contabilitate', desc: 'Firme de contabilitate, experți contabili',
  theme: { palette: 'cerneala', fonts: 'modern', radius: 6 },
  images: [im('professionals', 'hero'), ...many('portfolio', ['sf-team-m', 'sf-team-o', 'sf-team-a'])],
  header: { brand: 'Cifra Bună', cta: 'Cere o ofertă' },
  footer: { brand: 'Cifra Bună Contabilitate', text: 'Strada Doamnei 9, București · 07xx xxx xxx' },
  content: {
    hero: { eyebrow: 'Contabilitate pentru SRL și PFA', title: 'Tu te ocupi de clienți. Noi, de cifre.', text: 'Contabilitate lunară, salarii și declarații la timp, cu un singur om de contact care îți răspunde.', cta: 'Cere o ofertă', cta2: 'Vezi prețurile', image: im('professionals', 'hero') },
    about: { title: 'Despre noi', text: 'Lucrăm cu peste 120 de firme mici din București. Fiecare client are un contabil dedicat, nu un call center.', image: im('portfolio', 'sf-team-m') },
    menu: { title: 'Prețuri', note: 'Prețuri lunare, fără TVA.', items: [
      { name: 'PFA', desc: 'Evidență și declarații', price: 'de la 250 lei', image: im('professionals', 'hero') },
      { name: 'SRL micro', desc: 'Până la 30 de documente pe lună', price: 'de la 450 lei', image: im('professionals', 'hero') },
      { name: 'SRL cu salariați', desc: 'Contabilitate + salarizare', price: 'de la 750 lei', image: im('professionals', 'hero') },
      { name: 'Înființare firmă', desc: 'De la nume la cod fiscal', price: '600 lei', image: im('professionals', 'hero') },
    ] },
    reviews: { title: 'Ce spun clienții', items: [
      { quote: 'În patru ani n-am primit nicio amendă. Asta spune tot.', author: 'Marian G., SRL construcții' },
      { quote: 'Îmi răspund pe WhatsApp în aceeași zi.', author: 'Elena C., PFA' },
      { quote: 'Au preluat contabilitatea de la vechea firmă fără bătăi de cap.', author: 'Dan V., magazin online' },
    ] },
    cta: { title: 'Schimbi contabilul?', text: 'Preluăm totul de la vechea firmă, fără să te ocupi tu.', cta: 'Cere o ofertă' },
    faq: { title: 'Întrebări frecvente', items: [
      { q: 'Lucrați cu firme din afara Bucureștiului?', a: 'Da, totul se poate face online.' },
      { q: 'Cum vă trimit documentele?', a: 'Pe email, WhatsApp sau într-o aplicație simplă pe care ți-o dăm noi.' },
      { q: 'Ce se întâmplă dacă vine un control?', a: 'Suntem alături de tine și pregătim documentele.' },
    ] },
    text: { eyebrow: 'Prețuri', title: 'Știi de la început cât plătești', text: 'Prețul depinde de numărul de documente și de salariați. Fără costuri ascunse.' },
    columns: { title: 'Ce primești', intro: 'Inclus în orice abonament.', cols: [
      { image: im('professionals', 'hero'), title: 'Contabil dedicat', text: 'Același om, care îți cunoaște firma.', cta: 'Află mai mult' },
      { image: im('professionals', 'hero'), title: 'Declarații la timp', text: 'Ți le arătăm înainte să le depunem.', cta: 'Află mai mult' },
      { image: im('professionals', 'hero'), title: 'Răspuns în aceeași zi', text: 'Pe telefon, email sau WhatsApp.', cta: 'Află mai mult' },
    ] },
    team: { title: 'Echipa', people: [
      { image: im('portfolio', 'sf-team-m'), name: 'Maria Dobre', role: 'Expert contabil' },
      { image: im('portfolio', 'sf-team-o'), name: 'Oana Ilie', role: 'Contabil' },
      { image: im('portfolio', 'sf-team-a'), name: 'Alina Stoica', role: 'Salarizare' },
    ] },
    form: { title: 'Cere o ofertă', text: 'Îți trimitem prețul exact în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Tipul firmei și numărul de angajați', cta: 'Trimite', address: 'Strada Doamnei 9, București', phone: '07xx xxx xxx', email: 'oferte@cifrabuna.ro' },
  },
  pages: [
    { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'numbers'], ['reviews', 'cards'], ['cta', 'band']] },
    { name: 'Prețuri', blocks: [['text', 'center'], ['menu', 'list'], ['faq', 'list']] },
    { name: 'Despre', blocks: [['about', 'side'], ['team', 'grid']] },
    { name: 'Contact', blocks: [['form', 'info']] },
  ],
};

return P;
}

if (typeof module !== 'undefined' && module.exports) module.exports = addMore;
else addMore(root.SB_PACKS);
})(typeof window !== 'undefined' ? window : globalThis);
