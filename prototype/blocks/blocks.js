'use strict';
/**
 * prototype/blocks/blocks.js — block library for the block-editor prototype.
 *
 * A page is { theme, blocks: [{ id, type, variant, bg, data }] }.
 * Each block type declares its variants, default data, the fields the
 * settings panel edits, and render(data, variant) → HTML.
 *
 * Editable text carries data-f="<path into data>", replaceable images carry
 * data-img="<path>", list items carry data-list="<list path>" data-i="<index>".
 * The editor reads those attributes; the published page ignores them.
 */

(function () {
const IMG = '../../templates/product-menu/images/';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Editable inline text. */
function t(tag, path, value, cls) {
  return `<${tag}${cls ? ` class="${cls}"` : ''} data-f="${path}">${esc(value)}</${tag}>`;
}

/** Replaceable image. */
function img(path, src, alt, cls) {
  return `<img${cls ? ` class="${cls}"` : ''} data-img="${path}" src="${esc(src)}" alt="${esc(alt || '')}">`;
}

function btn(path, label, cls) {
  return `<a href="#" class="b-btn${cls ? ' ' + cls : ''}" data-f="${path}">${esc(label)}</a>`;
}

const BLOCKS = {
  nav: {
    label: 'Meniu de navigare', category: 'Antet',
    variants: { bar: 'Bară simplă', centered: 'Logo centrat' },
    defaults: () => ({ brand: 'Casa Nord', links: [{ label: 'Meniu' }, { label: 'Galerie' }, { label: 'Contact' }], cta: 'Rezervă o masă' }),
    fields: [
      { key: 'brand', label: 'Numele afacerii', type: 'text' },
      { key: 'links', label: 'Linkuri', type: 'list', item: [{ key: 'label', label: 'Text', type: 'text' }], newItem: { label: 'Link nou' } },
      { key: 'cta', label: 'Buton', type: 'text' },
    ],
    render(d, v) {
      const links = d.links.map((l, i) => `<a href="#" data-f="links.${i}.label" data-list="links" data-i="${i}">${esc(l.label)}</a>`).join('');
      if (v === 'centered') {
        return `<nav class="b-nav b-nav--centered"><div class="b-wrap"><div class="b-nav__links">${links}</div>${t('span', 'brand', d.brand, 'b-nav__brand')}<div class="b-nav__end">${btn('cta', d.cta)}</div></div></nav>`;
      }
      return `<nav class="b-nav"><div class="b-wrap">${t('span', 'brand', d.brand, 'b-nav__brand')}<div class="b-nav__links">${links}</div>${btn('cta', d.cta)}</div></nav>`;
    },
  },

  hero: {
    label: 'Prima secțiune (hero)', category: 'Antet',
    variants: { split: 'Text + poză', full: 'Poză pe tot ecranul', centered: 'Doar text, centrat' },
    defaults: () => ({
      eyebrow: 'Restaurant · București',
      title: 'Cine de seară, vinuri de pivniță, mese lungi',
      text: 'O sală mică de mese lângă Parcul Herăstrău. Gătim seara, cu legume de la producători locali.',
      cta: 'Rezervă o masă', cta2: 'Vezi meniul',
      image: IMG + 'cn-hero.jpg',
    }),
    fields: [
      { key: 'eyebrow', label: 'Text mic deasupra', type: 'text' },
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'text', label: 'Descriere', type: 'textarea' },
      { key: 'cta', label: 'Buton principal', type: 'text' },
      { key: 'cta2', label: 'Al doilea buton', type: 'text' },
      { key: 'image', label: 'Poză', type: 'image' },
    ],
    render(d, v) {
      const copy = `${t('p', 'eyebrow', d.eyebrow, 'b-eyebrow')}${t('h1', 'title', d.title, 'b-display')}${t('p', 'text', d.text, 'b-lede')}<div class="b-actions">${btn('cta', d.cta)}${btn('cta2', d.cta2, 'b-btn--ghost')}</div>`;
      if (v === 'full') {
        return `<header class="b-hero b-hero--full">${img('image', d.image, '', 'b-hero__bg')}<div class="b-hero__shade"></div><div class="b-wrap b-hero__copy">${copy}</div></header>`;
      }
      if (v === 'centered') {
        return `<header class="b-hero b-hero--centered"><div class="b-wrap b-narrow">${copy}</div></header>`;
      }
      return `<header class="b-hero b-hero--split"><div class="b-wrap b-cols"><div class="b-hero__copy">${copy}</div>${img('image', d.image, '', 'b-media')}</div></header>`;
    },
  },

  about: {
    label: 'Despre noi', category: 'Conținut',
    variants: { side: 'Text + poză', statement: 'Citat mare' },
    defaults: () => ({
      title: 'Povestea noastră',
      text: 'Casa Nord este o sală mică de mese lângă Parcul Herăstrău. Gătim seara: legume de la producători locali, pește de Dunăre, deserturi simple. Meniul se schimbă o dată pe lună.',
      image: IMG + 'cn-r1.jpg',
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'image', label: 'Poză', type: 'image' },
    ],
    render(d, v) {
      if (v === 'statement') {
        return `<section class="b-sec b-statement"><div class="b-wrap b-narrow">${t('p', 'title', d.title, 'b-eyebrow')}${t('p', 'text', d.text, 'b-quote')}</div></section>`;
      }
      return `<section class="b-sec"><div class="b-wrap b-cols b-cols--rev">${img('image', d.image, '', 'b-media')}<div>${t('h2', 'title', d.title, 'b-h2')}${t('p', 'text', d.text, 'b-body')}</div></div></section>`;
    },
  },

  menu: {
    label: 'Meniu cu prețuri', category: 'Restaurant',
    variants: { list: 'Listă pe două coloane', cards: 'Carduri cu poze' },
    defaults: () => ({
      title: 'Meniu',
      note: 'Meniul se schimbă o dată pe lună.',
      items: [
        { name: 'Pâine cu maia și unt', desc: 'Unt bătut în casă, sare de mare', price: '24 lei', image: IMG + 'cn-d1.jpg' },
        { name: 'Păstrăv de munte', desc: 'Cartofi noi, mărar, unt brun', price: '68 lei', image: IMG + 'cn-d2.jpg' },
        { name: 'Rață la cuptor', desc: 'Varză roșie, sos de vișine', price: '79 lei', image: IMG + 'cn-d3.jpg' },
        { name: 'Ciocolată și cireșe', desc: 'Mousse, cireșe în sirop, migdale', price: '32 lei', image: IMG + 'tv-m1.jpg' },
      ],
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'note', label: 'Notă', type: 'text' },
      { key: 'items', label: 'Preparate', type: 'list', item: [
        { key: 'name', label: 'Nume', type: 'text' }, { key: 'desc', label: 'Descriere', type: 'text' },
        { key: 'price', label: 'Preț', type: 'text' }, { key: 'image', label: 'Poză', type: 'image' },
      ], newItem: { name: 'Preparat nou', desc: 'Descriere scurtă', price: '0 lei', image: IMG + 'tv-m2.jpg' } },
    ],
    render(d, v) {
      const head = `<div class="b-head">${t('h2', 'title', d.title, 'b-h2')}${t('p', 'note', d.note, 'b-muted')}</div>`;
      if (v === 'cards') {
        const cards = d.items.map((it, i) => `<article class="b-card" data-list="items" data-i="${i}">${img(`items.${i}.image`, it.image, it.name, 'b-card__img')}<div class="b-card__row">${t('h3', `items.${i}.name`, it.name)}${t('span', `items.${i}.price`, it.price, 'b-price')}</div>${t('p', `items.${i}.desc`, it.desc, 'b-muted')}</article>`).join('');
        return `<section class="b-sec"><div class="b-wrap">${head}<div class="b-grid b-grid--4">${cards}</div></div></section>`;
      }
      const rows = d.items.map((it, i) => `<div class="b-menu__item" data-list="items" data-i="${i}"><div class="b-menu__line">${t('span', `items.${i}.name`, it.name, 'b-menu__name')}<span class="b-menu__dots"></span>${t('span', `items.${i}.price`, it.price, 'b-price')}</div>${t('p', `items.${i}.desc`, it.desc, 'b-muted')}</div>`).join('');
      return `<section class="b-sec"><div class="b-wrap">${head}<div class="b-menu">${rows}</div></div></section>`;
    },
  },

  gallery: {
    label: 'Galerie foto', category: 'Conținut',
    variants: { grid: 'Grilă', mosaic: 'Mozaic' },
    defaults: () => ({
      title: 'Din bucătărie',
      items: ['cn-ig1', 'cn-ig2', 'cn-ig3', 'cn-ig4', 'cn-ig5', 'cn-ig6'].map((n) => ({ image: IMG + n + '.jpg' })),
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'items', label: 'Poze', type: 'list', item: [{ key: 'image', label: 'Poză', type: 'image' }], newItem: { image: IMG + 'tv-ig1.jpg' } },
    ],
    render(d, v) {
      const pics = d.items.map((it, i) => `<figure class="b-gal__item" data-list="items" data-i="${i}">${img(`items.${i}.image`, it.image, '')}</figure>`).join('');
      return `<section class="b-sec"><div class="b-wrap">${t('h2', 'title', d.title, 'b-h2')}<div class="b-gal b-gal--${v}">${pics}</div></div></section>`;
    },
  },

  reviews: {
    label: 'Recenzii', category: 'Încredere',
    variants: { cards: 'Trei carduri', single: 'O recenzie mare' },
    defaults: () => ({
      title: 'Ce spun oaspeții',
      items: [
        { quote: 'Cea mai bună rață pe care am mâncat-o în București. Revenim sigur.', author: 'Andreea M.' },
        { quote: 'Personal atent, vinuri bine alese, atmosferă liniștită.', author: 'Mihai D.' },
        { quote: 'Am sărbătorit aici o aniversare. Totul a fost impecabil.', author: 'Ioana P.' },
      ],
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'items', label: 'Recenzii', type: 'list', item: [{ key: 'quote', label: 'Text', type: 'textarea' }, { key: 'author', label: 'Autor', type: 'text' }], newItem: { quote: 'Recenzie nouă', author: 'Nume' } },
    ],
    render(d, v) {
      if (v === 'single') {
        const r = d.items[0] || { quote: '', author: '' };
        return `<section class="b-sec b-statement"><div class="b-wrap b-narrow">${t('p', 'items.0.quote', r.quote, 'b-quote b-quote--marks')}${t('p', 'items.0.author', r.author, 'b-eyebrow')}</div></section>`;
      }
      const cards = d.items.map((r, i) => `<blockquote class="b-review" data-list="items" data-i="${i}">${t('p', `items.${i}.quote`, r.quote)}${t('cite', `items.${i}.author`, r.author)}</blockquote>`).join('');
      return `<section class="b-sec"><div class="b-wrap">${t('h2', 'title', d.title, 'b-h2')}<div class="b-grid b-grid--3">${cards}</div></div></section>`;
    },
  },

  hours: {
    label: 'Program și adresă', category: 'Contact',
    variants: { columns: 'Două coloane', photo: 'Cu poză' },
    defaults: () => ({
      title: 'Ne găsești aici',
      address: 'Strada Nordului 12, București',
      phone: '07xx xxx xxx',
      hours: [{ day: 'Marți – Vineri', time: '18:00 – 23:00' }, { day: 'Sâmbătă – Duminică', time: '13:00 – 23:30' }, { day: 'Luni', time: 'închis' }],
      image: IMG + 'cn-r2.jpg',
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'address', label: 'Adresă', type: 'text' },
      { key: 'phone', label: 'Telefon', type: 'text' },
      { key: 'hours', label: 'Program', type: 'list', item: [{ key: 'day', label: 'Zile', type: 'text' }, { key: 'time', label: 'Ore', type: 'text' }], newItem: { day: 'Zi', time: '00:00 – 00:00' } },
      { key: 'image', label: 'Poză', type: 'image' },
    ],
    render(d, v) {
      const rows = d.hours.map((h, i) => `<div class="b-hours__row" data-list="hours" data-i="${i}">${t('span', `hours.${i}.day`, h.day)}${t('span', `hours.${i}.time`, h.time)}</div>`).join('');
      const info = `<div>${t('h2', 'title', d.title, 'b-h2')}${t('p', 'address', d.address, 'b-body')}${t('p', 'phone', d.phone, 'b-body b-strong')}</div><div class="b-hours">${rows}</div>`;
      if (v === 'photo') {
        return `<section class="b-sec"><div class="b-wrap b-cols">${img('image', d.image, '', 'b-media')}<div class="b-stack">${info}</div></div></section>`;
      }
      return `<section class="b-sec"><div class="b-wrap b-cols">${info}</div></section>`;
    },
  },

  cta: {
    label: 'Bandă cu buton', category: 'Contact',
    variants: { band: 'Bandă', boxed: 'Card centrat' },
    defaults: () => ({ title: 'Rezervă o masă pentru diseară', text: 'Îți confirmăm pe WhatsApp în câteva minute.', cta: 'Scrie-ne pe WhatsApp' }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'text', label: 'Text', type: 'text' },
      { key: 'cta', label: 'Buton', type: 'text' },
    ],
    render(d, v) {
      const inner = `<div>${t('h2', 'title', d.title, 'b-h2')}${t('p', 'text', d.text, 'b-body')}</div>${btn('cta', d.cta)}`;
      if (v === 'boxed') return `<section class="b-sec"><div class="b-wrap"><div class="b-box">${inner}</div></div></section>`;
      return `<section class="b-sec b-band"><div class="b-wrap b-band__row">${inner}</div></section>`;
    },
  },

  faq: {
    label: 'Întrebări frecvente', category: 'Încredere',
    variants: { list: 'Listă' },
    defaults: () => ({
      title: 'Întrebări frecvente',
      items: [
        { q: 'Aveți meniu vegetarian?', a: 'Da, în fiecare lună avem cel puțin trei preparate vegetariene.' },
        { q: 'Pot veni cu copii?', a: 'Sigur. Avem scaune înalte și porții mai mici la cerere.' },
        { q: 'Organizați evenimente private?', a: 'Da, sala mică are 20 de locuri. Scrie-ne pentru detalii.' },
      ],
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'items', label: 'Întrebări', type: 'list', item: [{ key: 'q', label: 'Întrebare', type: 'text' }, { key: 'a', label: 'Răspuns', type: 'textarea' }], newItem: { q: 'Întrebare nouă?', a: 'Răspuns.' } },
    ],
    render(d) {
      const rows = d.items.map((it, i) => `<details class="b-faq__item" data-list="items" data-i="${i}" open>${t('summary', `items.${i}.q`, it.q)}${t('p', `items.${i}.a`, it.a, 'b-muted')}</details>`).join('');
      return `<section class="b-sec"><div class="b-wrap b-narrow">${t('h2', 'title', d.title, 'b-h2')}<div class="b-faq">${rows}</div></div></section>`;
    },
  },

  footer: {
    label: 'Subsol', category: 'Subsol', locked: true,
    variants: { simple: 'Simplu' },
    defaults: () => ({ brand: 'Casa Nord', text: 'Strada Nordului 12, București · 07xx xxx xxx' }),
    fields: [{ key: 'brand', label: 'Nume', type: 'text' }, { key: 'text', label: 'Text', type: 'text' }],
    render(d) {
      return `<footer class="b-foot"><div class="b-wrap b-foot__row">${t('span', 'brand', d.brand, 'b-nav__brand')}${t('span', 'text', d.text, 'b-muted')}</div><p class="b-attr">Build by hidook.tech powered by hidook.agency</p></footer>`;
    },
  },
};

