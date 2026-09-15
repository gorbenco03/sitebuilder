/**
 * Hidook native public booking widget (VISION.md §8 step c part 1).
 * Mount: <div data-hidook-cal-native data-customer-id="…" data-site-id="…" …></div>
 * Separate from the legacy local appointment-request form — not a cutover.
 */
(function (global) {
  'use strict';

  // Monday-first weekday header for the month-grid calendar (owner request,
  // 2026-09-14: "someone may want to book 2-3 weeks ahead" — see the calendar
  // grid below replacing the old 5-21 day horizontal scroller).
  var WD_MON_RO = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'];
  var MONTH_RO = [
    'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
    'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'
  ];
  // Owner-configurable server horizon is calendar_settings.max_advance_days
  // (engine.js assertBookingWindow) — NULL by default, which the engine
  // treats as "no cap" (see engine.js's own doc comment: permissive so a
  // tenant that never configured the policy is never blocked). A month-grid
  // calendar still needs SOME forward horizon to know when to stop paging
  // "next month" and to draw the last few months as reachable — this is that
  // client-side default, used only when the tenant truly has no configured
  // cap (listPublicServices exposes the real value as maxAdvanceDays, null
  // when unset). It never disagrees with the server: the server already
  // accepts every day inside (and, when unset, well past) this window, so no
  // day the calendar offers within it can be rejected on submit.
  var DEFAULT_MAX_ADVANCE_DAYS = 60;

  function $(root, sel) { return root.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymdAdd(ymd, days) {
    var p = ymd.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** "YYYY-MM" for a (year, 1-based month) pair. */
  function monthKeyOf(y, m) { return y + '-' + pad2(m); }

  /** Number of days in (year, 1-based month), civil calendar (no TZ). */
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  /** Monday=0..Sunday=6 weekday of the 1st of (year, 1-based month). */
  function firstWeekdayMonday(y, m) {
    var wd = new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay(); // 0 Sun..6 Sat
    return (wd + 6) % 7;
  }

  /** Monday=0..Sunday=6 weekday of a YYYY-MM-DD civil date. */
  function weekdayMonday(ymd) {
    var p = ymd.split('-').map(Number);
    var wd = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay();
    return (wd + 6) % 7;
  }

  /** Full Romanian date incl. year, for a day cell's aria-label. */
  function formatFullDateRo(ymd) {
    var parts = ymd.split('-').map(Number);
    var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    var wd = dt.getUTCDay();
    var names = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
    return names[wd].charAt(0).toUpperCase() + names[wd].slice(1) +
      ', ' + parts[2] + ' ' + MONTH_RO[parts[1] - 1] + ' ' + parts[0];
  }

  function formatDayLabel(ymd, tz) {
    try {
      var noon = ymd + 'T12:00:00';
      // Parse as local civil via UTC noon anchor for weekday
      var parts = ymd.split('-').map(Number);
      var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
      var wd = dt.getUTCDay();
      var names = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
      return names[wd].charAt(0).toUpperCase() + names[wd].slice(1) +
        ', ' + parts[2] + ' ' + MONTH_RO[parts[1] - 1] +
        (tz ? ' · ' + tz : '');
    } catch (_) {
      return ymd;
    }
  }

  function formatSlotLocal(iso, tz) {
    try {
      return new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(iso));
    } catch (_) {
      return iso.slice(11, 16);
    }
  }

  function formatRangeRo(startIso, endIso, tz) {
    try {
      var dtf = new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      var start = dtf.format(new Date(startIso));
      var end = new Intl.DateTimeFormat('ro-RO', {
        timeZone: tz || 'Europe/Bucharest',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(endIso));
      return start + '–' + end;
    } catch (_) {
      return startIso + ' – ' + endIso;
    }
  }

  function buildAltHtml(cfg) {
    var bits = [];
    if (cfg.contactWhatsapp) {
      bits.push('<a href="' + escapeAttr(cfg.contactWhatsapp) + '" rel="noopener noreferrer">WhatsApp</a>');
    }
    if (cfg.contactPhone) {
      var tel = cfg.contactPhoneTel || cfg.contactPhone.replace(/\s+/g, '');
      bits.push('<a href="tel:' + escapeAttr(tel) + '">' + escapeHtml(cfg.contactPhone) + '</a>');
    }
    if (cfg.contactEmail) {
      bits.push('<a href="mailto:' + escapeAttr(cfg.contactEmail) + '">' + escapeHtml(cfg.contactEmail) + '</a>');
    }
    if (!bits.length) {
      return 'Dacă programările online nu răspund, folosește datele de contact de pe site.';
    }
    return 'Dacă programările online nu răspund: ' + bits.join(' · ');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  function apiUrl(base, path, params) {
    var u = (base || '') + path;
    if (params) {
      var q = Object.keys(params)
        .filter(function (k) { return params[k] != null && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      if (q) u += (u.indexOf('?') >= 0 ? '&' : '?') + q;
    }
    return u;
  }

  function mount(root) {
    if (!root || root.getAttribute('data-hnb-ready') === '1') return;
    root.setAttribute('data-hnb-ready', '1');
    root.classList.add('hnb');

    var cfg = {
      customerId: root.getAttribute('data-customer-id') || '',
      siteId: root.getAttribute('data-site-id') || '',
      apiBase: root.getAttribute('data-api-base') || '',
      brand: root.getAttribute('data-brand') || '',
      contactPhone: root.getAttribute('data-contact-phone') || '',
      contactPhoneTel: root.getAttribute('data-contact-phone-tel') || '',
      contactEmail: root.getAttribute('data-contact-email') || '',
      contactWhatsapp: root.getAttribute('data-contact-whatsapp') || ''
      // NOTE: data-day-count is intentionally no longer read. Pre-existing
      // published pages still carry it (baked into their HTML at publish
      // time) — this widget is fetched live by those pages on every visit,
      // so an unused attribute on #hnb-root must never break anything. It
      // doesn't: an ignored attribute is a no-op, and the month-grid
      // calendar below gets its own forward horizon from the server
      // (maxAdvanceDays) instead.
    };

    root.innerHTML = '';
    root.appendChild(el('p', 'hnb__eyebrow', 'Programări online'));
    root.appendChild(el('h1', 'hnb__title', 'Alege un interval'));
    var sub = el('p', 'hnb__sub',
      'Confirmarea este instant dacă intervalul e liber. Dacă e ocupat, cererea rămâne în așteptare — nu vei vedea niciodată „confirmat” pe un interval deja rezervat.');
    root.appendChild(sub);
    var eyebrow = root.querySelector('.hnb__eyebrow');
    var title = root.querySelector('.hnb__title');

    var steps = el('ol', 'hnb__steps');
    steps.setAttribute('aria-label', 'Pași');
    ['Serviciu', 'Dată & oră', 'Datele tale', 'Gata'].forEach(function (label, i) {
      var li = el('li', i === 0 ? 'is-current' : '', label);
      li.setAttribute('data-step', String(i));
      steps.appendChild(li);
    });
    root.appendChild(steps);

    var layout = el('div', 'hnb__layout');
    var svcCol = el('aside', 'hnb__svcs');
    svcCol.setAttribute('aria-label', 'Servicii');
    var slotPane = el('div', 'hnb__slot-pane');
    layout.appendChild(svcCol);
    layout.appendChild(slotPane);
    root.appendChild(layout);

    var loading = el('p', 'hnb__loading', 'Se încarcă programul…');
    slotPane.appendChild(loading);

    var state = {
      services: [],
      timezone: 'Europe/Bucharest',
      serviceId: null,
      dateLocal: null,
      slotsByDate: {},
      selectedStart: null,
      selectedEnd: null,
      busy: false,
      // Wave 7 (audit #25) — "pick a person or accept any available".
      // resources stays a single-item (or empty) list for a legacy tenant,
      // in which case the picker row never renders — zero visual change.
      resources: [],
      resourceId: null, // null = "Oricine disponibil"
      // Month-grid calendar (owner request 2026-09-14): today/horizon are
      // civil YYYY-MM-DD in the tenant's own timezone, computed once at
      // bootstrap (see the services fetch below). viewYear/viewMonth is the
      // month currently displayed; navigating months never refetches a
      // month already present in fetchedMonthKeys (serviceId/resourceId
      // scoped, since eligibility/occupancy differ per service and staff).
      today: null,
      maxAdvanceDays: null,
      horizonYmd: null,
      viewYear: null,
      viewMonth: null,
      fetchedMonthKeys: {},
      pendingFocusDate: null // set by keyboard month-crossing nav; consumed by renderCalendar
    };

    function setStep(idx) {
      steps.querySelectorAll('li').forEach(function (li, i) {
        li.className = i < idx ? 'is-done' : i === idx ? 'is-current' : '';
      });
    }

    function showError(title, body) {
      hideFlow();
      var box = el('div', 'hnb__result hnb__result--err');
      box.setAttribute('role', 'alert');
      box.setAttribute('data-hnb-error', '1');
      box.appendChild(el('h2', '', title || 'Programările online sunt temporar indisponibile'));
      box.appendChild(el('p', '', body || 'Nu am putut încărca calendarul acum.'));
      var hint = el('p', 'hnb__result-hint', '');
      hint.innerHTML = buildAltHtml(cfg);
      box.appendChild(hint);
      root.appendChild(box);
      setStep(0);
    }

    function hideFlow() {
      layout.hidden = true;
      layout.setAttribute('hidden', '');
      layout.style.display = 'none';
      steps.hidden = true;
      steps.setAttribute('hidden', '');
      steps.style.display = 'none';
      sub.hidden = true;
      sub.setAttribute('hidden', '');
      sub.style.display = 'none';
      if (eyebrow) {
        eyebrow.hidden = true;
        eyebrow.setAttribute('hidden', '');
        eyebrow.style.display = 'none';
      }
      if (title) {
        title.hidden = true;
        title.setAttribute('hidden', '');
        title.style.display = 'none';
      }
      // Drop any leftover loading / form chrome so only the result card remains
      root.querySelectorAll('.hnb__loading').forEach(function (n) {
        n.hidden = true;
        n.setAttribute('hidden', '');
        n.style.display = 'none';
      });
      try { slotPane.innerHTML = ''; } catch (_) { /* ignore */ }
      try { svcCol.innerHTML = ''; } catch (_) { /* ignore */ }
    }

    function showSuccess(payload) {
      hideFlow();
      var ok = payload.status === 'confirmed';
      var box = el('div', 'hnb__result ' + (ok ? 'hnb__result--ok' : 'hnb__result--wait'));
      box.setAttribute('data-hnb-success', ok ? 'confirmed' : payload.status);
      box.appendChild(el('h2', '', ok ? 'Programare confirmată' : 'Cerere înregistrată'));
      var when = formatRangeRo(payload.startUtc, payload.endUtc, state.timezone);
      var line = when + (payload.serviceName ? ' · ' + payload.serviceName : '');
      // Wave 7 (audit #25): only surfaced once meaningful (2+ resources) —
      // public-api.createPublicBooking already applies that guard, so
      // payload.resourceName is simply absent for a single-resource tenant.
      if (payload.resourceName) line += ' · cu ' + payload.resourceName;
      box.appendChild(el('p', '', line));
      if (ok) {
        box.appendChild(el('p', 'hnb__result-hint',
          'Vei primi email cu detaliile și un link de anulare / reprogramare (când livrarea email este activă).'));
      } else {
        box.appendChild(el('p', 'hnb__result-hint',
          'Intervalul ales nu a putut fi confirmat automat. Status: în așteptare. Nu e o confirmare falsă.'));
      }
      root.appendChild(box);
      setStep(3);
    }

    function fetchJson(url, opts) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      var options = opts || {};
      if (ctrl) options.signal = ctrl.signal;
      var p = fetch(url, options).then(function (res) {
        return res.json().then(function (body) {
          return { res: res, body: body };
        }).catch(function () {
          return { res: res, body: null };
        });
      });
      if (ctrl) {
        timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 15000);
        p = p.finally(function () { if (timer) clearTimeout(timer); });
      }
      return p;
    }

    function renderServices() {
      svcCol.innerHTML = '';
      state.services.forEach(function (svc, i) {
        var btn = el('button', 'hnb__svc' + (svc.id === state.serviceId ? ' is-selected' : ''), '');
        btn.type = 'button';
        btn.setAttribute('data-service-id', svc.id);
        btn.appendChild(el('span', 'hnb__svc-name', svc.name));
        btn.appendChild(el('span', 'hnb__svc-meta', svc.durationMinutes + ' min'));
        btn.addEventListener('click', function () {
          state.serviceId = svc.id;
          state.selectedStart = null;
          state.selectedEnd = null;
          renderServices();
          setStep(1);
          loadSlots();
        });
        svcCol.appendChild(btn);
        if (i === 0 && !state.serviceId) {
          state.serviceId = svc.id;
          btn.classList.add('is-selected');
        }
      });
    }

    /**
     * Month-grid calendar (owner request 2026-09-14, replacing the old
     * 5-21 day horizontal scroller): weekday header (Monday-first), a
     * prev/next month header bounded to [current month .. horizon month],
     * and one button per day of the displayed month. Days outside the
     * bookable window (past, or beyond the horizon) or with zero free
     * slots are shown disabled (aria-disabled, not hidden/removed) so the
     * grid always stays a real grid. Uses `aria-disabled` rather than the
     * native `disabled` attribute so keyboard arrow navigation can still
     * land on — and read out — an unavailable day (WAI-ARIA APG date-picker
     * pattern), while the click handler still refuses to act on it.
     */
    function renderCalendar() {
      var wrap = el('div', 'hnb__cal');

      var head = el('div', 'hnb__cal-head');
      var prevBtn = el('button', 'hnb__cal-nav hnb__cal-prev', '‹');
      prevBtn.type = 'button';
      prevBtn.setAttribute('aria-label', 'Luna anterioară');
      var title = el('span', 'hnb__cal-title', MONTH_RO[state.viewMonth - 1] + ' ' + state.viewYear);
      var nextBtn = el('button', 'hnb__cal-nav hnb__cal-next', '›');
      nextBtn.type = 'button';
      nextBtn.setAttribute('aria-label', 'Luna următoare');

      var curYear = Number(state.today.slice(0, 4));
      var curMonth = Number(state.today.slice(5, 7));
      if (state.viewYear === curYear && state.viewMonth === curMonth) {
        prevBtn.disabled = true;
      }
      prevBtn.addEventListener('click', function () { navigateMonth(-1); });

      var nm = state.viewMonth === 12 ? 1 : state.viewMonth + 1;
      var nmy = state.viewMonth === 12 ? state.viewYear + 1 : state.viewYear;
      var nextMonthFirst = monthKeyOf(nmy, nm) + '-01';
      if (nextMonthFirst > state.horizonYmd) {
        nextBtn.disabled = true;
      }
      nextBtn.addEventListener('click', function () { navigateMonth(1); });

      head.appendChild(prevBtn);
      head.appendChild(title);
      head.appendChild(nextBtn);
      wrap.appendChild(head);

      var weekdays = el('div', 'hnb__cal-weekdays');
      weekdays.setAttribute('aria-hidden', 'true');
      WD_MON_RO.forEach(function (wd) { weekdays.appendChild(el('span', '', wd)); });
      wrap.appendChild(weekdays);

      var grid = el('div', 'hnb__cal-grid');
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', 'Zile disponibile — ' + MONTH_RO[state.viewMonth - 1] + ' ' + state.viewYear);

      var monthKeyCur = monthKeyOf(state.viewYear, state.viewMonth);
      var activeYmd;
      if (state.pendingFocusDate && state.pendingFocusDate.slice(0, 7) === monthKeyCur) {
        activeYmd = state.pendingFocusDate;
      } else if (state.dateLocal && state.dateLocal.slice(0, 7) === monthKeyCur) {
        activeYmd = state.dateLocal;
      } else if (state.today.slice(0, 7) === monthKeyCur) {
        activeYmd = state.today;
      } else {
        activeYmd = monthKeyCur + '-01';
      }
      state.pendingFocusDate = null;

      var lead = firstWeekdayMonday(state.viewYear, state.viewMonth);
      for (var p = 0; p < lead; p++) grid.appendChild(el('span', 'hnb__cal-pad'));

      var dim = daysInMonth(state.viewYear, state.viewMonth);
      for (var d = 1; d <= dim; d++) {
        var ymd = monthKeyCur + '-' + pad2(d);
        var isToday = ymd === state.today;
        var isSelected = ymd === state.dateLocal;
        var bookable = ymd >= state.today && ymd <= state.horizonYmd &&
          !!(state.slotsByDate[ymd] && state.slotsByDate[ymd].length);
        var cls = 'hnb__cal-day' +
          (isToday ? ' is-today' : '') +
          (isSelected ? ' is-selected' : '') +
          (bookable ? '' : ' is-unavailable');
        var btn = el('button', cls, String(d));
        btn.type = 'button';
        btn.setAttribute('data-date', ymd);
        var label = formatFullDateRo(ymd) + (isToday ? ' · astăzi' : '') + (bookable ? '' : ' · indisponibil');
        btn.setAttribute('aria-label', label);
        if (!bookable) btn.setAttribute('aria-disabled', 'true');
        btn.tabIndex = ymd === activeYmd ? 0 : -1;
        btn.addEventListener('click', function (ev) {
          var b = ev.currentTarget;
          if (b.getAttribute('aria-disabled') === 'true') return;
          var newYmd = b.getAttribute('data-date');
          if (newYmd === state.dateLocal) return;
          state.dateLocal = newYmd;
          state.selectedStart = null;
          state.selectedEnd = null;
          renderSlotPane();
          var again = slotPane.querySelector('.hnb__cal-day[data-date="' + newYmd + '"]');
          if (again) again.focus();
        });
        btn.addEventListener('keydown', handleCalKeydown);
        grid.appendChild(btn);
      }
      var totalCells = lead + dim;
      var trail = (7 - (totalCells % 7)) % 7;
      for (var t = 0; t < trail; t++) grid.appendChild(el('span', 'hnb__cal-pad'));

      wrap.appendChild(grid);
      return wrap;
    }

    /** Arrow/Home/End roving-tabindex navigation across the day grid. */
    function handleCalKeydown(ev) {
      var deltas = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
      var cur = ev.currentTarget.getAttribute('data-date');
      if (ev.key in deltas) {
        ev.preventDefault();
        moveCalendarFocus(cur, deltas[ev.key]);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        moveCalendarFocus(cur, -weekdayMonday(cur));
      } else if (ev.key === 'End') {
        ev.preventDefault();
        moveCalendarFocus(cur, 6 - weekdayMonday(cur));
      }
    }

    function moveCalendarFocus(fromYmd, delta) {
      var target = ymdAdd(fromYmd, delta);
      // Bounded exactly like the prev/next buttons: never before the
      // current month, never past the horizon's month.
      var curMonthFirst = state.today.slice(0, 7) + '-01';
      if (target < curMonthFirst) target = curMonthFirst;
      var hy = Number(state.horizonYmd.slice(0, 4));
      var hm = Number(state.horizonYmd.slice(5, 7));
      var horizonMonthLast = monthKeyOf(hy, hm) + '-' + pad2(daysInMonth(hy, hm));
      if (target > horizonMonthLast) target = horizonMonthLast;

      var ty = Number(target.slice(0, 4));
      var tm = Number(target.slice(5, 7));
      if (ty !== state.viewYear || tm !== state.viewMonth) {
        state.pendingFocusDate = target;
        state.viewYear = ty;
        state.viewMonth = tm;
        loadMonth();
        return;
      }
      var btn = slotPane.querySelector('.hnb__cal-day[data-date="' + target + '"]');
      if (!btn) return;
      slotPane.querySelectorAll('.hnb__cal-day').forEach(function (b) { b.tabIndex = -1; });
      btn.tabIndex = 0;
      btn.focus();
    }

    function navigateMonth(delta) {
      var m = state.viewMonth + delta;
      var y = state.viewYear;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      state.viewYear = y;
      state.viewMonth = m;
      loadMonth();
    }

    /**
     * Wave 7 (audit #25) — resource picker chips: "Oricine disponibil" plus
     * one chip per named resource eligible for the selected service. Hidden
     * entirely when there's nothing to choose between (0 or 1 resource),
     * which is exactly every pre-Wave-7 tenant.
     */
    function renderResourcePicker() {
      if (state.resources.length < 2) return null;
      var row = el('div', 'hnb__resources');
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-label', 'Cu cine');
      var anyBtn = el('button', 'hnb__resource' + (state.resourceId ? '' : ' is-selected'), 'Oricine disponibil');
      anyBtn.type = 'button';
      anyBtn.addEventListener('click', function () {
        if (!state.resourceId) return;
        state.resourceId = null;
        state.selectedStart = null;
        state.selectedEnd = null;
        loadSlots();
      });
      row.appendChild(anyBtn);
      state.resources.forEach(function (r) {
        var btn = el('button', 'hnb__resource' + (state.resourceId === r.id ? ' is-selected' : ''), r.name);
        btn.type = 'button';
        btn.setAttribute('data-resource-id', r.id);
        btn.addEventListener('click', function () {
          if (state.resourceId === r.id) return;
          state.resourceId = r.id;
          state.selectedStart = null;
          state.selectedEnd = null;
          loadSlots();
        });
        row.appendChild(btn);
      });
      return row;
    }

    function renderSlotPane() {
      slotPane.innerHTML = '';
      if (!state.serviceId) {
        slotPane.appendChild(el('p', 'hnb__empty', 'Alege un serviciu.'));
        return;
      }
      if (!state.dateLocal) state.dateLocal = state.today;

      var resourceRow = renderResourcePicker();
      if (resourceRow) {
        slotPane.appendChild(el('p', 'hnb__label', 'Cu cine'));
        slotPane.appendChild(resourceRow);
      }

      slotPane.appendChild(el('p', 'hnb__label', 'Ziua'));
      slotPane.appendChild(renderCalendar());
      slotPane.appendChild(el('p', 'hnb__day-label', formatDayLabel(state.dateLocal, state.timezone)));

      slotPane.appendChild(el('p', 'hnb__label', 'Ora'));
      var grid = el('div', 'hnb__slots');
      grid.setAttribute('role', 'listbox');
      grid.setAttribute('aria-label', 'Intervale libere');
      var list = state.slotsByDate[state.dateLocal] || [];
      if (!list.length) {
        grid.appendChild(el('p', 'hnb__empty', 'Nu sunt intervale libere în această zi.'));
      } else {
        list.forEach(function (slot) {
          var btn = el('button', 'hnb__slot' + (slot.startUtc === state.selectedStart ? ' is-selected' : ''),
            formatSlotLocal(slot.startUtc, state.timezone));
          btn.type = 'button';
          btn.setAttribute('data-start', slot.startUtc);
          btn.setAttribute('data-end', slot.endUtc);
          btn.addEventListener('click', function () {
            state.selectedStart = slot.startUtc;
            state.selectedEnd = slot.endUtc;
            setStep(2);
            renderSlotPane();
          });
          grid.appendChild(btn);
        });
      }
      slotPane.appendChild(grid);

      var form = el('form', 'hnb__form');
      form.setAttribute('novalidate', 'novalidate');
      form.innerHTML =
        '<label>Nume <input name="name" type="text" autocomplete="name" required maxlength="80" /></label>' +
        '<label>Email <input name="email" type="email" autocomplete="email" required maxlength="120" /></label>' +
        '<label>Telefon <span class="hnb__opt">(opțional)</span> <input name="phone" type="tel" autocomplete="tel" maxlength="40" /></label>' +
        '<label>Notă scurtă <span class="hnb__opt">(opțional)</span> <input name="note" type="text" maxlength="200" placeholder="ex. prima vizită" /></label>';
      slotPane.appendChild(form);
      slotPane.appendChild(el('p', 'hnb__privacy',
        'Păstrăm doar nume, email, telefon (dacă îl lași) și nota. Fără CNP, fără fișiere.'));

      var cta = el('button', 'hnb__cta', 'Confirmă programarea');
      cta.type = 'button';
      cta.setAttribute('data-hnb-submit', '1');
      cta.addEventListener('click', function () { submitBooking(form, cta); });
      slotPane.appendChild(cta);

      var alt = el('p', 'hnb__alt', '');
      alt.innerHTML = buildAltHtml(cfg);
      slotPane.appendChild(alt);

      var inlineErr = el('div', 'hnb__result hnb__result--err');
      inlineErr.hidden = true;
      inlineErr.setAttribute('data-hnb-inline-error', '1');
      inlineErr.setAttribute('role', 'alert');
      slotPane.appendChild(inlineErr);
    }

    /** First/last YYYY-MM-DD of (year, 1-based month). */
    function monthBounds(y, m) {
      return { first: monthKeyOf(y, m) + '-01', last: monthKeyOf(y, m) + '-' + pad2(daysInMonth(y, m)) };
    }

    /** serviceId/resourceId/month-scoped cache key — occupancy is per (service, staff). */
    function monthFetchKey(y, m) {
      return state.serviceId + '|' + (state.resourceId || '') + '|' + monthKeyOf(y, m);
    }

    function mergeSlots(list) {
      (list || []).forEach(function (s) {
        var d = s.dateLocal || String(s.startUtc || '').slice(0, 10);
        if (!state.slotsByDate[d]) state.slotsByDate[d] = [];
        state.slotsByDate[d].push(s);
      });
    }

    /**
     * Fetch free slots for one visible month in ONE request (not one per
     * day) — clamped to [today, horizon] so a month straddling either edge
     * never asks the server for a range it would reject or ignore, and a
     * month entirely outside that window (e.g. before "today") skips the
     * network call altogether.
     */
    function fetchMonthSlots(y, m) {
      var b = monthBounds(y, m);
      var from = b.first < state.today ? state.today : b.first;
      var to = b.last > state.horizonYmd ? state.horizonYmd : b.last;
      if (from > to) return Promise.resolve({ skipped: true });
      var url = apiUrl(cfg.apiBase, '/api/calendar-native/slots', {
        customerId: cfg.customerId,
        siteId: cfg.siteId,
        serviceId: state.serviceId,
        resourceId: state.resourceId || undefined,
        from: from,
        to: to
      });
      return fetchJson(url);
    }

    function resetAvailabilityCache() {
      state.slotsByDate = {};
      state.fetchedMonthKeys = {};
    }

    /** Month navigation (prev/next button or keyboard) — service/resource unchanged. */
    function loadMonth() {
      var key = monthFetchKey(state.viewYear, state.viewMonth);
      if (state.fetchedMonthKeys[key]) {
        renderSlotPane();
        focusActiveCalDay();
        return;
      }
      slotPane.innerHTML = '';
      slotPane.appendChild(el('p', 'hnb__loading', 'Se încarcă programul…'));
      fetchMonthSlots(state.viewYear, state.viewMonth).then(function (pack) {
        if (pack && pack.skipped) {
          state.fetchedMonthKeys[key] = true;
          renderSlotPane();
          focusActiveCalDay();
          return;
        }
        if (!pack.res.ok || !pack.body || !pack.body.ok) {
          showError(
            'Programările online sunt temporar indisponibile',
            'Nu am putut încărca intervalele libere. Te rugăm să încerci mai târziu sau să ne contactezi direct.'
          );
          return;
        }
        mergeSlots(pack.body.slots);
        state.fetchedMonthKeys[key] = true;
        renderSlotPane();
        focusActiveCalDay();
      }).catch(function () {
        showError(
          'Programările online sunt temporar indisponibile',
          'Conexiunea a eșuat sau a expirat. Nu am înregistrat nicio programare.'
        );
      });
    }

    /** After a month (re)render, hand keyboard focus to the roving-tabindex cell. */
    function focusActiveCalDay() {
      var btn = slotPane.querySelector('.hnb__cal-day[tabindex="0"]');
      if (btn) btn.focus();
    }

    /** Service/resource selection changed — reset the cache and (re)load the current view month. */
    function loadSlots() {
      if (!state.serviceId) return;
      resetAvailabilityCache();
      slotPane.innerHTML = '';
      slotPane.appendChild(el('p', 'hnb__loading', 'Se încarcă intervalele…'));
      // Wave 7 (audit #25): resources eligible for THIS service — refetched
      // whenever the service changes since eligibility is per-service.
      var resUrl = apiUrl(cfg.apiBase, '/api/calendar-native/resources', {
        customerId: cfg.customerId,
        siteId: cfg.siteId,
        serviceId: state.serviceId
      });
      Promise.all([fetchMonthSlots(state.viewYear, state.viewMonth), fetchJson(resUrl)]).then(function (packs) {
        var pack = packs[0];
        var resPack = packs[1];
        if (!pack || pack.skipped) {
          // Whole view month is outside [today, horizon] — nothing to merge.
        } else if (!pack.res.ok || !pack.body || !pack.body.ok) {
          showError(
            'Programările online sunt temporar indisponibile',
            'Nu am putut încărca intervalele libere. Te rugăm să încerci mai târziu sau să ne contactezi direct.'
          );
          return;
        } else {
          state.timezone = pack.body.timezone || state.timezone;
          mergeSlots(pack.body.slots);
        }
        state.fetchedMonthKeys[monthFetchKey(state.viewYear, state.viewMonth)] = true;
        state.resources = (resPack.res.ok && resPack.body && resPack.body.ok) ? (resPack.body.resources || []) : [];
        // The service just changed and no longer offers the previously
        // selected resource (or the picker is being hidden) — fall back to
        // "any available" rather than silently keeping a stale filter.
        if (state.resourceId && !state.resources.some(function (r) { return r.id === state.resourceId; })) {
          state.resourceId = null;
        }
        renderSlotPane();
      }).catch(function () {
        showError(
          'Programările online sunt temporar indisponibile',
          'Conexiunea a eșuat sau a expirat. Nu am înregistrat nicio programare.'
        );
      });
    }

    function submitBooking(form, cta) {
      if (state.busy) return;
      var inline = slotPane.querySelector('[data-hnb-inline-error]');
      if (inline) {
        inline.hidden = true;
        inline.innerHTML = '';
      }
      var name = (form.elements.name && form.elements.name.value || '').trim();
      var email = (form.elements.email && form.elements.email.value || '').trim();
      var phone = (form.elements.phone && form.elements.phone.value || '').trim();
      var note = (form.elements.note && form.elements.note.value || '').trim();
      if (!name || !email || !state.selectedStart) {
        if (inline) {
          inline.hidden = false;
          inline.appendChild(el('h2', '', 'Completează datele'));
          inline.appendChild(el('p', '', 'Completează numele, emailul și un interval orar.'));
        }
        return;
      }
      state.busy = true;
      cta.disabled = true;
      cta.textContent = 'Se trimite…';
      var url = apiUrl(cfg.apiBase, '/api/calendar-native/bookings');
      fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: cfg.customerId,
          siteId: cfg.siteId,
          serviceId: state.serviceId,
          resourceId: state.resourceId || undefined,
          startUtc: state.selectedStart,
          visitorName: name,
          visitorEmail: email,
          visitorPhone: phone || undefined,
          note: note || undefined
        })
      }).then(function (pack) {
        state.busy = false;
        if (!pack.res.ok || !pack.body || !pack.body.ok) {
          cta.disabled = false;
          cta.textContent = 'Confirmă programarea';
          var msg = (pack.body && pack.body.error) ||
            'Nu am putut înregistra programarea. Încearcă din nou sau folosește contactul de mai jos.';
          // Hard outage (5xx / network-shaped): full error panel, never fake success
          if (!pack.res.ok && pack.res.status >= 500) {
            showError('Programările online sunt temporar indisponibile', msg);
            return;
          }
          if (inline) {
            inline.hidden = false;
            inline.appendChild(el('h2', '', 'Nu am putut confirma'));
            inline.appendChild(el('p', '', msg));
            var h = el('p', 'hnb__result-hint', '');
            h.innerHTML = buildAltHtml(cfg);
            inline.appendChild(h);
          }
          return;
        }
        showSuccess(pack.body);
      }).catch(function () {
        state.busy = false;
        cta.disabled = false;
        cta.textContent = 'Confirmă programarea';
        showError(
          'Programările online sunt temporar indisponibile',
          'Conexiunea a eșuat sau a expirat. Nu am înregistrat nicio programare.'
        );
      });
    }

    // Bootstrap services
    var svcUrl = apiUrl(cfg.apiBase, '/api/calendar-native/services', {
      customerId: cfg.customerId,
      siteId: cfg.siteId
    });
    fetchJson(svcUrl).then(function (pack) {
      if (!pack.res.ok || !pack.body || !pack.body.ok) {
        showError(
          'Programările online sunt temporar indisponibile',
          'Nu am putut încărca serviciile acum. Te rugăm să ne contactezi direct.'
        );
        return;
      }
      state.timezone = pack.body.timezone || state.timezone;
      state.services = pack.body.services || [];
      if (!state.services.length) {
        showError(
          'Programările online nu sunt configurate',
          'Nu există servicii active pentru acest site.'
        );
        return;
      }
      // Month-grid calendar bootstrap: "today" is computed once, in the
      // tenant's own timezone — every day comparison below (bookable range,
      // is-today, prev/next bounds) is plain civil YYYY-MM-DD string math
      // from this single anchor, never re-derived from the visitor's local
      // clock/timezone.
      var todayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: state.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var get = function (t) {
        return (todayParts.find(function (p) { return p.type === t; }) || {}).value;
      };
      state.today = get('year') + '-' + get('month') + '-' + get('day');
      state.maxAdvanceDays = pack.body.maxAdvanceDays != null ? pack.body.maxAdvanceDays : DEFAULT_MAX_ADVANCE_DAYS;
      state.horizonYmd = ymdAdd(state.today, state.maxAdvanceDays);
      state.viewYear = Number(state.today.slice(0, 4));
      state.viewMonth = Number(state.today.slice(5, 7));
      state.dateLocal = state.today;
      loading.remove();
      renderServices();
      setStep(1);
      loadSlots();
    }).catch(function () {
      showError(
        'Programările online sunt temporar indisponibile',
        'Conexiunea a eșuat sau a expirat. Nu am înregistrat nicio programare.'
      );
    });
  }

  function autoMount(scope) {
    var root = scope || document;
    root.querySelectorAll('[data-hidook-cal-native]').forEach(mount);
  }

  global.HidookNativeBooking = { mount: mount, autoMount: autoMount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { autoMount(document); });
  } else {
    autoMount(document);
  }
})(typeof window !== 'undefined' ? window : this);
