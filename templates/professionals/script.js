// Professionals vertical — appointment request + calm interactions.
// Zero dependencies. No Google/Calendly. Local request status only.
// Defensive: every init returns early when its roots are missing.

document.addEventListener('DOMContentLoaded', () => {
    initReveal();
    initSmoothScroll();
    initAppointment();
    initWhatsAppQR();
});

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
    // 1=Mon … 7=Sun
    try {
        const w = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
        const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
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
    const confirmText = root.getAttribute('data-confirm') || 'Your request has been logged.';
    const emptyText = root.getAttribute('data-empty') || 'No time slots are available right now.';
    const submitLabel = root.getAttribute('data-submit') || 'Send request';

    const dateSel = document.getElementById('pr-appt-date');
    const slotSel = document.getElementById('pr-appt-slot');
    const hint = document.getElementById('pr-appt-hint');
    const submitBtn = document.getElementById('pr-appt-submit');
    const done = document.getElementById('pr-appt-done');
    const doneBody = document.getElementById('pr-appt-done-body');
    const doneConfirm = document.getElementById('pr-appt-done-confirm');
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
        if (!first) return { id: 'default', label: 'Consultation', durationMin: defaultDur, mode: '' };
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
                const label = new Intl.DateTimeFormat('en-US', {
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
                hint.textContent = 'Please fill in your name, email, and a time slot.';
            }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            const span = submitBtn.querySelector('span');
            if (span) span.textContent = 'Sending…';
            else submitBtn.textContent = 'Sending…';
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

        if (payload.slug && /^https?:/i.test(location.origin || '')) {
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
                    throw new Error((body && body.error) || 'We couldn\'t log your request.');
                }
            } catch (err) {
                if (hint) {
                    hint.hidden = false;
                    hint.textContent = err.message || 'Something went wrong sending your request. Try again or use the contact email.';
                }
                if (submitBtn) {
                    submitBtn.disabled = false;
                    const span = submitBtn.querySelector('span');
                    if (span) span.textContent = submitLabel;
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
                when = new Intl.DateTimeFormat('en-US', {
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
                    (localOnly ? ' · local preview status' : '');
            }
            if (doneConfirm) {
                doneConfirm.textContent = confirmText;
            }
        }
    }

    if (submitBtn) submitBtn.addEventListener('click', sendRequest);
    form.addEventListener('submit', sendRequest);
}

function initWhatsAppQR() {
    const modal = document.getElementById('wa-qr');
    const img = document.getElementById('wa-qr-img');
    const links = document.querySelectorAll('a[href*="wa.me"]');
    if (!modal || !img || !links.length) return;

    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    if (isMobile) return;

    const openBtn = document.getElementById('wa-qr-open');
    const openModal = (waUrl) => {
        // Local SVG placeholder QR (no external QR API)
        const svg = encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">` +
            `<rect width="240" height="240" fill="#F3EFE8"/>` +
            `<rect x="24" y="24" width="64" height="64" fill="none" stroke="#14120F" stroke-width="8"/>` +
            `<rect x="152" y="24" width="64" height="64" fill="none" stroke="#14120F" stroke-width="8"/>` +
            `<rect x="24" y="152" width="64" height="64" fill="none" stroke="#14120F" stroke-width="8"/>` +
            `<text x="120" y="130" text-anchor="middle" font-size="14" fill="#14120F" font-family="sans-serif">WhatsApp</text>` +
            `</svg>`
        );
        img.src = 'data:image/svg+xml,' + svg;
        img.alt = 'Open the WhatsApp link below';
        if (openBtn) openBtn.href = waUrl;
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    };
    const closeModal = () => {
        modal.hidden = true;
        document.body.style.overflow = '';
    };

    links.forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        openModal(a.href);
    }));
    modal.querySelectorAll('[data-wa-close]').forEach((el) => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
}