/** Theme presets the right panel offers. */
const THEMES = {
  palettes: {
    seara: { label: 'Seară', bg: '#0f0d0b', fg: '#f6f1ea', paper: '#f3eee8', ink: '#1a1410', accent: '#c4a574' },
    hartie: { label: 'Hârtie', bg: '#f3eee8', fg: '#1a1410', paper: '#ffffff', ink: '#1a1410', accent: '#8a5a2b' },
    verde: { label: 'Verde', bg: '#16241c', fg: '#f2ebdd', paper: '#f2ebdd', ink: '#16241c', accent: '#e0a33a' },
    alb: { label: 'Alb', bg: '#ffffff', fg: '#141414', paper: '#f4f4f2', ink: '#141414', accent: '#c2410c' },
  },
  fonts: {
    clasic: { label: 'Clasic', display: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif", text: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    modern: { label: 'Modern', display: "'Avenir Next', 'Futura', 'Helvetica Neue', Arial, sans-serif", text: "'Avenir Next', 'Helvetica Neue', Arial, sans-serif" },
    editorial: { label: 'Editorial', display: "Didot, 'Bodoni 72', 'Times New Roman', serif", text: "Georgia, 'Times New Roman', serif" },
  },
};

function newId() { return 'b' + Math.random().toString(36).slice(2, 9); }

function makeBlock(type, variant) {
  const def = BLOCKS[type];
  return { id: newId(), type, variant: variant || Object.keys(def.variants)[0], bg: 'auto', data: def.defaults() };
}

function defaultPage() {
  return {
    theme: { palette: 'seara', fonts: 'clasic', radius: 10 },
    blocks: [
      makeBlock('nav'), makeBlock('hero', 'split'), makeBlock('about', 'side'), makeBlock('menu', 'list'),
      makeBlock('gallery', 'grid'), makeBlock('reviews', 'cards'), makeBlock('hours', 'columns'), makeBlock('cta', 'band'), makeBlock('footer'),
    ],
  };
}

/** Theme + block CSS, shared by the editor canvas and the exported page. */
function themeCss(theme) {
  const p = THEMES.palettes[theme.palette] || THEMES.palettes.seara;
  const f = THEMES.fonts[theme.fonts] || THEMES.fonts.clasic;
  return `:root{--bg:${p.bg};--fg:${p.fg};--paper:${p.paper};--ink:${p.ink};--accent:${p.accent};--fd:${f.display};--ft:${f.text};--r:${theme.radius}px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--ft);line-height:1.55}
img{display:block;max-width:100%}
a{color:inherit}
.blk{--sbg:var(--bg);--sfg:var(--fg);background:var(--sbg);color:var(--sfg)}
.blk[data-bg="light"]{--sbg:var(--paper);--sfg:var(--ink)}
.blk[data-bg="dark"]{--sbg:var(--ink);--sfg:var(--paper)}
.blk[data-bg="accent"]{--sbg:var(--accent);--sfg:var(--ink)}
.b-wrap{max-width:1120px;margin:0 auto;padding:0 28px}
.b-narrow{max-width:760px}
.b-sec{padding:88px 0}
.b-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:56px;align-items:center}
.b-stack{display:flex;flex-direction:column;gap:28px}
.b-display{font-family:var(--fd);font-weight:400;font-size:clamp(40px,5.4vw,72px);line-height:1.02;letter-spacing:-.01em;margin:14px 0 18px}
.b-h2{font-family:var(--fd);font-weight:400;font-size:clamp(30px,3.4vw,46px);line-height:1.08;margin-bottom:18px}
.b-eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.blk[data-bg="accent"] .b-eyebrow{color:var(--sfg)}
.b-lede{font-size:19px;opacity:.82;max-width:44ch}
.b-body{font-size:17px;opacity:.86;max-width:60ch;margin-bottom:10px}
.b-strong{font-weight:700;opacity:1}
.b-muted{opacity:.68;font-size:15px}
.b-quote{font-family:var(--fd);font-size:clamp(26px,3vw,40px);line-height:1.25;margin:16px 0}
.b-quote--marks::before{content:'„'}.b-quote--marks::after{content:'”'}
.b-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.b-btn{display:inline-flex;align-items:center;min-height:48px;padding:0 24px;border-radius:var(--r);background:var(--accent);color:var(--ink);text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em}
.blk[data-bg="accent"] .b-btn{background:var(--ink);color:var(--paper)}
.b-btn--ghost{background:transparent;color:inherit;box-shadow:inset 0 0 0 1px currentColor}
.b-media{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.b-nav{padding:18px 0;border-bottom:1px solid color-mix(in srgb,var(--sfg) 14%,transparent)}
.b-nav .b-wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.b-nav__brand{font-family:var(--fd);font-size:24px}
.b-nav__links{display:flex;gap:26px;font-size:15px}
.b-nav__links a{text-decoration:none;opacity:.8}
.b-nav--centered .b-wrap{display:grid;grid-template-columns:1fr auto 1fr}
.b-nav--centered .b-nav__end{justify-self:end}
@media(max-width:720px){.b-nav__links{display:none}.b-nav--centered .b-wrap{grid-template-columns:auto 1fr}}
.b-hero{padding:72px 0 88px}
.b-hero--split .b-media{aspect-ratio:4/5;max-height:620px}
.b-hero--centered{text-align:center;padding:120px 0}
.b-hero--centered .b-lede{margin:0 auto}
.b-hero--centered .b-quote--marks::before{content:'„'}.b-quote--marks::after{content:'”'}
.b-actions{justify-content:center}
.b-hero--full{position:relative;min-height:640px;display:flex;align-items:flex-end;padding:0 0 72px;color:#fff}
.b-hero__bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.b-hero__shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.65))}
.b-hero--full .b-hero__copy{position:relative}
.b-statement{text-align:center}
.b-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px 24px;margin-bottom:28px}
.b-menu{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:22px 64px}
.b-menu__line{display:flex;align-items:baseline;gap:10px;font-size:19px}
.b-menu__name{font-family:var(--fd)}
.b-menu__dots{flex:1;border-bottom:1px dotted color-mix(in srgb,var(--sfg) 40%,transparent);transform:translateY(-4px)}
.b-price{font-weight:700;white-space:nowrap}
.b-grid{display:grid;gap:24px}
.b-grid--3{grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.b-grid--4{grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.b-card{display:flex;flex-direction:column;gap:8px}
.b-card__img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}
.b-card__row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-top:6px}
.b-card h3{font-family:var(--fd);font-weight:400;font-size:21px}
.b-gal{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
.b-gal img{width:100%;height:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}
.b-gal--mosaic{grid-auto-rows:180px}
.b-gal--mosaic img{aspect-ratio:auto}
.b-gal--mosaic .b-gal__item:nth-child(6n+1){grid-column:span 2;grid-row:span 2}
@media(max-width:720px){.b-gal{grid-template-columns:repeat(2,minmax(0,1fr))}}
.b-review{border-top:1px solid color-mix(in srgb,var(--sfg) 22%,transparent);padding-top:18px;display:flex;flex-direction:column;gap:12px;font-size:17px}
.b-review cite{font-style:normal;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.b-hours{display:flex;flex-direction:column}
.b-hours__row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid color-mix(in srgb,var(--sfg) 16%,transparent)}
.b-band{padding:64px 0}
.b-band__row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px}
.b-band .b-h2{margin-bottom:6px}
.b-box{background:color-mix(in srgb,var(--sfg) 6%,transparent);border-radius:calc(var(--r) * 2);padding:56px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:20px}
.b-faq{display:flex;flex-direction:column}
.b-faq__item{border-top:1px solid color-mix(in srgb,var(--sfg) 18%,transparent);padding:18px 0}
.b-faq__item summary{font-size:18px;font-weight:600;cursor:pointer}
.b-faq__item p{margin-top:8px}
.b-foot{padding:40px 0 24px;border-top:1px solid color-mix(in srgb,var(--sfg) 14%,transparent)}
.b-foot__row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:baseline}
.b-attr{text-align:center;font-size:12px;opacity:.55;margin-top:28px}`;
}

function renderBlock(b) {
  const def = BLOCKS[b.type];
  return `<div class="blk" data-id="${b.id}" data-bg="${b.bg}">${def.render(b.data, b.variant)}</div>`;
}

/** Standalone page (preview / export): no editor attributes needed at runtime. */
function renderPage(page, baseHref) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">${baseHref ? `<base href="${esc(baseHref)}">` : ''}<meta name="viewport" content="width=device-width,initial-scale=1"><title>Previzualizare</title><style>${themeCss(page.theme)}</style></head><body>${page.blocks.map(renderBlock).join('')}</body></html>`;
}

window.SB = { BLOCKS, THEMES, makeBlock, defaultPage, themeCss, renderBlock, renderPage, esc };
})();
