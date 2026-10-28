'use strict';
/**
 * builder/blocks/blocks.js — block library and renderer for the block editor.
 *
 * Runs in the browser (window.SB) and in Node (require), so the editor canvas
 * and the published site render from the same code.
 *
 * A page is { theme, blocks: [{ id, type, variant, bg, data }] }.
 * Each block type declares its variants, default data, the fields the
 * settings panel edits, and render(data, variant) → HTML.
 *
 * Editable text carries data-f="<path into data>", replaceable images carry
 * data-img="<path>", list items carry data-list="<list path>" data-i="<index>".
 * The editor reads those attributes; the published page ignores them.
 */

(function (root) {
const IS_NODE = typeof module !== 'undefined' && module.exports;
const IMG = '@tpl/product-menu/images/';

/** Starter packs: window.SB_PACKS in the browser, packs*.js in Node. */
let nodePacks = null;
function packs() {
  if (!IS_NODE) return root.SB_PACKS || {};
  if (!nodePacks) {
    nodePacks = require('./packs.js');
    require('./packs-more.js')(nodePacks);
  }
  return nodePacks;
}

/**
 * Pack photos are stored as "@tpl/<template>/images/<file>" and resolved
 * against the asset base of wherever the page is rendered.
 */
let assetBase = '';
function asset(src) {
  const v = String(src == null ? '' : src);
  if (v.startsWith('@tpl/')) return assetBase + v.slice(5);
  // Only uploads and the site's own files: no third-party images on a customer's site.
  return /^data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(v) || /^images\/[\w.-]+$/.test(v) ? v : '';
}

function safeHref(href) {
  const v = String(href == null ? '' : href).trim();
  return /^(https?:|mailto:|tel:|#)/i.test(v) || /^[\w.-]+\.html(#[\w-]*)?$/.test(v) ? v : '#';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Keep only inline formatting a customer can add: bold, italic, links, line breaks. */
function rich(value) {
  const src = String(value == null ? '' : value);
  if (!/[<&]/.test(src)) return esc(src);
  const text = (x) => x.replace(/&(?!(?:amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
  const open = [];
  let out = '';
  let last = 0;
  const re = /<(\/?)([a-z0-9]+)([^>]*)>/gi;
  let m;
  while ((m = re.exec(src))) {
    out += text(src.slice(last, m.index).replace(/</g, '&lt;'));
    last = re.lastIndex;
    const close = m[1] === '/';
    let tag = m[2].toLowerCase();
    if (tag === 'b') tag = 'strong';
    if (tag === 'i') tag = 'em';
    if (tag === 'br') { if (!close) out += '<br>'; continue; }
    if (tag !== 'strong' && tag !== 'em' && tag !== 'a') continue;
    if (close) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
    } else if (tag === 'a') {
      const h = m[3].match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
      const href = h ? (h[2] != null ? h[2] : h[3]).replace(/&amp;/g, '&') : '#';
      out += `<a href="${esc(safeHref(href))}">`;
      open.push('a');
    } else {
      out += `<${tag}>`;
      open.push(tag);
    }
  }
  out += text(src.slice(last).replace(/</g, '&lt;'));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Editable inline text (may hold bold, italic and links). */
function t(tag, path, value, cls) {
  return `<${tag}${cls ? ` class="${cls}"` : ''} data-f="${path}" data-rich>${rich(value)}</${tag}>`;
}

/** Replaceable image. */
function img(path, src, alt, cls) {
  return `<img${cls ? ` class="${cls}"` : ''} data-img="${path}" src="${esc(asset(src))}" alt="${esc(alt || '')}">`;
}

function btn(path, label, cls) {
  return `<a href="#" class="b-btn${cls ? ' ' + cls : ''}" data-f="${path}">${esc(label)}</a>`;
}

/* ---------- online booking: services and the weekly schedule the calendar books against ---------- */

const WEEKDAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
const DURATIONS = [15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240];
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function durLabel(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return `${h === 1 ? '1 oră' : `${h} ore`}${r ? ` ${r} min` : ''}`;
}

function weekDays(on, from, to) {
  return WEEKDAYS.map((_, i) => ({ on: on(i), from, to }));
}

/** The schedule as seven { on, from, to } days, Monday first; anything malformed counts as closed. */
function bookingWeek(d) {
  const w = Array.isArray(d && d.week) ? d.week : [];
  return WEEKDAYS.map((_, i) => {
    const x = w[i] && typeof w[i] === 'object' ? w[i] : {};
    const from = HM_RE.test(x.from) ? x.from : '09:00';
    const to = HM_RE.test(x.to) ? x.to : '17:00';
    return { on: x.on === true && to > from, from, to };
  });
}

/** Services with a name, each with a duration from DURATIONS (minutes). */
function bookingServices(d) {
  return (Array.isArray(d && d.services) ? d.services : [])
    .map((s) => ({ name: String((s && s.name) || '').replace(/<[^>]*>/g, '').trim().slice(0, 120), min: DURATIONS.includes(Number(s && s.min)) ? Number(s.min) : 30 }))
    .filter((s) => s.name);
}

/** "Luni – Vineri 09:00 – 17:00 · Sâmbătă 10:00 – 14:00": consecutive days with the same hours collapse. */
function weekSummary(week) {
  const out = [];
  let i = 0;
  while (i < 7) {
    if (!week[i].on) { i += 1; continue; }
    let j = i;
    while (j + 1 < 7 && week[j + 1].on && week[j + 1].from === week[i].from && week[j + 1].to === week[i].to) j += 1;
    out.push(`${WEEKDAYS[i]}${j > i ? ` – ${WEEKDAYS[j]}` : ''} ${week[i].from} – ${week[i].to}`);
    i = j + 1;
  }
  return out;
}

const BLOCKS = {
  nav: {
    label: 'Antet', category: 'Antet', shared: true,
    variants: { bar: 'Bară simplă', centered: 'Logo centrat' },
    defaults: () => ({ brand: 'Casa Nord', cta: 'Rezervă o masă' }),
    fields: [
      { key: 'brand', label: 'Numele afacerii', type: 'text' },
      { key: 'cta', label: 'Buton', type: 'text' },
    ],
    render(d, v, ctx) {
      const pages = (ctx && ctx.pages) || [];
      const links = pages.map((p) => `<a href="${esc(ctx.pageHref ? ctx.pageHref(p) : '#' + p.slug)}" data-page="${esc(p.id)}"${ctx.current === p.id ? ' class="is-cur"' : ''}>${esc(p.name)}</a>`).join('');
      const brand = `<span class="b-nav__brand" data-f="brand">${esc(d.brand)}</span>`;
      if (v === 'centered') {
        return `<nav class="b-nav b-nav--centered"><div class="b-wrap"><div class="b-nav__links">${links}</div>${brand}<div class="b-nav__end">${btn('cta', d.cta)}</div></div></nav>`;
      }
      return `<nav class="b-nav"><div class="b-wrap">${brand}<div class="b-nav__links">${links}</div>${btn('cta', d.cta)}</div></nav>`;
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
    label: 'Listă cu prețuri', category: 'Prețuri',
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

  text: {
    label: 'Text', category: 'Conținut',
    variants: { left: 'Aliniat stânga', center: 'Centrat', split: 'Titlu lângă text' },
    defaults: () => ({ eyebrow: 'Din bucătărie', title: 'Gătim cu ce aduce sezonul', text: 'Lucrăm cu cinci producători din jurul Bucureștiului. Când se termină roșiile, se termină și preparatul. De aceea meniul se schimbă în fiecare lună.' }),
    fields: [
      { key: 'eyebrow', label: 'Text mic deasupra', type: 'text' },
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'text', label: 'Text', type: 'textarea' },
    ],
    render(d, v) {
      if (v === 'split') {
        return `<section class="b-sec"><div class="b-wrap b-cols b-cols--top"><div>${t('p', 'eyebrow', d.eyebrow, 'b-eyebrow')}${t('h2', 'title', d.title, 'b-h2')}</div>${t('p', 'text', d.text, 'b-body')}</div></section>`;
      }
      return `<section class="b-sec${v === 'center' ? ' b-center' : ''}"><div class="b-wrap b-narrow">${t('p', 'eyebrow', d.eyebrow, 'b-eyebrow')}${t('h2', 'title', d.title, 'b-h2')}${t('p', 'text', d.text, 'b-body')}</div></section>`;
    },
  },

  columns: {
    label: 'Coloane', category: 'Conținut',
    variants: { images: 'Cu poze', numbers: 'Cu numere', plain: 'Doar text' },
    defaults: () => ({
      title: 'De ce vin oaspeții la noi',
      intro: 'Trei lucruri pe care nu le schimbăm, oricât s-ar schimba meniul.',
      cols: [
        { image: IMG + 'cn-r3.jpg', title: 'Producători locali', text: 'Legume, brânzeturi și carne din jurul orașului.', cta: 'Află mai mult' },
        { image: IMG + 'cn-d2.jpg', title: 'Meniu de sezon', text: 'Se schimbă o dată pe lună, după ce e la piață.', cta: 'Vezi meniul' },
        { image: IMG + 'cn-ig4.jpg', title: 'Vinuri românești', text: 'Peste 40 de etichete, la pahar și la sticlă.', cta: 'Lista de vinuri' },
      ],
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'intro', label: 'Introducere', type: 'text' },
      { key: 'cols', label: 'Coloane (2–4)', type: 'list', max: 4, min: 2, item: [
        { key: 'image', label: 'Poză', type: 'image' }, { key: 'title', label: 'Titlu', type: 'text' },
        { key: 'text', label: 'Text', type: 'textarea' }, { key: 'cta', label: 'Link', type: 'text' },
      ], newItem: { image: IMG + 'cn-ig5.jpg', title: 'Coloană nouă', text: 'Scrie aici un text scurt.', cta: 'Află mai mult' } },
    ],
    render(d, v) {
      const n = Math.min(Math.max(d.cols.length, 2), 4);
      const cols = d.cols.map((c, i) => {
        const top = v === 'images' ? img(`cols.${i}.image`, c.image, c.title, 'b-col__img')
          : v === 'numbers' ? `<span class="b-col__num">${String(i + 1).padStart(2, '0')}</span>` : '';
        return `<div class="b-col" data-list="cols" data-i="${i}">${top}${t('h3', `cols.${i}.title`, c.title, 'b-h3')}${t('p', `cols.${i}.text`, c.text, 'b-muted')}<a href="#" class="b-link" data-f="cols.${i}.cta">${esc(c.cta)}</a></div>`;
      }).join('');
      return `<section class="b-sec"><div class="b-wrap"><div class="b-head b-head--stack">${t('h2', 'title', d.title, 'b-h2')}${t('p', 'intro', d.intro, 'b-body')}</div><div class="b-cols-n" style="--n:${n}">${cols}</div></div></section>`;
    },
  },

  team: {
    label: 'Echipa', category: 'Încredere',
    variants: { grid: 'Poze mari', round: 'Poze rotunde' },
    defaults: () => ({
      title: 'Oamenii din spatele farfuriei',
      people: [
        { image: IMG + 'cn-r1.jpg', name: 'Andrei Ionescu', role: 'Bucătar-șef' },
        { image: IMG + 'cn-r2.jpg', name: 'Maria Pop', role: 'Somelier' },
        { image: IMG + 'cn-r3.jpg', name: 'Radu Stan', role: 'Pastry chef' },
      ],
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'people', label: 'Persoane', type: 'list', item: [{ key: 'image', label: 'Poză', type: 'image' }, { key: 'name', label: 'Nume', type: 'text' }, { key: 'role', label: 'Rol', type: 'text' }], newItem: { image: IMG + 'cn-ig2.jpg', name: 'Nume Prenume', role: 'Rol' } },
    ],
    render(d, v) {
      const ppl = d.people.map((p, i) => `<figure class="b-person b-person--${v}" data-list="people" data-i="${i}">${img(`people.${i}.image`, p.image, p.name)}${t('figcaption', `people.${i}.name`, p.name, 'b-h3')}${t('p', `people.${i}.role`, p.role, 'b-muted')}</figure>`).join('');
      return `<section class="b-sec"><div class="b-wrap">${t('h2', 'title', d.title, 'b-h2')}<div class="b-grid b-grid--4">${ppl}</div></div></section>`;
    },
  },

  form: {
    label: 'Formular de contact', category: 'Contact',
    variants: { simple: 'Simplu', info: 'Cu date de contact' },
    defaults: () => ({
      title: 'Scrie-ne', text: 'Îți răspundem în aceeași zi.',
      lName: 'Numele tău', lPhone: 'Telefon', lMsg: 'Mesaj', cta: 'Trimite',
      address: 'Strada Nordului 12, București', phone: '07xx xxx xxx', email: 'salut@casanord.ro',
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' }, { key: 'text', label: 'Text', type: 'text' },
      { key: 'lName', label: 'Eticheta „nume”', type: 'text' }, { key: 'lPhone', label: 'Eticheta „telefon”', type: 'text' },
      { key: 'lMsg', label: 'Eticheta „mesaj”', type: 'text' }, { key: 'cta', label: 'Buton', type: 'text' },
      { key: 'address', label: 'Adresă', type: 'text' }, { key: 'phone', label: 'Telefon', type: 'text' }, { key: 'email', label: 'Email', type: 'text' },
    ],
    render(d, v, ctx) {
      // Published: posts to /api/site-messages (filled in at publish), falls back to email.
      const to = String(d.email || '').trim();
      const form = ctx.published
        ? `<form class="b-form" data-site-messages-api="" data-site-slug="" data-mail-to="${/^[^\s@"<>]+@[^\s@"<>]+$/.test(to) ? esc(to) : ''}" novalidate>`
          + `<label class="b-form__lbl">${rich(d.lName)}<input class="b-input" name="name" autocomplete="name" required></label>`
          + `<label class="b-form__lbl">${rich(d.lPhone)}<input class="b-input" name="contact" autocomplete="tel" required></label>`
          + `<label class="b-form__lbl">${rich(d.lMsg)}<textarea class="b-input" name="message" rows="4" required></textarea></label>`
          + '<input class="b-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
          + `<button type="submit" class="b-btn">${esc(d.cta)}</button><p class="b-form__status" data-cf-status role="status" hidden></p></form>`
        : `<form class="b-form" onsubmit="return false">${t('span', 'lName', d.lName, 'b-form__lbl')}<input class="b-input" aria-label="${esc(d.lName)}">${t('span', 'lPhone', d.lPhone, 'b-form__lbl')}<input class="b-input" aria-label="${esc(d.lPhone)}">${t('span', 'lMsg', d.lMsg, 'b-form__lbl')}<textarea class="b-input" rows="4" aria-label="${esc(d.lMsg)}"></textarea>${btn('cta', d.cta)}</form>`;
      const head = `${t('h2', 'title', d.title, 'b-h2')}${t('p', 'text', d.text, 'b-body')}`;
      if (v === 'info') {
        return `<section class="b-sec"><div class="b-wrap b-cols b-cols--top"><div>${head}<div class="b-info">${t('p', 'address', d.address)}${t('p', 'phone', d.phone, 'b-strong')}${t('p', 'email', d.email)}</div></div>${form}</div></section>`;
      }
      return `<section class="b-sec"><div class="b-wrap b-narrow">${head}${form}</div></section>`;
    },
  },

  booking: {
    label: 'Programări online', category: 'Contact',
    variants: { split: 'Text lângă calendar', center: 'Centrat' },
    defaults: () => ({
      title: 'Programează-te online',
      text: 'Alegi serviciul, ziua și ora care îți convin. Primești confirmarea pe email.',
      services: [{ name: 'Consultație', min: '30' }],
      week: weekDays((i) => i < 5, '09:00', '17:00'),
      phone: '07xx xxx xxx',
    }),
    fields: [
      { key: 'title', label: 'Titlu', type: 'text' },
      { key: 'text', label: 'Text', type: 'textarea' },
      { key: 'services', label: 'Servicii', type: 'list', min: 1, max: 20, item: [
        { key: 'name', label: 'Serviciu', type: 'text' },
        { key: 'min', label: 'Durată', type: 'select', options: DURATIONS.map((m) => [String(m), durLabel(m)]) },
      ], newItem: { name: 'Serviciu nou', min: '30' } },
      { key: 'week', label: 'Zile și ore', type: 'week' },
      { key: 'phone', label: 'Telefon pentru cine nu rezervă online', type: 'text' },
    ],
    render(d, v, ctx) {
      const services = bookingServices(d);
      const week = bookingWeek(d);
      const phone = String(d.phone || '').replace(/<[^>]*>/g, '').trim();
      const tel = phone.replace(/\D/g, '').length >= 6 ? phone.replace(/[^\d+]/g, '') : '';
      const call = !phone ? ''
        : !ctx.published ? `<p class="b-muted b-book__call">Preferi la telefon? Sună la ${t('span', 'phone', d.phone)}</p>`
          : tel ? `<p class="b-muted b-book__call">Preferi la telefon? Sună la <a href="tel:${esc(tel)}">${esc(phone)}</a></p>` : '';
      const head = `<div>${t('h2', 'title', d.title, 'b-h2')}${t('p', 'text', d.text, 'b-body')}${call}</div>`;
      const wrap = (inner) => `<section class="b-sec b-book"><div class="b-wrap ${v === 'center' ? 'b-narrow b-book--center' : 'b-cols b-cols--top'}">${head}${inner}</div></section>`;
      const list = `<ul class="b-book__svcs">${services.map((s) => `<li><span>${esc(s.name)}</span><span class="b-muted">${durLabel(s.min)}</span></li>`).join('')}</ul>`;
      const hours = weekSummary(week);
      if (ctx.published && ctx.booking) {
        const k = ctx.booking;
        const api = esc(k.apiBase || '');
        return wrap(`<div class="b-book__live"><link rel="stylesheet" href="${api}/calendar-native/widget/public-booking-widget.css">`
          + `<div data-hidook-cal-native data-customer-id="${esc(k.customerId)}" data-site-id="${esc(k.siteId)}" data-api-base="${api}" data-brand="${esc(k.brand || '')}"`
          + `${tel ? ` data-contact-phone="${esc(phone)}" data-contact-phone-tel="${esc(tel)}"` : ''} data-day-count="14"><p class="b-muted">Se încarcă programările…</p></div>`
          + `<noscript><p class="b-body">Programarea online are nevoie de JavaScript.${tel ? ` Sună la <a href="tel:${esc(tel)}">${esc(phone)}</a>.` : ''}</p></noscript>`
          + `<script src="${api}/calendar-native/widget/public-booking-widget.js" defer></script></div>`);
      }
      if (ctx.published) {
        // A downloaded copy has no booking server behind it: list the services and say how to book.
        const how = tel ? `<p class="b-body">Pentru programare sună la <a href="tel:${esc(tel)}">${esc(phone)}</a>.</p>` : '';
        return wrap(`<div class="b-book__card">${list}${hours.length ? `<p class="b-muted">${hours.map(esc).join('<br>')}</p>` : ''}${how}</div>`);
      }
      const raw = Array.isArray(d.services) ? d.services : [];
      const svcs = raw.map((s, i) => `<li data-list="services" data-i="${i}"${i === 0 ? ' class="is-on"' : ''}>${t('span', `services.${i}.name`, s && s.name)}<span class="b-muted">${durLabel(DURATIONS.includes(Number(s && s.min)) ? Number(s.min) : 30)}</span></li>`).join('');
      const open = week.findIndex((x) => x.on);
      const slots = open < 0 ? [] : (() => {
        const out = [];
        const [h0, m0] = week[open].from.split(':').map(Number);
        const end = week[open].to.split(':').map(Number);
        for (let m = h0 * 60 + m0; m + 30 <= end[0] * 60 + end[1] && out.length < 6; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
        return out;
      })();
      const days = WEEKDAYS.map((n, i) => `<span class="${week[i].on ? (i === open ? 'is-on' : '') : 'is-off'}">${n.slice(0, 2)}</span>`).join('');
      const note = hours.length
        ? 'Pe site, aici apare calendarul cu orele libere. Programările le primești pe email și le vezi în Site-urile mele → Programări.'
        : 'Alege în panoul din dreapta zilele în care primești programări.';
      return wrap(`<div class="b-book__card"><p class="b-book__step">1. Alege serviciul</p><ul class="b-book__svcs b-book__svcs--pick">${svcs}</ul>`
        + `<p class="b-book__step">2. Alege ziua și ora</p><div class="b-book__days">${days}</div><div class="b-book__slots">${slots.map((s) => `<span>${s}</span>`).join('')}</div>`
        + `${hours.length ? `<p class="b-muted">${hours.map(esc).join('<br>')}</p>` : ''}<p class="b-note">${note}</p></div>`);
    },
  },

  instagram: {
    label: 'Instagram', category: 'Conținut',
    variants: { grid: 'Șase poze', strip: 'Bandă' },
    defaults: () => ({ title: 'Din bucătărie, pe Instagram', handle: '@casanord', cta: 'Urmărește-ne' }),
    fields: [{ key: 'title', label: 'Titlu', type: 'text' }, { key: 'handle', label: 'Cont', type: 'text' }, { key: 'cta', label: 'Buton', type: 'text' }],
    render(d, v, ctx) {
      // Public site: only a connected Instafidget feed, never sample photos or an empty section.
      const embed = ctx.igEmbed || '';
      if (ctx.published && !embed) return '';
      const handle = String(d.handle || '').replace(/^@/, '').trim();
      const follow = handle && ctx.published ? `<a href="https://instagram.com/${esc(encodeURIComponent(handle))}" class="b-btn b-btn--ghost" target="_blank" rel="noopener" data-f="cta">${esc(d.cta)}</a>` : btn('cta', d.cta, 'b-btn--ghost');
      const head = `<div class="b-head"><div>${t('h2', 'title', d.title, 'b-h2')}${t('p', 'handle', d.handle, 'b-eyebrow')}</div>${follow}</div>`;
      if (ctx.published) return `<section class="b-sec"><div class="b-wrap">${head}<iframe class="b-ig-embed" src="${esc(embed)}" title="Instagram" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div></section>`;
      const list = Array.isArray(d.images) ? d.images : Array.from({ length: 6 }, (_, i) => `${IMG}cn-ig${i + 1}.jpg`);
      const pics = list.map((src) => `<img src="${esc(asset(src))}" alt="">`).join('');
      const note = embed
        ? 'Instagram e conectat: pe site apar postările tale, prin Instafidget.'
        : 'Poze de exemplu. Conectează Instagram din panoul din dreapta; până atunci blocul nu apare pe site.';
      return `<section class="b-sec"><div class="b-wrap">${head}<div class="b-ig b-ig--${v}">${pics}</div><p class="b-note">${note}</p></div></section>`;
    },
  },

  spacer: {
    label: 'Separator', category: 'Conținut',
    variants: { line: 'Linie', space: 'Doar spațiu' },
    defaults: () => ({}),
    fields: [],
    render(d, v) { return `<div class="b-spacer b-spacer--${v}"><div class="b-wrap"><hr></div></div>`; },
  },

  footer: {
    label: 'Subsol', category: 'Subsol', locked: true, shared: true,
    variants: { simple: 'Simplu' },
    defaults: () => ({ brand: 'Casa Nord', text: 'Strada Nordului 12, București · 07xx xxx xxx' }),
    fields: [{ key: 'brand', label: 'Nume', type: 'text' }, { key: 'text', label: 'Text', type: 'text' }],
    render(d, v, ctx) {
      const legal = ctx.published ? '<nav class="b-legal" aria-label="Pagini legale"><a href="privacy.html">Confidențialitate</a><a href="terms.html">Termeni</a><a href="cookies.html">Cookie-uri</a></nav>' : '';
      return `<footer class="b-foot"><div class="b-wrap b-foot__row">${t('span', 'brand', d.brand, 'b-nav__brand')}${t('span', 'text', d.text, 'b-muted')}</div>${legal}<p class="b-attr hb-built-by">Build by <a href="https://hidook.tech" target="_blank" rel="noopener noreferrer">hidook.tech</a> powered by <a href="https://hidook.agency" target="_blank" rel="noopener noreferrer">hidook.agency</a></p></footer>`;
    },
  },
};

/** Theme presets the right panel offers. */
const THEMES = {
  palettes: {
    seara: { label: 'Seară', bg: '#0f0d0b', fg: '#f6f1ea', paper: '#f3eee8', ink: '#1a1410', accent: '#c4a574' },
    hartie: { label: 'Hârtie', bg: '#f3eee8', fg: '#1a1410', paper: '#ffffff', ink: '#1a1410', accent: '#8a5a2b' },
    verde: { label: 'Verde', bg: '#16241c', fg: '#f2ebdd', paper: '#f2ebdd', ink: '#16241c', accent: '#e0a33a' },
    alb: { label: 'Alb', bg: '#ffffff', fg: '#141414', paper: '#f4f4f2', ink: '#141414', accent: '#c2410c', on: '#ffffff' },
    pudra: { label: 'Pudră', bg: '#f8eee9', fg: '#2b1d18', paper: '#ffffff', ink: '#2b1d18', accent: '#a4553d', on: '#ffffff' },
    santier: { label: 'Șantier', bg: '#ffffff', fg: '#111111', paper: '#f4f4f1', ink: '#111111', accent: '#ffd23f', on: '#111111' },
    birou: { label: 'Birou', bg: '#ffffff', fg: '#14213d', paper: '#f4f6fa', ink: '#14213d', accent: '#2a5bd7', on: '#ffffff' },
    ivoriu: { label: 'Ivoriu', bg: '#ffffff', fg: '#1c1a19', paper: '#f6f2ee', ink: '#1c1a19', accent: '#8c6d5a', on: '#ffffff' },
    beton: { label: 'Beton', bg: '#f2f2ef', fg: '#1d1f22', paper: '#ffffff', ink: '#1d1f22', accent: '#e2622e', on: '#ffffff' },
    vin: { label: 'Vin', bg: '#2a1418', fg: '#f5ece6', paper: '#f5ece6', ink: '#2a1418', accent: '#d9a46c', on: '#2a1418' },
    menta: { label: 'Mentă', bg: '#f3f8f6', fg: '#15302a', paper: '#ffffff', ink: '#15302a', accent: '#2f8f75', on: '#ffffff' },
    salvie: { label: 'Salvie', bg: '#f5f4ef', fg: '#22302a', paper: '#ffffff', ink: '#22302a', accent: '#3d6b4f', on: '#ffffff' },
    cerneala: { label: 'Cerneală', bg: '#0f1724', fg: '#e8edf5', paper: '#f4f6fa', ink: '#0f1724', accent: '#5b8def', on: '#ffffff' },
    zmeura: { label: 'Zmeură', bg: '#fbe4e8', fg: '#3b2420', paper: '#ffffff', ink: '#3b2420', accent: '#c2314f', on: '#ffffff' },
  },
  fonts: {
    clasic: { label: 'Clasic', display: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif", text: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    modern: { label: 'Modern', display: "'Avenir Next', 'Futura', 'Helvetica Neue', Arial, sans-serif", text: "'Avenir Next', 'Helvetica Neue', Arial, sans-serif" },
    solid: { label: 'Solid', display: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", text: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    editorial: { label: 'Editorial', display: "Didot, 'Bodoni 72', 'Times New Roman', serif", text: "Georgia, 'Times New Roman', serif" },
  },
};

function newId() { return 'b' + Math.random().toString(36).slice(2, 9); }

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function makeBlock(type, variant, packId) {
  const def = BLOCKS[type];
  const pack = packs()[packId];
  const blank = packs().gol;
  const data = pack && pack.content[type] ? clone(pack.content[type])
    : pack && pack.ownDefaults ? def.defaults()
    : pack && blank && blank.content[type] ? clone(blank.content[type])
    : def.defaults();
  if (pack && type === 'nav') Object.assign(data, pack.header);
  if (pack && type === 'footer') Object.assign(data, pack.footer);
  return { id: newId(), type, variant: variant || Object.keys(def.variants)[0], bg: 'auto', data };
}

function slugify(name) {
  return String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pagina';
}

function makePage(name, blocks, packId) {
  return { id: newId(), name, slug: slugify(name), blocks: (blocks || []).map(([type, v]) => makeBlock(type, v, packId)) };
}

function defaultSite(packId) {
  const id = packs()[packId] ? packId : 'restaurant';
  const pack = packs()[id];
  const pages = pack.pages.map((p) => makePage(p.name, p.blocks, id));
  return { v: 2, pack: id, theme: clone(pack.theme), header: makeBlock('nav', 'bar', id), footer: makeBlock('footer', 'simple', id), pages, current: pages[0].id };
}

/** Theme + block CSS, shared by the editor canvas and the exported page. */
function themeCss(theme) {
  const p = THEMES.palettes[theme.palette] || THEMES.palettes.seara;
  const f = THEMES.fonts[theme.fonts] || THEMES.fonts.clasic;
  return `:root{--bg:${p.bg};--fg:${p.fg};--paper:${p.paper};--ink:${p.ink};--accent:${p.accent};--on:${p.on || p.ink};--fd:${f.display};--ft:${f.text};--r:${theme.radius}px}
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
.b-btn{display:inline-flex;align-items:center;min-height:48px;padding:0 24px;border-radius:var(--r);background:var(--accent);color:var(--on);text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em}
.blk[data-bg="accent"] .b-btn{background:var(--ink);color:var(--paper)}
.b-btn--ghost{background:transparent;color:inherit;box-shadow:inset 0 0 0 1px currentColor}
.b-media{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.b-nav{padding:18px 0;border-bottom:1px solid color-mix(in srgb,var(--sfg) 14%,transparent)}
.b-nav .b-wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.b-nav__brand{font-family:var(--fd);font-size:24px}
.b-nav__links{display:flex;gap:26px;font-size:15px}
.b-nav__links a{text-decoration:none;opacity:.8}
.b-nav__links a.is-cur{opacity:1;box-shadow:inset 0 -2px 0 var(--accent)}
[data-rich] a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
[data-rich] strong{font-weight:700}
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
.b-attr{text-align:center;font-size:12px;opacity:.55;margin-top:28px}
.b-attr a{color:inherit}
.b-legal{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;font-size:13px;margin-top:24px;opacity:.75}
.b-legal a{color:inherit}
.b-center{text-align:center}
.b-center .b-body{margin-left:auto;margin-right:auto}
.b-cols--top{align-items:start}
.b-head--stack{flex-direction:column;align-items:flex-start}
.b-h3{font-family:var(--fd);font-weight:400;font-size:22px;line-height:1.2}
.b-cols-n{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:32px}
@media(max-width:800px){.b-cols-n{grid-template-columns:1fr}}
.b-col{display:flex;flex-direction:column;gap:10px}
.b-col__img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.b-col__num{font-family:var(--fd);font-size:44px;color:var(--accent);line-height:1}
.b-link{color:var(--accent);font-weight:700;text-decoration:none;font-size:15px}
.b-person{display:flex;flex-direction:column;gap:6px}
.b-person img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--r)}
.b-person--round{align-items:center;text-align:center}
.b-person--round img{width:160px;aspect-ratio:1;border-radius:50%}
.b-form{display:flex;flex-direction:column;gap:8px;margin-top:20px}
.b-form__lbl{font-size:14px;font-weight:600;margin-top:6px}
.b-input{font:inherit;color:inherit;background:color-mix(in srgb,var(--sfg) 6%,transparent);border:1px solid color-mix(in srgb,var(--sfg) 25%,transparent);border-radius:var(--r);padding:13px 14px}
.b-form .b-btn{align-self:flex-start;margin-top:14px}
label.b-form__lbl{display:flex;flex-direction:column;gap:6px}
button.b-btn{border:0;font:inherit;font-weight:700;cursor:pointer}
.b-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.b-form__status{font-size:15px;margin-top:8px}
.b-info{display:flex;flex-direction:column;gap:6px;margin-top:20px;font-size:17px}
.b-ig{display:grid;gap:8px;grid-template-columns:repeat(3,minmax(0,1fr))}
.b-ig--strip{grid-template-columns:repeat(6,minmax(0,1fr))}
.b-ig img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--r) / 2)}
@media(max-width:720px){.b-ig--strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
.b-note{font-size:13px;opacity:.55;margin-top:12px}
.b-ig-embed{display:block;width:100%;min-height:520px;border:0;border-radius:var(--r)}
.b-book--center{text-align:center}
.b-book--center .b-body{margin-left:auto;margin-right:auto}
.b-book--center .b-book__card,.b-book--center .b-book__live{margin-top:28px;text-align:left}
.b-book__call{margin-top:6px}
.b-book__card{background:var(--paper);color:var(--ink);border-radius:var(--r);padding:24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 0 color-mix(in srgb,var(--ink) 10%,transparent)}
.b-book__step{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--accent)}
.b-book__svcs{list-style:none;display:flex;flex-direction:column;gap:8px}
.b-book__svcs li{display:flex;justify-content:space-between;gap:16px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);border-radius:calc(var(--r) / 2 + 4px)}
.b-book__svcs--pick li.is-on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.b-book__days,.b-book__slots{display:flex;flex-wrap:wrap;gap:8px}
.b-book__days span,.b-book__slots span{min-width:44px;padding:9px 10px;text-align:center;border-radius:calc(var(--r) / 2 + 4px);border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);font-size:14px}
.b-book__days .is-on{background:var(--accent);border-color:var(--accent);color:var(--on)}
.b-book__days .is-off{opacity:.35;text-decoration:line-through}
.b-book .hnb{--hnb-accent:var(--accent);--hnb-accent-2:color-mix(in srgb,var(--accent) 55%,#000);--hnb-accent-soft:color-mix(in srgb,var(--accent) 14%,#fff);--hnb-ink:var(--ink);--hnb-sans:var(--ft);--hnb-serif:var(--fd)}
.blk .b-book .hnb__steps li.is-current,.blk .b-book .hnb__cal-day.is-selected,.blk .b-book .hnb__resource.is-selected,.blk .b-book .hnb__slot.is-selected,.blk .b-book .hnb__cta{color:var(--on)}
.blk .b-book .hnb__cta:hover{background:var(--accent);filter:brightness(.92)}
.b-book .hnb__eyebrow,.b-book .hnb__title,.b-book .hnb__sub{display:none}
@media(min-width:900px){.b-book .b-cols{grid-template-columns:minmax(0,1fr) minmax(0,1.7fr)}}
.b-spacer--line{padding:28px 0}
.b-spacer--space{padding:40px 0}
.b-spacer hr{border:0;border-top:1px solid color-mix(in srgb,var(--sfg) 20%,transparent)}
.b-spacer--space hr{visibility:hidden}
.blk[data-pad="compact"] .b-sec,.blk[data-pad="compact"] .b-hero:not(.b-hero--full){padding-top:44px;padding-bottom:44px}
.blk[data-pad="airy"] .b-sec,.blk[data-pad="airy"] .b-hero:not(.b-hero--full){padding-top:136px;padding-bottom:136px}
.blk[data-align="center"] .b-wrap{text-align:center}
.blk[data-align="center"] .b-actions,.blk[data-align="center"] .b-head{justify-content:center}
.blk[data-align="center"] .b-lede,.blk[data-align="center"] .b-body{margin-left:auto;margin-right:auto}
@media(max-width:720px){.blk[data-hidem]{display:none}}`;
}

/**
 * Per-element overrides set from the canvas text toolbar:
 * b.el[path] = { align, size (px), bold, italic, color: 'accent'|'muted', hidden, href }.
 * Rendered as one scoped <style> per block so the export needs no script.
 */
const SIZE_STEPS = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 88];

function elementCss(b) {
  const out = [];
  Object.entries(b.el || {}).forEach(([path, s]) => {
    const sel = `.blk[data-id="${b.id}"] [data-f="${path}"]`;
    const r = [];
    if (s.hidden) r.push('display:none');
    if (s.align) r.push(`text-align:${s.align}`);
    if (s.size) r.push(`font-size:clamp(${Math.round(s.size * 0.62)}px, ${(s.size / 14.4).toFixed(2)}vw, ${s.size}px)`);
    if (s.bold === true) r.push('font-weight:700');
    if (s.bold === false) r.push('font-weight:400');
    if (s.italic) r.push('font-style:italic');
    if (s.color === 'accent') r.push('color:var(--accent);opacity:1');
    if (s.color === 'muted') r.push('opacity:.6');
    if (r.length) out.push(`${sel}{${r.join(';')}}`);
  });
  return out.join('');
}

function applyLinks(html, b) {
  return html.replace(/<a href="#"([^>]*?)data-f="([^"]+)"/g, (m, attrs, path) => {
    const href = b.el && b.el[path] && b.el[path].href;
    return href ? `<a href="${esc(safeHref(href))}"${attrs}data-f="${path}"` : m;
  });
}

function renderBlock(b, ctx) {
  const def = BLOCKS[b.type];
  if (!def) return '';
  const inner = def.render(b.data || {}, b.variant, ctx || {});
  if (!inner) return '';
  const css = elementCss(b);
  const attrs = `data-id="${esc(b.id)}" data-bg="${esc(b.bg || 'auto')}" data-pad="${esc(b.pad || 'normal')}" data-align="${esc(b.align || 'auto')}"${b.hideMobile ? ' data-hidem' : ''}`;
  return `<div class="blk" ${attrs}>${css ? `<style>${css}</style>` : ''}${applyLinks(inner, b)}</div>`;
}

/** All blocks of one page in order: shared header, the page's own blocks, shared footer. */
function pageBlocks(site, pageId) {
  const page = site.pages.find((p) => p.id === pageId) || site.pages[0];
  return [site.header, ...page.blocks, site.footer];
}

function siteCtx(site, pageId, opts) {
  const o = opts || {};
  return { pages: site.pages.map((p) => ({ id: p.id, name: p.name, slug: p.slug })), current: pageId, published: !!o.published, pageHref: o.pageHref, igEmbed: feedUrl(site), booking: o.booking || null };
}

/** File name of a page on the published site: the first page is index.html. */
function pageFile(site, page) {
  return page.id === site.pages[0].id ? 'index.html' : `${page.slug}.html`;
}

const IMAGES = ['cn-hero', 'cn-r1', 'cn-r2', 'cn-r3', 'cn-d1', 'cn-d2', 'cn-d3', 'cn-ig1', 'cn-ig2', 'cn-ig3', 'cn-ig4', 'cn-ig5', 'cn-ig6',
  'tv-hero', 'tv-a1', 'tv-a2', 'tv-a3', 'tv-m1', 'tv-m2', 'tv-m3', 'tv-ig1', 'tv-ig2', 'tv-ig3', 'tv-ig4', 'tv-ig5', 'tv-ig6'].map((n) => IMG + n + '.jpg');

const FORM_JS = "document.addEventListener('submit',function(e){var f=e.target;if(!f.matches||!f.matches('form[data-site-messages-api]'))return;e.preventDefault();var g=function(n){return((f.elements[n]||{}).value||'').trim()},name=g('name'),contact=g('contact'),message=g('message'),st=f.querySelector('[data-cf-status]'),b=f.querySelector('button[type=submit]');var say=function(m){st.textContent=m;st.hidden=!m};if(!name||!contact||!message){say('Completează numele, un contact și mesajul.');return}var mail=function(){var to=f.getAttribute('data-mail-to');if(!to){say('Nu am putut trimite mesajul acum. Sună-ne sau scrie-ne direct.');return}say('Nu am putut trimite direct — îți deschidem clientul de email.');location.href='mailto:'+to+'?subject='+encodeURIComponent('Mesaj nou de pe site — '+name)+'&body='+encodeURIComponent('De la: '+name+'\\nContact: '+contact+'\\n\\n'+message)};var api=f.getAttribute('data-site-messages-api')||'';if(!api){mail();return}b.disabled=true;fetch(api+'/api/site-messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:f.getAttribute('data-site-slug')||'',name:name,contact:contact,message:message,website:g('website')})}).then(function(r){if(!r.ok)throw 0;say('Mulțumim! Mesajul tău a fost trimis — revenim cât mai curând.');f.reset()}).catch(mail).finally(function(){b.disabled=false})})";

/**
 * Standalone page.
 * opts: string base href (editor preview), or { published, assetBase, head, body, canonical, booking }
 * for the files of a published site. booking ({ customerId, siteId, apiBase, brand }) turns
 * the booking block into the live calendar; without it the block lists services and a phone.
 */
function renderPage(site, pageId, opts) {
  const o = typeof opts === 'string' ? { baseHref: opts } : (opts || {});
  const prevBase = assetBase;
  if (o.assetBase != null) assetBase = o.assetBase;
  try {
    if (o.published) site = withoutDemoEmails(site);
    const ctx = siteCtx(site, pageId, o.published ? { published: true, pageHref: (p) => pageFile(site, site.pages.find((x) => x.id === p.id)), booking: o.booking } : null);
    const body = pageBlocks(site, pageId).map((b) => renderBlock(b, ctx)).join('');
    const page = site.pages.find((p) => p.id === pageId) || site.pages[0];
    const brand = (site.header && site.header.data && site.header.data.brand) || '';
    const title = page.id === site.pages[0].id ? brand || page.name : `${page.name} · ${brand}`;
    const desc = site.seo && site.seo.description ? `<meta name="description" content="${esc(site.seo.description)}">` : '';
    const canon = o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}"><meta property="og:url" content="${esc(o.canonical)}">` : '';
    const mail = o.published && /data-site-messages-api=/.test(body) ? `<script>${FORM_JS}</script>` : '';
    return `<!doctype html><html lang="ro"><head><meta charset="utf-8">${o.baseHref ? `<base href="${esc(o.baseHref)}">` : ''}<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${desc}${canon}<meta property="og:title" content="${esc(title)}"><style>${themeCss(site.theme)}</style>${o.head || ''}</head><body>${body}${o.body || ''}${mail}</body></html>`;
  } finally {
    assetBase = prevBase;
  }
}

/* ---------- validation: everything a browser sends is cleaned before it is stored or published ---------- */

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PATH_RE = /^[A-Za-z0-9_.-]{1,60}$/;
const LIMITS = { pages: 20, blocks: 60, text: 4000, json: 12 * 1024 * 1024 };

function cleanValue(v, depth) {
  if (depth > 6) return undefined;
  if (typeof v === 'string') return v.startsWith('data:image/') ? v : v.slice(0, LIMITS.text);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 60).map((x) => cleanValue(x, depth + 1)).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).slice(0, 60).forEach((k) => {
      if (!PATH_RE.test(k)) return;
      const c = cleanValue(v[k], depth + 1);
      if (c !== undefined) out[k] = c;
    });
    return out;
  }
  return undefined;
}

function cleanEl(el) {
  const out = {};
  Object.keys(el && typeof el === 'object' ? el : {}).slice(0, 80).forEach((path) => {
    const s = el[path];
    if (!PATH_RE.test(path) || !s || typeof s !== 'object') return;
    const r = {};
    if (s.hidden) r.hidden = true;
    if (['left', 'center', 'right'].includes(s.align)) r.align = s.align;
    if (SIZE_STEPS.includes(Number(s.size))) r.size = Number(s.size);
    if (s.bold === true || s.bold === false) r.bold = s.bold;
    if (s.italic) r.italic = true;
    if (s.color === 'accent' || s.color === 'muted') r.color = s.color;
    if (typeof s.href === 'string' && s.href) r.href = safeHref(s.href.slice(0, 500));
    out[path] = r;
  });
  return out;
}

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const goodId = (v) => typeof v === 'string' && ID_RE.test(v);

function cleanBlock(b, wantType, ids) {
  if (!b || typeof b !== 'object') return null;
  const def = own(BLOCKS, b.type) ? BLOCKS[b.type] : null;
  if (!def || (wantType && b.type !== wantType) || (!wantType && def.shared)) return null;
  const data = cleanValue(b.data || {}, 0) || {};
  // Lists the renderer walks must be lists, whatever the browser sent.
  const base = def.defaults();
  Object.keys(base).forEach((k) => { if (Array.isArray(base[k]) && !Array.isArray(data[k])) data[k] = base[k]; });
  let id = goodId(b.id) && !ids.has(b.id) ? b.id : newId();
  while (ids.has(id)) id = newId();
  ids.add(id);
  return {
    id,
    type: b.type,
    variant: own(def.variants, b.variant) ? b.variant : Object.keys(def.variants)[0],
    bg: ['auto', 'light', 'dark', 'accent'].includes(b.bg) ? b.bg : 'auto',
    pad: ['compact', 'normal', 'airy'].includes(b.pad) ? b.pad : undefined,
    align: ['auto', 'center'].includes(b.align) ? b.align : undefined,
    // Shared header/footer always show (the footer carries the hidook attribution).
    hideMobile: b.hideMobile && !def.shared ? true : undefined,
    el: cleanEl(b.el),
    data,
  };
}

/**
 * Returns a clean copy of a block site, or throws an Error with a Romanian
 * message the API can hand back as-is.
 */
function normalizeSite(input) {
  const fail = (m) => { const e = new Error(m); e.code = 'BLOCKS_INVALID'; throw e; };
  if (!input || typeof input !== 'object' || input.v !== 2) fail('Site-ul nu are formatul editorului pe blocuri.');
  if (!Array.isArray(input.pages) || !input.pages.length) fail('Site-ul trebuie să aibă cel puțin o pagină.');
  if (input.pages.length > LIMITS.pages) fail(`Un site poate avea cel mult ${LIMITS.pages} de pagini.`);
  const theme = input.theme || {};
  const pack = own(packs(), input.pack) ? input.pack : 'gol';
  const ids = new Set();
  const header = cleanBlock(input.header, 'nav', ids) || makeBlock('nav', 'bar', pack);
  const footer = cleanBlock(input.footer, 'footer', ids) || makeBlock('footer', 'simple', pack);
  ids.add(header.id);
  ids.add(footer.id);
  const pageIds = new Set();
  const slugs = new Set();
  const pages = input.pages.map((p, i) => {
    const name = String((p && p.name) || `Pagina ${i + 1}`).slice(0, 60);
    let slug = slugify((p && p.slug) || name).slice(0, 40);
    if (slug === 'index' || ['privacy', 'terms', 'cookies'].includes(slug)) slug += '-1';
    while (slugs.has(slug)) slug += '-2';
    slugs.add(slug);
    const blocks = (Array.isArray(p && p.blocks) ? p.blocks : []).slice(0, LIMITS.blocks).map((b) => cleanBlock(b, null, ids)).filter(Boolean);
    let id = p && goodId(p.id) && !pageIds.has(p.id) ? p.id : newId();
    while (pageIds.has(id)) id = newId();
    pageIds.add(id);
    return { id, name, slug, blocks };
  });
  const out = {
    v: 2,
    pack,
    theme: {
      palette: own(THEMES.palettes, theme.palette) ? theme.palette : 'alb',
      fonts: own(THEMES.fonts, theme.fonts) ? theme.fonts : 'modern',
      radius: Math.max(0, Math.min(24, Math.round(Number(theme.radius) || 0))),
    },
    header, footer, pages,
    current: pages.some((p) => p.id === input.current) ? input.current : pages[0].id,
  };
  const feed = feedUrl(input);
  if (feed) out.instagram = { embedUrl: feed };
  if (input.seo && typeof input.seo === 'object') {
    out.seo = { description: String(input.seo.description || '').slice(0, 300) };
  }
  if (JSON.stringify(out).length > LIMITS.json) fail('Site-ul e prea mare. Folosește poze mai mici.');
  return out;
}

/** Name of the business, for slugs, page titles and the legal pages. */
function siteBrand(site) {
  const h = site && site.header && site.header.data && site.header.data.brand;
  const f = site && site.footer && site.footer.data && site.footer.data.brand;
  return String(h || f || '').replace(/<[^>]*>/g, '').trim();
}

/** Every "@tpl/…" photo the site uses, so publishing can copy exactly those files. */
function templateAssets(site) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (v.startsWith('@tpl/') && /^@tpl\/[a-z0-9-]+\/images\/[A-Za-z0-9_.-]+$/.test(v)) found.add(v.slice(5)); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(site);
  return [...found];
}

/** The connected Instafidget feed, if any (never instagram.com/facebook.com: they refuse framing). */
function feedUrl(site) {
  const raw = site && site.instagram && typeof site.instagram.embedUrl === 'string' ? site.instagram.embedUrl.trim() : '';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(raw) || raw.length > 500) return '';
  const host = raw.replace(/^https:\/\//i, '').split(/[/?#:]/)[0].toLowerCase().replace(/^www\./, '');
  return /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com)$/.test(host) ? '' : raw;
}

/* ---------- starter content the customer has not replaced yet ---------- */

const PHONE_DEMO = /07xx\s*xxx\s*xxx/i;

/** E-mail addresses and business names that come from a starter pack. */
function starterValues() {
  const emails = new Set();
  const brands = new Set();
  const handles = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (/^[^\s@]+@[^\s@]+$/.test(v)) emails.add(v.toLowerCase()); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  Object.values(packs()).forEach((p) => {
    walk(p.content);
    if (p.header && p.header.brand) brands.add(p.header.brand);
    if (p.content && p.content.instagram && p.content.instagram.handle) handles.add(p.content.instagram.handle);
  });
  Object.values(BLOCKS).forEach((d) => walk(d.defaults()));
  handles.add(BLOCKS.instagram.defaults().handle);
  return { emails, brands, handles };
}

function isDemoEmail(v, known) {
  const e = String(v || '').trim().toLowerCase();
  return !!e && (known.emails.has(e) || /@exemplu\./.test(e));
}

/** Published copy of a site with every starter e-mail blanked (never publish an invented address). */
function withoutDemoEmails(site) {
  const known = starterValues();
  const copy = JSON.parse(JSON.stringify(site));
  const fix = (b) => { if (b && b.data && isDemoEmail(b.data.email, known)) b.data.email = ''; };
  copy.pages.forEach((p) => p.blocks.forEach(fix));
  return copy;
}

/**
 * What still looks like starter content, for the check before publishing.
 * Returns [{ key, label, page }] — each a short Romanian sentence.
 */
function demoLeftovers(site) {
  const known = starterValues();
  const out = [];
  const brand = siteBrand(site);
  if (!brand || known.brands.has(brand) || brand === 'Numele afacerii') {
    out.push({ key: 'brand', label: `Numele afacerii e încă cel de exemplu („${brand || 'gol'}”).` });
  }
  const seen = new Set();
  const note = (key, label, page) => { if (!seen.has(key + page)) { seen.add(key + page); out.push({ key, label, page }); } };
  const scan = (b, pageName) => {
    const walk = (v, k) => {
      if (typeof v === 'string') {
        if (PHONE_DEMO.test(v)) note('phone', 'Telefon de exemplu (07xx xxx xxx).', pageName);
        if (k === 'email' && isDemoEmail(v, known)) note('email', 'E-mail de exemplu: pe site nu apare până nu pui adresa ta.', pageName);
        if (k === 'handle' && b.type === 'instagram' && known.handles.has(v)) note('handle', `Contul de Instagram e cel de exemplu (${v}).`, pageName);
        if (v.startsWith('data:image/svg+xml')) note('photo', 'Poze de completat.', pageName);
        return;
      }
      if (v && typeof v === 'object') Object.keys(v).forEach((kk) => walk(v[kk], kk));
    };
    walk(b.data, '');
  };
  scan(site.header, 'Antet');
  scan(site.footer, 'Subsol');
  site.pages.forEach((p) => p.blocks.forEach((b) => scan(b, p.name)));
  const ig = site.pages.some((p) => p.blocks.some((b) => b.type === 'instagram'));
  if (ig && !feedUrl(site)) out.push({ key: 'instagram', label: 'Blocul Instagram nu e conectat, deci nu apare pe site.' });
  const pack = packs()[site.pack];
  const starter = (pack && pack.content.booking) || BLOCKS.booking.defaults();
  const plan = (d) => JSON.stringify([bookingServices(d), bookingWeek(d)]);
  site.pages.forEach((p) => p.blocks.forEach((b) => {
    if (b.type === 'booking' && plan(b.data) === plan(starter)) {
      note('booking', 'Serviciile și orele din „Programări online” sunt cele de exemplu. Clienții se vor putea programa doar în orele de acolo.', p.name);
    }
  }));
  return out;
}

/**
 * First-run identity: swap the starter business name, phone and town for the
 * customer's own everywhere they appear in the site's text.
 */
function applyIdentity(site, who) {
  const pack = packs()[site.pack] || {};
  const name = String((who && who.name) || '').trim().slice(0, 80);
  const phone = String((who && who.phone) || '').trim().slice(0, 40);
  const town = String((who && who.town) || '').trim().slice(0, 60);
  const oldBrand = (pack.header && pack.header.brand) || '';
  const footer = (pack.footer && pack.footer.text) || '';
  const addr = footer.split(' · ')[0] || '';
  const oldTown = addr.includes(',') ? addr.slice(addr.lastIndexOf(',') + 1).trim() : '';
  const swap = (v) => {
    let x = v;
    if (name && oldBrand) x = x.split(oldBrand).join(name);
    if (phone) x = x.replace(new RegExp(PHONE_DEMO.source, 'gi'), phone);
    if (town && oldTown) x = x.split(oldTown).join(town);
    return x;
  };
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    Object.keys(o).forEach((k) => {
      if (typeof o[k] === 'string' && !o[k].startsWith('data:') && !o[k].startsWith('@tpl/')) o[k] = swap(o[k]);
      else walk(o[k]);
    });
  };
  [site.header, site.footer].forEach((b) => walk(b.data));
  site.pages.forEach((p) => p.blocks.forEach((b) => walk(b.data)));
  if (name) { site.header.data.brand = name; site.footer.data.brand = name; }
  return site;
}

function setAssetBase(base) { assetBase = String(base || ''); }

/** Every booking block of the site, in page order. */
function bookingBlocks(site) {
  return (site.pages || []).flatMap((p) => (p.blocks || []).filter((b) => b && b.type === 'booking'));
}

const SB = { BLOCKS, THEMES, IMAGES, SIZE_STEPS, makeBlock, makePage, defaultSite, slugify, themeCss, renderBlock, pageBlocks, siteCtx, elementCss, renderPage, rich, esc, newId, asset, setAssetBase, safeHref, pageFile, normalizeSite, siteBrand, templateAssets, packs, feedUrl, demoLeftovers, applyIdentity, bookingBlocks, bookingWeek, bookingServices };
if (IS_NODE) module.exports = SB;
else root.SB = SB;
})(typeof window !== 'undefined' ? window : globalThis);
