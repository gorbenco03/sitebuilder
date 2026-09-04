/**
 * Hidook native public booking widget (VISION.md §8 step c part 1).
 * Mount: <div data-hidook-cal-native data-customer-id="…" data-site-id="…" …></div>
 * Separate from the legacy local appointment-request form — not a cutover.
 */
(function (global) {
  'use strict';

  var WD_RO = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'];
  var MONTH_RO = [
    'ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
    'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'
  ];

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
      contactWhatsapp: root.getAttribute('data-contact-whatsapp') || '',
      dayCount: Math.min(21, Math.max(5, parseInt(root.getAttribute('data-day-count') || '14', 10) || 14))
    };

    root.innerHTML = '';
    root.appendChild(el('p', 'hnb__eyebrow', 'Programări online'));
    root.appendChild(el('h1', 'hnb__title', 'Alege un interval'));
    var sub = el('p', 'hnb__sub',
      'Confirmarea este instant dacă intervalul e liber. Dacă e ocupat, cererea rămâne în așteptare — nu vei vedea niciodată „confirmat” pe un slot deja rezervat.');
    root.appendChild(sub);

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
      busy: false
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
      steps.hidden = true;
      sub.hidden = true;
    }

    function showSuccess(payload) {
      hideFlow();
      var ok = payload.status === 'confirmed';
      var box = el('div', 'hnb__result ' + (ok ? 'hnb__result--ok' : 'hnb__result--wait'));
      box.setAttribute('data-hnb-success', ok ? 'confirmed' : payload.status);
      box.appendChild(el('h2', '', ok ? 'Programare confirmată' : 'Cerere înregistrată'));
      var when = formatRangeRo(payload.startUtc, payload.endUtc, state.timezone);
      var line = when + (payload.serviceName ? ' · ' + payload.serviceName : '');
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

    function dayButtons(fromYmd) {
      var row = el('div', 'hnb__days');
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-label', 'Zile disponibile');
      for (var i = 0; i < cfg.dayCount; i++) {
        var ymd = ymdAdd(fromYmd, i);
        var parts = ymd.split('-').map(Number);
        var dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
        var wd = dt.getUTCDay();
        var btn = el('button', 'hnb__day' + (ymd === state.dateLocal ? ' is-selected' : ''), '');
        btn.type = 'button';
        btn.setAttribute('data-date', ymd);
        btn.innerHTML = WD_RO[wd] + '<br><strong>' + parts[2] + '</strong>';
        btn.addEventListener('click', function (ev) {
          state.dateLocal = ev.currentTarget.getAttribute('data-date');
          state.selectedStart = null;
          state.selectedEnd = null;
          renderSlotPane();
        });
        row.appendChild(btn);
      }
      return row;
    }

    function renderSlotPane() {
      slotPane.innerHTML = '';
      if (!state.serviceId) {
        slotPane.appendChild(el('p', 'hnb__empty', 'Alege un serviciu.'));
        return;
      }
      var todayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: state.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var get = function (t) {
        return (todayParts.find(function (p) { return p.type === t; }) || {}).value;
      };
      var todayYmd = get('year') + '-' + get('month') + '-' + get('day');
      if (!state.dateLocal) state.dateLocal = todayYmd;

      slotPane.appendChild(el('p', 'hnb__label', 'Ziua'));
      slotPane.appendChild(dayButtons(todayYmd));
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

    function loadSlots() {
      if (!state.serviceId) return;
      slotPane.innerHTML = '';
      slotPane.appendChild(el('p', 'hnb__loading', 'Se încarcă intervalele…'));
      var todayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: state.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var get = function (t) {
        return (todayParts.find(function (p) { return p.type === t; }) || {}).value;
      };
      var from = get('year') + '-' + get('month') + '-' + get('day');
      var to = ymdAdd(from, cfg.dayCount - 1);
      var url = apiUrl(cfg.apiBase, '/api/calendar-native/slots', {
        customerId: cfg.customerId,
        siteId: cfg.siteId,
        serviceId: state.serviceId,
        from: from,
        to: to
      });
      fetchJson(url).then(function (pack) {
        if (!pack.res.ok || !pack.body || !pack.body.ok) {
          showError(
            'Programările online sunt temporar indisponibile',
            'Nu am putut încărca intervalele libere. Te rugăm să încerci mai târziu sau să ne contactezi direct.'
          );
          return;
        }
        state.timezone = pack.body.timezone || state.timezone;
        state.slotsByDate = {};
        (pack.body.slots || []).forEach(function (s) {
          var d = s.dateLocal || String(s.startUtc || '').slice(0, 10);
          if (!state.slotsByDate[d]) state.slotsByDate[d] = [];
          state.slotsByDate[d].push(s);
        });
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
