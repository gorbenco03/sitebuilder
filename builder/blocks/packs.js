'use strict';
/** Starter packs share the renderer API, not a page composition. */
(function (root) {
const T = '@tpl/';
function imgs(dir, names) { return names.map((n) => `${T}${dir}/images/${n}.jpg`); }

const PACKS = {
  restaurant: {
    label: 'Restaurant', desc: 'Restaurante, cafenele și baruri',
    theme: { palette: 'seara', fonts: 'clasic', radius: 2 },
    images: imgs('product-menu', ['cn-hero', 'cn-r1', 'cn-r2', 'cn-r3', 'cn-d1', 'cn-d2', 'cn-d3', 'cn-ig1', 'cn-ig2', 'cn-ig3', 'cn-ig4', 'cn-ig5', 'cn-ig6', 'tv-hero', 'tv-a1', 'tv-a2', 'tv-a3', 'tv-m1', 'tv-m2', 'tv-m3']),
    actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' }, cta: { cta: 'contact' } },
    header: { brand: 'Casa Nord', cta: 'Rezervă o masă' },
    footer: { brand: 'Casa Nord', text: 'Strada Nordului 12, București · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Restaurant · București · design de exemplu', title: 'O masă bună. O seară pe îndelete.', text: 'Descoperă meniul, alege-ți masa și lasă loc pentru desert.', cta: 'Rezervă o masă', cta2: 'Vezi meniul', image: `${T}product-menu/images/cn-hero.jpg` },
      about: { title: 'Loc pentru încă o poveste', text: 'O masă cu prietenii sau o cină în doi. Fotografia ilustrează atmosfera; adaugă aici povestea și imaginile restaurantului tău.', image: `${T}product-menu/images/cn-r1.jpg` },
      menu: { title: 'La masă', note: 'Selecție și prețuri de exemplu. Completează ingredientele și alergenii pentru meniul real.', items: [
        { name: 'Pește cu legume', desc: 'File de pește, legume și verdețuri', price: '68 lei', image: `${T}product-menu/images/cn-d1.jpg` },
        { name: 'Friptură de vită', desc: 'Carne rumenită, servită pe platou', price: '89 lei', image: `${T}product-menu/images/cn-d2.jpg` },
        { name: 'Desert de ciocolată', desc: 'Un final dulce pentru cină', price: '32 lei', image: `${T}product-menu/images/cn-d3.jpg` },
        { name: 'Salată de sezon', desc: 'Frunze, legume și semințe', price: '38 lei', image: `${T}product-menu/images/tv-m1.jpg` },
      ] },
      text: { eyebrow: 'Meniu', title: 'Ce alegi în seara asta?', text: 'Preparatele, descrierile și prețurile de mai jos sunt exemple editabile. Înlocuiește-le cu oferta restaurantului tău.' },
      hours: { title: 'Ne vedem la masă', address: 'Adresă de exemplu · Strada Nordului 12, București', phone: '07xx xxx xxx', hours: [{ day: 'Marți – Vineri', time: '18:00 – 23:00' }, { day: 'Sâmbătă – Duminică', time: '13:00 – 23:30' }, { day: 'Luni', time: 'închis' }], image: `${T}product-menu/images/cn-r2.jpg` },
      cta: { title: 'Alege seara. Noi păstrăm masa.', text: 'Spune-ne data și câte persoane veniți. Rezervarea se stabilește direct cu restaurantul.', cta: 'Rezervă o masă' },
      form: { title: 'O masă pentru voi', text: 'Lasă data, ora și numărul de persoane. Așteaptă confirmarea restaurantului înainte să vii.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Când și câte persoane?', cta: 'Cere o rezervare', address: 'Adresă de exemplu · Strada Nordului 12, București', phone: '07xx xxx xxx', email: '' },
      faq: { title: 'Înainte să vii', items: [
        { q: 'Cum rezerv o masă?', a: 'Trimite o cerere sau sună la numărul completat de restaurant. Cererea nu este o confirmare.' },
        { q: 'Unde găsesc informații despre alergeni?', a: 'Cere restaurantului lista actuală de ingrediente și alergeni înainte să comanzi.' },
      ] },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'full'], ['cta', 'band'], ['about', 'side'], ['hours', 'columns']] },
      { name: 'Meniu', blocks: [['text', 'split'], ['menu', 'cards']] },
      { name: 'Contact', blocks: [['form', 'info'], ['hours', 'photo'], ['faq', 'list']] },
    ],
  },

  salon: {
    label: 'Salon de frumusețe', desc: 'Coafor, manichiură, cosmetică',
    theme: { palette: 'pudra', fonts: 'editorial', radius: 4 },
    images: imgs('portfolio', ['iv-hero', 'iv-par1', 'iv-par2', 'iv-par3', 'iv-par4', 'iv-mani1', 'iv-mani2', 'iv-mani3', 'iv-mani4', 'iv-ig1', 'iv-ig2', 'iv-ig3', 'iv-ig4', 'iv-ig5', 'iv-ig6', 'iv-team-c', 'iv-team-d', 'iv-team-l', 'sf-hero', 'sf-ext1', 'sf-ext2']),
    actions: { nav: { cta: 'booking' }, hero: { cta: 'booking', cta2: 'menu' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'booking' }, cta: { cta: 'booking' } },
    header: { brand: 'Atelier Ivoire', cta: 'Programează-te' },
    footer: { brand: 'Atelier Ivoire', text: 'Strada Lăpușneanu 8, Iași · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Păr & culoare · Iași · design de exemplu', title: 'Culoare în lumină naturală.', text: 'Balayage, tuns și îngrijire. Un look de pornire pentru conversația cu stilista ta; fotografiile sunt exemple, nu lucrări ale salonului.', cta: 'Programează-te', cta2: 'Vezi prețurile', image: `${T}portfolio/images/iv-par1.jpg` },
      about: { title: 'O pauză la oglindă', text: 'Începem cu ce îți dorești de la părul tău: formă, culoare, întreținere. Acesta este un spațiu de exemplu; prezintă aici salonul și oamenii tăi.', image: `${T}portfolio/images/iv-hero.jpg` },
      menu: { title: 'Servicii și prețuri', note: 'Prețuri și durate de exemplu. Confirmă serviciul potrivit înainte de programare.', items: [
        { name: 'Tuns și coafat', desc: '60 de minute', price: '120 lei', image: `${T}portfolio/images/iv-par2.jpg` },
        { name: 'Vopsit rădăcină', desc: '90 de minute', price: 'de la 220 lei', image: `${T}portfolio/images/iv-par3.jpg` },
        { name: 'Balayage', desc: 'În jur de 3 ore', price: 'de la 450 lei', image: `${T}portfolio/images/iv-par4.jpg` },
        { name: 'Manichiură semipermanentă', desc: '75 de minute', price: '90 lei', image: `${T}portfolio/images/iv-mani1.jpg` },
      ] },
      columns: { title: 'Două direcții de culoare', intro: 'Fotografii ilustrative, nu rezultate documentate ale salonului. Discută look-ul dorit și serviciul potrivit cu stilista ta.', cols: [
        { image: `${T}portfolio/images/iv-par2.jpg`, title: 'Brunet cu reflexe calde', text: 'Exemplu de culoare și coafat cu ondulații. Consultația stabilește ce se potrivește părului tău.', cta: 'Vezi prețurile' },
        { image: `${T}portfolio/images/iv-par4.jpg`, title: 'Șuvițe în lumină naturală', text: 'Exemplu de inspirație pentru balayage. Rezultatul depinde de baza și istoricul părului.', cta: 'Programează-te' },
      ] },
      gallery: { title: 'Idei de culoare · fotografii de exemplu', items: ['iv-par2', 'iv-par4'].map((n) => ({ image: `${T}portfolio/images/${n}.jpg` })) },
      hours: { title: 'Loc pentru tine', address: 'Adresă de exemplu · Strada Lăpușneanu 8, Iași', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '9:00 – 20:00' }, { day: 'Sâmbătă', time: '9:00 – 15:00' }, { day: 'Duminică', time: 'închis' }], image: `${T}portfolio/images/iv-par1.jpg` },
      cta: { title: 'Următorul look începe cu o discuție.', text: 'Alege serviciul și verifică orele disponibile în calendar.', cta: 'Programează-te' },
      faq: { title: 'Înainte de programare', items: [
        { q: 'Cum aleg serviciul?', a: 'Dacă nu știi ce să rezervi, descrie rezultatul dorit în mesaj. Salonul îți poate recomanda serviciul potrivit.' },
        { q: 'Pot muta programarea?', a: 'Verifică regulile de anulare și reprogramare comunicate la rezervare.' },
        { q: 'Ce produse folosiți?', a: 'Adaugă aici produsele folosite efectiv în salon și informațiile relevante pentru clientele tale.' },
      ] },
      text: { eyebrow: 'Atelier Ivoire · exemplu editabil', title: 'Părul tău, pe mâini cunoscute.', text: 'Exemplu de prezentare a echipei. Adaugă numele, serviciile și fotografiile persoanelor care lucrează în salon, cu acordul lor.' },
      booking: { title: 'Programează-te online', text: 'Vezi serviciile și programul de mai jos.', services: [
        { name: 'Tuns și coafat', min: '60' }, { name: 'Vopsit rădăcină', min: '90' }, { name: 'Balayage', min: '180' }, { name: 'Manichiură semipermanentă', min: '75' },
      ], week: [{ on: true, from: '09:00', to: '20:00' }, { on: true, from: '09:00', to: '20:00' }, { on: true, from: '09:00', to: '20:00' }, { on: true, from: '09:00', to: '20:00' }, { on: true, from: '09:00', to: '20:00' }, { on: true, from: '09:00', to: '15:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
      form: { title: 'Ai o întrebare?', text: 'Spune-ne ce serviciu te interesează înainte să alegi ora.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Mesajul tău', cta: 'Trimite', address: 'Adresă de exemplu · Strada Lăpușneanu 8, Iași', phone: '07xx xxx xxx', email: 'salut@atelierivoire.ro' },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'images'], ['menu', 'list'], ['about', 'side'], ['cta', 'band']] },
      { name: 'Prețuri', blocks: [['menu', 'list'], ['cta', 'band']] },
      { name: 'Echipa', blocks: [['text', 'left'], ['about', 'side']] },
      { name: 'Contact', blocks: [['booking', 'split'], ['hours', 'photo'], ['form', 'simple'], ['faq', 'list']] },
    ],
  },

  meserii: {
    label: 'Meserii', desc: 'Construcții, renovări, reparații',
    theme: { palette: 'santier', fonts: 'solid', radius: 0 },
    images: imgs('local-service', ['ct-hero', 'ct-ac1', 'ct-ac2', 'ct-ac3', 'ct-fat1', 'ct-fat2', 'ct-rep1', 'ct-rep2', 'ct-rep3', 'pr-hero', 'pr-baie1', 'pr-baie2', 'pr-baie3', 'pr-buc1', 'pr-buc2', 'pr-buc3', 'pr-ext1', 'pr-ext2', 'ct-ig1', 'ct-ig2', 'ct-ig3']),
    actions: { nav: { cta: 'phone' }, hero: { cta: 'phone', cta2: 'contact' }, columns: { 'cols.0.cta': 'contact', 'cols.1.cta': 'contact' }, cta: { cta: 'phone' } },
    header: { brand: 'Acoperișuri Dacia', cta: 'Sună acum' },
    footer: { brand: 'Acoperișuri Dacia', text: 'Zonă de exemplu · București și Ilfov · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Acoperișuri · București și Ilfov · exemplu', title: 'Reparații de acoperiș.', text: 'Infiltrații sau țigle desprinse? Spune-ne problema și localitatea la 07xx xxx xxx. Reparații, învelitori și jgheaburi; zona se completează pentru echipa ta.', cta: 'Sună acum', cta2: 'Cere o ofertă', image: `${T}local-service/images/ct-rep1.jpg` },
      columns: { title: 'Ce fel de lucrare ai?', intro: 'Fotografii ilustrative, nu proiecte documentate ale echipei. Înlocuiește-le cu lucrări proprii și detalii reale.', cols: [
        { image: `${T}local-service/images/ct-ac1.jpg`, title: 'Învelitoare din țiglă', text: 'Exemplu vizual: acoperiș în pantă. Descrie starea învelitorii și lucrarea de care ai nevoie.', cta: 'Cere o ofertă' },
        { image: `${T}local-service/images/ct-rep2.jpg`, title: 'Jgheaburi și scurgeri', text: 'Exemplu vizual: colectarea apei la marginea acoperișului. Arată locul unde apa nu se scurge corect.', cta: 'Cere o ofertă' },
      ] },
      about: { title: 'Cine vine la lucrare', text: 'Adaugă numele echipei, zona reală de lucru și ce intervenții preluați. Publică experiența, calificările și condițiile de garanție numai dacă le poți documenta.', image: `${T}local-service/images/ct-ac2.jpg` },
      menu: { title: 'Intervenții și evaluare', note: 'Servicii de exemplu. Costul și disponibilitatea se confirmă după descrierea lucrării.', items: [
        { name: 'Reparații de învelitoare', desc: 'Țiglă, tablă și elemente de fixare', price: 'cere ofertă', image: `${T}local-service/images/ct-ac3.jpg` },
        { name: 'Jgheaburi și burlane', desc: 'Verificare, înlocuire sau montaj', price: 'cere ofertă', image: `${T}local-service/images/ct-rep2.jpg` },
        { name: 'Hidroizolație terasă', desc: 'Descrie suprafața și problema observată', price: 'cere ofertă', image: `${T}local-service/images/ct-rep3.jpg` },
      ] },
      hours: { title: 'Zona și programul de lucru', address: 'Zonă de exemplu · București și Ilfov', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '8:00 – 18:00' }, { day: 'Sâmbătă', time: '9:00 – 14:00' }, { day: 'Intervenții', time: 'după confirmare' }], image: `${T}local-service/images/ct-ac2.jpg` },
      cta: { title: 'Spune-ne unde și ce s-a întâmplat.', text: 'Telefon de completat: 07xx xxx xxx. Nu urca pe acoperiș pentru fotografii.', cta: 'Sună acum' },
      faq: { title: 'Înainte de ofertă', items: [
        { q: 'Ce trimit pentru evaluare?', a: 'Localitatea, o descriere a problemei și fotografii făcute dintr-un loc sigur.' },
        { q: 'Cum aflu costul și termenul?', a: 'Cere o ofertă scrisă cu lucrările incluse, materialele, termenul și condițiile de garanție agreate cu echipa.' },
      ] },
      text: { eyebrow: 'Servicii pentru acoperiș · exemple', title: 'De la locul infiltrației la planul de lucru.', text: 'Descrie problema, stabilim ce trebuie verificat și discutăm oferta înainte de începerea lucrării. Completează procedura reală a echipei tale.' },
      form: { title: 'Cere o ofertă', text: 'Localitatea și problema sunt primul pas. Echipa confirmă separat vizita și disponibilitatea.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Localitatea și lucrarea de care ai nevoie', cta: 'Trimite cererea', address: 'Zonă de exemplu · București și Ilfov', phone: '07xx xxx xxx', email: '' },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['columns', 'images'], ['hours', 'columns'], ['cta', 'band']] },
      { name: 'Servicii', blocks: [['text', 'split'], ['menu', 'list'], ['about', 'statement'], ['faq', 'list']] },
      { name: 'Cere ofertă', blocks: [['form', 'info'], ['hours', 'columns']] },
    ],
  },

  profesionisti: {
    label: 'Servicii profesionale', desc: 'Avocați, contabili, consultanți',
    theme: { palette: 'birou', fonts: 'editorial', radius: 0 },
    images: [`${T}professionals/images/hero.jpg`],
    actions: { nav: { cta: 'booking' }, hero: { cta: 'booking', cta2: 'menu' }, columns: { 'cols.0.cta': 'menu', 'cols.1.cta': 'booking', 'cols.2.cta': 'contact' }, cta: { cta: 'booking' } },
    header: { brand: 'Cabinet Marin', cta: 'Programează o consultație' },
    footer: { brand: 'Cabinet Marin', text: 'Calea Victoriei 40, București · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Drept civil și comercial · cabinet de exemplu', title: 'Înainte să semnezi, înțelege ce decizi.', text: 'Contracte, relații între asociați, litigii civile. O consultație începe cu întrebarea ta și cu documentele relevante.', cta: 'Programează o consultație', cta2: 'Vezi serviciile', image: '' },
      about: { title: 'Cine răspunde pentru cazul tău', text: 'Aici se prezintă avocatul titular: numele real, forma de exercitare, baroul și ariile de practică. Acesta este un cabinet de exemplu, fără identități sau calificări inventate.', image: '' },
      menu: { title: 'Arii de practică', note: 'Exemple editabile. Serviciul, onorariul și condițiile se stabilesc pentru situația concretă.', items: [
        { name: 'Contracte', desc: 'Redactare, revizuire și explicarea clauzelor', price: 'la cerere', image: '' },
        { name: 'Relații între asociați', desc: 'Documente și opțiuni pentru organizarea firmei', price: 'la cerere', image: '' },
        { name: 'Litigii civile', desc: 'Analiza documentelor și a pașilor disponibili', price: 'la cerere', image: '' },
      ] },
      hours: { title: 'Discutăm cu programare', address: 'Adresă de exemplu · Calea Victoriei 40, București', phone: '07xx xxx xxx', hours: [{ day: 'Luni – Vineri', time: '9:00 – 18:00' }, { day: 'Weekend', time: 'doar online, cu programare' }], image: '' },
      cta: { title: 'Cu ce întrebare începem?', text: 'Alege tipul consultației și verifică disponibilitatea.', cta: 'Programează o consultație' },
      faq: { title: 'Înainte de consultație', items: [
        { q: 'Ce documente pregătesc?', a: 'O descriere scurtă și documentele relevante. Întreabă cabinetul cum le poți transmite în siguranță.' },
        { q: 'Cum se stabilește onorariul?', a: 'Cere condițiile și onorariul aplicabil înainte de consultație. Tarifele se confirmă direct cu cabinetul.' },
      ] },
      text: { eyebrow: 'Specializare, nu promisiuni de rezultat', title: 'Ce ai nevoie să clarifici?', text: 'Prezintă problema și documentele existente. Cabinetul confirmă dacă o poate prelua și în ce condiții. Niciun rezultat nu este garantat.' },
      columns: { title: 'De la întrebare la următorul pas', intro: 'Parcurs de exemplu, de adaptat modului real de lucru al cabinetului.', cols: [
        { title: 'Descrii situația', text: 'Spui ce vrei să clarifici și ce termene cunoști.', cta: 'Vezi serviciile' },
        { title: 'Stabilim consultația', text: 'Confirmăm obiectul discuției, documentele și condițiile.', cta: 'Programează o consultație' },
        { title: 'Alegi următorul pas', text: 'Discuți opțiunile și ce presupune fiecare, fără promisiuni de rezultat.', cta: 'Contact' },
      ] },
      booking: { title: 'Programează o consultație', text: 'Vezi serviciile și programul de mai jos.', services: [
        { name: 'Primul apel (gratuit)', min: '30' }, { name: 'Consultație la cabinet', min: '60' }, { name: 'Consultație online', min: '60' },
      ], week: [{ on: true, from: '09:00', to: '18:00' }, { on: true, from: '09:00', to: '18:00' }, { on: true, from: '09:00', to: '18:00' }, { on: true, from: '09:00', to: '18:00' }, { on: true, from: '09:00', to: '18:00' }, { on: false, from: '09:00', to: '17:00' }, { on: false, from: '09:00', to: '17:00' }], phone: '07xx xxx xxx' },
      form: { title: 'O întrebare înainte de consultație', text: 'Serviciile și orele calendarului sunt exemple editabile. Confirmă condițiile cu cabinetul; nu trimite date sensibile în acest mesaj.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Pe scurt, despre ce e vorba?', cta: 'Trimite', address: 'Adresă de exemplu · Calea Victoriei 40, București', phone: '07xx xxx xxx', email: '' },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'centered'], ['about', 'statement'], ['columns', 'numbers'], ['cta', 'band']] },
      { name: 'Servicii', blocks: [['text', 'left'], ['menu', 'list'], ['faq', 'list']] },
      { name: 'Despre', blocks: [['about', 'statement'], ['text', 'split']] },
      { name: 'Contact', blocks: [['booking', 'split'], ['form', 'info'], ['hours', 'columns']] },
    ],
  },

  cofetarie: {
    label: 'Cofetărie', desc: 'Torturi, prăjituri, comenzi',
    theme: { palette: 'zmeura', fonts: 'clasic', radius: 2 },
    images: imgs('desserdirina', ['hero', 'torturi-1', 'cupcakes-1', 'catering-1', 'placinte-1']),
    actions: { nav: { cta: 'contact' }, hero: { cta: 'contact', cta2: 'menu' }, columns: { 'cols.0.cta': 'contact', 'cols.1.cta': 'menu', 'cols.2.cta': 'contact' }, cta: { cta: 'contact' } },
    header: { brand: 'Cofetăria Mura', cta: 'Trimite o cerere' },
    footer: { brand: 'Cofetăria Mura', text: 'Strada Mureșenilor 21, Brașov · 07xx xxx xxx' },
    content: {
      hero: { eyebrow: 'Atelier de torturi · Brașov · design de exemplu', title: 'Un tort pentru momentul vostru.', text: 'O aniversare, o masă în familie, o zi de sărbătorit. Pornim de la ocazie, porții și gusturile tale. Fotografii de exemplu, de înlocuit cu produsele atelierului.', cta: 'Trimite o cerere', cta2: 'Vezi torturile', image: `${T}desserdirina/images/hero.jpg` },
      about: { title: 'Foietaj, straturi, detalii.', text: 'Dincolo de decor, contează ce descoperi la prima felie. Prezintă aici ingredientele și texturile produselor tale; fotografia este un exemplu de foietaj, nu o secțiune a tortului de mai sus.', image: `${T}desserdirina/images/placinte-1.jpg` },
      menu: { title: 'O selecție pentru masa dulce', note: 'Fotografii și prețuri de exemplu. Compoziția, porțiile și alergenii se confirmă înainte de comandă.', items: [
        { name: 'Tartă cu afine', desc: 'Fructe și decor de ciocolată', price: '160 lei/kg', image: `${T}desserdirina/images/torturi-1.jpg` },
        { name: 'Cupcakes cu fructe', desc: 'Cremă și fructe deasupra', price: '12 lei/buc.', image: `${T}desserdirina/images/cupcakes-1.jpg` },
        { name: 'Prăjituri și eclere', desc: 'Selecție pentru platoul de sărbătoare', price: 'la cerere', image: `${T}desserdirina/images/catering-1.jpg` },
      ] },
      hours: { title: 'Ridicarea comenzii', address: 'Adresă de exemplu · Strada Mureșenilor 21, Brașov', phone: '07xx xxx xxx', hours: [{ day: 'Marți – Sâmbătă', time: '8:00 – 19:00' }, { day: 'Duminică', time: '9:00 – 13:00' }, { day: 'Luni', time: 'închis' }], image: '' },
      cta: { title: 'Ce sărbătoriți?', text: 'Spune-ne data, numărul de porții și ce gusturi vă plac. Disponibilitatea se confirmă înainte de comandă.', cta: 'Trimite o cerere' },
      faq: { title: 'Detaliile unei comenzi', items: [
        { q: 'Cu cât timp înainte comand?', a: 'Trimite data dorită. Atelierul confirmă disponibilitatea și termenul pentru produsul ales.' },
        { q: 'Cum aflu ingredientele și alergenii?', a: 'Cere lista pentru produsul ales înainte să comanzi. Nu presupune că un produs este potrivit unei alergii din fotografie.' },
        { q: 'Cum ridic sau primesc comanda?', a: 'Stabiliți adresa, intervalul și eventualul cost al livrării când confirmați oferta.' },
      ] },
      text: { eyebrow: 'Torturi & masă dulce', title: 'Alege gustul. Povestim apoi despre decor.', text: 'Selecția de mai jos ilustrează produse diferite, nu variante ale aceluiași tort. Înlocuiește exemplele cu oferta reală a cofetăriei.' },
      columns: { title: 'De la idee la prima felie', intro: 'Un parcurs de comandă de adaptat atelierului tău.', cols: [
        { title: 'Spui ce sărbătorești', text: 'Data, numărul de porții, preferințele și alergenii despre care vrei să întrebi.', cta: 'Trimite o cerere' },
        { title: 'Stabilim detaliile', text: 'Compoziția, decorul, prețul și disponibilitatea se confirmă înainte de lucru.', cta: 'Vezi torturile' },
        { title: 'Ne vedem la ridicare', text: 'Agreăm locul și intervalul. Livrarea se discută separat, dacă este disponibilă.', cta: 'Contact' },
      ] },
      form: { title: 'Povestește-ne despre ocazie', text: 'Cererea nu este o comandă confirmată. Așteaptă răspunsul atelierului.', lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Data, ocazia și numărul de porții', cta: 'Cere o ofertă', address: 'Adresă de exemplu · Strada Mureșenilor 21, Brașov', phone: '07xx xxx xxx', email: '' },
    },
    pages: [
      { name: 'Acasă', blocks: [['hero', 'split'], ['about', 'side'], ['columns', 'numbers'], ['cta', 'band']] },
      { name: 'Torturi', blocks: [['text', 'split'], ['menu', 'cards']] },
      { name: 'Contact', blocks: [['form', 'info'], ['hours', 'columns'], ['faq', 'list']] },
    ],
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = PACKS;
else root.SB_PACKS = PACKS;
})(typeof window !== 'undefined' ? window : globalThis);
