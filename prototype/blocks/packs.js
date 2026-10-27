'use strict';
/**
 * prototype/blocks/packs.js — starter packs: one per business type.
 *
 * A pack is a theme, starter content for every block type it uses, a
 * shared header/footer and a set of pages. Blocks added later from the
 * library take their starter content from the active pack, so a salon
 * site never gets restaurant text.
 */

(function () {
const T = '../../templates/';

function imgs(dir, names) { return names.map((n) => `${T}${dir}/images/${n}.jpg`); }

const PACKS = {
  restaurant: {
    label: 'Restaurant', desc: 'Restaurante, cafenele și baruri',
    theme: { palette: 'seara', fonts: 'clasic', radius: 10 },
    images: imgs('product-menu', ['cn-hero', 'cn-r1', 'cn-r2', 'cn-r3', 'cn-d1', 'cn-d2', 'cn-d3', 'cn-ig1', 'cn-ig2', 'cn-ig3', 'cn-ig4', 'cn-ig5', 'cn-ig6', 'tv-hero', 'tv-a1', 'tv-a2', 'tv-a3', 'tv-m1', 'tv-m2', 'tv-m3']),
    header: { brand: 'Casa Nord', cta: 'Rezervă o masă' },
    footer: { brand: 'Casa Nord', text: 'Strada Nordului 12, București · 07xx xxx xxx' },
    content: {},
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['about', 'side'], ['columns', 'images'], ['gallery', 'grid'], ['reviews', 'cards'], ['cta', 'band']] },
      { name: 'Meniu', blocks: [['text', 'center'], ['menu', 'list'], ['menu', 'cards'], ['cta', 'band']] },
      { name: 'Contact', blocks: [['hours', 'photo'], ['form', 'info'], ['faq', 'list']] },
    ],
  },

  salon: {
    label: 'Salon de frumusețe', desc: 'Coafor, manichiură, cosmetică',
    theme: { palette: 'pudra', fonts: 'editorial', radius: 16 },
    images: imgs('portfolio', ['iv-hero', 'iv-par1', 'iv-par2', 'iv-par3', 'iv-par4', 'iv-mani1', 'iv-mani2', 'iv-mani3', 'iv-mani4', 'iv-ig1', 'iv-ig2', 'iv-ig3', 'iv-ig4', 'iv-ig5', 'iv-ig6', 'iv-team-c', 'iv-team-d', 'iv-team-l', 'sf-hero', 'sf-ext1', 'sf-ext2']),
    header: { brand: 'Atelier Ivoire', cta: 'Programează-te' },
    footer: { brand: 'Atelier Ivoire', text: 'Strada Lăpușneanu 8, Iași · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Salon · Iași', title: 'Păr sănătos, culoare care ține', text: 'Coafor, colorare și manichiură. Patru stiliste, programări în aceeași săptămână.', cta: 'Alege o oră liberă', cta2: 'Vezi prețurile', image: `${T}portfolio/images/iv-hero.jpg` },
      about: { title: 'Despre salon', text: 'Am deschis Atelier Ivoire în 2016, cu un singur scaun. Azi suntem patru și lucrăm la fel: fără grabă, cu produse bune și cu sfaturi pe care le poți urma acasă.', image: `${T}portfolio/images/iv-par2.jpg` },
      menu: { title: 'Servicii și prețuri', note: 'Prețurile includ spălatul și coafatul.', items: [
        { name: 'Tuns și coafat', desc: '60 de minute', price: '120 lei', image: `${T}portfolio/images/iv-par1.jpg` },
        { name: 'Vopsit rădăcină', desc: '90 de minute', price: 'de la 220 lei', image: `${T}portfolio/images/iv-par3.jpg` },
        { name: 'Balayage', desc: 'În jur de 3 ore', price: 'de la 450 lei', image: `${T}portfolio/images/iv-par4.jpg` },
        { name: 'Manichiură semipermanentă', desc: '75 de minute', price: '90 lei', image: `${T}portfolio/images/iv-mani1.jpg` },
      ] },
      gallery: { title: 'Lucrări recente', items: ['iv-par1', 'iv-par2', 'iv-par3', 'iv-mani2', 'iv-mani3', 'iv-par4'].map((n) => ({ image: `${T}portfolio/images/${n}.jpg` })) },
      reviews: { title: 'Ce spun clientele', items: [
        { quote: 'Prima dată când culoarea a ieșit exact ca în poza pe care am arătat-o.', author: 'Ioana R.' },
        { quote: 'Atentă la detalii și sinceră când ceva nu mi s-ar potrivi.', author: 'Alexandra M.' },
        { quote: 'Manichiura ține trei săptămâni. Revin de fiecare dată.', author: 'Diana P.' },
      ] },
      hours: { title: 'Ne găsești aici', address: 'Strada Lăpușneanu 8, Iași', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '9:00 – 20:00' }, { day: 'Sâmbătă', time: '9:00 – 15:00' }, { day: 'Duminică', time: 'închis' }], image: `${T}portfolio/images/sf-ext1.jpg` },
      cta: { title: 'Ai o ocazie specială în curând?', text: 'Scrie-ne și îți găsim o oră în aceeași săptămână.', cta: 'Programează-te' },
      faq: { title: 'Întrebări frecvente', items: [
        { q: 'Cât timp înainte trebuie să mă programez?', a: 'De obicei găsim o oră în aceeași săptămână. Pentru mirese, cu o lună înainte.' },
        { q: 'Pot muta programarea?', a: 'Da, cu cel puțin 24 de ore înainte.' },
        { q: 'Ce produse folosiți?', a: 'Lucrăm cu vopsele fără amoniac și cu îngrijire profesională pe care o poți cumpăra și pentru acasă.' },
      ] },
      text: { eyebrow: 'Prețuri', title: 'Servicii pentru păr și unghii', text: 'Toate prețurile includ consultația. Dacă nu știi ce ți se potrivește, întreabă-ne înainte.' },
      columns: { title: 'Ce facem', intro: 'Trei lucruri pe care le facem cel mai des.', cols: [
        { image: `${T}portfolio/images/iv-par2.jpg`, title: 'Culoare', text: 'Balayage, vopsit și corectarea culorii.', cta: 'Vezi prețurile' },
        { image: `${T}portfolio/images/iv-par1.jpg`, title: 'Tunsori', text: 'Pentru păr lung, scurt sau în creștere.', cta: 'Programează-te' },
        { image: `${T}portfolio/images/iv-mani2.jpg`, title: 'Manichiură', text: 'Semipermanentă, gel și îngrijire.', cta: 'Programează-te' },
      ] },
      team: { title: 'Echipa', people: [
        { image: `${T}portfolio/images/iv-team-c.jpg`, name: 'Carla', role: 'Coloristă' },
        { image: `${T}portfolio/images/iv-team-d.jpg`, name: 'Diana', role: 'Hairstylistă' },
        { image: `${T}portfolio/images/iv-team-l.jpg`, name: 'Laura', role: 'Manichiuristă' },
      ] },
      form: { title: 'Cere o programare', text: 'Te sunăm noi să confirmăm ora.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce serviciu dorești?', cta: 'Trimite', address: 'Strada Lăpușneanu 8, Iași', phone: '07xx xxx xxx', email: 'salut@atelierivoire.ro' },
      instagram: { title: 'Pe Instagram', handle: '@atelierivoire', cta: 'Urmărește-ne', images: ['iv-ig1', 'iv-ig2', 'iv-ig3', 'iv-ig4', 'iv-ig5', 'iv-ig6'].map((n) => `${T}portfolio/images/${n}.jpg`) },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'images'], ['gallery', 'mosaic'], ['reviews', 'cards'], ['cta', 'boxed']] },
      { name: 'Prețuri', blocks: [['text', 'center'], ['menu', 'list'], ['cta', 'band']] },
      { name: 'Echipa', blocks: [['about', 'side'], ['team', 'round']] },
      { name: 'Contact', blocks: [['hours', 'photo'], ['form', 'simple'], ['faq', 'list']] },
    ],
  },

  meserii: {
    label: 'Meserii', desc: 'Construcții, renovări, reparații',
    theme: { palette: 'santier', fonts: 'solid', radius: 4 },
    images: imgs('local-service', ['ct-hero', 'ct-ac1', 'ct-ac2', 'ct-ac3', 'ct-fat1', 'ct-fat2', 'ct-rep1', 'ct-rep2', 'ct-rep3', 'pr-hero', 'pr-baie1', 'pr-baie2', 'pr-baie3', 'pr-buc1', 'pr-buc2', 'pr-buc3', 'pr-ext1', 'pr-ext2', 'ct-ig1', 'ct-ig2', 'ct-ig3']),
    header: { brand: 'Acoperișuri Dacia', cta: 'Sună acum' },
    footer: { brand: 'Acoperișuri Dacia', text: 'București și Ilfov · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Acoperișuri · București și Ilfov', title: 'Acoperișuri reparate în 48 de ore', text: 'Țiglă, tablă, hidroizolații și jgheaburi. Venim la evaluare gratuit și îți spunem prețul pe loc.', cta: 'Cere o ofertă', cta2: 'Sună acum', image: `${T}local-service/images/ct-hero.jpg` },
      about: { title: 'Despre noi', text: 'Lucrăm din 2008 pe acoperișuri de case și blocuri. Avem echipele noastre, nu subcontractăm, și dăm garanție scrisă la manoperă.', image: `${T}local-service/images/ct-ac2.jpg` },
      menu: { title: 'Prețuri orientative', note: 'Prețul final îl stabilim după evaluare.', items: [
        { name: 'Evaluare la fața locului', desc: 'București și Ilfov', price: 'gratuit', image: `${T}local-service/images/ct-rep1.jpg` },
        { name: 'Reparație țiglă', desc: 'Pe metru pătrat', price: 'de la 60 lei', image: `${T}local-service/images/ct-rep2.jpg` },
        { name: 'Acoperiș nou din tablă', desc: 'Pe metru pătrat, cu manoperă', price: 'de la 180 lei', image: `${T}local-service/images/ct-ac1.jpg` },
        { name: 'Hidroizolație terasă', desc: 'Membrană bituminoasă', price: 'de la 95 lei', image: `${T}local-service/images/ct-rep3.jpg` },
      ] },
      gallery: { title: 'Lucrări recente', items: ['ct-ac1', 'ct-ac2', 'ct-ac3', 'ct-fat1', 'ct-fat2', 'ct-rep3'].map((n) => ({ image: `${T}local-service/images/${n}.jpg` })) },
      reviews: { title: 'Ce spun clienții', items: [
        { quote: 'Au venit a doua zi după telefon și au oprit infiltrația înainte de ploaie.', author: 'Mihai S., Otopeni' },
        { quote: 'Preț corect, lucrare curată, au strâns tot după ei.', author: 'Elena V., Voluntari' },
        { quote: 'Am primit garanție scrisă. Recomand.', author: 'George T., București' },
      ] },
      hours: { title: 'Program', address: 'București și Ilfov', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '8:00 – 18:00' }, { day: 'Sâmbătă', time: '9:00 – 14:00' }, { day: 'Urgențe', time: 'oricând' }], image: `${T}local-service/images/ct-ac3.jpg` },
      cta: { title: 'Plouă în casă? Sună-ne acum.', text: 'Răspundem la urgențe în aceeași zi.', cta: 'Sună acum' },
      faq: { title: 'Întrebări frecvente', items: [
        { q: 'Evaluarea costă ceva?', a: 'Nu. Venim gratuit în București și Ilfov.' },
        { q: 'Dați garanție?', a: 'Da, 5 ani la manoperă, în scris.' },
        { q: 'Lucrați și iarna?', a: 'Da, pentru reparații și urgențe, când vremea permite.' },
      ] },
      text: { eyebrow: 'Servicii', title: 'Tot ce ține de acoperiș', text: 'De la o țiglă spartă la un acoperiș complet nou, cu structură, izolație și jgheaburi.' },
      columns: { title: 'De ce să ne alegi', intro: 'Trei lucruri pe care ni le cer clienții.', cols: [
        { image: `${T}local-service/images/ct-rep1.jpg`, title: 'Evaluare gratuită', text: 'Venim, măsurăm și îți spunem prețul pe loc.', cta: 'Cere o ofertă' },
        { image: `${T}local-service/images/ct-ac1.jpg`, title: 'Echipe proprii', text: 'Nu subcontractăm. Știi cine vine la tine.', cta: 'Despre noi' },
        { image: `${T}local-service/images/ct-fat1.jpg`, title: 'Garanție 5 ani', text: 'Scrisă, la manoperă.', cta: 'Vezi lucrări' },
      ] },
      team: { title: 'Echipa', people: [
        { image: `${T}local-service/images/pr-hero.jpg`, name: 'Ion Dumitru', role: 'Șef de echipă' },
        { image: `${T}local-service/images/ct-rep2.jpg`, name: 'Vasile Pop', role: 'Tinichigiu' },
        { image: `${T}local-service/images/ct-rep3.jpg`, name: 'Marius Ene', role: 'Hidroizolații' },
      ] },
      form: { title: 'Cere o ofertă', text: 'Spune-ne ce lucrare ai. Te sunăm în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce lucrare ai?', cta: 'Trimite cererea', address: 'București și Ilfov', phone: '07xx xxx xxx', email: 'oferte@acoperisuridacia.ro' },
      instagram: { title: 'Din șantier', handle: '@acoperisuridacia', cta: 'Urmărește-ne', images: ['ct-ig1', 'ct-ig2', 'ct-ig3', 'ct-ig4', 'ct-ig5', 'ct-ig6'].map((n) => `${T}local-service/images/${n}.jpg`) },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'full'], ['columns', 'numbers'], ['gallery', 'grid'], ['reviews', 'cards'], ['cta', 'band']] },
      { name: 'Servicii', blocks: [['text', 'split'], ['menu', 'cards'], ['faq', 'list']] },
      { name: 'Cere ofertă', blocks: [['form', 'info'], ['hours', 'columns']] },
    ],
  },

  profesionisti: {
    label: 'Servicii profesionale', desc: 'Avocați, contabili, consultanți',
    theme: { palette: 'birou', fonts: 'editorial', radius: 6 },
    images: [`${T}professionals/images/hero.jpg`, ...imgs('portfolio', ['sf-team-a', 'sf-team-m', 'sf-team-o', 'sf-ext2', 'sf-ext3'])],
    header: { brand: 'Cabinet Marin', cta: 'Programează o consultație' },
    footer: { brand: 'Cabinet Marin', text: 'Calea Victoriei 40, București · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Avocat · drept civil și comercial', title: 'Claritate pentru deciziile care contează', text: 'Consultații online sau la cabinet, numai cu programare. Primul apel de 30 de minute e gratuit.', cta: 'Programează o consultație', cta2: 'Vezi serviciile', image: `${T}professionals/images/hero.jpg` },
      about: { title: 'Despre cabinet', text: 'Lucrăm cu firme mici și cu persoane fizice. Îți explicăm fiecare pas pe înțeles și îți spunem de la început cât costă.', image: `${T}professionals/images/hero.jpg` },
      menu: { title: 'Servicii și onorarii', note: 'Onorariul exact îl stabilim după primul apel.', items: [
        { name: 'Primul apel', desc: '30 de minute, online', price: 'gratuit', image: `${T}professionals/images/hero.jpg` },
        { name: 'Consultanță juridică', desc: 'Pe oră', price: '300 lei', image: `${T}professionals/images/hero.jpg` },
        { name: 'Redactare contract', desc: 'Contract comercial standard', price: 'de la 800 lei', image: `${T}professionals/images/hero.jpg` },
        { name: 'Reprezentare în instanță', desc: 'Pe dosar', price: 'la cerere', image: `${T}professionals/images/hero.jpg` },
      ] },
      reviews: { title: 'Ce spun clienții', items: [
        { quote: 'Mi-a explicat contractul rând cu rând. Am semnat știind exact ce semnez.', author: 'Andrei C., antreprenor' },
        { quote: 'Răspunde la telefon și ține termenele.', author: 'Cristina L.' },
        { quote: 'Onorariul a fost cel spus la început, fără surprize.', author: 'Paul M.' },
      ] },
      hours: { title: 'Cabinetul', address: 'Calea Victoriei 40, București', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '9:00 – 18:00' }, { day: 'Weekend', time: 'doar online, cu programare' }], image: `${T}professionals/images/hero.jpg` },
      cta: { title: 'Ai o întrebare juridică?', text: 'Primul apel de 30 de minute e gratuit.', cta: 'Alege o oră' },
      faq: { title: 'Întrebări frecvente', items: [
        { q: 'Cât costă o consultație?', a: 'Primul apel de 30 de minute e gratuit. Apoi 300 lei pe oră.' },
        { q: 'Lucrați și online?', a: 'Da, pe video, cu documentele trimise pe email.' },
        { q: 'Cât durează un contract?', a: 'De obicei 3–5 zile lucrătoare.' },
      ] },
      text: { eyebrow: 'Servicii', title: 'Cu ce te putem ajuta', text: 'Contracte, firme, litigii civile și verificări înainte să semnezi ceva important.' },
      columns: { title: 'Domenii', intro: 'Lucrăm mai ales pe acestea.', cols: [
        { image: `${T}professionals/images/hero.jpg`, title: 'Contracte', text: 'Redactare, revizuire și negociere.', cta: 'Află mai mult' },
        { image: `${T}professionals/images/hero.jpg`, title: 'Firme', text: 'Înființare, modificări, asociați.', cta: 'Află mai mult' },
        { image: `${T}professionals/images/hero.jpg`, title: 'Litigii', text: 'Reprezentare în instanță, civil și comercial.', cta: 'Află mai mult' },
      ] },
      team: { title: 'Echipa', people: [
        { image: `${T}portfolio/images/sf-team-a.jpg`, name: 'Ana Marin', role: 'Avocat titular' },
        { image: `${T}portfolio/images/sf-team-m.jpg`, name: 'Mara Ionescu', role: 'Avocat colaborator' },
        { image: `${T}portfolio/images/sf-team-o.jpg`, name: 'Oana Pop', role: 'Asistent juridic' },
      ] },
      form: { title: 'Programează o consultație', text: 'Îți confirmăm ora pe email.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Pe scurt, despre ce e vorba?', cta: 'Trimite', address: 'Calea Victoriei 40, București', phone: '07xx xxx xxx', email: 'contact@cabinetmarin.ro' },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'numbers'], ['reviews', 'single'], ['cta', 'band']] },
      { name: 'Servicii', blocks: [['text', 'split'], ['menu', 'list'], ['faq', 'list']] },
      { name: 'Despre', blocks: [['about', 'statement'], ['team', 'grid']] },
      { name: 'Contact', blocks: [['form', 'info'], ['hours', 'columns']] },
    ],
  },

  cofetarie: {
    label: 'Cofetărie', desc: 'Torturi, prăjituri, comenzi',
    theme: { palette: 'zmeura', fonts: 'clasic', radius: 20 },
    images: imgs('desserdirina', ['torturi-1', 'torturi-2', 'torturi-3', 'torturi-4', 'cupcakes-1', 'cupcakes-2', 'catering-1', 'catering-2', 'placinte-1']),
    header: { brand: 'Cofetăria Mura', cta: 'Comandă pe WhatsApp' },
    footer: { brand: 'Cofetăria Mura', text: 'Strada Mureșenilor 21, Brașov · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Cofetărie · Brașov', title: 'Torturi la comandă, cu fructe adevărate', text: 'Coacem în fiecare dimineață. Comanzi cu 3 zile înainte, ridici sau îți aducem acasă.', cta: 'Comandă pe WhatsApp', cta2: 'Vezi torturile', image: `${T}desserdirina/images/torturi-1.jpg` },
      about: { title: 'Povestea noastră', text: 'Am început în bucătăria de acasă, cu torturi pentru prieteni. Acum avem un atelier mic, dar rețetele sunt aceleași: unt, ouă de la țară și fructe de sezon.', image: `${T}desserdirina/images/placinte-1.jpg` },
      menu: { title: 'Ce coacem', note: 'Prețurile sunt orientative.', items: [
        { name: 'Tort cu afine', desc: 'Mascarpone, blat de cacao', price: '160 lei/kg', image: `${T}desserdirina/images/torturi-1.jpg` },
        { name: 'Tort aniversar tematic', desc: 'Decor după tema ta', price: 'de la 190 lei/kg', image: `${T}desserdirina/images/torturi-3.jpg` },
        { name: 'Cupcakes cu zmeură', desc: 'Minimum 12 bucăți', price: '12 lei/buc.', image: `${T}desserdirina/images/cupcakes-1.jpg` },
        { name: 'Platou de prăjituri', desc: 'Pentru evenimente', price: 'la cerere', image: `${T}desserdirina/images/catering-2.jpg` },
      ] },
      gallery: { title: 'Din atelier', items: ['torturi-1', 'torturi-2', 'torturi-3', 'torturi-4', 'cupcakes-2', 'catering-1'].map((n) => ({ image: `${T}desserdirina/images/${n}.jpg` })) },
      reviews: { title: 'Ce spun clienții', items: [
        { quote: 'Tortul de botez a fost exact ca în schiță. Toată lumea a cerut numărul.', author: 'Simona D.' },
        { quote: 'Cele mai bune cupcakes din Brașov, fără exagerare.', author: 'Radu F.' },
        { quote: 'Au livrat la timp, chiar și în ziua de Paște.', author: 'Alina G.' },
      ] },
      hours: { title: 'Atelierul', address: 'Strada Mureșenilor 21, Brașov', phone: '07xx xxx xxx', hours: [{ day: 'Marți – Sâmbătă', time: '8:00 – 19:00' }, { day: 'Duminică', time: '9:00 – 13:00' }, { day: 'Luni', time: 'închis' }], image: `${T}desserdirina/images/catering-1.jpg` },
      cta: { title: 'Ai o aniversare în curând?', text: 'Scrie-ne cu 3 zile înainte și îți trimitem o schiță.', cta: 'Comandă pe WhatsApp' },
      faq: { title: 'Întrebări frecvente', items: [
        { q: 'Cu cât timp înainte comand?', a: 'Cu 3 zile pentru torturi obișnuite, cu o săptămână pentru tematice.' },
        { q: 'Livrați?', a: 'Da, în Brașov, cu 20 lei.' },
        { q: 'Aveți variante fără zahăr?', a: 'Da, pentru câteva torturi. Întreabă-ne pe WhatsApp.' },
      ] },
      text: { eyebrow: 'Comenzi', title: 'Torturi pentru orice ocazie', text: 'Aniversări, botezuri, nunți sau doar o duminică. Ne spui ocazia și numărul de invitați, noi propunem.' },
      columns: { title: 'Cum comanzi', intro: 'Trei pași, fără grabă.', cols: [
        { image: `${T}desserdirina/images/torturi-2.jpg`, title: 'Ne scrii', text: 'Ce tort vrei, pentru câte persoane și data.', cta: 'Scrie-ne' },
        { image: `${T}desserdirina/images/torturi-4.jpg`, title: 'Primești schița', text: 'În aceeași zi, cu prețul final.', cta: 'Vezi exemple' },
        { image: `${T}desserdirina/images/catering-2.jpg`, title: 'Ridici sau livrăm', text: 'Din atelier sau acasă, în Brașov.', cta: 'Program' },
      ] },
      team: { title: 'Cine coace', people: [
        { image: `${T}desserdirina/images/torturi-2.jpg`, name: 'Irina', role: 'Cofetar' },
        { image: `${T}desserdirina/images/cupcakes-2.jpg`, name: 'Andra', role: 'Decor' },
      ] },
      form: { title: 'Cere o ofertă', text: 'Răspundem în aceeași zi.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Ce ocazie și pentru câte persoane?', cta: 'Trimite', address: 'Strada Mureșenilor 21, Brașov', phone: '07xx xxx xxx', email: 'comenzi@cofetariamura.ro' },
      instagram: { title: 'Pe Instagram', handle: '@cofetariamura', cta: 'Urmărește-ne', images: ['torturi-1', 'torturi-2', 'torturi-3', 'cupcakes-1', 'cupcakes-2', 'catering-1'].map((n) => `${T}desserdirina/images/${n}.jpg`) },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['menu', 'cards'], ['columns', 'images'], ['reviews', 'cards'], ['cta', 'boxed']] },
      { name: 'Torturi', blocks: [['text', 'center'], ['gallery', 'mosaic'], ['menu', 'list']] },
      { name: 'Contact', blocks: [['hours', 'photo'], ['form', 'simple'], ['faq', 'list']] },
    ],
  },
};

window.SB_PACKS = PACKS;
})();
