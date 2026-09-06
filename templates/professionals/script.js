// Professionals vertical — appointment request + calm interactions.
// Zero dependencies. No Google/Calendly. Local request status only.
// Defensive: every init returns early when its roots are missing.

document.addEventListener('DOMContentLoaded', () => {
    initReveal();
    initSmoothScroll();
    initMobileNav();
    initAppointment();
    initWhatsAppQR();
    initLocalBusinessJsonLd();
});

function initMobileNav() {
    const toggle = document.getElementById('pr-nav-toggle');
    const menu = document.getElementById('pr-nav-mobile');
    if (!toggle || !menu) return;

    function focusables() {
        return Array.from(menu.querySelectorAll('a[href]'));
    }

    function openMenu() {
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        const first = focusables()[0];
        if (first) first.focus();
    }

    function closeMenu(returnFocus) {
        if (menu.hidden) return;
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (returnFocus !== false) toggle.focus();
    }

    toggle.addEventListener('click', () => {
        if (toggle.getAttribute('aria-expanded') === 'true') closeMenu();
        else openMenu();
    });

    menu.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', () => closeMenu(false));
    });

    document.addEventListener('keydown', (e) => {
        if (menu.hidden) return;
        if (e.key === 'Escape') {
            closeMenu();
            return;
        }
        if (e.key === 'Tab') {
            const items = focusables();
            if (!items.length) return;
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (menu.hidden) return;
        if (menu.contains(e.target) || toggle.contains(e.target)) return;
        closeMenu(false);
    });

    try {
        const mq = window.matchMedia('(min-width: 820px)');
        const onChange = (e) => { if (e.matches) closeMenu(false); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    } catch (_) { /* matchMedia unavailable — ignore */ }
}

/* ─────────────────────────────────────────────────────────────
   JSON-LD LocalBusiness — built client-side from the already-rendered
   page (name/phone/email/address/hours/socials), so every publish path
   (web builder, Telegram, self-hosted export) gets the same structured
   data with no server-side changes. If a server-populated JSON-LD block
   already exists (e.g. the Telegram flow's seo.jsonLd), that one wins —
   this is strictly a fallback for the gap where nothing was generated.
   ───────────────────────────────────────────────────────────── */
function initLocalBusinessJsonLd() {
    try {
        if (document.querySelector('script[type="application/ld+json"]')) return;

        const text = (sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : '';
        };
        const attr = (sel, name) => {
            const el = document.querySelector(sel);
            return el ? (el.getAttribute(name) || '').trim() : '';
        };

        const name = text('[data-ld="name"]');
        if (!name) return; // nothing reliable to publish

        const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name };

        const description = attr('meta[name="description"]', 'content');
        if (description) data.description = description;

        const canonical = attr('link[rel="canonical"]', 'href');
        data.url = canonical || (typeof location !== 'undefined' ? location.href : '');
        if (!data.url) delete data.url;

        const phoneHref = attr('[data-ld="phone"]', 'href');
        if (phoneHref) data.telephone = phoneHref.replace(/^tel:/i, '');

        const emailHref = attr('[data-ld="email"]', 'href');
        if (emailHref) data.email = emailHref.replace(/^mailto:/i, '');

        const addressEl = document.querySelector('[data-ld="address"]');
        if (addressEl) {
            const lines = addressEl.innerHTML
                .split(/<br\s*\/?>/i)
                .map((chunk) => chunk.replace(/<[^>]*>/g, '').trim())
                .filter(Boolean);
            if (lines.length) data.address = { '@type': 'PostalAddress', streetAddress: lines.join(', ') };
        }

        const sameAs = [];
        const igHref = attr('[data-ld="instagram"]', 'href');
        if (igHref) sameAs.push(igHref);
        const fbHref = attr('[data-ld="facebook"]', 'href');
        if (fbHref) sameAs.push(fbHref);
        if (sameAs.length) data.sameAs = sameAs;

        const heroBg = document.querySelector('.pr-hero__bg');
        if (heroBg) {
            const bgImage = getComputedStyle(heroBg).backgroundImage || '';
            const m = /url\((['"]?)(.*?)\1\)/.exec(bgImage);
            if (m && m[2] && !/^data:/i.test(m[2])) {
                try { data.image = new URL(m[2], location.href).href; } catch (_) { data.image = m[2]; }
            }
        }

        const DAY = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };
        const weeklyRoot = document.getElementById('pr-weekly');
        if (weeklyRoot) {
            const spec = Array.from(weeklyRoot.querySelectorAll('[data-w]'))
                .map((el) => {
                    const day = DAY[String(el.getAttribute('data-w')).trim()];
                    const opens = (el.getAttribute('data-s') || '').trim();
                    const closes = (el.getAttribute('data-e') || '').trim();
                    if (!day || !opens || !closes) return null;
                    return { '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + day, opens, closes };
                })
                .filter(Boolean);
            if (spec.length) data.openingHoursSpecification = spec;
        }

        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(data);
        document.head.appendChild(script);
    } catch (_) {
        /* never let SEO best-effort break the page */
    }
}

function initReveal() {
    const nodes = document.querySelectorAll('.pr-reveal');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) {
        nodes.forEach((n) => n.classList.add('is-in'));
        return;
    }
    const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) {
                e.target.classList.add('is-in');
                io.unobserve(e.target);
            }
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    nodes.forEach((n) => io.observe(n));
}

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
        a.addEventListener('click', (e) => {
            const id = a.getAttribute('href');
            if (!id || id === '#') return;
            const el = document.querySelector(id);
            if (!el) return;
            e.preventDefault();
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function parseHm(hm) {
    const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

function ymdInTz(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(date);
        const get = (t) => (parts.find((p) => p.type === t) || {}).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    } catch (_) {
        return date.toISOString().slice(0, 10);
    }
}

function weekdayInTz(date, timeZone) {
    // 1=luni … 7=duminică
    try {
        const w = new Intl.DateTimeFormat('ro-RO', { timeZone, weekday: 'long' }).format(date);
        const map = { luni: 1, marți: 2, miercuri: 3, joi: 4, vineri: 5, sâmbătă: 6, duminică: 7 };
        return map[w] || 1;
    } catch (_) {
        const d = date.getUTCDay();
        return d === 0 ? 7 : d;
    }
}

function zonedLocalToUtcISO(ymd, hm, timeZone) {
    // Interpret ymd+hm as wall time in timeZone → ISO UTC.
    const [Y, M, D] = ymd.split('-').map(Number);
    const [h, mi] = hm.split(':').map(Number);
    // Binary search UTC ms that formats to the desired wall clock in tz.
    let lo = Date.UTC(Y, M - 1, D - 1, 0, 0, 0) - 36e5 * 36;
    let hi = Date.UTC(Y, M - 1, D + 1, 0, 0, 0) + 36e5 * 36;
    const want = `${ymd}T${pad2(h)}:${pad2(mi)}`;
    for (let i = 0; i < 48; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const d = new Date(mid);
        let wall;
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
            }).formatToParts(d);
            const g = (t) => (parts.find((p) => p.type === t) || {}).value;
            wall = `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
        } catch (_) {
            wall = d.toISOString().slice(0, 16);
        }
        if (wall === want) return new Date(mid).toISOString();
        if (wall < want) lo = mid + 1;
        else hi = mid - 1;
    }
    // Fallback: treat as local browser time
    return new Date(Y, M - 1, D, h, mi, 0).toISOString();
}

function loadWeekly() {
    const root = document.getElementById('pr-weekly');
    if (!root) return [];
    return Array.from(root.querySelectorAll('[data-w]')).map((el) => ({
        w: el.getAttribute('data-w'),
        s: el.getAttribute('data-s'),
        e: el.getAttribute('data-e'),
    })).filter((x) => x.w && x.s && x.e);
}

function detectLiveSlug() {
    const m = String(location.pathname || '').match(/\/live\/([a-z0-9-]{3,40})(?:\/|$)/i);
    return m ? m[1].toLowerCase() : '';
}

function initAppointment() {
    const root = document.querySelector('[data-pr-appt]');
    const form = document.getElementById('pr-appt-form');
    if (!root || !form) return;

    const tz = root.getAttribute('data-tz') || 'Europe/Bucharest';
    const interval = Math.max(15, parseInt(root.getAttribute('data-interval') || '60', 10) || 60);
    const defaultDur = Math.max(15, parseInt(root.getAttribute('data-duration') || '45', 10) || 45);
    const lead = Math.max(0, parseInt(root.getAttribute('data-lead') || '120', 10) || 120);
    const confirmText = root.getAttribute('data-confirm') || 'Cererea ta a fost înregistrată.';
    const emptyText = root.getAttribute('data-empty') || 'Nu există intervale disponibile în această perioadă.';
    const submitLabel = root.getAttribute('data-submit') || 'Trimite cererea';

    const dateSel = document.getElementById('pr-appt-date');
    const slotSel = document.getElementById('pr-appt-slot');
    const hint = document.getElementById('pr-appt-hint');
    const submitBtn = document.getElementById('pr-appt-submit');
    const done = document.getElementById('pr-appt-done');
    const doneBody = document.getElementById('pr-appt-done-body');
    const doneConfirm = document.getElementById('pr-appt-done-confirm');
    const fail = document.getElementById('pr-appt-fail');
    const weekly = loadWeekly();

    const typeInputs = () => Array.from(form.querySelectorAll('input[name="appt-type"]'));

    function selectedType() {
        const checked = form.querySelector('input[name="appt-type"]:checked');
        if (checked) {
            return {
                id: checked.value,
                label: checked.getAttribute('data-label') || checked.value,
                durationMin: parseInt(checked.getAttribute('data-duration') || String(defaultDur), 10) || defaultDur,
                mode: checked.getAttribute('data-mode') || '',
            };
        }
        const first = typeInputs()[0];
        if (!first) return { id: 'default', label: 'Consultație', durationMin: defaultDur, mode: '' };
        first.checked = true;
        return {
            id: first.value,
            label: first.getAttribute('data-label') || first.value,
            durationMin: parseInt(first.getAttribute('data-duration') || String(defaultDur), 10) || defaultDur,
            mode: first.getAttribute('data-mode') || '',
        };
    }

    function slotsForDay(ymd, durationMin) {
        const probe = new Date(ymd + 'T12:00:00Z');
        // Find a UTC instant on that calendar day in tz for weekday
        let weekday = 1;
        try {
            // Walk hours to land on ymd in tz
            for (let h = 0; h < 24; h++) {
                const d = new Date(Date.UTC(
                    Number(ymd.slice(0, 4)),
                    Number(ymd.slice(5, 7)) - 1,
                    Number(ymd.slice(8, 10)),
                    h, 0, 0
                ));
                if (ymdInTz(d, tz) === ymd) {
                    weekday = weekdayInTz(d, tz);
                    break;
                }
            }
        } catch (_) {
            weekday = probe.getUTCDay() === 0 ? 7 : probe.getUTCDay();
        }

        const ranges = weekly.filter((r) => String(r.w) === String(weekday));
        const out = [];
        const now = Date.now() + lead * 60 * 1000;

        ranges.forEach((r) => {
            const startM = parseHm(r.s);
            const endM = parseHm(r.e);
            if (startM == null || endM == null || endM <= startM) return;
            for (let t = startM; t + durationMin <= endM; t += interval) {
                const hh = pad2(Math.floor(t / 60));
                const mm = pad2(t % 60);
                const hm = `${hh}:${mm}`;
                const iso = zonedLocalToUtcISO(ymd, hm, tz);
                const ms = Date.parse(iso);
                if (!Number.isFinite(ms) || ms < now) continue;
                out.push({ hm, iso, label: hm });
            }
        });
        return out;
    }

    function fillDates() {
        if (!dateSel) return;
        dateSel.innerHTML = '';
        const type = selectedType();
        const days = [];
        const base = new Date();
        for (let i = 0; i < 21; i++) {
            const d = new Date(base.getTime() + i * 86400000);
            const ymd = ymdInTz(d, tz);
            const slots = slotsForDay(ymd, type.durationMin);
            if (slots.length) days.push({ ymd, count: slots.length });
        }
        if (!days.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '—';
            dateSel.appendChild(opt);
            if (hint) {
                hint.hidden = false;
                hint.textContent = emptyText;
            }
            if (slotSel) {
                slotSel.innerHTML = '';
                const o = document.createElement('option');
                o.value = '';
                o.textContent = '—';
                slotSel.appendChild(o);
            }
            return;
        }
        if (hint) hint.hidden = true;
        days.forEach((day, idx) => {
            const opt = document.createElement('option');
            opt.value = day.ymd;
            try {
                const label = new Intl.DateTimeFormat('ro-RO', {
                    timeZone: tz,
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                }).format(new Date(day.ymd + 'T12:00:00Z'));
                opt.textContent = label;
            } catch (_) {
                opt.textContent = day.ymd;
            }
            if (idx === 0) opt.selected = true;
            dateSel.appendChild(opt);
        });
        fillSlots();
    }

    function fillSlots() {
        if (!slotSel || !dateSel) return;
        slotSel.innerHTML = '';
        const type = selectedType();
        const ymd = dateSel.value;
        const slots = ymd ? slotsForDay(ymd, type.durationMin) : [];
        if (!slots.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = '—';
            slotSel.appendChild(o);
            if (hint) {
                hint.hidden = false;
                hint.textContent = emptyText;
            }
            return;
        }
        if (hint) hint.hidden = true;
        slots.forEach((s, idx) => {
            const o = document.createElement('option');
            o.value = s.iso;
            o.textContent = `${s.label} · ${type.durationMin} min`;
            o.dataset.hm = s.hm;
            if (idx === 0) o.selected = true;
            slotSel.appendChild(o);
        });
    }

    typeInputs().forEach((inp) => inp.addEventListener('change', fillDates));
    if (dateSel) dateSel.addEventListener('change', fillSlots);
    fillDates();

    // Click path (not native form submit): builder preview iframe sandbox is
    // allow-scripts only — form submit is blocked without allow-forms.
    async function sendRequest(e) {
        if (e) e.preventDefault();
        if (submitBtn && submitBtn.disabled) return;
        if (fail) fail.hidden = true;

        const type = selectedType();
        const name = (form.querySelector('#pr-name') || {}).value || '';
        const email = (form.querySelector('#pr-email') || {}).value || '';
        const phone = (form.querySelector('#pr-phone') || {}).value || '';
        const note = (form.querySelector('#pr-note') || {}).value || '';
        const startISO = (slotSel && slotSel.value) || '';
        const ymd = (dateSel && dateSel.value) || '';

        if (!name.trim() || !email.trim() || !startISO) {
            if (hint) {
                hint.hidden = false;
                hint.textContent = 'Completează numele, emailul și un interval orar.';
            }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            const span = submitBtn.querySelector('span');
            if (span) span.textContent = 'Se trimite…';
            else submitBtn.textContent = 'Se trimite…';
        }

        const payload = {
            slug: detectLiveSlug(),
            appointmentTypeId: type.id,
            appointmentTypeLabel: type.label,
            requestedStartISO: startISO,
            timezone: tz,
            durationMin: type.durationMin,
            mode: type.mode,
            visitorName: name.trim(),
            visitorEmail: email.trim(),
            visitorPhone: phone.trim() || undefined,
            note: note.trim() || undefined,
        };

        let result = null;
        let localOnly = false;

        // A real page (http/https origin) always tries the live backend first —
        // whether it's /live/<slug>/ on Hidook or a self-hosted export with no
        // backend at all. Only a sandboxed builder-preview document (opaque
        // "null" origin from srcdoc) skips straight to the local-preview branch.
        // This is what lets a self-hosted export be told apart from a real
        // submission: if the fetch fails (404, network error, non-ok response —
        // exactly what a static host with no /api/appointments route returns),
        // we show an honest failure state instead of a fake success.
        if (/^https?:/i.test(location.origin || '')) {
            try {
                const res = await fetch(location.origin + '/api/appointments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify(payload),
                });
                const body = await res.json().catch(() => ({}));
                if (res.ok && body && body.ok) {
                    result = body;
                } else {
                    throw new Error((body && body.error) || 'Cererea nu a putut fi înregistrată.');
                }
            } catch (err) {
                if (hint) {
                    hint.hidden = false;
                    hint.textContent = 'Cererea NU a fost trimisă. Formularul rămâne completat — încearcă din nou sau folosește telefonul ori WhatsApp de mai jos.';
                }
                if (fail) fail.hidden = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    const span = submitBtn.querySelector('span');
                    if (span) span.textContent = submitLabel;
                    else submitBtn.textContent = submitLabel;
                }
                return;
            }
        } else {
            // Builder preview / offline — customer-visible local request state
            localOnly = true;
            const id = 'local-' + Date.now().toString(36);
            result = {
                ok: true,
                id,
                status: 'requested',
                requestedStartISO: startISO,
                timezone: tz,
                appointmentTypeLabel: type.label,
            };
            try {
                const key = 'pr-appt-requests';
                const prev = JSON.parse(sessionStorage.getItem(key) || '[]');
                prev.push({ ...payload, id, status: 'requested', createdAt: new Date().toISOString() });
                sessionStorage.setItem(key, JSON.stringify(prev.slice(-40)));
            } catch (_) { /* ignore — sandbox may lack storage */ }
        }

        form.hidden = true;
        if (done) {
            done.hidden = false;
            let when = startISO;
            try {
                when = new Intl.DateTimeFormat('ro-RO', {
                    timeZone: tz,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(new Date(startISO));
            } catch (_) {
                when = `${ymd} ${startISO}`;
            }
            if (doneBody) {
                doneBody.textContent =
                    `${type.label} · ${when}` +
                    (localOnly ? ' · stare de previzualizare locală' : '');
            }
            if (doneConfirm) {
                doneConfirm.textContent = confirmText;
            }
        }
    }

    if (submitBtn) submitBtn.addEventListener('click', sendRequest);
    form.addEventListener('submit', sendRequest);
}

/* ─────────────────────────────────────────────────────────────
   Minimal QR Code generator — pure vanilla JS, no CDN.
   Based on the ISO 18004 QR Code standard, numeric/alphanumeric/byte modes.
   Supports URLs up to ~250 chars at error-correction level M.
   ───────────────────────────────────────────────────────────── */
// The hand-rolled QR encoder that used to live here was removed. It produced
// symbols with corrupted finder patterns -- the audit's finding #1, and the
// only critical it verified independently, by failing to decode the output
// with a real scanner. The fix vendored Kazuhiko Arase's MIT qrcode.js and
// overrode window.generateQRSVG with it just below, but left the broken
// encoder in place, where it shipped to every published site and would have
// silently taken over again if the override were ever reordered or dropped.

// QR Code Generator for JavaScript — Kazuhiko Arase, MIT License (qrcode.js).
// Published/exported sites load that local vendored asset before this script.
window.generateQRSVG = function (text, size) {
    var qr = qrcode(0, 'M');
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    qr.addData(String(text || ''), 'Byte');
    qr.make();
    var target = Number(size) || 240;
    var cell = target / (qr.getModuleCount() + 8);
    return qr.createSvgTag({ cellSize: cell, margin: cell * 4, scalable: true, alt: 'Cod QR WhatsApp' });
};

function initWhatsAppQR() {
    var modal = document.getElementById('wa-qr');
    var img = document.getElementById('wa-qr-img');
    var links = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

    // Desktop viewport / UA only — do not treat Mac trackpads as phones (maxTouchPoints).
    var ua = navigator.userAgent || '';
    var isMobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    var narrow = false;
    try { narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches; } catch (_) {}
    if (isMobileUa && narrow) return;

    var openBtn = document.getElementById('wa-qr-open');

    function paintQr(waUrl) {
        var svg = (typeof window.generateQRSVG === 'function') ? window.generateQRSVG(waUrl, 240) : '';
        if (svg) {
            img.removeAttribute('src');
            img.setAttribute('alt', 'Cod QR WhatsApp');
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            img.style.display = 'block';
            var old = modal.querySelector('.wa-qr__svg');
            if (old) old.remove();
        }
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        try { modal.removeAttribute('hidden'); } catch (_) {}
        document.body.style.overflow = 'hidden';
    }

    function closeQr() {
        modal.hidden = true;
        try { modal.setAttribute('hidden', ''); } catch (_) {}
        document.body.style.overflow = '';
    }

    links.forEach(function (a) {
        a.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            paintQr(a.href);
        });
    });

    modal.querySelectorAll('[data-wa-close]').forEach(function (el) {
        el.addEventListener('click', closeQr);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !modal.hidden) closeQr();
    });
}
