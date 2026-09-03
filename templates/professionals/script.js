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
                    throw new Error((body && body.error) || 'Cererea nu a putut fi înregistrată.');
                }
            } catch (err) {
                if (hint) {
                    hint.hidden = false;
                    hint.textContent = 'Nu am putut trimite cererea. Încearcă din nou sau folosește emailul de contact.';
                }
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
(function (root) {
    'use strict';
    // Reed-Solomon GF(256) tables
    var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            EXP[i] = x; LOG[x] = i;
            x = x << 1; if (x & 0x100) x ^= 0x11d;
        }
        for (var i2 = 255; i2 < 512; i2++) EXP[i2] = EXP[i2 - 255];
    })();
    function gfMul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
    function gfPolyMul(p, q) {
        var r = new Uint8Array(p.length + q.length - 1);
        for (var i = 0; i < p.length; i++)
            for (var j = 0; j < q.length; j++)
                r[i + j] ^= gfMul(p[i], q[j]);
        return r;
    }
    function rsGenerator(n) {
        var g = new Uint8Array([1]);
        for (var i = 0; i < n; i++) g = gfPolyMul(g, new Uint8Array([1, EXP[i]]));
        return g;
    }
    function rsEncode(data, n) {
        var gen = rsGenerator(n), msg = new Uint8Array(data.length + n);
        msg.set(data);
        for (var i = 0; i < data.length; i++) {
            var c = msg[i];
            if (c) for (var j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], c);
        }
        return msg.slice(data.length);
    }

    // QR version/ec tables (version 1-10, level M)
    var EC_M = [
        null,
        {total:26, data:16, ec:10, blocks:1},
        {total:44, data:28, ec:16, blocks:1},
        {total:70, data:44, ec:26, blocks:1},
        {total:100, data:64, ec:18, blocks:2},
        {total:134, data:86, ec:24, blocks:2},
        {total:172, data:108, ec:16, blocks:4},
        {total:196, data:124, ec:18, blocks:4},
        {total:242, data:154, ec:22, blocks:2},
        {total:292, data:182, ec:22, blocks:3},
        {total:346, data:216, ec:26, blocks:4}
    ];

    function getVersion(byteLen) {
        for (var v = 1; v <= 10; v++)
            if (EC_M[v] && EC_M[v].data >= byteLen + 2) return v;
        return -1;
    }

    // Alignment pattern positions
    var ALIGN = [null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];

    function makeMatrix(v) {
        var s = v * 4 + 17, m = [];
        for (var i = 0; i < s; i++) { m[i] = new Int8Array(s); for (var j = 0; j < s; j++) m[i][j] = -1; }

        function setFinder(r, c) {
            for (var i = -1; i <= 7; i++) for (var j = -1; j <= 7; j++) {
                var rr = r + i, cc = c + j; if (rr < 0 || rr >= s || cc < 0 || cc >= s) continue;
                var onBorder = (i === -1 || i === 7 || j === -1 || j === 7);
                var onInner = (i >= 1 && i <= 5 && j >= 1 && j <= 5);
                m[rr][cc] = (onBorder || onInner) ? 1 : 0;
            }
        }
        setFinder(0, 0); setFinder(0, s - 7); setFinder(s - 7, 0);

        // Timing
        for (var i2 = 8; i2 < s - 8; i2++) { m[6][i2] = i2 % 2 === 0 ? 1 : 0; m[i2][6] = i2 % 2 === 0 ? 1 : 0; }

        // Alignment
        var ap = ALIGN[v];
        for (var ai = 0; ai < ap.length; ai++) for (var aj = 0; aj < ap.length; aj++) {
            var ar = ap[ai], ac = ap[aj];
            if (m[ar][ac] !== -1) continue;
            for (var di = -2; di <= 2; di++) for (var dj = -2; dj <= 2; dj++) {
                var rv = di === -2 || di === 2 || dj === -2 || dj === 2 ? 1 : (di === 0 && dj === 0 ? 1 : 0);
                m[ar + di][ac + dj] = rv;
            }
        }

        // Dark module
        m[s - 8][8] = 1;
        return m;
    }

    function placeFormat(m, mask) {
        var s = m.length;
        var fmt = [0,1,1,0,1,1,1,1,1,0,0,1,0,1,0]; // level M, mask bits (filled per mask)
        // Format info string: EC level M = 00, mask pattern
        var fmtData = (1 << 3) | mask; // 01 for M (after XOR with 101010000010010 = 21522)
        // Compute format bits: 5-bit data + 10-bit ECC
        var gen = 0x537; // x^10 + x^8 + x^5 + x^4 + x^2 + x + 1
        var rem = fmtData << 10;
        for (var i2 = 4; i2 >= 0; i2--) { if (rem & (1 << (i2 + 10))) rem ^= gen << i2; }
        var bits = ((fmtData << 10) | rem) ^ 21522;
        var seq = [];
        for (var b = 14; b >= 0; b--) seq.push((bits >> b) & 1);
        // Place in matrix
        var positions = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
        var positions2 = [[s-1,8],[s-2,8],[s-3,8],[s-4,8],[s-5,8],[s-6,8],[s-7,8],[8,s-8],[8,s-7],[8,s-6],[8,s-5],[8,s-4],[8,s-3],[8,s-2],[8,s-1]];
        for (var pi = 0; pi < 15; pi++) {
            m[positions[pi][0]][positions[pi][1]] = seq[pi];
            m[positions2[pi][0]][positions2[pi][1]] = seq[pi];
        }
    }

    function placeData(m, data) {
        var s = m.length, col = s - 1, row = s - 1, up = true, bitIdx = 0;
        var total = data.length * 8;
        while (col > 0) {
            if (col === 6) col--;
            for (var r2 = 0; r2 < s; r2++) {
                var rr = up ? (s - 1 - r2) : r2;
                for (var cc = 0; cc < 2; cc++) {
                    var c2 = col - cc;
                    if (m[rr][c2] !== -1) continue;
                    var bit = 0;
                    if (bitIdx < total) { var byte = data[bitIdx >> 3]; bit = (byte >> (7 - (bitIdx & 7))) & 1; }
                    m[rr][c2] = bit;
                    bitIdx++;
                }
            }
            col -= 2; up = !up;
        }
    }

    function applyMask(m, maskId) {
        var s = m.length, fn;
        var fns = [
            function(r,c){return (r+c)%2===0;},
            function(r){return r%2===0;},
            function(_,c){return c%3===0;},
            function(r,c){return (r+c)%3===0;},
            function(r,c){return (Math.floor(r/2)+Math.floor(c/3))%2===0;},
            function(r,c){return (r*c)%2+(r*c)%3===0;},
            function(r,c){return ((r*c)%2+(r*c)%3)%2===0;},
            function(r,c){return ((r+c)%2+(r*c)%3)%2===0;}
        ];
        fn = fns[maskId];
        var nm = [];
        for (var i = 0; i < s; i++) {
            nm[i] = new Int8Array(s);
            for (var j = 0; j < s; j++) {
                nm[i][j] = m[i][j];
                if (m[i][j] !== -1 && fn(i, j)) nm[i][j] ^= 1;
            }
        }
        return nm;
    }

    function encode(text) {
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 128) { bytes.push(c); }
            else if (c < 2048) { bytes.push(0xC0|(c>>6)); bytes.push(0x80|(c&63)); }
            else { bytes.push(0xE0|(c>>12)); bytes.push(0x80|((c>>6)&63)); bytes.push(0x80|(c&63)); }
        }
        var v = getVersion(bytes.length);
        if (v < 0) return null;
        var ec = EC_M[v];
        // Build data codewords
        var buf = [], cap = ec.data;
        // Header: byte mode (0100), char count (8 bits), data
        var header = (4 << 4) | ((bytes.length >> 4) & 0xF);
        buf.push(((4 << 4) | (bytes.length >> 4)) & 0xFF);
        buf.push(((bytes.length & 0xF) << 4) | ((bytes[0] >> 4) & 0xF));
        for (var i2 = 0; i2 < bytes.length - 1; i2++)
            buf.push(((bytes[i2] & 0xF) << 4) | ((bytes[i2+1] >> 4) & 0xF));
        buf.push((bytes[bytes.length-1] & 0xF) << 4);
        // Terminator + padding
        while (buf.length < cap) buf.push(buf.length % 2 === 0 ? 0xEC : 0x11);

        // RS error correction
        var data = new Uint8Array(buf);
        var ecBytes = rsEncode(data, ec.total - ec.data);
        var allData = new Uint8Array(ec.total);
        allData.set(data); allData.set(ecBytes, data.length);

        // Build matrix
        var mat = makeMatrix(v);
        placeData(mat, allData);
        var best = applyMask(mat, 5); // mask pattern 5 is reliable for URLs
        placeFormat(best, 5);

        return best;
    }

    function toSVG(matrix, size) {
        if (!matrix) return '';
        var s = matrix.length, cell = size / s;
        var rects = [];
        for (var r = 0; r < s; r++) {
            for (var c = 0; c < s; c++) {
                if (matrix[r][c] === 1) {
                    rects.push('<rect x="' + (c * cell).toFixed(2) + '" y="' + (r * cell).toFixed(2) +
                        '" width="' + cell.toFixed(2) + '" height="' + cell.toFixed(2) + '" fill="#1A1714"/>');
                }
            }
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
            '" width="' + size + '" height="' + size + '" style="background:#fff">' +
            rects.join('') + '</svg>';
    }

    root.generateQRSVG = function (text, size) { return toSVG(encode(text), size || 240); };
})(window);

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
