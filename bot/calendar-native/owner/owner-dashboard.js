/**
 * Owner bookings dashboard + availability editor (VISION §8 step c part 2).
 * Romanian product copy. Tenant scoped via customerId + siteId on every call.
 * Requires hb_session cookie of the site owner (customerId === session uid).
 */
(function () {
  'use strict';

  var WEEKDAYS = [
    { n: 1, label: 'Luni' },
    { n: 2, label: 'Marți' },
    { n: 3, label: 'Miercuri' },
    { n: 4, label: 'Joi' },
    { n: 5, label: 'Vineri' },
    { n: 6, label: 'Sâmbătă' },
    { n: 7, label: 'Duminică' },
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function cfgFromRoot(root) {
    return {
      apiBase: (root.getAttribute('data-api-base') || '').replace(/\/$/, ''),
      customerId: root.getAttribute('data-customer-id') || '',
      siteId: root.getAttribute('data-site-id') || '',
      brand: root.getAttribute('data-brand') || 'Calendar',
    };
  }

  function apiUrl(base, path, params) {
    var u = (base || '') + path;
    if (params) {
      var q = Object.keys(params)
        .filter(function (k) { return params[k] != null && params[k] !== ''; })
        .map(function (k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        })
        .join('&');
      if (q) u += (u.indexOf('?') >= 0 ? '&' : '?') + q;
    }
    return u;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatWhen(iso, tz) {
    try {
      var d = new Date(iso);
      return d.toLocaleString('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch (_) {
      return iso;
    }
  }

  function formatTime(iso, tz) {
    try {
      return new Date(iso).toLocaleTimeString('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch (_) {
      return '';
    }
  }

  function minutesToTime(m) {
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function timeToMinutes(t) {
    var raw = String(t || '').trim();
    // Accept 24h "09:00" and tolerate accidental AM/PM leftovers
    var am = /\b(am|a\.m\.)\b/i.test(raw);
    var pm = /\b(pm|p\.m\.)\b/i.test(raw);
    var m = raw.match(/(\d{1,2})\s*[:.hH]\s*(\d{2})/);
    if (!m) {
      var p = raw.split(':');
      if (p.length < 2) return null;
      var h0 = parseInt(p[0], 10);
      var m0 = parseInt(p[1], 10);
      if (!Number.isFinite(h0) || !Number.isFinite(m0)) return null;
      return h0 * 60 + m0;
    }
    var h = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  }

  /** Parse RO dd.mm.yyyy (or yyyy-mm-dd) → yyyy-mm-dd for API filters. */
  function parseRoDate(s) {
    var v = String(s || '').trim();
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (!m) return '';
    var d = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var y = parseInt(m[3], 10);
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000) return '';
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function formatRoDate(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
    var p = ymd.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function badgeClass(status) {
    if (status === 'confirmed') return 'hod-badge hod-badge--ok';
    if (status === 'requested') return 'hod-badge hod-badge--wait';
    if (status === 'reschedule_needed') return 'hod-badge hod-badge--resched';
    return 'hod-badge hod-badge--cancelled';
  }

  function mount(root) {
    var cfg = cfgFromRoot(root);
    var state = {
      tab: 'bookings',
      timezone: 'Europe/Bucharest',
      bookings: [],
      counts: {},
      weekly: [],
      overrides: [],
      services: [],
      settings: null,
      msg: null,
      authBlocked: false,
      reschedule: null,
      slots: [],
      pickSlot: null,
    };

    root.innerHTML =
      '<div class="hod-shell" data-hod-shell>' +
      '  <header class="hod-top">' +
      '    <div>' +
      '      <p class="hod-eyebrow" data-hod-brand></p>' +
      '      <h1>Programările tale</h1>' +
      '      <p class="hod-sub">Doar tu vezi aceste date — izolate pe site-ul tău.</p>' +
      '    </div>' +
      '  </header>' +
      '  <div data-hod-flash></div>' +
      '  <div class="hod-tabs" role="tablist">' +
      '    <button type="button" class="hod-tab is-on" data-hod-tab="bookings">Programări</button>' +
      '    <button type="button" class="hod-tab" data-hod-tab="avail">Disponibilitate</button>' +
      '    <button type="button" class="hod-tab" data-hod-tab="services">Servicii</button>' +
      '  </div>' +
      '  <div class="hod-panel is-on" data-hod-panel="bookings"></div>' +
      '  <div class="hod-panel" data-hod-panel="avail"></div>' +
      '  <div class="hod-panel" data-hod-panel="services"></div>' +
      '  <div data-hod-modal-host></div>' +
      '  <p class="hod-foot">Build by hidook.tech powered by hidook.agency</p>' +
      '</div>';

    var brandEl = $('[data-hod-brand]', root);
    if (brandEl) brandEl.textContent = cfg.brand || 'Calendar';

    function setMsg(text, kind) {
      state.msg = text ? { text: text, kind: kind || 'ok' } : null;
      paintFlash();
    }

    function paintFlash() {
      var el = $('[data-hod-flash]', root);
      if (!el) return;
      if (!state.msg) {
        el.innerHTML = '';
        return;
      }
      var cls = state.msg.kind === 'err' ? 'hod-msg hod-msg--err' : 'hod-msg hod-msg--ok';
      el.innerHTML = '<div class="' + cls + '" role="status">' + esc(state.msg.text) + '</div>';
    }

    function tenantParams() {
      return { customerId: cfg.customerId, siteId: cfg.siteId };
    }

    async function api(method, path, body, params) {
      var url = apiUrl(cfg.apiBase, path, Object.assign({}, tenantParams(), params || {}));
      var opts = {
        method: method,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      };
      if (body != null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(Object.assign({}, tenantParams(), body));
      }
      var res = await fetch(url, opts);
      var data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      return { status: res.status, data: data };
    }

    async function loadBookings() {
      var qEl = $('[data-hod-q]', root);
      var stEl = $('[data-hod-status]', root);
      var fromEl = $('[data-hod-from]', root);
      var toEl = $('[data-hod-to]', root);
      var params = {
        q: qEl ? qEl.value : '',
        status: stEl ? stEl.value : '',
        fromDateLocal: fromEl ? parseRoDate(fromEl.value) : '',
        toDateLocal: toEl ? parseRoDate(toEl.value) : '',
      };
      var r = await api('GET', '/api/calendar-native/owner/bookings', null, params);
      if (r.status === 401) {
        state.authBlocked = true;
        paintAll();
        return;
      }
      if (r.status === 403) {
        setMsg('Nu ai acces la programările acestui site.', 'err');
        state.bookings = [];
        paintBookings();
        return;
      }
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut încărca programările.', 'err');
        return;
      }
      state.authBlocked = false;
      state.timezone = r.data.timezone || state.timezone;
      state.bookings = r.data.bookings || [];
      state.counts = r.data.counts || {};
      paintBookings();
    }

    async function loadAvailability() {
      var r = await api('GET', '/api/calendar-native/owner/availability');
      if (r.status === 401) {
        state.authBlocked = true;
        paintAll();
        return;
      }
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut încărca disponibilitatea.', 'err');
        return;
      }
      state.settings = r.data.settings;
      state.timezone = (r.data.settings && r.data.settings.timezone) || state.timezone;
      state.weekly = r.data.weekly || [];
      state.overrides = r.data.overrides || [];
      state.services = r.data.services || [];
      paintAvail();
      paintServices();
    }

    function paintBookings() {
      var panel = $('[data-hod-panel="bookings"]', root);
      if (!panel) return;
      if (state.authBlocked) {
        panel.innerHTML =
          '<div class="hod-auth"><h2>Autentificare necesară</h2>' +
          '<p>Deschide dashboard-ul după ce te conectezi ca owner al site-ului.</p></div>';
        return;
      }
      var c = state.counts || {};
      var html = '';
      html += '<div class="hod-stats" aria-label="Rezumat">';
      html +=
        '<div class="hod-stat"><strong>' +
        esc(c.confirmed || 0) +
        '</strong><span>confirmate</span></div>';
      html +=
        '<div class="hod-stat"><strong>' +
        esc(c.requested || 0) +
        '</strong><span>în așteptare</span></div>';
      html +=
        '<div class="hod-stat"><strong>' +
        esc(c.reschedule_needed || 0) +
        '</strong><span>reprogramare</span></div>';
      html +=
        '<div class="hod-stat"><strong>' +
        esc(c.cancelled || 0) +
        '</strong><span>anulate</span></div>';
      html += '</div>';

      html += '<div class="hod-filters">';
      html +=
        '<input type="search" data-hod-q placeholder="Caută nume, email…" aria-label="Caută" />';
      html +=
        '<select data-hod-status aria-label="Status">' +
        '<option value="">Toate statusurile</option>' +
        '<option value="confirmed">Confirmate</option>' +
        '<option value="requested">În așteptare</option>' +
        '<option value="reschedule_needed">Reprogramare</option>' +
        '<option value="cancelled">Anulate</option>' +
        '</select>';
      html +=
        '<input type="text" inputmode="numeric" data-hod-from placeholder="zz.ll.aaaa" aria-label="De la" maxlength="10" autocomplete="off" />';
      html +=
        '<input type="text" inputmode="numeric" data-hod-to placeholder="zz.ll.aaaa" aria-label="Până la" maxlength="10" autocomplete="off" />';
      html += '<button type="button" class="hod-btn hod-btn--ghost" data-hod-refresh>Filtrează</button>';
      html += '</div>';

      if (!state.bookings.length) {
        html +=
          '<div class="hod-empty">Nicio programare pe aceste filtre. Când apar rezervări pe site, le vezi aici.</div>';
      } else {
        html += '<ul class="hod-list">';
        state.bookings.forEach(function (b) {
          html += '<li class="hod-booking" data-booking-id="' + esc(b.id) + '">';
          html += '<div>';
          html += '<div class="hod-booking__top">';
          html +=
            '<div class="hod-booking__time">' +
            esc(formatWhen(b.startUtc, state.timezone)) +
            (b.durationMinutes ? ' · ' + esc(b.durationMinutes) + ' min' : '') +
            '</div>';
          html +=
            '<span class="' +
            badgeClass(b.status) +
            '">' +
            esc(b.statusLabel || b.status) +
            '</span>';
          html += '</div>';
          html +=
            '<div class="hod-booking__meta"><strong>' +
            esc(b.visitorName) +
            '</strong> · ' +
            esc(b.serviceName || 'Serviciu') +
            '</div>';
          html +=
            '<div class="hod-booking__meta">' +
            esc(b.visitorEmail) +
            (b.visitorPhone ? ' · ' + esc(b.visitorPhone) : '') +
            '</div>';
          if (b.note) html += '<div class="hod-booking__note">' + esc(b.note) + '</div>';
          html += '</div>';
          html += '<div class="hod-booking__acts">';
          if (b.status !== 'cancelled') {
            html +=
              '<button type="button" class="hod-btn hod-btn--small hod-btn--ghost" data-hod-act="reschedule" data-id="' +
              esc(b.id) +
              '" data-svc="' +
              esc(b.serviceId || '') +
              '">Reprogramează</button>';
            html +=
              '<button type="button" class="hod-btn hod-btn--small hod-btn--danger" data-hod-act="cancel" data-id="' +
              esc(b.id) +
              '">Anulează</button>';
          }
          if (b.status === 'requested') {
            html +=
              '<button type="button" class="hod-btn hod-btn--small" data-hod-act="confirm" data-id="' +
              esc(b.id) +
              '">Confirmă</button>';
          }
          html += '</div></li>';
        });
        html += '</ul>';
      }
      panel.innerHTML = html;

      var refresh = $('[data-hod-refresh]', panel);
      if (refresh) refresh.addEventListener('click', function () { loadBookings(); });
      $all('[data-hod-act]', panel).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-hod-act');
          var id = btn.getAttribute('data-id');
          if (act === 'cancel') onCancel(id, btn);
          if (act === 'confirm') onConfirm(id, btn);
          if (act === 'reschedule') openReschedule(id, btn.getAttribute('data-svc'));
        });
      });
    }

    function paintAvail() {
      var panel = $('[data-hod-panel="avail"]', root);
      if (!panel) return;
      if (state.authBlocked) {
        panel.innerHTML = '';
        return;
      }
      var byDay = {};
      (state.weekly || []).forEach(function (w) {
        byDay[w.weekday] = w;
      });
      var html = '';
      html += '<div class="hod-card">';
      html += '<h2>Program săptămânal</h2>';
      html +=
        '<p class="hod-hint">Fus orar: ' +
        esc((state.settings && state.settings.timezone) || state.timezone) +
        '. Zilele libere și orele speciale pe o dată anume înlocuiesc programul săptămânal.</p>';
      html += '<ul class="hod-week">';
      WEEKDAYS.forEach(function (d) {
        var w = byDay[d.n];
        var open = !!w;
        var start = w ? minutesToTime(w.startMinute) : '09:00';
        var end = w ? minutesToTime(w.endMinute) : '17:00';
        html += '<li data-weekday="' + d.n + '">';
        html += '<div class="hod-week__day">' + esc(d.label) + '</div>';
        html += '<div class="hod-week__row">';
        html +=
          '<label><input type="checkbox" data-hod-open ' +
          (open ? 'checked' : '') +
          ' /> Deschis</label>';
        html +=
          '<input type="text" inputmode="numeric" data-hod-start placeholder="09:00" value="' +
          esc(start) +
          '" ' +
          (open ? '' : 'disabled') +
          ' aria-label="Ora de început" maxlength="5" />';
        html += '<span aria-hidden="true">–</span>';
        html +=
          '<input type="text" inputmode="numeric" data-hod-end placeholder="17:00" value="' +
          esc(end) +
          '" ' +
          (open ? '' : 'disabled') +
          ' aria-label="Ora de sfârșit" maxlength="5" />';
        html += '</div></li>';
      });
      html += '</ul>';
      html +=
        '<button type="button" class="hod-btn" data-hod-save-weekly>Salvează programul</button>';
      html += '</div>';

      html += '<div class="hod-card">';
      html += '<h2>Zile libere și ore speciale</h2>';
      html +=
        '<p class="hod-hint">Adaugă o zi liberă sau ore speciale pe o dată. Ele înlocuiesc programul recurent în acea zi.</p>';
      html += '<ul class="hod-ov-list">';
      if (!state.overrides.length) {
        html += '<li class="hod-hint" style="border:0">Nicio excepție adăugată încă.</li>';
      }
      state.overrides.forEach(function (o) {
        var label =
          o.kind === 'blackout'
            ? 'zi liberă'
            : 'ore speciale ' +
              minutesToTime(o.startMinute) +
              '–' +
              minutesToTime(o.endMinute);
        html += '<li>';
        html +=
          '<span><strong>' +
          esc(formatRoDate(o.dateLocal) || o.dateLocal) +
          '</strong> — ' +
          esc(label) +
          (o.note ? ' · ' + esc(o.note) : '') +
          '</span>';
        html +=
          '<button type="button" class="hod-btn hod-btn--small hod-btn--ghost" data-hod-del-ov="' +
          esc(o.id) +
          '">Șterge</button>';
        html += '</li>';
      });
      html += '</ul>';
      html += '<div class="hod-ov-form">';
      html +=
        '<div class="hod-field">Dată (zz.ll.aaaa)<input type="text" inputmode="numeric" data-hod-ov-date placeholder="zz.ll.aaaa" maxlength="10" autocomplete="off" /></div>';
      html +=
        '<div class="hod-field">Tip<select data-hod-ov-kind>' +
        '<option value="blackout">Zi liberă</option>' +
        '<option value="special_hours">Ore speciale</option>' +
        '</select></div>';
      html +=
        '<div class="hod-row2 hod-ov-hours" hidden>' +
        '<div class="hod-field">De la<input type="text" inputmode="numeric" data-hod-ov-start placeholder="10:00" value="10:00" maxlength="5" /></div>' +
        '<div class="hod-field">Până la<input type="text" inputmode="numeric" data-hod-ov-end placeholder="14:00" value="14:00" maxlength="5" /></div>' +
        '</div>';
      html +=
        '<div class="hod-field">Notă (opțional)<input type="text" data-hod-ov-note maxlength="120" placeholder="ex. sărbătoare" /></div>';
      html +=
        '<button type="button" class="hod-btn hod-btn--ghost" data-hod-add-ov>+ Adaugă excepție</button>';
      html += '</div></div>';

      panel.innerHTML = html;

      $all('[data-hod-open]', panel).forEach(function (cb) {
        cb.addEventListener('change', function () {
          var li = cb.closest('li');
          $all('input[data-hod-start], input[data-hod-end]', li).forEach(function (inp) {
            inp.disabled = !cb.checked;
          });
        });
      });
      var kindSel = $('[data-hod-ov-kind]', panel);
      var hoursRow = $('.hod-ov-hours', panel);
      if (kindSel && hoursRow) {
        kindSel.addEventListener('change', function () {
          hoursRow.hidden = kindSel.value !== 'special_hours';
        });
      }
      var saveW = $('[data-hod-save-weekly]', panel);
      if (saveW) saveW.addEventListener('click', saveWeekly);
      var addOv = $('[data-hod-add-ov]', panel);
      if (addOv) addOv.addEventListener('click', addOverride);
      $all('[data-hod-del-ov]', panel).forEach(function (btn) {
        btn.addEventListener('click', function () {
          removeOverride(btn.getAttribute('data-hod-del-ov'), btn);
        });
      });
    }

    function paintServices() {
      var panel = $('[data-hod-panel="services"]', root);
      if (!panel) return;
      if (state.authBlocked) {
        panel.innerHTML = '';
        return;
      }
      var html = '<div class="hod-card"><h2>Servicii</h2>';
      html +=
        '<p class="hod-hint">Durata și pauza dintre programări se folosesc la generarea intervalelor libere pe site-ul public.</p>';
      html += '<ul class="hod-svc-list">';
      if (!state.services.length) {
        html += '<li class="hod-hint">Niciun serviciu configurat.</li>';
      }
      state.services.forEach(function (s) {
        html += '<li data-svc-id="' + esc(s.id) + '">';
        html +=
          '<div><strong>' +
          esc(s.name) +
          '</strong> · ' +
          esc(s.durationMinutes) +
          ' min · pauză ' +
          esc(s.bufferMinutes != null ? s.bufferMinutes : '—') +
          ' min</div>';
        html += '<div class="hod-svc-edit">';
        html +=
          '<div class="hod-field">Nume<input type="text" data-hod-svc-name value="' +
          esc(s.name) +
          '" maxlength="80" /></div>';
        html += '<div class="hod-row2">';
        html +=
          '<div class="hod-field">Durată (min)<input type="number" min="5" max="480" data-hod-svc-dur value="' +
          esc(s.durationMinutes) +
          '" /></div>';
        html +=
          '<div class="hod-field">Pauză după (min)<input type="number" min="0" max="240" data-hod-svc-buf value="' +
          esc(s.bufferMinutes != null ? s.bufferMinutes : 0) +
          '" /></div>';
        html += '</div>';
        html +=
          '<button type="button" class="hod-btn hod-btn--small" data-hod-save-svc="' +
          esc(s.id) +
          '">Salvează serviciul</button>';
        html += '</div></li>';
      });
      html += '</ul></div>';
      panel.innerHTML = html;
      $all('[data-hod-save-svc]', panel).forEach(function (btn) {
        btn.addEventListener('click', function () {
          saveService(btn.getAttribute('data-hod-save-svc'), btn);
        });
      });
    }

    function paintTabs() {
      $all('[data-hod-tab]', root).forEach(function (t) {
        t.classList.toggle('is-on', t.getAttribute('data-hod-tab') === state.tab);
      });
      $all('[data-hod-panel]', root).forEach(function (p) {
        p.classList.toggle('is-on', p.getAttribute('data-hod-panel') === state.tab);
      });
    }

    function paintAll() {
      paintFlash();
      paintTabs();
      paintBookings();
      paintAvail();
      paintServices();
    }

    async function saveWeekly() {
      var panel = $('[data-hod-panel="avail"]', root);
      var windows = [];
      $all('li[data-weekday]', panel).forEach(function (li) {
        var open = $('[data-hod-open]', li);
        if (!open || !open.checked) return;
        var sm = timeToMinutes($('[data-hod-start]', li).value);
        var em = timeToMinutes($('[data-hod-end]', li).value);
        if (sm == null || em == null || em <= sm) return;
        windows.push({
          weekday: Number(li.getAttribute('data-weekday')),
          startMinute: sm,
          endMinute: em,
        });
      });
      var r = await api('PUT', '/api/calendar-native/owner/availability/weekly', {
        windows: windows,
      });
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut salva programul.', 'err');
        return;
      }
      state.weekly = r.data.weekly || [];
      setMsg('Programul săptămânal a fost salvat.', 'ok');
      paintAvail();
    }

    async function addOverride() {
      var panel = $('[data-hod-panel="avail"]', root);
      var dateLocal = parseRoDate($('[data-hod-ov-date]', panel).value);
      if (!dateLocal) {
        setMsg('Completează data în format zz.ll.aaaa.', 'err');
        return;
      }
      var kind = $('[data-hod-ov-kind]', panel).value;
      var note = $('[data-hod-ov-note]', panel).value;
      var body = { dateLocal: dateLocal, kind: kind, note: note || null };
      if (kind === 'special_hours') {
        body.startMinute = timeToMinutes($('[data-hod-ov-start]', panel).value);
        body.endMinute = timeToMinutes($('[data-hod-ov-end]', panel).value);
      }
      var r = await api('POST', '/api/calendar-native/owner/availability/overrides', body);
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut adăuga excepția.', 'err');
        return;
      }
      setMsg('Excepție adăugată.', 'ok');
      await loadAvailability();
    }

    async function removeOverride(id, btn) {
      if (btn) btn.disabled = true;
      var r = await api(
        'DELETE',
        '/api/calendar-native/owner/availability/overrides/' + encodeURIComponent(id)
      );
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut șterge excepția.', 'err');
        if (btn) btn.disabled = false;
        return;
      }
      setMsg('Excepție ștearsă.', 'ok');
      await loadAvailability();
    }

    async function saveService(id, btn) {
      var li = btn.closest('li');
      var body = {
        name: $('[data-hod-svc-name]', li).value,
        durationMinutes: Number($('[data-hod-svc-dur]', li).value),
        bufferMinutes: Number($('[data-hod-svc-buf]', li).value),
      };
      btn.disabled = true;
      var r = await api(
        'PUT',
        '/api/calendar-native/owner/services/' + encodeURIComponent(id),
        body
      );
      btn.disabled = false;
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut salva serviciul.', 'err');
        return;
      }
      setMsg('Serviciu actualizat.', 'ok');
      await loadAvailability();
    }

    async function onCancel(id, btn) {
      if (!window.confirm('Anulezi această programare? Intervalul se eliberează imediat.')) return;
      btn.disabled = true;
      var r = await api(
        'POST',
        '/api/calendar-native/owner/bookings/' + encodeURIComponent(id) + '/cancel',
        {}
      );
      btn.disabled = false;
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut anula.', 'err');
        return;
      }
      setMsg('Programare anulată. Intervalul este din nou liber.', 'ok');
      await loadBookings();
    }

    async function onConfirm(id, btn) {
      btn.disabled = true;
      var r = await api(
        'POST',
        '/api/calendar-native/owner/bookings/' + encodeURIComponent(id) + '/confirm',
        {}
      );
      btn.disabled = false;
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut confirma.', 'err');
        return;
      }
      setMsg('Programare confirmată.', 'ok');
      await loadBookings();
    }

    async function openReschedule(bookingId, serviceId) {
      state.reschedule = { bookingId: bookingId, serviceId: serviceId };
      state.pickSlot = null;
      state.slots = [];
      paintModal();
      var from = new Date();
      var to = new Date(from.getTime() + 14 * 86400000);
      function ymd(d) {
        return (
          d.getFullYear() +
          '-' +
          String(d.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getDate()).padStart(2, '0')
        );
      }
      var r = await api('GET', '/api/calendar-native/owner/slots', null, {
        serviceId: serviceId,
        from: ymd(from),
        to: ymd(to),
      });
      if (!r.data || !r.data.ok) {
        setMsg((r.data && r.data.error) || 'Nu am putut încărca intervalele libere.', 'err');
        closeModal();
        return;
      }
      state.slots = r.data.slots || [];
      paintModal();
    }

    function closeModal() {
      state.reschedule = null;
      state.slots = [];
      state.pickSlot = null;
      var host = $('[data-hod-modal-host]', root);
      if (host) host.innerHTML = '';
    }

    function paintModal() {
      var host = $('[data-hod-modal-host]', root);
      if (!host) return;
      if (!state.reschedule) {
        host.innerHTML = '';
        return;
      }
      var html =
        '<div class="hod-modal-bg" data-hod-modal-bg><div class="hod-modal" role="dialog" aria-modal="true">';
      html += '<h3>Reprogramează</h3>';
      html +=
        '<p class="hod-hint">Alege un interval liber. Intervalul vechi se eliberează imediat; istoricul rămâne pe aceeași programare.</p>';
      if (!state.slots.length) {
        html += '<div class="hod-empty">Nu sunt intervale libere în următoarele 14 zile.</div>';
      } else {
        html += '<div class="hod-slots">';
        state.slots.slice(0, 36).forEach(function (s) {
          var on = state.pickSlot === s.startUtc ? ' is-on' : '';
          html +=
            '<button type="button" class="hod-slot' +
            on +
            '" data-hod-pick="' +
            esc(s.startUtc) +
            '">' +
            esc(formatTime(s.startUtc, state.timezone)) +
            '<br><span style="font-size:10px;font-weight:600">' +
            esc(s.dateLocal || '') +
            '</span></button>';
        });
        html += '</div>';
      }
      html +=
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
        '<button type="button" class="hod-btn" data-hod-do-reschedule ' +
        (state.pickSlot ? '' : 'disabled') +
        '>Salvează noua oră</button>' +
        '<button type="button" class="hod-btn hod-btn--ghost" data-hod-close-modal>Închide</button>' +
        '</div>';
      html += '</div></div>';
      host.innerHTML = html;
      var bg = $('[data-hod-modal-bg]', host);
      if (bg) {
        bg.addEventListener('click', function (e) {
          if (e.target === bg) closeModal();
        });
      }
      $all('[data-hod-pick]', host).forEach(function (b) {
        b.addEventListener('click', function () {
          state.pickSlot = b.getAttribute('data-hod-pick');
          paintModal();
        });
      });
      var close = $('[data-hod-close-modal]', host);
      if (close) close.addEventListener('click', closeModal);
      var go = $('[data-hod-do-reschedule]', host);
      if (go) {
        go.addEventListener('click', async function () {
          if (!state.pickSlot || !state.reschedule) return;
          go.disabled = true;
          var r = await api(
            'POST',
            '/api/calendar-native/owner/bookings/' +
              encodeURIComponent(state.reschedule.bookingId) +
              '/reschedule',
            { startUtc: state.pickSlot }
          );
          go.disabled = false;
          if (!r.data || !r.data.ok) {
            setMsg((r.data && r.data.error) || 'Nu am putut reprograma.', 'err');
            return;
          }
          setMsg('Programare mutată. Intervalul vechi este din nou liber.', 'ok');
          closeModal();
          await loadBookings();
        });
      }
    }

    $all('[data-hod-tab]', root).forEach(function (t) {
      t.addEventListener('click', function () {
        state.tab = t.getAttribute('data-hod-tab');
        paintTabs();
      });
    });

    paintAll();
    loadBookings().then(function () {
      return loadAvailability();
    });
  }

  function boot() {
    $all('[data-hidook-cal-owner]').forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
